import { useLingui } from '@lingui/react';
import { type ReactElement, useCallback, useId, useRef, useState } from 'react';

import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { type DocumentMatch, searchDocument } from './documentSearch.js';
import {
  FIND_ALL_PAGES,
  FIND_BAD_PATTERN,
  FIND_CANCEL,
  FIND_CANCELLED,
  FIND_CASE_SENSITIVE,
  FIND_DOCUMENT_EMPTY,
  FIND_DOCUMENT_MATCHES,
  FIND_EMPTY,
  FIND_LABEL,
  FIND_MATCHES,
  FIND_MATCH_ON_PAGE,
  FIND_MATCH_POSITION,
  FIND_NEXT_MATCH,
  FIND_PREVIOUS_MATCH,
  FIND_PROGRESS,
  FIND_REFUSED,
  FIND_REGEX,
  FIND_SUBMIT,
  FIND_TRUNCATED,
  FIND_WHOLE_WORD,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';

/**
 * The find bar: E2's text substrate, reached by a person.
 *
 * ## Why the query lives here rather than in a command's parameters
 *
 * A registered command's `run(context)` takes the application's state and no
 * arguments — which is right, because a command is something a menu, a chord and
 * a palette can all invoke, and none of them can supply a string. A search needs
 * one, so the string belongs to a surface and the command's job is to send the
 * user to it. `document.find` focuses this field; submitting it searches.
 *
 * ## ONE PAGE, and it is the CURRENT one rather than a literal
 *
 * A search runs over the page the reader is looking at, which the scroller
 * reports and `CommandContext` carries. It went out as `SHOWN_PAGE.kernel` while
 * the renderer drew one page; continuous scroll made that a live value rather
 * than a constant, and the property that mattered survived the change — the
 * number is never typed here, because PDF.js counts from 1 and this build has
 * already sent the wrong one once, in a rotate, where nothing on screen could
 * disagree.
 *
 * That is also what makes the wired pair meaningful. The kernel's cases assert
 * which page was searched and this surface's assert which page was requested;
 * neither holds a literal, so a disagreement is a visible edit to the one place
 * the correspondence lives.
 *
 * ## The WHOLE DOCUMENT is the same channel, per page, and it is cancellable
 *
 * `searchDocument` walks the pages one at a time, because ADR-0035 says a
 * document's text never lands in `main` at once. **A cancelled walk publishes
 * nothing** — see that module — so this surface has no state in which a partial
 * count can be shown, and the button that cancels does not have to also clear
 * anything.
 *
 * ## The document walk IS navigable, and the page search is not
 *
 * This section said navigation *"needs a current match, a next-match affordance
 * and a way to scroll a page that does not scroll yet — all of which belong
 * with continuous scroll"*. Continuous scroll landed in `215fb1d` and the
 * sentence stayed, which is the shape `CLAUDE.md` item 7 names: a claim
 * falsified by a commit that never touched the file holding it. The trigger had
 * fired and only this comment could have said so.
 *
 * So the whole-document result carries an **active match** and `onJump` moves
 * the scroller to its page. The per-page result deliberately does not: every
 * match it holds is on the page the reader is already looking at, so a jump
 * would be a scroll to where they are, and a *match 3 of 7* readout that never
 * moved anything is the display-only defect with a number on it.
 *
 * What is still owed is highlighting the match's own glyphs, which needs DOM
 * ranges over a text layer — D4's *Select and copy* row, in Stage 5. Landing on
 * the right page is what can be true today.
 */
export interface FindBarProps {
  readonly client: ContractClient;
  /**
   * The open document. The bar renders nothing without one.
   *
   * `DocId` rather than `string`, and the brand earned its place here on the
   * first compile: this was written `string` and the channel refused it, which
   * is invariant L2 as a type rather than as a rule about what a renderer holds.
   */
  readonly docId: DocId | undefined;
  /** The page to search, zero-based, from the scroller. */
  readonly page: number | undefined;
  /** How many pages the document has, for the whole-document walk. */
  readonly pageCount: number | undefined;
  /**
   * Move the scroller to a page, ZERO-BASED as the document model indexes them.
   *
   * The same `navigator.jumpTo` a thumbnail, an outline entry and the status
   * bar's field dispatch — passed in rather than reached for, so this surface
   * has no second way to move the reader.
   */
  readonly onJump: (page: number) => void;
}

/**
 * How many matches one page's search asks for.
 *
 * Under the contract's `MAX_SEARCH_MATCHES` ceiling and stated here rather than
 * defaulted there, because `truncated` only means something against a limit the
 * caller chose — see the channel's own note.
 */
const PAGE_LIMIT = 100;

/** What the bar is showing: nothing asked, an answer, or a refusal. */
type FindState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'answered'; readonly lines: readonly string[]; readonly truncated: boolean }
  | {
      readonly kind: 'document';
      readonly matches: readonly DocumentMatch[];
      readonly truncated: boolean;
      /**
       * Which match the reader is on, an index into `matches`.
       *
       * IN THE SAME VARIANT as the list it indexes, rather than a `useState` of
       * its own, because the illegal state here is *an index and a list that
       * disagree* — a second search that answered with fewer matches while a
       * separate `active` still held 40 would read a match that is not there.
       * One `setState` replaces both or neither (B5).
       *
       * `-1` for a walk that found nothing, so the navigation controls have a
       * state to be absent in that is not a valid position.
       */
      readonly active: number;
    }
  | { readonly kind: 'searching'; readonly done: number; readonly count: number }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'bad-pattern' }
  | { readonly kind: 'refused' };

/** The three flags a person can set, as the channel names them. */
interface FindOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export function FindBar({
  client,
  docId,
  page,
  pageCount,
  onJump,
}: FindBarProps): ReactElement | null {
  const { _ } = useLingui();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<FindOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [state, setState] = useState<FindState>({ kind: 'idle' });
  const inputId = useId();
  // A REF, not state: aborting must not re-render, and the walk holds this
  // controller for its whole life. Kept so the cancel button can reach the walk
  // that is running rather than one a re-render rebuilt.
  const walk = useRef<AbortController | null>(null);

  const search = useCallback(async (): Promise<void> => {
    if (docId === undefined || page === undefined) return;
    // AN EMPTY QUERY IS NOT A SEARCH. The channel refuses it and the kernel
    // refuses it; refusing it here too means the user does not meet a validation
    // failure for having an empty box, which is the state the box starts in.
    if (query === '') {
      setState({ kind: 'idle' });
      return;
    }

    const answer = await client['document.searchPage']({
      docId,
      page,
      query,
      limit: PAGE_LIMIT,
      ...options,
    });

    // A REFUSAL IS RENDERED, never swallowed. `document-busy` and its siblings
    // leave the document as it was, and a find bar that showed "0 matches" for
    // one would tell the user their word is absent from a document nobody
    // looked in.
    if (!answer.ok) {
      // A BAD PATTERN IS ITS OWN STATE, because it is the only refusal here
      // that is about what the user typed rather than about the document —
      // "this page could not be searched" is the wrong sentence for a missing
      // bracket, and it is the one a reader would act on by retrying.
      setState({ kind: answer.error.code === 'search-pattern-invalid' ? 'bad-pattern' : 'refused' });
      return;
    }
    setState({
      kind: 'answered',
      lines: answer.value.matches.map((match) => match.text),
      truncated: answer.value.truncated,
    });
  }, [client, docId, options, page, query]);

  const searchAll = useCallback(async (): Promise<void> => {
    if (docId === undefined || pageCount === undefined || query === '') return;

    const controller = new AbortController();
    walk.current = controller;
    setState({ kind: 'searching', done: 0, count: pageCount });

    const outcome = await searchDocument({
      client,
      docId,
      pageCount,
      query,
      perPage: PAGE_LIMIT,
      options,
      signal: controller.signal,
      onProgress: ({ pagesSearched }) => {
        setState({ kind: 'searching', done: pagesSearched, count: pageCount });
      },
    });

    walk.current = null;
    if (outcome.kind === 'cancelled') {
      setState({ kind: 'cancelled' });
      return;
    }
    if (outcome.kind === 'refused') {
      setState({
        kind: outcome.code === 'search-pattern-invalid' ? 'bad-pattern' : 'refused',
      });
      return;
    }
    // THE FIRST MATCH IS THE ACTIVE ONE AND THE READER IS TAKEN TO IT. A walk
    // that reported *12 matches* and left the reader on the page they started
    // from makes them find the first one by hand, which is the work the walk
    // just did.
    const first = outcome.matches[0];
    setState({
      kind: 'document',
      matches: outcome.matches,
      truncated: outcome.truncated,
      active: first === undefined ? -1 : 0,
    });
    if (first !== undefined) onJump(first.page);
  }, [client, docId, onJump, options, pageCount, query]);

  /**
   * Step the active match and take the reader to its page.
   *
   * **It wraps**, in both directions. A reader on the last match pressing
   * *next* is asking to continue, and a control that did nothing there is
   * indistinguishable from one that is broken — the position readout is what
   * makes the wrap legible rather than disorienting, which is why the two ship
   * together.
   *
   * The modulo is written with `+ count` because JavaScript's `%` keeps the
   * sign of its left operand, so `(0 - 1) % n` is `-1` rather than the last
   * index — the spelling without it walks backwards off the front of the list.
   *
   * The jump happens HERE and not in the state updater: React invokes an
   * updater twice under StrictMode, and a scroll is not a thing to do twice
   * because it happened to be cheap the first time.
   */
  const step = useCallback(
    (by: 1 | -1): void => {
      if (state.kind !== 'document' || state.active === -1) return;
      const count = state.matches.length;
      const active = (state.active + by + count) % count;
      const match = state.matches[active];
      if (match === undefined) return;
      setState({ ...state, active });
      onJump(match.page);
    },
    [onJump, state],
  );

  if (docId === undefined) return null;

  const searching = state.kind === 'searching';

  return (
    <form
      className="m-find-bar"
      onSubmit={(event) => {
        event.preventDefault();
        void search();
      }}
    >
      <label htmlFor={inputId}>{_(FIND_LABEL)}</label>
      <input
        id={inputId}
        // `data-find-input` so the command can focus it without this surface
        // exporting a ref through the registry — a command that reached into a
        // component's internals would be the second wiring place the registry
        // exists to forbid.
        data-find-input="true"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <button type="submit">{_(FIND_SUBMIT)}</button>
      {pageCount === undefined ? null : searching ? (
        <button
          type="button"
          data-find-cancel="true"
          onClick={() => {
            walk.current?.abort();
          }}
        >
          {_(FIND_CANCEL)}
        </button>
      ) : (
        <button
          type="button"
          data-find-all="true"
          onClick={() => {
            void searchAll();
          }}
        >
          {_(FIND_ALL_PAGES)}
        </button>
      )}
      <fieldset className="m-find-options">
        {OPTION_ROWS.map(({ key, label }) => (
          <label key={key}>
            <input
              type="checkbox"
              data-find-option={key}
              checked={options[key]}
              onChange={(event) => {
                const checked = event.target.checked;
                setOptions((current) => ({ ...current, [key]: checked }));
              }}
            />
            {_(label)}
          </label>
        ))}
      </fieldset>
      {state.kind === 'refused' ? <p className="m-find-problem">{_(FIND_REFUSED)}</p> : null}
      {state.kind === 'bad-pattern' ? (
        <p className="m-find-problem">{_(FIND_BAD_PATTERN)}</p>
      ) : null}
      {state.kind === 'cancelled' ? <p className="m-find-problem">{_(FIND_CANCELLED)}</p> : null}
      {searching ? (
        <p className="m-find-progress">{_(FIND_PROGRESS, { done: state.done, count: state.count })}</p>
      ) : null}
      {state.kind === 'answered' ? (
        <div className="m-find-results">
          <p>
            {state.lines.length === 0
              ? _(FIND_EMPTY)
              : _(FIND_MATCHES, { count: state.lines.length })}
          </p>
          {state.truncated ? <p className="m-find-truncated">{_(FIND_TRUNCATED)}</p> : null}
          <ul>
            {state.lines.map((line, index) => (
              // The index is part of the key because two matches on one line are
              // two results with identical text, and a key that collided would
              // make React drop one of them.
              <li key={`${String(index)}:${line}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.kind === 'document' ? (
        <div className="m-find-results">
          <p>
            {state.matches.length === 0
              ? _(FIND_DOCUMENT_EMPTY)
              : _(FIND_DOCUMENT_MATCHES, { count: state.matches.length })}
          </p>
          {state.truncated ? <p className="m-find-truncated">{_(FIND_TRUNCATED)}</p> : null}
          {state.active === -1 ? null : (
            <div className="m-find-navigation">
              <button
                type="button"
                data-find-previous="true"
                onClick={() => {
                  step(-1);
                }}
              >
                {_(FIND_PREVIOUS_MATCH)}
              </button>
              {/* ONE-BASED FOR A READER, like every other count on screen. The
                  active index is an index into the list; nobody is shown
                  "match 0 of 12". */}
              <p className="m-find-position">
                {_(FIND_MATCH_POSITION, {
                  position: state.active + 1,
                  count: state.matches.length,
                })}
              </p>
              <button
                type="button"
                data-find-next="true"
                onClick={() => {
                  step(1);
                }}
              >
                {_(FIND_NEXT_MATCH)}
              </button>
            </div>
          )}
          <ul>
            {state.matches.map((match, index) => (
              <li
                key={`${String(index)}:${String(match.page)}:${String(match.offset)}`}
                // `aria-current` rather than a class alone: which match a reader
                // is on is information, and a screen reader that only gets the
                // list gets a count with no position in it.
                aria-current={index === state.active ? 'true' : undefined}
                className={index === state.active ? 'm-find-match is-active' : 'm-find-match'}
              >
                {/* THE PAGE AS A READER COUNTS IT. The walk carries the
                    kernel's zero-based index and `pdfjsPageOf` is the one
                    place the two numbering schemes meet. */}
                {_(FIND_MATCH_ON_PAGE, { page: pdfjsPageOf(match.page), text: match.text })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

/**
 * The option checkboxes, as data.
 *
 * A row per flag rather than three near-identical blocks: the flags differ only
 * in their name and their label, and three copies of a checkbox is three places
 * to forget `data-find-option` — which is what a UI test finds them by.
 */
const OPTION_ROWS = [
  { key: 'caseSensitive', label: FIND_CASE_SENSITIVE },
  { key: 'wholeWord', label: FIND_WHOLE_WORD },
  { key: 'regex', label: FIND_REGEX },
] as const satisfies readonly { key: keyof FindOptions; label: (typeof FIND_REGEX)[][number] }[];
