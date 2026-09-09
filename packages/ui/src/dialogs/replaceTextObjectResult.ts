import { MAX_REPLACED_TEXT, MAX_TEXT_REPLACEMENTS } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the edit-text dialog answers with — its own module for
 * `flatFieldsResult.ts`'s forced reason: the entry imports the body lazily and
 * the body needs this type, so declaring it beside the entry would make the two
 * circular.
 *
 * ## It answers REPLACEMENTS, not a line and a string
 *
 * A person edits a visual **line**; a command names text **objects**. The
 * dialog is where those two meet, because it is the only place holding both the
 * line's runs and what the person typed — so it answers the payload the command
 * carries and the command sends it unchanged.
 *
 * The alternative was answering *which line, and its new text* and letting the
 * command look the line up again. That would put a position in a list on the
 * wire and make the command re-derive object indices from it, which is the one
 * thing the whole `targets: 'text-object'` design exists to prevent: the index
 * comes from the read and is never computed. Here it is copied from the run the
 * dialog was handed, and `lineEdit.ts` is the only code between the two.
 *
 * ## The bounds are the COMMAND's, imported rather than restated
 *
 * `MAX_REPLACED_TEXT` and `MAX_TEXT_REPLACEMENTS` are what
 * `replaceTextObjectSchema` enforces. Numbers written here would be this
 * dialog's opinion about limits the contract owns, and the day the two
 * disagreed the reader would meet a refusal over their document instead of a
 * disabled button — `LinkAddressBody`'s argument for importing `MAX_LINK_URI`.
 *
 * ## An EMPTY replacement is legal and is not the dismissal
 *
 * `replaceTextObjectSchema` accepts an empty string — clearing a line's text is
 * a thing people do — so this schema does too, and the two ways of leaving the
 * dialog stay distinct: a replacement of `''` is *make it empty*, and no answer
 * at all is *never mind*. What is NOT legal is an empty LIST: a command naming
 * nothing regenerates a page for no change, so `.min(1)` here refuses what the
 * command would refuse, one layer earlier and as a disabled button.
 */
export const REPLACE_TEXT_OBJECT_RESULT = z
  .object({
    replacements: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            text: z.string().max(MAX_REPLACED_TEXT),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_TEXT_REPLACEMENTS),
  })
  .strict();

/** Which objects, and what each becomes. */
export type ReplaceTextObjectAnswer = z.infer<typeof REPLACE_TEXT_OBJECT_RESULT>;
