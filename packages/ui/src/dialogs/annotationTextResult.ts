import { MAX_ANNOTATION_TEXT } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the annotation-text dialog answers with — its own module, for
 * `deletePagesResult.ts`' reason and not for tidiness: the declaration imports
 * its body lazily and the body needs this type, so declaring it beside the
 * entry makes the two files circular.
 *
 * `.min(1)` and `.trim()` together are the gate. A text box carrying nothing is
 * a rectangle with an invisible border — a control that appears to have done
 * nothing — and whitespace produces exactly that while looking like content, so
 * the trim happens before the bound rather than after it. A person who opens
 * the dialog and presses space is answered the same way as one who dismisses
 * it: `undefined`, and no command.
 *
 * The upper bound is the contract's `MAX_ANNOTATION_TEXT`, imported rather than
 * restated — the payload's limit is the payload's, and a second number here
 * would be a dialog that accepts what the channel refuses.
 */
export const ANNOTATION_TEXT_RESULT = z
  .object({ text: z.string().trim().min(1).max(MAX_ANNOTATION_TEXT) })
  .strict();

/** The words a person typed, trimmed and known non-empty. */
export type AnnotationTextAnswer = z.infer<typeof ANNOTATION_TEXT_RESULT>;
