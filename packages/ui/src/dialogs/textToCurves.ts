import { keptLossesSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { CURVES_RESULT_TITLE, TEXT_TO_CURVES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const TEXT_TO_CURVES_DIALOG_ID = 'dialog.text-to-curves';
export const CURVES_RESULT_DIALOG_ID = 'dialog.curves-result';

export const TEXT_TO_CURVES_RESULT = z.object({ confirmed: z.literal(true) }).strict();

/**
 * What the person reads before a curves copy is made
 * ([ADR-0282](../../../../docs/DECISIONS/0282-text-to-curves-saves-a-new-copy-whose-letters-are-shapes.md) Decision 3):
 * what the copy is, what its text can no longer do, and — only where the document has them, by main's count — that its
 * form fields become part of the page and its tags are removed. Answering is *Save a copy…*; the file is main's to pick.
 */
export const TEXT_TO_CURVES_DIALOG = declareDialog({
  id: TEXT_TO_CURVES_DIALOG_ID,
  title: TEXT_TO_CURVES_TITLE,
  props: z.object({ fields: z.number().int().nonnegative(), tags: z.number().int().nonnegative() }).strict(),
  result: TEXT_TO_CURVES_RESULT,
  component: lazy(() => import('./TextToCurvesBody.js')),
});

export const CURVES_RESULT_RESULT = z.object({ open: z.literal(true) }).strict();

/** The report's props, apart from the declaration so the body can name them without a cycle through `lazy()`. */
export const CURVES_RESULT_PROPS = z
  .object({
    bytes: z.number().int().nonnegative(),
    before: z.number().int().nonnegative(),
    lost: keptLossesSchema,
    compared: z.boolean(),
    fontsLeft: z.number().int().nonnegative(),
  })
  .strict();

/**
 * What the copy is, after it was written (Decisions 4 and 7): both sizes, every count that fell by name and number, the
 * fonts the converter left, and *Open the copy*, which opens it in a tab. Where either side could not be counted it
 * says so, rather than that nothing was lost.
 */
export const CURVES_RESULT_DIALOG = declareDialog({
  id: CURVES_RESULT_DIALOG_ID,
  title: CURVES_RESULT_TITLE,
  props: CURVES_RESULT_PROPS,
  result: CURVES_RESULT_RESULT,
  component: lazy(() => import('./CurvesResultBody.js')),
});
