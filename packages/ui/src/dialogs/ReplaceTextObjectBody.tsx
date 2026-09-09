import { useLingui } from '@lingui/react';
import { MAX_REPLACED_TEXT } from '@monstera/contract';
import { type ReactElement, useState } from 'react';

import {
  REPLACE_TEXT_OBJECT_APPLY,
  REPLACE_TEXT_OBJECT_CHOOSE,
  REPLACE_TEXT_OBJECT_EXPLAINS,
  REPLACE_TEXT_OBJECT_NEW_TEXT,
  REPLACE_TEXT_OBJECT_NONE,
  REPLACE_TEXT_OBJECT_TOO_LONG,
  REPLACE_TEXT_OBJECT_TRUNCATED,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ReplaceTextObjectAnswer } from './replaceTextObjectResult.js';

/**
 * Choosing one of the page's text objects and typing what replaces it.
 *
 * ## WHAT AN INDEX IS, SAID BEFORE ANY IS OFFERED
 *
 * `FlatFieldsBody`'s rule — *what was guessed is said before the list* — with a
 * different thing to say. The engine answers positions in the page's object
 * order and nothing a reader recognises, so a bare list of numbers reads as
 * error codes. The sentence above it is what makes the control usable at all,
 * and it is the honest form of a limitation the two rows after this one close.
 *
 * ## NOTHING IS PRESELECTED
 *
 * The opposite of the flat-field review, and for the opposite reason: there,
 * the list is a proposal and most of it is right, so starting ticked makes
 * rejecting the odd one the whole job. Here every option is equally likely and
 * the edit is destructive — an apply that landed on whichever object happened
 * to be first would be one keystroke from replacing text the reader never
 * looked at. So the apply is disabled until somebody has chosen.
 *
 * ## The length rule is shown, not enforced afterwards
 *
 * `MAX_REPLACED_TEXT` is the command's own bound, imported rather than
 * restated (`LinkAddressBody`'s argument). Meeting it as a disabled button and
 * a sentence beats meeting it as a refusal over the document.
 *
 * **An empty replacement is allowed**, which is why there is no *empty* message
 * beside the too-long one: emptying a run is an edit somebody means to make,
 * and the schema accepts it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ReplaceTextObjectBody({
  indices,
  truncated,
  resolve,
}: {
  readonly indices: readonly number[];
  readonly truncated: boolean;
} & DialogAnswering<ReplaceTextObjectAnswer>): ReactElement {
  const { _ } = useLingui();
  const [chosen, setChosen] = useState<number | null>(null);
  const [text, setText] = useState('');

  const tooLong = text.length > MAX_REPLACED_TEXT;

  return (
    <div className="m-replace-text-object">
      <p className="m-replace-text-object__explains">{_(REPLACE_TEXT_OBJECT_EXPLAINS)}</p>
      {truncated ? (
        <p className="m-replace-text-object__truncated" role="status">
          {_(REPLACE_TEXT_OBJECT_TRUNCATED)}
        </p>
      ) : null}
      {indices.length === 0 ? (
        <p className="m-replace-text-object__none">{_(REPLACE_TEXT_OBJECT_NONE)}</p>
      ) : (
        <>
          <fieldset className="m-replace-text-object__choice">
            <legend className="m-replace-text-object__legend">
              {_(REPLACE_TEXT_OBJECT_CHOOSE)}
            </legend>
            {indices.map((index) => (
              <label className="m-replace-text-object__option" key={index}>
                <input
                  checked={chosen === index}
                  name="m-replace-text-object"
                  onChange={() => {
                    setChosen(index);
                  }}
                  type="radio"
                />
                {/* THE ENGINE'S OWN NUMBER, rendered as itself. A position in
                    this list would be a second numbering of the same page —
                    the one thing the channel's own header forbids — and it
                    would agree with the engine's exactly until a page had a
                    non-text object before a text one. */}
                <span className="m-replace-text-object__index">{index}</span>
              </label>
            ))}
          </fieldset>
          <Input
            label={REPLACE_TEXT_OBJECT_NEW_TEXT}
            onValueChange={setText}
            value={text}
          />
          {tooLong ? (
            <p className="m-replace-text-object__too-long" role="alert">
              {_(REPLACE_TEXT_OBJECT_TOO_LONG)}
            </p>
          ) : null}
          <Button
            disabled={chosen === null || tooLong}
            label={REPLACE_TEXT_OBJECT_APPLY}
            onClick={() => {
              // GUARDED AGAIN rather than trusting the disabled attribute, for
              // `FlatFieldsBody`'s reason: the result schema refuses a text
              // past the bound and has no shape for an absent index, and a
              // resolve that reached either would surface as an internal error
              // over a button the reader could press.
              if (chosen === null || tooLong) return;
              resolve({ index: chosen, text });
            }}
            variant="primary"
          />
        </>
      )}
    </div>
  );
}
