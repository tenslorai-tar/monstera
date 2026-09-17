import { MAX_TEXT_LAYER_LINE } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { COMPARE_DOCUMENTS_TITLE, COMPARE_RESULT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the compare command opens to choose the other document. */
export const COMPARE_DOCUMENTS_DIALOG_ID = 'dialog.compare-documents';

/** The id it opens with what it found. */
export const COMPARE_RESULT_DIALOG_ID = 'dialog.compare-result';

/**
 * How many changed lines one comparison lists. A document rewritten from end to end differs on
 * every line, and a list a person cannot read to the end is not a review; the count above it
 * is still whole.
 */
export const MAX_COMPARE_CHANGES = 1000;

export const COMPARE_DOCUMENTS_RESULT = z.object({ other: z.string().min(1) }).strict();

export type CompareDocumentsAnswer = z.infer<typeof COMPARE_DOCUMENTS_RESULT>;

/**
 * Which other open document to compare with — `mergeDocument.ts`' picker and its reasons: the
 * choices travel in, already without this document, and `.min(1)` means there is something to
 * choose. With nothing else open the command opens the result dialog's `none` instead.
 */
export const COMPARE_DOCUMENTS_DIALOG = declareDialog({
  id: COMPARE_DOCUMENTS_DIALOG_ID,
  title: COMPARE_DOCUMENTS_TITLE,
  props: z
    .object({
      choices: z
        .array(z.object({ docId: z.string().min(1), name: z.string().min(1) }).strict())
        .min(1),
    })
    .strict(),
  result: COMPARE_DOCUMENTS_RESULT,
  component: lazy(() => import('./CompareDocumentsBody.js')),
});

const changeSchema = z
  .object({ kind: z.enum(['removed', 'added']), text: z.string().max(MAX_TEXT_LAYER_LINE) })
  .strict();

/**
 * What a comparison found (D8's *document compare*).
 *
 * Pages are the number a person reads. `compared` is how many page pairs were read; below
 * `shared` — the pages both documents have — it means a document changed during the walk and
 * the rest were not compared, which the dialog says rather than presenting a part as the whole.
 */
export const COMPARE_RESULT_DIALOG = declareDialog({
  id: COMPARE_RESULT_DIALOG_ID,
  title: COMPARE_RESULT_TITLE,
  props: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('refused') }).strict(),
    z
      .object({
        kind: z.literal('compared'),
        otherName: z.string().min(1),
        shared: z.number().int().nonnegative(),
        compared: z.number().int().nonnegative(),
        /** Pages only this document has (positive) or only the other has (negative). */
        extraPages: z.number().int(),
        /** Changed lines found, whole, even where the list below stops. */
        changedLines: z.number().int().nonnegative(),
        /** Pages whose text was longer than one read carries, so their comparison may miss lines. */
        clippedPages: z.number().int().nonnegative(),
        pages: z
          .array(
            z
              .object({ page: z.number().int().positive(), changes: z.array(changeSchema).min(1).readonly() })
              .strict(),
          )
          .readonly(),
      })
      .strict()
      .refine(
        (props) => props.pages.reduce((sum, page) => sum + page.changes.length, 0) <= MAX_COMPARE_CHANGES,
        { message: 'the list is bounded at MAX_COMPARE_CHANGES lines' },
      ),
  ]),
  component: lazy(() => import('./CompareResultBody.js')),
});
