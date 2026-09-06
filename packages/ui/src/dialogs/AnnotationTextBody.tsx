import { useLingui } from '@lingui/react';
import { MAX_ANNOTATION_TEXT } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  ANNOTATION_TEXT_APPLY,
  ANNOTATION_TEXT_EMPTY,
  ANNOTATION_TEXT_LABEL,
  ANNOTATION_TEXT_TOO_LONG,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * What a text box says, collected after its box has been drawn.
 *
 * ## The refusals are shown before the button is pressed
 *
 * `DeletePagesBody`'s shape and its argument: the apply control is disabled
 * while the value is unusable and the reason is on screen, so a person meets a
 * sentence rather than a dialog that closes and does nothing.
 *
 * Two of them, and the first is the one that is easy to miss. **Whitespace is
 * empty**, because a `/FreeText` carrying three spaces renders as a rectangle
 * with an invisible border — a text box the person typed into and cannot see.
 * So the trim is what the emptiness is judged on here, exactly as the result
 * schema judges it on the way out.
 *
 * ## The trim happens once, and the schema is where
 *
 * This body tests `text.trim()` and hands `resolve` the RAW value; the result
 * schema trims. Trimming here as well would be two writers for one
 * normalisation, and the one that matters is the schema's — it is what the
 * answer is validated against and what a second caller of this dialog would
 * meet. What this does is decide whether the control is usable, which is a
 * rendering question about the same string.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function AnnotationTextBody({
  resolve,
}: DialogAnswering<AnnotationTextAnswer>): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState('');

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_ANNOTATION_TEXT;
  const usable = trimmed.length > 0 && !tooLong;

  return (
    <div className="m-annotation-text">
      <Input label={ANNOTATION_TEXT_LABEL} onValueChange={setText} value={text} />
      <p className="m-annotation-text__problem" role="status">
        {tooLong ? _(ANNOTATION_TEXT_TOO_LONG) : trimmed.length > 0 ? '' : _(ANNOTATION_TEXT_EMPTY)}
      </p>
      <Button
        disabled={!usable}
        label={ANNOTATION_TEXT_APPLY}
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
