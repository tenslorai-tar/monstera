import { builtInStampSchema, libraryIdSchema } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the stamp chooser answers: a built-in stamp or a kept picture for the box just drawn — or a change to the
 * library, after which the tool acts and asks again with the library as it now is.
 *
 * A change is an ANSWER rather than a report (ADR-0094), because the chooser's props are fixed when it opens: a picture
 * added while it stayed open could not appear in it. Closing and asking again is the dialog seam as it stands.
 *
 * In a file of its own because the dialog's entry loads its body lazily and the body
 * needs this type, so declaring it beside the entry would make the two files circular. The stamp and the id are the
 * contract's own schemas, so the chooser cannot answer what the command or the channel refuses.
 */
export const STAMP_RESULT = z.union([
  z.object({ stamp: builtInStampSchema }).strict(),
  z.object({ picture: libraryIdSchema }).strict(),
  z.object({ library: z.literal('add') }).strict(),
  z.object({ library: z.literal('remove'), id: libraryIdSchema }).strict(),
]);

/** The chooser's answer. */
export type StampAnswer = z.infer<typeof STAMP_RESULT>;

/** One kept stamp picture as the chooser shows it: its id, its name, and a `blob:` address of its bytes. */
export const STAMP_PICTURE = z.object({ id: libraryIdSchema, name: z.string().min(1), src: z.string().startsWith('blob:') }).strict();

export type StampPicture = z.infer<typeof STAMP_PICTURE>;
