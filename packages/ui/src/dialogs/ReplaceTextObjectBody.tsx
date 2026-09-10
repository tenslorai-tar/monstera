import { useLingui } from '@lingui/react';
import { MAX_REPLACED_TEXT } from '@monstera/contract';
import { type ReactElement, useState } from 'react';

import { type LineRun, lineText, replacementsForLine } from '../lineEdit.js';
import {
  REPLACE_TEXT_OBJECT_APPLY,
  REPLACE_TEXT_OBJECT_CHOOSE,
  REPLACE_TEXT_OBJECT_EXPLAINS,
  REPLACE_TEXT_OBJECT_NEW_TEXT,
  REPLACE_TEXT_OBJECT_NONE,
  REPLACE_TEXT_OBJECT_TOO_LONG,
  REPLACE_TEXT_OBJECT_TRUNCATED,
  REPLACE_TEXT_OBJECT_UNADDRESSABLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ReplaceTextObjectAnswer } from './replaceTextObjectResult.js';

/** One line as the dialog is handed it. */
interface OfferedLine {
  readonly runs: readonly LineRun[];
}

/**
 * Choosing one of the page's lines and editing what it says.
 *
 * ## THE PERSON CONFIRMS THE GROUPING, which is a decision and not a courtesy
 *
 * ADR-0049 Decision 3: the editor's line grouping is the editor's own, no
 * engine having an opinion about lines, so **nothing is written until a person
 * has seen the line the editor formed and agreed it is a line.** Choosing a row
 * here is that confirmation. It is why the grouping is allowed to exist at all,
 * and why this dialog is its only consumer.
 *
 * ## The text is shown, and that is the whole difference from what shipped
 *
 * The predecessor listed object indices, because the channel behind it answered
 * numbers. `FlatFieldsBody`'s rule — *what was guessed is said before the list*
 * — still applies to the sentence above the rows, but the rows themselves are
 * now words a reader recognises, so the sentence explains what a line is rather
 * than what an index is.
 *
 * ## NOTHING IS PRESELECTED
 *
 * The opposite of the flat-field review, and for the opposite reason: there,
 * the list is a proposal and most of it is right, so starting ticked makes
 * rejecting the odd one the whole job. Here every option is equally likely and
 * the edit is destructive — an apply that landed on whichever line happened to
 * be first would be one keystroke from replacing text the reader never looked
 * at. So the apply is disabled until somebody has chosen.
 *
 * ## Choosing a line FILLS the input with what it says
 *
 * An empty box beside a chosen line would mean *clear this line*, and a person
 * who clicked a row to read it more closely and then pressed apply would erase
 * it. Filling the box makes the default action **change nothing**, which is
 * also what disables the button: an unedited line produces no replacements.
 *
 * ## The apply is disabled when the diff names NOTHING
 *
 * `replaceTextObjectSchema` refuses an empty list, because regenerating a
 * page's content stream for no change is the whole cost of an edit paid for
 * nothing. Meeting that as a disabled button rather than as a refusal over the
 * document is the same argument the length rule below makes.
 *
 * ## The length rule is shown, not enforced afterwards
 *
 * `MAX_REPLACED_TEXT` is the command's own bound, imported rather than restated
 * (`LinkAddressBody`'s argument). It is checked against the **longest
 * replacement the diff produced** and not against the whole line, because that
 * is what the command carries: a line longer than the bound spread over several
 * runs is legal, and refusing it would be this dialog inventing a limit.
 *
 * **An empty replacement is allowed**, which is why there is no *empty* message
 * beside the too-long one: clearing a line is an edit somebody means to make.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ReplaceTextObjectBody({
  lines,
  truncated,
  unaddressable,
  resolve,
}: {
  readonly lines: readonly OfferedLine[];
  readonly truncated: boolean;
  readonly unaddressable: boolean;
} & DialogAnswering<ReplaceTextObjectAnswer>): ReactElement {
  const { _ } = useLingui();
  const [chosen, setChosen] = useState<number | null>(null);
  const [text, setText] = useState('');

  const line = chosen === null ? undefined : lines[chosen];
  const replacements = line === undefined ? [] : replacementsForLine(line.runs, text);
  const tooLong = replacements.some((replacement) => replacement.text.length > MAX_REPLACED_TEXT);
  const unchanged = replacements.length === 0;

  return (
    <div className="m-replace-text-object">
      <p className="m-replace-text-object__explains">{_(REPLACE_TEXT_OBJECT_EXPLAINS)}</p>
      {truncated ? (
        <p className="m-replace-text-object__truncated" role="status">
          {_(REPLACE_TEXT_OBJECT_TRUNCATED)}
        </p>
      ) : null}
      {/* SHOWN BESIDE AN EMPTY LIST TOO, and that is the case it matters most
          for: a page whose text is ENTIRELY inside a Form XObject lists nothing,
          and *this page has no text* would be a false sentence about a page
          covered in words. So this sits above the empty message rather than
          inside the populated branch. */}
      {unaddressable ? (
        <p className="m-replace-text-object__unaddressable" role="status">
          {_(REPLACE_TEXT_OBJECT_UNADDRESSABLE)}
        </p>
      ) : null}
      {lines.length === 0 ? (
        <p className="m-replace-text-object__none">{_(REPLACE_TEXT_OBJECT_NONE)}</p>
      ) : (
        <>
          <fieldset className="m-replace-text-object__choice">
            <legend className="m-replace-text-object__legend">
              {_(REPLACE_TEXT_OBJECT_CHOOSE)}
            </legend>
            {lines.map((offered, at) => (
              <label
                className="m-replace-text-object__option"
                // THE ROW'S POSITION, and it is a React key rather than an
                // identifier that goes anywhere: two lines may say the same
                // words, so the text is not unique, and the object index is the
                // engine's and must not become a list position by habit. What
                // travels on the wire is copied from `offered.runs`.
                key={at}
              >
                <input
                  checked={chosen === at}
                  name="m-replace-text-object"
                  onChange={() => {
                    setChosen(at);
                    // FILLED FROM THE LINE, so the default action changes
                    // nothing. See the header: an empty box beside a chosen row
                    // would make *look closer, then apply* an erasure.
                    setText(lineText(offered.runs));
                  }}
                  type="radio"
                />
                <span className="m-replace-text-object__line">{lineText(offered.runs)}</span>
              </label>
            ))}
          </fieldset>
          <Input label={REPLACE_TEXT_OBJECT_NEW_TEXT} onValueChange={setText} value={text} />
          {tooLong ? (
            <p className="m-replace-text-object__too-long" role="alert">
              {_(REPLACE_TEXT_OBJECT_TOO_LONG)}
            </p>
          ) : null}
          <Button
            disabled={chosen === null || tooLong || unchanged}
            label={REPLACE_TEXT_OBJECT_APPLY}
            onClick={() => {
              // GUARDED AGAIN rather than trusting the disabled attribute, for
              // `FlatFieldsBody`'s reason: the result schema refuses an empty
              // list and a text past the bound, and a resolve that reached
              // either would surface as an internal error over a button the
              // reader could press.
              if (chosen === null || tooLong || unchanged) return;
              // COPIED, because the result schema infers a mutable array and
              // `replacementsForLine` answers a readonly one. A cast would have
              // compiled and handed the caller this render's array.
              resolve({ replacements: [...replacements] });
            }}
            variant="primary"
          />
        </>
      )}
    </div>
  );
}
