import { listedFontFamiliesSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { WATERMARK_PAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { TARGET_PAGES } from './pageScope.js';
import { WATERMARK_PAGES_RESULT, WATERMARK_SETTINGS } from './watermarkPagesResult.js';

/** The id `watermarkPagesCommand` opens to collect the text and its appearance. */
export const WATERMARK_PAGES_DIALOG_ID = 'dialog.watermark-pages';

/**
 * The watermark's text, appearance and scope — the third argument-collecting
 * dialog, and the first for a command that draws.
 *
 * ## The current page travels IN so the scope can be offered
 *
 * `cropPages`' shape and its reason: *this page* and *all pages* are the two
 * scopes worth having, and the first needs to know which page. The dialog
 * resolves the choice and answers with the scope the command carries, so
 * nothing downstream re-derives it.
 *
 * ## Edit opens the same window (ADR-0246 Decision 3)
 *
 * With `editing`, the settings the engine recorded on the stamp fill the fields, and the window offers no scope: Edit
 * redraws on every page the stamp is on, which the command took from the read, so a scope here would be a second answer
 * to a question already answered.
 */
export const WATERMARK_PAGES_DIALOG = declareDialog({
  id: WATERMARK_PAGES_DIALOG_ID,
  title: WATERMARK_PAGES_TITLE,
  props: z
    .object({
      /** The command's `targetPages`, for the scope's first choice (ADR-0104). */
      pages: TARGET_PAGES,
      /** The fonts `app.fontFamilies` answered when the dialog opened; absent where the read failed (ADR-0235). */
      fonts: listedFontFamiliesSchema.optional(),
      /** The recorded settings of the watermark being edited; absent, the window adds one. */
      editing: WATERMARK_SETTINGS.optional(),
    })
    .strict(),
  result: WATERMARK_PAGES_RESULT,
  component: lazy(() => import('./WatermarkPagesBody.js')),
});
