import { lazy } from 'react';
import { z } from 'zod';

import { INSERT_BLANK_PAGE_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { INSERT_BLANK_PAGE_RESULT } from './insertBlankPageResult.js';

/** The id `insertBlankPageCommand` opens to ask how many blank pages, and where. */
export const INSERT_BLANK_PAGE_DIALOG_ID = 'dialog.insert-blank-page';

/**
 * How many blank pages, and where they go (the owner's O3): the count, and the one placement row every inserting dialog
 * asks. It opens on one page after the page on show, which is what the command did before it asked anything.
 */
export const INSERT_BLANK_PAGE_DIALOG = declareDialog({
  id: INSERT_BLANK_PAGE_DIALOG_ID,
  title: INSERT_BLANK_PAGE_DIALOG_TITLE,
  props: z
    .object({
      /** The target's page count, bounding the position. */
      pageCount: z.number().int().positive(),
      /** The page the pages go after by default, zero-based: the last of the pages acted on. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: INSERT_BLANK_PAGE_RESULT,
  component: lazy(() => import('./InsertBlankPageBody.js')),
});
