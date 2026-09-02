import { useLingui } from '@lingui/react';
import { type ReactElement, useCallback, useId, useState } from 'react';

import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import {
  FIND_EMPTY,
  FIND_LABEL,
  FIND_MATCHES,
  FIND_REFUSED,
  FIND_SUBMIT,
  FIND_TRUNCATED,
} from './messages/en.js';

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
 * **Searching only the current page is a limit, and it is the honest one to
 * start with.** A document-wide search is this channel per page with a
 * cancellable walk over them, which the row names as *background indexing* and
 * which needs a results surface to arrive into.
 *
 * ## The result is a COUNT and the lines, not a navigable list
 *
 * Navigation between matches needs a current match, a next-match affordance and
 * a way to scroll a page that does not scroll yet — all of which belong with
 * continuous scroll. What ships is what can be true today: how many matches this
 * page holds and which lines they are on, which is observable, correct, and
 * survives being asked twice.
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
  | { readonly kind: 'refused' };

export function FindBar({ client, docId, page }: FindBarProps): ReactElement | null {
  const { _ } = useLingui();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<FindState>({ kind: 'idle' });
  const inputId = useId();

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
    });

    // A REFUSAL IS RENDERED, never swallowed. `document-busy` and its siblings
    // leave the document as it was, and a find bar that showed "0 matches" for
    // one would tell the user their word is absent from a document nobody
    // looked in.
    if (!answer.ok) {
      setState({ kind: 'refused' });
      return;
    }
    setState({
      kind: 'answered',
      lines: answer.value.matches.map((match) => match.text),
      truncated: answer.value.truncated,
    });
  }, [client, docId, page, query]);

  if (docId === undefined) return null;

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
      {state.kind === 'refused' ? <p className="m-find-problem">{_(FIND_REFUSED)}</p> : null}
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
    </form>
  );
}
