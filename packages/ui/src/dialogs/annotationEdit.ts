import { MAX_ANNOTATION_TEXT } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { ANNOTATION_EDIT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { ANNOTATION_TEXT_RESULT } from './annotationTextResult.js';

/** The id the annotation menu's *Edit* opens to rewrite what a mark says. */
export const ANNOTATION_EDIT_DIALOG_ID = 'dialog.annotation-edit';

/**
 * What a mark says, offered for rewriting.
 *
 * ## Its own declaration, sharing the RESULT and the form
 *
 * `annotationNote.ts`' arrangement and its argument, one dialog further on: the
 * answer is the same shape and the same rules, so {@link ANNOTATION_TEXT_RESULT}
 * is imported rather than restated. What is NOT shared is the wording — a
 * dialog headed *Note* with a button reading *Add note*, opened on a comment
 * that already exists, would say it is adding one and then replace one.
 *
 * ## It takes PROPS where the other two take none, and that is the difference
 *
 * The note and text-box dialogs ask *what*, and a blank field is the honest
 * start. This one asks *what instead*, so it opens holding the mark's current
 * text — which arrives as a prop rather than being read here, because a dialog
 * that fetched it would be a second reader of the annotation walk (B3a) and
 * would answer at a version the selection's handles may no longer name.
 *
 * ## A BLANK answer is refused, exactly as the note dialog refuses one
 *
 * `editAnnotationTextSchema` permits an empty string and this dialog does not,
 * and the two are not in conflict: the schema's allowance exists for the
 * **inverse**, which must be able to restore a mark that genuinely carried no
 * text. What a person may ask for is the narrower set, and the reason is the
 * note dialog's unchanged — an icon a reader clicks to be shown nothing is the
 * display-only defect at document scale, whether it got that way by being
 * created empty or by being emptied.
 */
export const ANNOTATION_EDIT_DIALOG = declareDialog({
  id: ANNOTATION_EDIT_DIALOG_ID,
  title: ANNOTATION_EDIT_TITLE,
  props: z.object({ text: z.string().max(MAX_ANNOTATION_TEXT) }).strict(),
  result: ANNOTATION_TEXT_RESULT,
  component: lazy(() => import('./AnnotationEditBody.js')),
});
