import { lazy } from 'react';
import { z } from 'zod';

import { GENERATE_TOC_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `generateTocCommand` opens when the document carries no outline. */
export const GENERATE_TOC_PROBLEM_DIALOG_ID = 'dialog.generate-toc-problem';

/**
 * What the user is told when there is nothing to tabulate.
 *
 * ## Why not `dialog.command-problem`
 *
 * `insertImageProblem.ts`' argument, and it is the same one: that dialog's
 * props are a union of **failure codes**, outcomes where the channel refused.
 * Nothing refused here. The command was never sent — the renderer read the
 * outline, found it empty, and stopped — so folding this in would put a
 * document-level refusal and *this document has no bookmarks* behind one
 * sentence.
 *
 * ## Refusing here is what stops a blank page being generated
 *
 * The kernel throws on an empty outline, and that throw is a defect guard for
 * the narrow race where the outline is emptied between this read and the apply.
 * It is deliberately **not** the user-facing path: a throw crosses as
 * `internal` with an incident id, which is the wrong sentence for a document
 * that simply has no headings.
 *
 * ## One reason, and a union anyway
 *
 * `insertImageProblem.ts` has two and this has one, but the discriminated shape
 * is what lets a second arrive without every existing reader changing — and,
 * more usefully here, it makes the props say *which* problem rather than
 * carrying an empty object that any call satisfies.
 *
 * It answers nothing. `declareDialog` gives an entry no result unless it
 * declares one (ADR-0038), so this is informational by construction.
 */
export const GENERATE_TOC_PROBLEM_DIALOG = declareDialog({
  id: GENERATE_TOC_PROBLEM_DIALOG_ID,
  title: GENERATE_TOC_PROBLEM_TITLE,
  props: z.discriminatedUnion('reason', [
    z.object({ reason: z.literal('no-outline') }).strict(),
  ]),
  component: lazy(() => import('./GenerateTocProblemBody.js')),
});
