import { MAX_PAGE_INDEX } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PAGES_LEFT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PAGES_LEFT_DIALOG_ID = 'dialog.pages-left';

/**
 * The pages a header and footer, Bates numbers, a watermark or a background left as they were because they display
 * nothing ([ADR-0254](../../../../docs/DECISIONS/0254-a-command-that-places-on-pages-skips-a-page-that-shows-nothing-and-names-it.md)),
 * zero-based as the command named them. Its own dialog, not a problem's: the command did what it could, and every other
 * page was done.
 */
export const pagesLeftSchema = z
  .object({ pages: z.array(z.number().int().nonnegative().max(MAX_PAGE_INDEX)).min(1).max(MAX_PAGE_INDEX + 1) })
  .strict();

export type PagesLeft = z.infer<typeof pagesLeftSchema>;

export const PAGES_LEFT_DIALOG = declareDialog({
  id: PAGES_LEFT_DIALOG_ID,
  title: PAGES_LEFT_TITLE,
  informs: 'message',
  props: pagesLeftSchema,
  component: lazy(() => import('./PagesLeftBody.js')),
});
