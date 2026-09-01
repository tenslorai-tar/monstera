import { lazy } from 'react';
import { z } from 'zod';

import { HISTORY_TRIMMED_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `rotatePageCommand` opens when a command cost undo steps. */
export const HISTORY_TRIMMED_DIALOG_ID = 'dialog.history-trimmed';

/**
 * What the user is told when the checkpoint budget shortened their undo history.
 *
 * ## Why this exists at all — invariant 18, stated as an obligation
 *
 * §4 bounds memory at *"one document plus a few checkpoints"*, so a long session
 * eventually sheds the oldest ones. A checkpoint is what undo needs to step over
 * a non-invertible command, so dropping one ends undo past that point. **A
 * silently shortened history is work quietly becoming unrecoverable**, which is
 * precisely what invariant 18 forbids — the loss is invisible until the user
 * reaches for it, and by then there is nothing to say.
 *
 * ## Why NOT `dialog.command-problem`, which is where this was expected to go
 *
 * That dialog is titled *"That could not be done"* and its props are a union of
 * **failure codes**. This fires on a command that succeeded. Reusing it would
 * tell the user their operation failed at the exact moment it worked, which is
 * worse than the silence it replaces — and the schema would have had to grow a
 * member that is not a failure, ending the property that makes the union
 * readable.
 *
 * ## Why a dialog rather than a toast, and the honest limit
 *
 * A toast is the better carrier and does not exist: it is D12, Stage 0/1, and
 * unstarted. Between a modal and nothing, invariant 18 chooses the modal — the
 * same reasoning `dialog.save-problem` records for a message that can be missed
 * by not looking.
 *
 * **It fires rarely by construction**, because it fires only when the budget was
 * actually reached, which needs a session long enough to accumulate checkpoints
 * past §9.17's ceiling. If that turns out to be often, the answer is the toast
 * and not a suppression rule.
 *
 * ## A COUNT, and it is not optional
 *
 * `dropped` is how many undo steps went. Bytes would answer a question the user
 * did not ask; a boolean would leave *"some history"* to a sentence that cannot
 * say how much. The schema requires it to be positive: a dialog opened for zero
 * dropped steps is a modal that tells the user nothing happened, and making that
 * unrepresentable is cheaper than a rule about when to call this — the same
 * trade `dialog.save-problem` makes by refusing `saved`.
 */
export const HISTORY_TRIMMED_DIALOG = declareDialog({
  id: HISTORY_TRIMMED_DIALOG_ID,
  title: HISTORY_TRIMMED_TITLE,
  props: z.object({ dropped: z.number().int().positive() }).strict(),
  component: lazy(() => import('./HistoryTrimmedBody.js')),
});
