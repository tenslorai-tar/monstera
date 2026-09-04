import { lazy } from 'react';
import { z } from 'zod';

import { CROP_PAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { CROP_PAGES_RESULT } from './cropPagesResult.js';

/** The id `cropPagesCommand` opens to collect margins and a scope. */
export const CROP_PAGES_DIALOG_ID = 'dialog.crop-pages';

/**
 * Margins and a scope, for the second command whose arguments come from a
 * dialog.
 *
 * ## Why margins and not a rectangle drawn on the page
 *
 * Dragging a crop rectangle on the page is the better surface and it is a
 * **tool**, which is D3's registry and Stage 3's platform — a controller with
 * begin/update/commit/cancel, an overlay, and the coordinate adapters that go
 * with it. Building one here would be a second tool surface beside the registry
 * that exists to hold them.
 *
 * A margins dialog is the operation a person can already reach, and the two are
 * not alternatives: the tool, when it arrives, dispatches the same command with
 * the same four numbers.
 *
 * ## The current page travels IN so the scope can be offered
 *
 * *This page* and *all pages* are the two scopes worth having, and the first
 * needs to know which page. The dialog resolves the choice and answers with the
 * scope the command carries, so nothing downstream re-derives it.
 */
export const CROP_PAGES_DIALOG = declareDialog({
  id: CROP_PAGES_DIALOG_ID,
  title: CROP_PAGES_TITLE,
  props: z
    .object({
      /** The page being read, zero-based, for the *this page* scope. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: CROP_PAGES_RESULT,
  component: lazy(() => import('./CropPagesBody.js')),
});
