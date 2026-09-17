import { MAX_BARCODE_TEXT, MAX_PAGE_BARCODES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PAGE_BARCODES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PAGE_BARCODES_DIALOG_ID = 'dialog.page-barcodes';

/**
 * The barcodes on the page a person is looking at (ADR-0076).
 *
 * `pageStructure.ts`' split and its reasons: the command reads and this displays, a refusal
 * opens it too, and `page` is the number a person reads.
 */
export const PAGE_BARCODES_DIALOG = declareDialog({
  id: PAGE_BARCODES_DIALOG_ID,
  title: PAGE_BARCODES_TITLE,
  props: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('read'),
      page: z.number().int().positive(),
      barcodes: z
        .array(z.object({ format: z.string().min(1).max(32), text: z.string().max(MAX_BARCODE_TEXT) }))
        .max(MAX_PAGE_BARCODES)
        .readonly(),
      truncated: z.boolean(),
    }),
    z.object({ kind: z.literal('refused'), page: z.number().int().positive() }),
  ]),
  component: lazy(() => import('./PageBarcodesBody.js')),
});
