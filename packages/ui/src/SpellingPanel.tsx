import { useLingui } from '@lingui/react';
import { type ReactElement, useState, useSyncExternalStore } from 'react';

import type { DocumentStore } from './documentStores.js';
import {
  CONTEXT_PANEL_TAB_SPELLING,
  SPELLING_ADD,
  SPELLING_AGAIN,
  SPELLING_ALSO,
  SPELLING_CHANGE_TO,
  SPELLING_CLEAN,
  SPELLING_CLEAN_TITLE,
  SPELLING_DONE,
  SPELLING_EMPTY_TITLE,
  SPELLING_FINISHED,
  SPELLING_IGNORE,
  SPELLING_IGNORE_ALL,
  SPELLING_INTRO,
  SPELLING_LANGUAGE,
  SPELLING_NO_SUGGESTIONS,
  SPELLING_OPTION_COMMENTS,
  SPELLING_OPTION_FIELDS,
  SPELLING_PROGRESS,
  SPELLING_READING,
  SPELLING_REFUSED,
  SPELLING_REPLACE,
  SPELLING_REPLACE_ALL,
  SPELLING_START,
  SPELLING_STOP,
  SPELLING_SUGGESTIONS,
  SPELLING_SUGGESTIONS_HEADING,
  SPELLING_UNAVAILABLE,
  SPELLING_WHERE_COMMENT,
  SPELLING_WHERE_FIELD,
  SPELLING_WHERE_TEXT,
  SPELLING_WORD,
} from './messages/en.js';
import { Button } from './primitives/Button.js';
import { Input } from './primitives/Input.js';
import { Problem } from './primitives/Problem.js';
import { SPELLING_COMMENTS_SETTING, SPELLING_FIELDS_SETTING } from './settings/editing.js';
import type { SettingsStore } from './settingsStore.js';
import { activeLanguage, languageTitle } from './spelling/languages.js';
import type { SpellingOccurrence, SpellingReview } from './spelling/review.js';
import {
  type SpellingDeps,
  addToDictionary,
  coverChanged,
  ignoreAll,
  ignoreWord,
  replaceAll,
  replaceWord,
  startReview,
  stopReview,
} from './spelling/reviewRun.js';
import { useSetting } from './useSetting.js';

/**
 * The context panel's Spelling tab (ADR-0156): one misspelt word at a time, beside the page that shows it.
 *
 * ## It reads the review and writes none of it
 *
 * The review is the document's (`DocumentState.spelling`), so it survives the tab being switched away from and is
 * dropped with the document; `reviewRun.ts` is its one writer, and every control here calls it. What is this panel's
 * own is the word being typed into *Change to*, which starts as the first suggestion for each word.
 *
 * ## The controls stay put while the word changes
 *
 * Ignore and Replace move the review on, and a keyboard user pressing one again expects to stay on it. So the buttons
 * are never keyed on the word: only the field's text follows it, and focus does not move.
 */
export interface SpellingPanelProps {
  readonly deps: SpellingDeps;
  /** The focused document's store, which holds its review. */
  readonly store: DocumentStore;
  readonly settings: SettingsStore;
}

/** The document's review, as its store holds it now. */
export function useSpellingReview(store: DocumentStore | undefined): SpellingReview | undefined {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => store?.getState().spelling);
}

function NO_SUBSCRIBE(): () => void {
  return () => undefined;
}

/** A name for an occurrence that changes when the review moves to another word, for the typed field to follow. */
function keyOf(occurrence: SpellingOccurrence): string {
  const { place } = occurrence;
  const row = place.kind === 'text' ? place.line : place.index;
  return `${place.kind}:${String(place.page)}:${String(row)}:${String(place.offset)}:${occurrence.word}`;
}

/** How many characters of the text around the word are shown on each side. */
const CONTEXT_REACH = 48;

/** The text around the word, cut at a space within reach, with an ellipsis where it was cut. */
function around(occurrence: SpellingOccurrence): { readonly before: string; readonly after: string } {
  const { context, word } = occurrence;
  const start = occurrence.place.offset;
  const end = start + word.length;
  let from = Math.max(0, start - CONTEXT_REACH);
  if (from > 0) from = Math.max(from, context.indexOf(' ', from) + 1);
  let to = Math.min(context.length, end + CONTEXT_REACH);
  if (to < context.length) {
    const space = context.lastIndexOf(' ', to);
    if (space > end) to = space;
  }
  return {
    before: `${from > 0 ? '…' : ''}${context.slice(from, start)}`,
    after: `${context.slice(end, to)}${to < context.length ? '…' : ''}`,
  };
}

export function SpellingPanel({ deps, store, settings }: SpellingPanelProps): ReactElement {
  const { i18n } = useLingui();
  const review = useSpellingReview(store);
  const pageCount = useSyncExternalStore(store.subscribe, () => store.getState().pageCount);
  const comments = useSetting(settings, SPELLING_COMMENTS_SETTING);
  const fields = useSetting(settings, SPELLING_FIELDS_SETTING);
  const [typed, setTyped] = useState<{ readonly for: string; readonly text: string } | undefined>(undefined);

  const start = (): void => {
    if (pageCount !== undefined && pageCount > 0) void startReview(deps, store, pageCount);
  };
  const again = (
    <Button label={review === undefined ? SPELLING_START : SPELLING_AGAIN} disabled={pageCount === undefined} onClick={start} variant="primary" />
  );

  const options = (
    <fieldset className="m-spelling__options">
      <legend>{i18n._(SPELLING_ALSO)}</legend>
      {(
        [
          [SPELLING_COMMENTS_SETTING, comments, SPELLING_OPTION_COMMENTS],
          [SPELLING_FIELDS_SETTING, fields, SPELLING_OPTION_FIELDS],
        ] as const
      ).map(([setting, on, label]) => (
        <label className="m-spelling__option" key={setting.id}>
          <input
            type="checkbox"
            checked={on}
            onChange={() => {
              settings.set(setting.id, !on);
              void coverChanged(deps, store);
            }}
          />
          <span>{i18n._(label)}</span>
        </label>
      ))}
    </fieldset>
  );

  const language = (
    <p className="m-spelling__language">
      {i18n._(SPELLING_LANGUAGE, { language: i18n._(languageTitle(activeLanguage())) })}
    </p>
  );

  /** The panel's head: where the review is, and the language it checks against (the owner, 2026-10-08). */
  const head = (progress: string, where: string): ReactElement => (
    <header className="m-spelling__head">
      <div className="m-spelling__head-line">
        <p className="m-spelling__progress">{progress}</p>
        <p className="m-spelling__tongue">{i18n._(languageTitle(activeLanguage()))}</p>
      </div>
      <p className="m-spelling__where">{where}</p>
    </header>
  );

  let body: ReactElement;
  let header: ReactElement | null = null;
  if (review === undefined) {
    // THE EMPTY STATE: what the review will do, and the one button that starts it.
    body = (
      <div className="m-spelling__state">
        <p className="m-spelling__state-title">{i18n._(SPELLING_EMPTY_TITLE)}</p>
        <p>{i18n._(SPELLING_INTRO)}</p>
        <div className="m-spelling__actions m-spelling__actions--single">{again}</div>
      </div>
    );
  } else if (review.phase === 'reading') {
    body = (
      <div className="m-spelling__state">
        <p role="status">{i18n._(SPELLING_READING, { checked: String(review.checked), count: String(review.pageCount) })}</p>
        <div className="m-spelling__actions m-spelling__actions--single">
          <Button
            label={SPELLING_STOP}
            onClick={() => {
              stopReview(store);
            }}
          />
        </div>
      </div>
    );
  } else if (review.phase === 'unavailable' || review.phase === 'refused') {
    body = (
      <div className="m-spelling__state">
        <Problem message={i18n._(review.phase === 'unavailable' ? SPELLING_UNAVAILABLE : SPELLING_REFUSED)} />
        <div className="m-spelling__actions m-spelling__actions--single">{again}</div>
      </div>
    );
  } else if (review.current === undefined) {
    // THE FINISHED STATE, said plainly: a clean document and a reviewed one are different sentences, and both are said.
    const clean = review.occurrences.length === 0 && review.replaced === 0;
    body = (
      <div className="m-spelling__state" role="status">
        <p className="m-spelling__state-title">{i18n._(clean ? SPELLING_CLEAN_TITLE : SPELLING_FINISHED)}</p>
        <p>{clean ? i18n._(SPELLING_CLEAN) : i18n._(SPELLING_DONE, { replaced: review.replaced })}</p>
        <div className="m-spelling__actions m-spelling__actions--single">{again}</div>
      </div>
    );
  } else {
    const current = review.current;
    const key = keyOf(current);
    const text = typed?.for === key ? typed.text : (review.suggestions[0] ?? current.word);
    const choose = (next: string): void => {
      setTyped({ for: key, text: next });
    };
    const { before, after } = around(current);
    const page = String(current.place.page + 1);
    const where =
      current.place.kind === 'text'
        ? i18n._(SPELLING_WHERE_TEXT, { page })
        : current.place.kind === 'comment'
          ? i18n._(SPELLING_WHERE_COMMENT, { page })
          : i18n._(SPELLING_WHERE_FIELD, { page, name: current.name ?? '' });
    // NOTHING TO WRITE while an edit is on its way, or for a word that would become itself.
    const unchanged = text === current.word;
    const position = review.occurrences.indexOf(current);
    header = head(
      position < 0
        ? i18n._(SPELLING_WORD)
        : i18n._(SPELLING_PROGRESS, { position: String(position + 1), total: String(review.occurrences.length) }),
      where,
    );
    body = (
      <>
        <div className="m-spelling__current" aria-live="polite">
          <p className="m-spelling__label">{i18n._(SPELLING_WORD)}</p>
          <p className="m-spelling__word">{current.word}</p>
          <p className="m-spelling__context" dir="auto">
            {before}
            <mark>{current.word}</mark>
            {after}
          </p>
        </div>
        <div className="m-spelling__change">
          <Input label={SPELLING_CHANGE_TO} value={text} onValueChange={choose} />
        </div>
        {review.suggestions.length === 0 ? null : <p className="m-spelling__label">{i18n._(SPELLING_SUGGESTIONS_HEADING)}</p>}
        <div className="m-spelling__suggestions" role="group" aria-label={i18n._(SPELLING_SUGGESTIONS)}>
          {review.suggestions.length === 0 ? (
            <p>{i18n._(SPELLING_NO_SUGGESTIONS)}</p>
          ) : (
            review.suggestions.map((suggestion) => (
              <button
                aria-pressed={suggestion === text}
                className="m-spelling__suggestion"
                key={suggestion}
                onClick={() => {
                  choose(suggestion);
                }}
                type="button"
              >
                {suggestion}
              </button>
            ))
          )}
        </div>
        <div className="m-spelling__actions">
          <Button
            label={SPELLING_REPLACE}
            variant="primary"
            disabled={review.busy || unchanged}
            onClick={() => {
              void replaceWord(deps, store, text);
            }}
          />
          <Button
            label={SPELLING_REPLACE_ALL}
            disabled={review.busy || unchanged}
            onClick={() => {
              void replaceAll(deps, store, text);
            }}
          />
          <Button
            label={SPELLING_IGNORE}
            disabled={review.busy}
            onClick={() => {
              ignoreWord(store);
            }}
          />
          <Button
            label={SPELLING_IGNORE_ALL}
            disabled={review.busy}
            onClick={() => {
              ignoreAll(store);
            }}
          />
          <Button
            label={SPELLING_ADD}
            disabled={review.busy}
            onClick={() => {
              addToDictionary(deps, store);
            }}
          />
        </div>
        {/* WHAT THE LAST ACTION COULD NOT DO is a warning, and looks like one. */}
        <Problem message={review.notice === undefined ? undefined : i18n._(review.notice)} />
      </>
    );
  }

  return (
    <section aria-label={i18n._(CONTEXT_PANEL_TAB_SPELLING)} className="m-spelling">
      {header}
      {body}
      {options}
      {language}
    </section>
  );
}
