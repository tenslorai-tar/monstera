import { useLingui } from '@lingui/react';
import { MAX_ANNOTATION_TEXT } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import { attemptProblem, useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input, TextArea } from '../primitives/Input.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * The words for an annotation or a link — the form every dialog that asks for one piece of text renders: a note, a
 * text box, a callout, a typewriter, a reply, an edited comment, a link's address, a link's page and an address to open.
 * The first six take several lines (`multiline`), the last three one.
 *
 * ## Why this is a component and not a second dialog body
 *
 * The text box and the sticky note ask a person the same question and mean
 * different things by it, so what differs between their dialogs is **the
 * words**: *Add text box* against *Add note*, and a refusal sentence that names
 * the right object. Everything else — the trim, the two refusals, the disabled
 * control, the guard behind it — is one behaviour.
 *
 * The alternatives were both worse. A **single dialog with a `writes`
 * discriminant in its props** would put user-facing wording behind a value
 * crossing a zod schema, and `declareDialog` takes its title statically, so the
 * title could not follow the discriminant and would have to go generic — a
 * shipped dialog losing specificity to make room for a new one. A **copied
 * body** is fifty lines of validation logic in two files, which is where the
 * two come apart the day the bound changes.
 *
 * So each dialog keeps its own declaration, its own title and its own message
 * keys, and they share the part that has no words in it. The keys arrive as
 * ordinary props rather than through the props schema, which keeps B9's rule
 * intact: every string a person reads is still a key resolved by `useLingui`,
 * declared statically in the module that owns the dialog.
 *
 * ## When a refusal is shown (`attempt.ts`)
 *
 * What is typed being WRONG — too long, or failing the dialog's own rule — is
 * said as it is typed, and the action is disabled while it is. NOTHING TYPED is
 * said only once the person presses the action, which stays enabled so that it
 * can be pressed: a dialog that opened by telling the person what they had not
 * typed yet read as already wrong (the owner, 2026-10-03). Until this read
 * *"the refusals are shown before the button is pressed"*, emptiness included.
 *
 * Emptiness has one subtlety, and it is the one that is easy to miss. **Whitespace is
 * empty**, because a `/FreeText` carrying three spaces renders as a rectangle
 * with an invisible border, and a `/Text` carrying three spaces is an icon a
 * reader clicks to be shown nothing. So the trim is what emptiness is judged
 * on here, exactly as the result schema judges it on the way out.
 *
 * ## The trim happens once, and the schema is where
 *
 * This tests `text.trim()` and hands `resolve` the RAW value; the result schema
 * trims. Trimming here as well would be two writers for one normalisation, and
 * the one that matters is the schema's — it is what the answer is validated
 * against and what any other caller of these dialogs would meet. What this does
 * is decide whether the control is usable, which is a rendering question about
 * the same string.
 */
export interface AnnotationTextFormProps {
  /** The field's label. */
  readonly label: MessageKey;
  /** The confirming control, which says exactly what it will add. */
  readonly apply: MessageKey;
  /** Shown while the value is blank, naming what it is blank for. */
  readonly empty: MessageKey;
  /** Shown when the value is past the payload's bound. */
  readonly tooLong: MessageKey;
  /**
   * The bound this dialog's payload carries. Defaults to the annotation text's.
   *
   * A PARAMETER because the link dialogs' payload is a shorter field, and a
   * form that accepted 4,096 characters for a 2,048-character schema would be
   * the dialog accepting what the channel refuses — which is the exact defect
   * `annotationTextResult.ts` cites for importing the bound rather than
   * restating it.
   */
  readonly limit?: number;
  /**
   * An extra rule this dialog's value must pass, or `undefined` for none.
   *
   * Returns the key of the sentence to show. It runs on the TRIMMED value and
   * only when that value is non-empty, so a rule never has to repeat the two
   * refusals every caller shares.
   *
   * It exists because a link's page number is a different kind of wrong from a
   * comment's emptiness, and a person who typed *seven* should be told so
   * rather than meeting a control that closes and does nothing.
   */
  readonly validate?: (value: string) => MessageKey | undefined;
  /**
   * What the field starts with. Empty for the two dialogs that CREATE a mark.
   *
   * *Edit* is the caller with something to put here, and the value is the text
   * the selection carried from the walk rather than a read taken now — a
   * selection is a set of handles at one version, and text fetched when the
   * dialog opened would describe a document those handles may no longer name.
   *
   * The initial value is seeded into state once and then owned by the field, so
   * a person's typing is never overwritten by a re-render.
   */
  readonly initial?: string;
  /**
   * Whether the words run to sentences — a note, a text box, a reply, a comment — and so take the multi-line box that
   * grows with them. An address or a page number stays one line.
   */
  readonly multiline?: boolean;
  /** The dialog's own `resolve`. */
  readonly resolve: (answer: AnnotationTextAnswer) => void;
}

export function AnnotationTextForm({
  label,
  apply,
  empty,
  tooLong,
  limit = MAX_ANNOTATION_TEXT,
  validate,
  initial = '',
  multiline = false,
  resolve,
}: AnnotationTextFormProps): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState(initial);
  const attempt = useAttempt();
  const form = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  const over = trimmed.length > limit;
  const failed = trimmed.length > 0 && !over ? validate?.(trimmed) : undefined;
  const usable = trimmed.length > 0 && !over && failed === undefined;
  // WHAT IS TYPED BEING WRONG is said at once; NOTHING TYPED only once the person has pressed the action (`attempt.ts`).
  const invalid = over ? tooLong : failed;
  const problem = attemptProblem(attempt, invalid, trimmed.length === 0, empty);

  return (
    <div className="m-annotation-text" ref={form}>
      <DialogRow label={label} problem={problem === undefined ? undefined : _(problem)}>
        {multiline ? (
          <TextArea
            invalid={problem !== undefined}
            label={label}
            labelShownBeside
            onValueChange={setText}
            opensFocused
            value={text}
          />
        ) : (
          <Input
            invalid={problem !== undefined}
            label={label}
            labelShownBeside
            onValueChange={setText}
            opensFocused
            value={text}
          />
        )}
      </DialogRow>
      <DialogFooter>
        <Button
          // ENABLED WHILE EMPTY, so pressing it can say what is missing; disabled only while what is typed is wrong,
          // which the row already says.
          disabled={invalid !== undefined}
          label={apply}
          onClick={() => {
            attempt.attempt();
            // GUARDED rather than trusting the disabled attribute, for `DeletePagesBody`'s reason: the schema behind
            // `resolve` refuses an empty string, so a mismatch would throw `DialogResultRejected` over the user's
            // document rather than doing nothing. A refused press puts the person back in the field.
            if (!usable) {
              form.current?.querySelector<HTMLElement>('input, textarea')?.focus();
              return;
            }
            resolve({ text });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
