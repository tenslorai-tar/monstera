import { lazy } from 'react';
import { z } from 'zod';

import { DUPLICATE_PAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { DUPLICATE_PAGES_RESULT } from './duplicatePagesResult.js';

/** The id `findDuplicatePagesCommand` opens with what the engine found. */
export const DUPLICATE_PAGES_DIALOG_ID = 'dialog.duplicate-pages';

/**
 * What the engine found, and an offer to remove the extra copies.
 *
 * ## It opens even when there is nothing, and that is the design
 *
 * A command that silently did nothing when a document has no duplicates is one
 * a person presses twice. The dialog reports the empty case in words, with the
 * action disabled — *found nothing* said out loud is the difference between a
 * measurement and a control that appears broken.
 *
 * ## THE PROPS SAY WHAT WAS COMPARED, because the list understates
 *
 * The finder errs towards missing duplicates: two pages are grouped only when
 * their content bytes are equal and they resolve the same resources, so pages
 * that render identically from independently built resources are absent. The
 * body says so. A list headed *duplicates* with no such sentence is one a
 * person acts on without asking what it means.
 *
 * `truncated` rides in for the same reason: a person offered *remove them all*
 * against a clipped list would remove some and be told it had finished.
 */
export const DUPLICATE_PAGES_DIALOG = declareDialog({
  id: DUPLICATE_PAGES_DIALOG_ID,
  title: DUPLICATE_PAGES_TITLE,
  props: z
    .object({
      groups: z.array(z.object({ pages: z.array(z.number().int().nonnegative()).min(2) })),
      truncated: z.boolean(),
    })
    .strict(),
  result: DUPLICATE_PAGES_RESULT,
  component: lazy(() => import('./DuplicatePagesBody.js')),
});
