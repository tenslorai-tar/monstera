import { builtInStampSchema } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the stamp chooser answers: which built-in stamp to put in the box just drawn.
 *
 * In a file of its own for `annotationTextResult.ts`' reason: the dialog's entry loads its body lazily and the body
 * needs this type, so declaring it beside the entry would make the two files circular. The stamp is the contract's
 * own schema, so the chooser cannot answer a stamp the command refuses.
 */
export const STAMP_RESULT = z.object({ stamp: builtInStampSchema }).strict();

/** The chosen stamp. */
export type StampAnswer = z.infer<typeof STAMP_RESULT>;
