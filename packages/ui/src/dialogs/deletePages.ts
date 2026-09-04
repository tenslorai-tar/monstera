import { lazy } from 'react';
import { z } from 'zod';

import { DELETE_PAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { DELETE_PAGES_RESULT } from './deletePagesResult.js';

/** The id `deletePagesCommand` opens to collect a range. */
export const DELETE_PAGES_DIALOG_ID = 'dialog.delete-pages';

/**
 * The first dialog whose effect is a document **mutation**, and the first that
 * collects arguments a command then applies
 * ([ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)).
 *
 * ## Why deleting a range needs one at all
 *
 * `deletePages` takes an array and the toolbar can only ever send the page on
 * screen, so the command's own reach was one page at a time. A person wanting
 * pages 4 to 12 gone had to press a button nine times and undo nine times.
 *
 * ## The gate is the RESULT SCHEMA, not a confirmation step
 *
 * This is not *"are you sure"*. Dismissing it settles `undefined` and the
 * command returns before dispatching — there is no value to apply, so the gate
 * is a shape rather than a branch anyone can forget. A confirmation dialog over
 * an undoable command would be a modal the user learns to dismiss without
 * reading, which is worse than none.
 *
 * ## `pageCount` goes IN and pages come OUT
 *
 * The parse needs the document's length to refuse a page that does not exist,
 * and the dialog is the surface holding the text — so the bound travels in with
 * the props and the answer is already-validated **zero-based indices**. The
 * command therefore performs no arithmetic on what it receives, which is the
 * shape `pageNumbering.ts` exists to protect: the 1-based-to-0-based conversion
 * happens once, in `parsePageRanges`, and no call site repeats it.
 *
 * The result schema lives in `deletePagesResult.ts` rather than here, and that
 * is forced: this module imports the body lazily and the body needs the
 * answer's type, so declaring it beside the entry makes the two files circular.
 */
export const DELETE_PAGES_DIALOG = declareDialog({
  id: DELETE_PAGES_DIALOG_ID,
  title: DELETE_PAGES_TITLE,
  props: z.object({ pageCount: z.number().int().positive() }).strict(),
  result: DELETE_PAGES_RESULT,
  component: lazy(() => import('./DeletePagesBody.js')),
});
