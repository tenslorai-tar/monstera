import type { DocId } from '@monstera/shared';

import { applyRedactionsDefaults } from '../dialogs/applyRedactions.js';
import {
  PENDING_REDACTIONS_DIALOG_ID,
  PENDING_REDACTIONS_RESULT,
  type PendingRedactionOccasion,
} from '../dialogs/pendingRedactions.js';
import { type DocumentCommandDeps, applyDocumentCommand } from './documentCommands.js';
import { countPendingRedactions } from './redactionMarks.js';

/**
 * Redaction marks nobody has applied, asked about before the document leaves the person's hands — the owner's item N1
 * (2 October): *"Saving, closing or exporting a document with marks pending asks."*
 *
 * ## Why it exists
 *
 * A mark is an annotation. It says *this is to be removed*, and until `applyRedactions` burns it in, the words under
 * it are still in the content stream: a saved file, a Word export or a print carries them in full, and anyone can
 * select them. A person who drew marks and pressed Save believing the document redacted is the failure this question
 * stops. The mark's own look (`registries/annotationTypes.tsx`) is the other half — it no longer resembles the black
 * box a burn-in leaves.
 *
 * ## ONE QUESTION, asked from every place the document leaves (B3a)
 *
 * The save command and the close path's *Save*, the one close path for a document with nothing unsaved, and each
 * export, print and send — through {@link settlePendingRedactions}, composed once in `App.tsx` and handed to the
 * commands as `SettlesMarksFirst`, `RecognisesFirst`'s shape (ADR-0118). There is no single call every one of those
 * already passes through: the signature warning is main's answer to `document.save` alone, and each export is its own
 * channel. So the question has one owner and the callers take it, rather than each spelling its own.
 *
 * The count is `countPendingRedactions`' (`redactionMarks.ts`), which *Apply redactions* reads too. A refused read
 * asks nothing here: asking *0 redactions are marked* is not possible (the dialog's count is positive), and inventing
 * a count to ask with would be a claim nothing supports.
 */

/**
 * What became of the question: nothing to ask; the marks were applied; the person went ahead without applying; or the
 * person stopped — which includes an Apply that main refused, since going ahead after it would write the very marks
 * the person had just asked to burn in.
 */
export type MarksSettled = 'none' | 'applied' | 'kept' | 'stopped';

/**
 * Asks about the document's unapplied marks, where it carries any, and applies them on *Apply*.
 *
 * *Apply* burns in **every page's** marks with the choices the Apply redactions dialog starts on
 * (`applyRedactionsDefaults('all')`), through the one dispatcher — so the undo, the problem dialog and invariant 18's
 * notice are the burn-in's own. The question is the confirmation: *Confirm before redacting* governs the ribbon's
 * command, whose dialog is where the scope and cover are chosen, and a second dialog here would ask the same thing
 * twice.
 *
 * @param deps `onApplied` must move THIS document's view, not whichever one is in front: a close asks about each
 *   document in turn, and the one being asked about may not be the one that was active when the close began.
 * @param beforeAsking runs only when there is something to ask — the close path brings the document's tab to the
 *   front, so the question is about something on screen.
 */
export async function settlePendingRedactions(
  deps: DocumentCommandDeps,
  docId: DocId,
  occasion: PendingRedactionOccasion,
  beforeAsking: () => void = () => undefined,
): Promise<MarksSettled> {
  const count = await countPendingRedactions(deps.client, docId);
  if (count === undefined || count === 0) return 'none';

  beforeAsking();
  const answer = PENDING_REDACTIONS_RESULT.safeParse(await deps.ask(PENDING_REDACTIONS_DIALOG_ID, { count, occasion }));
  // DISMISSED IS CANCEL: the platform's × and Escape must never be the answer that writes the marks out.
  if (!answer.success) return 'stopped';
  if (answer.data === 'without') return 'kept';

  const { pages, cover, images, keepTitle } = applyRedactionsDefaults('all');
  const applied = await applyDocumentCommand(deps, docId, {
    kind: 'applyRedactions',
    pages: pages === 'all' ? 'all' : [...pages],
    cover,
    images,
    keepTitle,
  });
  return applied ? 'applied' : 'stopped';
}

/** Whether the action that asked may go ahead. */
export function proceeds(settled: MarksSettled): boolean {
  return settled !== 'stopped';
}
