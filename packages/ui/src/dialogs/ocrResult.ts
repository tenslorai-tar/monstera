import { ocrLanguageSchema } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the recognition dialog answers with.
 *
 * Its own module for `cropPagesResult.ts`'s reason, and it is a property of the
 * lazy seam rather than of this feature: the entry imports its body with
 * `lazy(() => import(…))` and the body needs the answer's type, so a schema
 * declared beside the entry makes the two files circular.
 *
 * ## A SCOPE AND A LANGUAGE, which is `BUILD-PROMPT.md`:473's *page scope choice*
 *
 * The scope is the same union every page-scoped command here carries — `'all'` or
 * a list — and the **command is not**: `ocrPage` names one page, because
 * [ADR-0035](../../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)
 * forbids a document's extracted text being resident in main at once. So the
 * dialog answers the scope and the command's caller walks it, which is also what
 * gives the walk progress and a cancel.
 *
 * The language is the **closed enum's** schema rather than a string, which is
 * ADR-0014 constraint 1 arriving at the surface: a person picking one of fourteen
 * names supplies no path and no file.
 */
export const OCR_RESULT = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    language: ocrLanguageSchema,
  })
  .strict();

/** The scope and the language, as the dialog produced them. */
export type OcrAnswer = z.infer<typeof OCR_RESULT>;
