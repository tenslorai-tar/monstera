import { MAX_BARCODE_TEXT } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PAGE_BARCODES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PAGE_BARCODES_DIALOG_ID = 'dialog.page-barcodes';

/** The most barcodes the list shows, over however many pages were read: past it the list is cut and says so. */
export const MAX_LISTED_BARCODES = 1000;

/**
 * What a row of the list asks of the opener. Each is a REPORT: the dialog stays open, and the command acts — copying goes
 * through `main` (the renderer holds no clipboard), and opening a link names the barcode by its page and place, never its
 * text, so `main` reads the address from the document itself.
 */
export const PAGE_BARCODES_REPORT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('copy'), text: z.string().min(1).max(MAX_BARCODE_TEXT) }).strict(),
  z.object({ kind: z.literal('copy-all') }).strict(),
  z.object({ kind: z.literal('open'), page: z.number().int().positive(), index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('read-all') }).strict(),
]);

/**
 * The barcodes on the page a person is looking at, or on every page (ADR-0076).
 *
 * `pageStructure.ts`' split and its reasons: the command reads and this displays, a refusal opens it too, and `page` is the
 * number a person reads. Each barcode carries ITS page and its place on that page, which is how a press on *Open link* names
 * it without sending its text.
 */
export const PAGE_BARCODES_DIALOG = declareDialog({
  id: PAGE_BARCODES_DIALOG_ID,
  title: PAGE_BARCODES_TITLE,
  props: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('read'),
      /** The page read, or the page on show when every page was. */
      page: z.number().int().positive(),
      /** Whether every page was read, in which case each row says its page. */
      all: z.boolean(),
      /** How many pages the document has, which decides whether *Read barcodes on all pages* is offered. */
      pageCount: z.number().int().positive(),
      barcodes: z
        .array(
          z.object({
            format: z.string().min(1).max(32),
            text: z.string().max(MAX_BARCODE_TEXT),
            /** The page a person reads, from 1. */
            page: z.number().int().positive(),
            /** Its place among that page's barcodes, which is how `main` finds it again. */
            index: z.number().int().nonnegative(),
          }),
        )
        .max(MAX_LISTED_BARCODES)
        .readonly(),
      truncated: z.boolean(),
    }),
    z.object({ kind: z.literal('refused'), page: z.number().int().positive() }),
  ]),
  result: PAGE_BARCODES_REPORT,
  component: lazy(() => import('./PageBarcodesBody.js')),
});

export type PageBarcodesReport = z.infer<typeof PAGE_BARCODES_REPORT>;
