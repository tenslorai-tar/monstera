import { lazy } from 'react';
import { z } from 'zod';

import { SAVE_TOO_DEEP_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a save, a copy or a copy to work on opens when main answers that the document is too deep to save. */
export const SAVE_TOO_DEEP_DIALOG_ID = 'dialog.save-too-deep';

/** The one way forward it can offer; closing it leaves everything as it was. */
export const SAVE_TOO_DEEP_RESULT = z.literal('copy-without-bookmarks');

/**
 * Said BEFORE anything is written (the owner's decision of 2026-10-16): the document nests deeper than the engine's
 * save can hold, so the save was not attempted rather than ending the engine host (`saveDepth.ts` in the kernel).
 *
 * `bookmarks` says the deep chain is the outline, and then the dialog offers *Save a copy without bookmarks*; otherwise
 * there is nothing to offer and it says so. `still` is the answer to that copy when it, too, was too deep.
 */
export const SAVE_TOO_DEEP_DIALOG = declareDialog({
  id: SAVE_TOO_DEEP_DIALOG_ID,
  title: SAVE_TOO_DEEP_TITLE,
  props: z.object({ bookmarks: z.boolean(), still: z.literal(true).exactOptional() }).strict(),
  result: SAVE_TOO_DEEP_RESULT,
  component: lazy(() => import('./SaveTooDeepBody.js')),
});
