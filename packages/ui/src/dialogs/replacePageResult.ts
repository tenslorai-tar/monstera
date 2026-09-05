import { z } from 'zod';

/**
 * What the replace-page dialog answers with — **its own module for
 * `deletePagesResult.ts`'s forced reason**: the entry imports the body lazily
 * and the body needs this type, so declaring it beside the entry makes the two
 * circular.
 *
 * One field, and it is the same shape `MERGE_DOCUMENT_RESULT` has. They are
 * **not** aliased: two dialogs answering the same shape today is a coincidence
 * of what each currently asks, and aliasing would make a change to one silently
 * change the other. The page being replaced is not here because it is the page
 * on screen, which the command already holds.
 */
export const REPLACE_PAGE_RESULT = z.object({ source: z.string().min(1) }).strict();

/** The document whose pages take the replaced page's place. */
export type ReplacePageAnswer = z.infer<typeof REPLACE_PAGE_RESULT>;
