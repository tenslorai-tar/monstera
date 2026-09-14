import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_PAGE_IMAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { EXPORT_PAGE_IMAGES_RESULT } from './exportPageImagesResult.js';

/** The id `exportPageImagesCommand` opens to choose pages and an encoding. */
export const EXPORT_PAGE_IMAGES_DIALOG_ID = 'dialog.export-page-images';

/**
 * Which pages, which format, what resolution and quality.
 *
 * `pageCount` goes IN, for the split dialog's reason: *every page* needs it to
 * build the list, and *these pages* to refuse a page the document lacks. The
 * FOLDER is main's, picked after this, so a dismissal of that picker discards
 * nothing decided here.
 */
export const EXPORT_PAGE_IMAGES_DIALOG = declareDialog({
  id: EXPORT_PAGE_IMAGES_DIALOG_ID,
  title: EXPORT_PAGE_IMAGES_TITLE,
  props: z.object({ pageCount: z.number().int().positive() }).strict(),
  result: EXPORT_PAGE_IMAGES_RESULT,
  component: lazy(() => import('./ExportPageImagesBody.js')),
});
