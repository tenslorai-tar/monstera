import { z } from 'zod';

/**
 * The second document a page command copies from — Replace pages, Insert from PDF, Merge and Import page as layer —
 * as each of their dialogs is handed it and answers about it.
 *
 * **One shape for the four** (B3a): which documents are offered, how many pages each has, and how *Choose file…*
 * answers are the same question in each dialog, asked with different words.
 *
 * Its own module for `deletePagesResult.ts`' forced reason: every entry imports its body lazily, and the bodies and the
 * commands both need these schemas.
 */

/**
 * One open document a page can come from: its id, its tab's name, and its page count, which the command read through
 * `document.viewModel` so the dialog can bound a choice of its pages (`sourcePagesSchema`).
 */
export const SOURCE_DOCUMENT = z
  .object({
    docId: z.string().min(1),
    name: z.string().min(1),
    pageCount: z.number().int().positive(),
  })
  .strict();

/** See {@link SOURCE_DOCUMENT}. */
export type SourceDocument = z.infer<typeof SOURCE_DOCUMENT>;

/**
 * The documents offered, in tab order and never the target. **May be empty**: *Choose file…* is the way to a source
 * then, so a person with one document open is shown the dialog rather than told to open another first.
 */
export const SOURCE_DOCUMENTS = z.array(SOURCE_DOCUMENT);

/**
 * *Choose file…*'s answer: the dialog closes, the command opens a file through the one open route (ADR-0040 Decision 2:
 * it arrives as a tab) and asks again with it chosen and `draft` restored, so nothing the person entered is lost.
 *
 * @param draft the dialog's own fields, as it reopens with them
 */
export function chooseFileAnswer<Draft extends z.ZodType>(draft: Draft) {
  return z.object({ kind: z.literal('choose-file'), draft }).strict();
}

/**
 * A page-range row as the person left it (`PageRangeStart`), for a draft: which option, and what was typed. The text
 * is bounded for the prop schema's sake and is never a page list until the row parses it.
 */
export const PAGE_RANGE_START = z.object({ every: z.boolean(), text: z.string().max(500) }).strict();

/**
 * The source's pages a dialog answers: `'all'`, or the pages chosen, zero-based and ascending as `parsePageRanges`
 * gives them. The command writes them as `sourcePagesSchema`'s runs on the way out (`withPageRuns`).
 */
export const SOURCE_PAGES_ANSWER = z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]);

/** The props every second-document dialog shares: what is offered, and which is chosen as it opens. */
export const SOURCE_PROPS = {
  choices: SOURCE_DOCUMENTS,
  /** The document chosen as the dialog opens — the file just picked — or, absent, the first offered. */
  source: z.string().min(1).optional(),
} as const;
