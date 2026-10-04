import { lazy } from 'react';
import { z } from 'zod';

import { PAGE_BACKGROUND_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { TARGET_PAGES } from './pageScope.js';

/** The id `pageBackgroundCommand` opens to collect the colour and the pages. */
export const PAGE_BACKGROUND_DIALOG_ID = 'dialog.page-background';

/** The colour, in PDF's DeviceRGB range as `setPageBackground` carries it, and the pages it fills. */
export const PAGE_BACKGROUND_RESULT = z
  .object({
    pages: z.union([z.literal('all'), TARGET_PAGES]),
    red: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    blue: z.number().min(0).max(1),
  })
  .strict();

export type PageBackgroundAnswer = z.infer<typeof PAGE_BACKGROUND_RESULT>;

/**
 * The page background's colour and scope (the owner's item 13j). The command painted one near-white tint on every page
 * with no question, which the owner could hardly see; the colour is now chosen with the application's one colour
 * control (`ColourChoice.tsx`), from paper tints, and the scope with the shared page row.
 */
export const PAGE_BACKGROUND_DIALOG = declareDialog({
  id: PAGE_BACKGROUND_DIALOG_ID,
  title: PAGE_BACKGROUND_TITLE,
  props: z
    .object({
      /** The command's `targetPages`, for the scope's first choice (ADR-0104). */
      pages: TARGET_PAGES,
    })
    .strict(),
  result: PAGE_BACKGROUND_RESULT,
  component: lazy(() => import('./PageBackgroundBody.js')),
});
