import { lazy } from 'react';
import { z } from 'zod';

import { INSERT_IMAGE_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `insertImageCommand` opens when a picked file did not become a page. */
export const INSERT_IMAGE_PROBLEM_DIALOG_ID = 'dialog.insert-image-problem';

/**
 * What the user is told when the image they picked did not become a page.
 *
 * ## Why not `dialog.command-problem`
 *
 * `historyTrimmed.ts`' argument, in the other direction. That dialog's props
 * are a union of **failure codes** — outcomes where the channel refused — and
 * these two are neither: the channel answered `ok`, and what it reported is
 * that the *file* was the problem. Folding them in would mean adding members to
 * a union whose readability is that every member is a failure code, and would
 * put a document-level refusal and a bad JPEG behind one sentence.
 *
 * ## Both reasons are here and neither is silent
 *
 * A dismissal is the third outcome and opens nothing, because the user did it
 * on purpose. These two they did not: they chose a file and got no page, and a
 * command that returned quietly would be the display-only failure — a control
 * that ran and appeared to do nothing.
 *
 * `too-large` carries the limit because *too large* without a number is
 * something a person cannot act on, and the number is main's rather than a
 * constant this side restates.
 *
 * ## It ANSWERS NOTHING, and that is the default
 *
 * `declareDialog` gives an entry no result unless it declares one (ADR-0038),
 * so this is informational by construction rather than by a body that happens
 * not to resolve.
 */
export const INSERT_IMAGE_PROBLEM_DIALOG = declareDialog({
  id: INSERT_IMAGE_PROBLEM_DIALOG_ID,
  title: INSERT_IMAGE_PROBLEM_TITLE,
  props: z.discriminatedUnion('reason', [
    z.object({ reason: z.literal('unreadable') }),
    z.object({ reason: z.literal('too-large'), limitBytes: z.number().int().positive() }),
  ]),
  component: lazy(() => import('./InsertImageProblemBody.js')),
});
