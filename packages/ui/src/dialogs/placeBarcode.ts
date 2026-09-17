import { BARCODE_FORMATS, MAX_BARCODE_TEXT } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PLACE_BARCODE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PLACE_BARCODE_DIALOG_ID = 'dialog.place-barcode';

/** What the dialog answers: the text and the symbology, exactly as `document.placeBarcode` takes them. */
export const PLACE_BARCODE_RESULT = z
  .object({ text: z.string().min(1).max(MAX_BARCODE_TEXT), format: z.enum(BARCODE_FORMATS) })
  .strict();

export type PlaceBarcodeAnswer = z.infer<typeof PLACE_BARCODE_RESULT>;

/**
 * Asks what a barcode placed in a dragged box should say, and in which symbology (ADR-0076).
 *
 * ## A REFUSAL REOPENS THIS, holding what was typed
 *
 * Whether a symbology can carry a text is zxing-cpp's answer, given in main after the dialog
 * closes — this side does not restate it. So a refused placement comes back here with the text
 * and type the person chose and a sentence saying why nothing was added, and they change one or
 * the other rather than typing it all again.
 */
export const PLACE_BARCODE_DIALOG = declareDialog({
  id: PLACE_BARCODE_DIALOG_ID,
  title: PLACE_BARCODE_TITLE,
  props: z.object({ refused: PLACE_BARCODE_RESULT.optional() }).strict(),
  result: PLACE_BARCODE_RESULT,
  component: lazy(() => import('./PlaceBarcodeBody.js')),
});
