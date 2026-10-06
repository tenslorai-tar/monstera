import { z } from 'zod';

import { PAGE_RANGE_START, SOURCE_PAGES_ANSWER, chooseFileAnswer } from './sourceDocuments.js';

/**
 * What the replace-pages dialog answers with — **its own module for `deletePagesResult.ts`'s forced reason**: the entry
 * imports the body lazily and the body needs this type, so declaring it beside the entry makes the two circular.
 *
 * The pages being replaced are not here: they are the command's `targetPages`, which it already holds and told the
 * dialog so it could name them.
 */

/** What the dialog reopens with after *Choose file…*: the source pages as the person left them. */
export const REPLACE_PAGE_DRAFT = z.object({ sourcePages: PAGE_RANGE_START }).strict();

/** Replace with these pages of that document — or open a file to choose from first. */
export const REPLACE_PAGE_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replace'), source: z.string().min(1), sourcePages: SOURCE_PAGES_ANSWER }).strict(),
  chooseFileAnswer(REPLACE_PAGE_DRAFT),
]);

/** See {@link REPLACE_PAGE_RESULT}. */
export type ReplacePageAnswer = z.infer<typeof REPLACE_PAGE_RESULT>;
