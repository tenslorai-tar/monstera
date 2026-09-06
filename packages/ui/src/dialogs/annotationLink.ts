import { MAX_LINK_URI } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { LINK_ADDRESS_TITLE, LINK_PAGE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The ids the two link tools open. */
export const LINK_ADDRESS_DIALOG_ID = 'dialog.link-address';
export const LINK_PAGE_DIALOG_ID = 'dialog.link-page';

/**
 * What a link points at, asked for after the rectangle has been drawn.
 *
 * ## TWO DIALOGS, because they ask two questions
 *
 * A web address and a page number are not one field with a mode on it. The
 * sticky note and the text box already set the shape — same form, own words,
 * own title — and here the difference is larger than wording: one answer is
 * validated against a URL grammar and the other against the document's own page
 * count. A single dialog would need a discriminant in its props, and
 * `declareDialog` takes its title statically, so the title would have to go
 * generic to make room.
 *
 * ## The result is a string in both, and the tool interprets it
 *
 * `{ text }`, as the annotation-text dialogs answer, rather than a parsed
 * number or a parsed URL. The dialog collects what a person typed; what it
 * MEANS is the tool's, and the payload schema is what finally refuses — so
 * there is one place a link's target is judged rather than a dialog and a
 * schema each holding an opinion.
 *
 * **Its own bound, not the annotation text's.** `MAX_LINK_URI` is 2,048 where a
 * note's is 4,096, and reusing the wider one would be a dialog that accepts what
 * the channel refuses.
 */
export const LINK_TEXT_RESULT = z
  .object({ text: z.string().trim().min(1).max(MAX_LINK_URI) })
  .strict();

/** What a link dialog answers with. */
export type LinkTextAnswer = z.infer<typeof LINK_TEXT_RESULT>;

export const LINK_ADDRESS_DIALOG = declareDialog({
  id: LINK_ADDRESS_DIALOG_ID,
  title: LINK_ADDRESS_TITLE,
  props: z.object({}).strict(),
  result: LINK_TEXT_RESULT,
  component: lazy(() => import('./LinkAddressBody.js')),
});

export const LINK_PAGE_DIALOG = declareDialog({
  id: LINK_PAGE_DIALOG_ID,
  title: LINK_PAGE_TITLE,
  props: z.object({}).strict(),
  result: LINK_TEXT_RESULT,
  component: lazy(() => import('./LinkPageBody.js')),
});
