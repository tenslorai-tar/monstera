import { lazy } from 'react';
import { z } from 'zod';

import { INSERT_IMAGES_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { INSERT_IMAGES_RESULT } from './insertImagesResult.js';

/** The id `insertImageCommand` opens to ask where the pictures' pages go. */
export const INSERT_IMAGES_DIALOG_ID = 'dialog.insert-images';

/**
 * Where the pictures go (the owner's O3), by the one placement row every inserting dialog asks, then *Choose images…*:
 * Insert from Markdown's order — where first, then the files — because the renderer never holds a path, so the picker
 * is `main`'s and runs after the answer. It opens after the page on show.
 */
export const INSERT_IMAGES_DIALOG = declareDialog({
  id: INSERT_IMAGES_DIALOG_ID,
  title: INSERT_IMAGES_DIALOG_TITLE,
  props: z
    .object({
      /** The target's page count, bounding the position. */
      pageCount: z.number().int().positive(),
      /** The page the pictures go after by default, zero-based: the last of the pages acted on. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: INSERT_IMAGES_RESULT,
  component: lazy(() => import('./InsertImagesBody.js')),
});
