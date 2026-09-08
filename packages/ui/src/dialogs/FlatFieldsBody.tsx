import { useLingui } from '@lingui/react';
import { type ReactElement, useState } from 'react';

import {
  FLAT_FIELDS_ACCEPT,
  FLAT_FIELDS_ALL_TEXT,
  FLAT_FIELDS_GUESSED,
  FLAT_FIELDS_NONE,
  FLAT_FIELDS_TRUNCATED,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { FlatFieldsAnswer } from './flatFieldsResult.js';

/**
 * What the page probably has, and the offer to create it.
 *
 * ## WHAT WAS GUESSED IS SAID BEFORE THE LIST, which is `DuplicatePagesBody`'s
 * rule
 *
 * The detector cannot tell a field from an empty table cell — measured, and it
 * is a fact about pages rather than about this build. A list headed *fields*
 * with no such sentence is one a person accepts without asking what it means,
 * and the cost of accepting a wrong one is a field on their document.
 *
 * ## EVERY BOX STARTS TICKED
 *
 * The list is a proposal, and the common case on a form that has any candidates
 * is that most of them are right. Starting empty would make the reader do the
 * detector's work twice; starting ticked makes rejecting the odd one the whole
 * of their job. The accept is disabled when nothing is ticked, because
 * `createFormField` refuses an empty list — a reader who wants none dismisses.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function FlatFieldsBody({
  candidates,
  truncated,
  resolve,
}: {
  readonly candidates: readonly { readonly name: string; readonly label: string }[];
  readonly truncated: boolean;
} & DialogAnswering<FlatFieldsAnswer>): ReactElement {
  const { _ } = useLingui();
  const [rejected, setRejected] = useState<readonly string[]>([]);
  const accepted = candidates
    .map((candidate) => candidate.name)
    .filter((name) => !rejected.includes(name));

  return (
    <div className="m-flat-fields">
      <p className="m-flat-fields__guessed">{_(FLAT_FIELDS_GUESSED)}</p>
      {truncated ? (
        <p className="m-flat-fields__truncated" role="status">
          {_(FLAT_FIELDS_TRUNCATED)}
        </p>
      ) : null}
      {candidates.length === 0 ? (
        <p className="m-flat-fields__none">{_(FLAT_FIELDS_NONE)}</p>
      ) : (
        <>
          <ul className="m-flat-fields__list">
            {candidates.map((candidate) => (
              <li className="m-flat-fields__row" key={candidate.name}>
                <label className="m-flat-fields__label">
                  <input
                    checked={!rejected.includes(candidate.name)}
                    onChange={(event) => {
                      setRejected((held) =>
                        event.currentTarget.checked
                          ? held.filter((name) => name !== candidate.name)
                          : [...held, candidate.name],
                      );
                    }}
                    type="checkbox"
                  />
                  {/* THE DOCUMENT'S OWN WORDS, and the derived name beside
                      them. The label is what the reader recognises on the page;
                      the name is what the field will be called, and a person
                      confirming a proposal needs to see both. */}
                  <span className="m-flat-fields__caption">{candidate.label}</span>
                  <span className="m-flat-fields__name">{candidate.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="m-flat-fields__kinds">{_(FLAT_FIELDS_ALL_TEXT)}</p>
          <Button
            disabled={accepted.length === 0}
            label={FLAT_FIELDS_ACCEPT}
            onClick={() => {
              // GUARDED AGAIN rather than trusting the disabled attribute, for
              // `DuplicatePagesBody`'s reason: the result schema refuses an
              // empty list, and a resolve that reached it would surface as an
              // internal error over a button the reader could press.
              if (accepted.length === 0) return;
              resolve({ accepted });
            }}
            values={{ count: accepted.length }}
            variant="primary"
          />
        </>
      )}
    </div>
  );
}
