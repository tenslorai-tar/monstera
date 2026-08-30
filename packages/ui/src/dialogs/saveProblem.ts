import { lazy } from 'react';
import { z } from 'zod';

import { SAVE_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `saveCommand` opens, and the registry's key. */
export const SAVE_PROBLEM_DIALOG_ID = 'dialog.save-problem';

/**
 * What the user is told when a save did not happen.
 *
 * ## Why this is a dialog and not a toast
 *
 * Invariant 18: *"a failed save never loses work … never by a dialog whose only
 * option discards their edits"*. Both outcomes leave the document intact, still
 * dirty, with its command log untouched — so the thing the user most needs is
 * the fact that nothing was lost, and a message that can be missed is the wrong
 * carrier for it. A toast is dismissible by not looking.
 *
 * Until this landed, `refused` and `write-failed` were **silent**: the command
 * received them and returned, and the user pressed Save and saw nothing at all.
 * That is worse than an error, because it is indistinguishable from success.
 *
 * ## One enum, five members, and no `kind` beside it
 *
 * The channel answers `{kind: 'refused', reason}` or `{kind: 'write-failed'}`,
 * which is two fields describing one thing. Flattening them here means the body
 * switches once and exhaustively: a sixth outcome is a compile error at the
 * switch rather than a branch that renders nothing (B5). Carrying both would
 * make `{kind: 'write-failed', reason: 'contested'}` representable, which is a
 * state nothing can produce and every reader has to rule out.
 *
 * `saved` is deliberately absent. A dialog for the successful case is a dialog
 * that appears every time the user presses Ctrl+S, and the schema refusing it is
 * cheaper than a rule about when to call this.
 */
export const SAVE_PROBLEM_DIALOG = declareDialog({
  id: SAVE_PROBLEM_DIALOG_ID,
  title: SAVE_PROBLEM_TITLE,
  props: z.object({
    outcome: z.enum(['contested', 'replaced', 'target-absent', 'unverifiable', 'write-failed']),
  }),
  component: lazy(() => import('./SaveProblemBody.js')),
});
