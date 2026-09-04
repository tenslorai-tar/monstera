import { lazy } from 'react';
import { z } from 'zod';

import { WATERMARK_PAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { WATERMARK_PAGES_RESULT } from './watermarkPagesResult.js';

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
 * ## No colour control, and that is the command's decision showing through
 *
 * `watermarkPagesSchema` carries no colour: a watermark is drawn in one grey at
 * an opacity, and making it configurable is a field on the command before it is
 * a control here. It arrives with Stage 3's style controls, which is where
 * every colour-bearing surface answers the question once rather than each
 * dialog answering it separately.
 */
export const WATERMARK_PAGES_DIALOG = declareDialog({
  id: WATERMARK_PAGES_DIALOG_ID,
  title: WATERMARK_PAGES_TITLE,
  props: z
    .object({
      /** The page being read, zero-based, for the *this page* scope. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: WATERMARK_PAGES_RESULT,
  component: lazy(() => import('./WatermarkPagesBody.js')),
});
