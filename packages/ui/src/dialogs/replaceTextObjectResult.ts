import { MAX_REPLACED_TEXT } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the replace-text dialog answers with — its own module for
 * `flatFieldsResult.ts`'s forced reason: the entry imports the body lazily and
 * the body needs this type, so declaring it beside the entry would make the two
 * circular.
 *
 * ## Both fields, and neither is derivable from the other
 *
 * `index` is WHICH object, in the editing engine's own numbering, and it comes
 * from `document.textObjects` — never from a position in a list this dialog
 * built, and never from anything MuPDF answered. `text` is what replaces it.
 *
 * ## The bound is the COMMAND's, imported rather than restated
 *
 * `MAX_REPLACED_TEXT` is what `replaceTextObjectSchema` enforces. A number
 * written here would be this dialog's opinion about a limit the contract owns,
 * and the day the two disagreed the reader would meet a refusal over their
 * document instead of a disabled button — which is `LinkAddressBody`'s argument
 * for importing `MAX_LINK_URI` rather than listing it.
 *
 * ## An EMPTY replacement is legal and is not the dismissal
 *
 * `replaceTextObjectSchema` accepts an empty string — deleting a run's text is
 * a thing people do — so this schema does too, and the two ways of leaving the
 * dialog stay distinct: an answer of `''` is *make it empty*, and no answer at
 * all is *never mind*. A `.min(1)` here would make the first unreachable and
 * the reader would have to delete the object some other way.
 */
export const REPLACE_TEXT_OBJECT_RESULT = z
  .object({
    index: z.number().int().nonnegative(),
    text: z.string().max(MAX_REPLACED_TEXT),
  })
  .strict();

/** Which object, and what it becomes. */
export type ReplaceTextObjectAnswer = z.infer<typeof REPLACE_TEXT_OBJECT_RESULT>;
