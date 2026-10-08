import { z } from 'zod';

/**
 * The `pageRuns` pre-read on the wire, ONE schema for both directions it crosses
 * ([ADR-0176](../../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)'s
 * correction): out of the PDFium host as `engine/page-runs`' answer, and into the MuPDF host with `engine/apply`, which
 * hands it to the operator writer. Two schemas would be two opinions about what a run is on the wire (B3a), and the
 * second would be the one nobody tested.
 *
 * Here rather than in either channel module, because `pdfiumChannels.ts` imports `engineChannels.ts` and both need it.
 */

/**
 * How many text objects, or one run's members, the reading may name: the most single-digit indices with their commas
 * an answer within `ENGINE_ANSWER_FILE_MAX_BYTES` (8 MiB) could hold, 8,388,608 / 2. A bound against a hostile peer,
 * a literal held to the division by `pdfiumChannels.test.ts`. A run holds at least one object, so it bounds the runs too.
 */
export const PAGE_TEXT_OBJECTS_MAX = 4_194_304;

/**
 * How long a run's text may be: `engine/text-runs`' bound on what a document says, `PDFIUM_PRIOR_TEXT_MAX`, held equal
 * to it by `pdfiumChannels.test.ts` so the two reads of one run cannot bound it differently.
 */
export const PAGE_RUN_TEXT_MAX = 65_536;

/** The page's joined runs with their members, and its text objects' page indices: `operatorEdit.ts`' `PageRuns`. */
export const pageRunsSchema = z
  .object({
    textObjects: z.array(z.number().int().nonnegative()).max(PAGE_TEXT_OBJECTS_MAX).readonly(),
    runs: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            members: z.array(z.number().int().nonnegative()).min(1).max(PAGE_TEXT_OBJECTS_MAX).readonly(),
            text: z.string().max(PAGE_RUN_TEXT_MAX),
            left: z.number(),
            right: z.number(),
            bottom: z.number(),
            top: z.number(),
          })
          .strict()
          // A RUN IS NAMED BY ITS FIRST OBJECT, which is how the editor's wire names it.
          .refine((run) => run.members[0] === run.index, { message: 'a run is named by its first object' }),
      )
      .max(PAGE_TEXT_OBJECTS_MAX)
      .readonly(),
  })
  .strict();
