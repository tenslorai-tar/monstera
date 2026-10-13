import { MAX_PDFA_LEFT_OUT, MAX_PDFA_REMOVALS, PDFA_LEFT_OUT_KINDS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PDFA_REMOVALS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PDFA_REMOVALS_DIALOG_ID = 'dialog.pdfa-removals';

/**
 * What a PDF/A export left out, after the file was written (ADR-0075's 2026-10-13 correction, the owner's N7).
 *
 * Opened only when something was left out; a file that kept everything is said in the toast. Everything here is in
 * Monstera's words, BY KIND AND PAGE: the converter's lines named nothing a person could find (the Note it reported as
 * removed was still in the file), so they are counted and never quoted. Informational — it answers nothing.
 */
export const PDFA_REMOVALS_DIALOG = declareDialog({
  id: PDFA_REMOVALS_DIALOG_ID,
  title: PDFA_REMOVALS_TITLE,
  informs: 'report',
  props: z
    .object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      leftOut: z
        .array(
          z
            .object({
              page: z.number().int().nonnegative(),
              kind: z.enum(PDFA_LEFT_OUT_KINDS),
              count: z.number().int().positive(),
            })
            .strict(),
        )
        .max(MAX_PDFA_LEFT_OUT)
        .readonly(),
      leftOutMore: z.number().int().nonnegative(),
      otherLeftOut: z.number().int().nonnegative().max(MAX_PDFA_REMOVALS),
      tagsDropped: z.boolean(),
    })
    .strict()
    .refine((props) => props.leftOut.length > 0 || props.leftOutMore > 0 || props.otherLeftOut > 0 || props.tagsDropped, {
      message: 'the notice opens only when something was left out',
    }),
  component: lazy(() => import('./PdfaRemovalsBody.js')),
});
