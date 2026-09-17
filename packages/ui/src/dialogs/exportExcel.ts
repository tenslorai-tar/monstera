import { MAX_TABLE_CELLS, MAX_TABLE_CELL_TEXT } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_EXCEL_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const EXPORT_EXCEL_DIALOG_ID = 'dialog.export-excel';

const LAYOUT = z.enum(['sheet-per-page', 'one-sheet']);

/** A person's text for one cell of the page on show, addressed as the grid shows it. */
const EDIT = z
  .object({
    table: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    text: z.string().max(MAX_TABLE_CELL_TEXT),
  })
  .strict();

/**
 * What the Excel export dialog answers: where the tables go — D10's
 * *combine-pages option* — and the corrections made to the page on show — its
 * *editable review grid* — and whether to move to another page or export.
 *
 * ## Moving to a page is an ANSWER, and the command asks again
 *
 * A dialog body holds no client (ADR-0038: a dialog answers the command that opened
 * it), so the grid cannot read the next page's tables itself. It answers `page`
 * with its edits, the command keeps them, reads the page asked for and opens the
 * grid on it — so every page's edits live in one place, the command, and reach
 * `document.exportExcel` together.
 */
export const EXPORT_EXCEL_RESULT = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('page'),
      /** The zero-based page to show next. */
      to: z.number().int().nonnegative(),
      layout: LAYOUT,
      edits: z.array(EDIT).max(MAX_TABLE_CELLS).readonly(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('export'),
      layout: LAYOUT,
      edits: z.array(EDIT).max(MAX_TABLE_CELLS).readonly(),
    })
    .strict(),
]);

export type ExportExcelAnswer = z.infer<typeof EXPORT_EXCEL_RESULT>;

export const EXPORT_EXCEL_PROPS = z
  .object({
    /** The zero-based page on show. */
    index: z.number().int().nonnegative(),
    /** The number a person reads for it. */
    page: z.number().int().positive(),
    pageCount: z.number().int().nonnegative(),
    tables: z
      .array(
        z.object({
          rows: z
            .array(
              z
                .array(z.object({ text: z.string().max(MAX_TABLE_CELL_TEXT), clipped: z.boolean() }))
                .max(MAX_TABLE_CELLS)
                .readonly(),
            )
            .max(MAX_TABLE_CELLS)
            .readonly(),
        }),
      )
      .max(MAX_TABLE_CELLS)
      .readonly(),
    truncated: z.boolean(),
    layout: LAYOUT,
    /** This page's edits so far, so moving back to a page shows what was typed on it. */
    edits: z.array(EDIT).max(MAX_TABLE_CELLS).readonly(),
  })
  .strict();

export type ExportExcelProps = z.infer<typeof EXPORT_EXCEL_PROPS>;

export const EXPORT_EXCEL_DIALOG = declareDialog({
  id: EXPORT_EXCEL_DIALOG_ID,
  title: EXPORT_EXCEL_TITLE,
  props: EXPORT_EXCEL_PROPS,
  result: EXPORT_EXCEL_RESULT,
  component: lazy(() => import('./ExportExcelBody.js')),
});
