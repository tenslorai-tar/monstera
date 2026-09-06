import { lazy } from 'react';
import { z } from 'zod';

import { ANNOTATION_TEXT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { ANNOTATION_TEXT_RESULT } from './annotationTextResult.js';

/** The id the text-box tool opens to collect what the box says. */
export const ANNOTATION_TEXT_DIALOG_ID = 'dialog.annotation-text';

/**
 * What a text annotation says, asked for after the box is drawn.
 *
 * ## The first dialog a TOOL opens rather than a command
 *
 * Every dialog before this one answers a registered command's `run`
 * ([ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)).
 * A tool has the same problem for the same reason — its intent is not complete
 * until a person supplies part of it — and the same answer: whatever opened the
 * dialog is what builds the command from the result. What made that possible is
 * `ToolController.commit` being able to answer later.
 *
 * ## Drawn first, then asked
 *
 * The box is dragged before the dialog opens, so the person has already said
 * *where* and is being asked only *what*. The other order — type, then place —
 * would need the text to survive a gesture that may be abandoned, and would put
 * a modal in front of a page before there is anything to attach it to.
 *
 * A consequence worth stating: a dismissed dialog leaves **nothing**. The
 * rectangle was a preview, not an annotation, and the command is built after
 * the answer rather than amended by it — so there is no half-made object to
 * clean up, which is the state a *place first, edit later* design has to
 * manage.
 *
 * ## No props
 *
 * Unlike the delete-pages dialog, this needs nothing from the document to
 * validate its answer: any non-empty string is a legal thing for a text box to
 * say, and the bound is the payload's. `.strict()` on an empty object is still
 * the right declaration rather than an omission — it refuses a caller that
 * passes something, which is how a props shape drifts.
 */
export const ANNOTATION_TEXT_DIALOG = declareDialog({
  id: ANNOTATION_TEXT_DIALOG_ID,
  title: ANNOTATION_TEXT_TITLE,
  props: z.object({}).strict(),
  result: ANNOTATION_TEXT_RESULT,
  component: lazy(() => import('./AnnotationTextBody.js')),
});
