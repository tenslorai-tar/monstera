import { lazy } from 'react';
import { z } from 'zod';

import { ANNOTATION_REPLY_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { ANNOTATION_TEXT_RESULT } from './annotationTextResult.js';

/** The id the annotation menu's *Reply* opens to collect the answer. */
export const ANNOTATION_REPLY_DIALOG_ID = 'dialog.annotation-reply';

/**
 * What a reply says, asked for after a mark has been selected.
 *
 * ## Its own declaration, sharing the text box's RESULT
 *
 * {@link ANNOTATION_NOTE_DIALOG}'s argument unchanged: the answer is the same
 * shape and the same rules — one non-empty line, trimmed, bounded by the
 * payload's `MAX_ANNOTATION_TEXT` — so {@link ANNOTATION_TEXT_RESULT} is
 * imported rather than restated, and what is not shared is the wording.
 *
 * ## And it is a THIRD declaration rather than a prop on the note's
 *
 * *Add note* and *Reply* differ in every word a person reads and in nothing
 * else, which is exactly the shape that invites one dialog with a mode flag.
 * That flag would be a user-facing string chosen by a variable — the one door
 * B9's lint rule cannot see — and the wrong branch produces a dialog that says
 * *Add note* over a box whose answer becomes a reply. Three small declarations
 * that each say one thing is the cheaper mistake.
 *
 * ## No props, and NOT the parent's text
 *
 * {@link ANNOTATION_EDIT_DIALOG} takes the mark's current text because an edit
 * starts from it. A reply does not: the parent's words are not the reply's
 * draft, and pre-filling them would make *Reply* answer the comment by quoting
 * it back. `.strict()` on an empty object refuses a caller that passes
 * something, which is how a props shape drifts.
 */
export const ANNOTATION_REPLY_DIALOG = declareDialog({
  id: ANNOTATION_REPLY_DIALOG_ID,
  title: ANNOTATION_REPLY_TITLE,
  props: z.object({}).strict(),
  result: ANNOTATION_TEXT_RESULT,
  component: lazy(() => import('./AnnotationReplyBody.js')),
});
