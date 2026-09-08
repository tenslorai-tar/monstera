import { useLingui } from '@lingui/react';
import type { SpellingLanguage } from '@monstera/contract';
import { type ReactElement, useState } from 'react';

import {
  SPELL_CHECK_ADD,
  SPELL_CHECK_ADDED,
  SPELL_CHECK_CLEAN,
  SPELL_CHECK_FIRST_PAGE,
  SPELL_CHECK_LANGUAGE,
  SPELL_CHECK_NO_SUGGESTIONS,
  SPELL_CHECK_OCCURRENCES,
  SPELL_CHECK_PARTIAL,
  SPELL_CHECK_SAVE,
  SPELL_CHECK_SUGGESTIONS,
  SPELL_CHECK_UNAVAILABLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { languageTitle } from '../spelling/languages.js';
import type { SpellCheckAnswer } from './spellCheckResult.js';

/** One misspelling, as the command found it. */
interface Listed {
  readonly word: string;
  readonly occurrences: number;
  readonly firstPage: number;
  readonly suggestions: readonly string[];
}

/**
 * What the document's spelling came to, and where a word joins the personal
 * dictionary.
 *
 * ## THREE OUTCOMES, and they are three messages rather than one empty list
 *
 * A document with no misspellings, a document that was never checked because
 * the dictionary would not load, and a walk that stopped after two pages all
 * produce a short or empty list. Only the first of them means *your spelling is
 * fine*, and telling them apart is the whole reason this body has three
 * branches — `found nothing` is the answer a reader was hoping for, which is
 * exactly when it must be said out loud rather than shown as blank space.
 *
 * ## The page number is one-BASED here and nowhere else
 *
 * Everything kernel-side counts from zero and this is the surface a person
 * reads, so the `+ 1` happens once, here, at the boundary between the two
 * frames. `CLAUDE.md`'s worked example is the rotate command whose two halves
 * each held a correct number in a different frame; the difference is that this
 * one is a display and nothing round-trips through it.
 *
 * ## Adding is a LOCAL list until the reader saves it
 *
 * Each add marks the row and grows a list; the button writes the whole list
 * through the result. Writing each word as it is clicked would mean a reader
 * who mis-clicks has already changed a stored setting with no undo — a personal
 * dictionary has no command log behind it — and the button is what makes the
 * change one decision the reader took rather than several they accumulated.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SpellCheckBody({
  available,
  language,
  misspellings,
  pagesChecked,
  pageCount,
  resolve,
}: {
  readonly available: boolean;
  readonly language: SpellingLanguage;
  readonly misspellings: readonly Listed[];
  readonly pagesChecked: number;
  readonly pageCount: number;
} & DialogAnswering<SpellCheckAnswer>): ReactElement {
  const { _ } = useLingui();
  const [added, setAdded] = useState<readonly string[]>([]);

  if (!available) {
    return (
      <div className="m-spell-check">
        <p className="m-spell-check__unavailable" role="status">
          {_(SPELL_CHECK_UNAVAILABLE)}
        </p>
      </div>
    );
  }

  return (
    <div className="m-spell-check">
      {/* The dictionary is named because a reader looking at a list of words
          their document uses needs to know what it was judged against — and
          because with one language shipped there is no control that would
          otherwise say so. */}
      <p className="m-spell-check__language">
        {_(SPELL_CHECK_LANGUAGE, { language: _(languageTitle(language)) })}
      </p>
      {pagesChecked < pageCount ? (
        <p className="m-spell-check__partial" data-partial="true" role="status">
          {_(SPELL_CHECK_PARTIAL, { counted: pagesChecked, total: pageCount })}
        </p>
      ) : null}
      {misspellings.length === 0 ? (
        <p className="m-spell-check__clean">{_(SPELL_CHECK_CLEAN)}</p>
      ) : (
        <>
          <ul className="m-spell-check__list">
            {misspellings.map((entry) => (
              <li className="m-spell-check__row" key={entry.word}>
                <span className="m-spell-check__word">{entry.word}</span>
                <span className="m-spell-check__where">
                  {_(SPELL_CHECK_OCCURRENCES, { count: entry.occurrences })}
                  {', '}
                  {_(SPELL_CHECK_FIRST_PAGE, { page: entry.firstPage + 1 })}
                </span>
                <span className="m-spell-check__suggestions">
                  {entry.suggestions.length === 0
                    ? _(SPELL_CHECK_NO_SUGGESTIONS)
                    : `${_(SPELL_CHECK_SUGGESTIONS)}: ${entry.suggestions.join(', ')}`}
                </span>
                {added.includes(entry.word) ? (
                  <span className="m-spell-check__added" data-added="true">
                    {_(SPELL_CHECK_ADDED)}
                  </span>
                ) : (
                  <Button
                    label={SPELL_CHECK_ADD}
                    onClick={() => {
                      setAdded((held) => [...held, entry.word]);
                    }}
                    values={{ word: entry.word }}
                  />
                )}
              </li>
            ))}
          </ul>
          <Button
            disabled={added.length === 0}
            label={SPELL_CHECK_SAVE}
            onClick={() => {
              // GUARDED AGAIN rather than trusting the disabled attribute, for
              // `FlatFieldsBody`'s reason — except that here an empty list is a
              // legal result, so what this guard prevents is a write of nothing
              // rather than a schema refusal. A reader with nothing to add
              // dismisses, which settles the dialog without touching a setting.
              if (added.length === 0) return;
              resolve({ added: [...added] });
            }}
            values={{ count: added.length }}
            variant="primary"
          />
        </>
      )}
    </div>
  );
}
