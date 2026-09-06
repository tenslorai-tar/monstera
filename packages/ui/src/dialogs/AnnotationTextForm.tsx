import { useLingui } from '@lingui/react';
import { MAX_ANNOTATION_TEXT } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * One line of text for an annotation — the form two dialogs render.
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
 * ## The refusals are shown before the button is pressed
 *
 * `DeletePagesBody`'s shape and its argument: the apply control is disabled
 * while the value is unusable and the reason is on screen, so a person meets a
 * sentence rather than a dialog that closes and does nothing.
 *
 * Two of them, and the first is the one that is easy to miss. **Whitespace is
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
  /** The dialog's own `resolve`. */
  readonly resolve: (answer: AnnotationTextAnswer) => void;
}

export function AnnotationTextForm({
  label,
  apply,
  empty,
  tooLong,
  resolve,
}: AnnotationTextFormProps): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState('');

  const trimmed = text.trim();
  const over = trimmed.length > MAX_ANNOTATION_TEXT;
  const usable = trimmed.length > 0 && !over;

  return (
    <div className="m-annotation-text">
      <Input label={label} onValueChange={setText} value={text} />
      <p className="m-annotation-text__problem" role="status">
        {over ? _(tooLong) : trimmed.length > 0 ? '' : _(empty)}
      </p>
      <Button
        disabled={!usable}
        label={apply}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `DeletePagesBody`'s reason: a disabled control is a rendering
          // decision, and the schema behind `resolve` refuses an empty string —
          // so a mismatch would throw `DialogResultRejected` over the user's
          // document rather than doing nothing.
          if (!usable) return;
          resolve({ text });
        }}
        variant="primary"
      />
    </div>
  );
}
