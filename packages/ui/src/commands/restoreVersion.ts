import type { DocId } from '@monstera/shared';

import { LEGACY_BACKUPS_DIALOG_ID } from '../dialogs/legacyBackups.js';
import { OPEN_PROBLEM_DIALOG_ID } from '../dialogs/openProblem.js';
import { RESTORE_VERSION_DIALOG_ID } from '../dialogs/restoreVersion.js';
import { RESTORE_VERSION_RESULT } from '../dialogs/restoreVersionResult.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import {
  RESTORE_VERSION_COMMAND_TITLE,
  TOAST_LEGACY_MOVED,
  TOAST_RESTORE_GONE,
  TOAST_RESTORE_NONE,
} from '../messages/en.js';
import { TOASTS, type UiCommand } from '../registries/commands.js';
import { confirmDone } from './confirmWritten.js';
import { type DocumentCommandDeps, hasDocument, reportProblem } from './documentCommands.js';
import type { OpenedDocument } from './importMarkdown.js';
import type { ShowToast } from '../toasts.js';

/**
 * File › *Restore a previous version…* ([ADR-0198](../../../../docs/DECISIONS/0198-backups-live-in-monsteras-own-data-folder-keyed-by-the-files-canonical-path-and-nothing-is-written-beside-the-file.md)):
 * the versions Monstera kept when a save replaced them, with the date and time each was saved over; the one chosen is
 * written as a COPY where the person picks and opened as its own tab. The document is not changed and the version is never
 * opened itself, so saving cannot overwrite it.
 *
 * ## Nothing but an id crosses
 *
 * Main lists each version under an opaque id and takes that id back. No path is in the dialog, the command or the channel.
 */
export function restoreVersionCommand(
  deps: DocumentCommandDeps & { readonly toast: ShowToast; readonly onOpened: (opened: OpenedDocument) => void },
): UiCommand {
  return {
    id: 'document.restore-version',
    feedback: TOASTS,
    icon: 'RotateCcw',
    title: RESTORE_VERSION_COMMAND_TITLE,
    // FILE › BESIDE SAVE A COPY: the other thing a person does with the file's own history.
    placements: [{ surface: 'menu-bar', menu: 'file', group: 1, order: 25 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      const docId = context.docId;
      if (docId === undefined) return;
      const listed = await deps.client['document.listBackups']({ docId });
      if (!listed.ok) {
        reportProblem(deps, listed.error);
        return;
      }
      if (listed.value.versions.length === 0) {
        // NOTHING TO CHOOSE FROM, said as a sentence and not as an empty dialog: the first save over a file keeps its first version.
        deps.toast('problem', TOAST_RESTORE_NONE);
        return;
      }
      // A DISMISSAL ANSWERS NOTHING THE SCHEMA ACCEPTS, and ends it (ADR-0038).
      const chosen = RESTORE_VERSION_RESULT.safeParse(await deps.ask(RESTORE_VERSION_DIALOG_ID, { versions: listed.value.versions }));
      if (!chosen.success) return;

      const restored = await deps.client['document.restoreBackup']({ docId, id: chosen.data.id });
      if (!restored.ok) {
        reportProblem(deps, restored.error);
        return;
      }
      const outcome = restored.value;
      switch (outcome.kind) {
        case 'opened':
          deps.onOpened({ docId: outcome.docId, version: outcome.version, byteLength: outcome.byteLength, name: outcome.name });
          return;
        case 'cancelled':
          return;
        case 'gone':
          deps.toast('problem', TOAST_RESTORE_GONE);
          return;
        case 'destination-contested':
          void deps.ask(SAVE_PROBLEM_DIALOG_ID, { outcome: 'contested' });
          return;
        case 'write-failed':
          void deps.ask(SAVE_PROBLEM_DIALOG_ID, { outcome: 'write-failed' });
          return;
        case 'absent':
        case 'at-capacity':
        case 'busy':
        case 'denied':
          void deps.ask(OPEN_PROBLEM_DIALOG_ID, { reason: outcome.kind });
          return;
      }
    },
  };
}

/**
 * Offers, as a document opens, to move the old `.bak` files beside it that Monstera made into its own folder — ONCE PER FOLDER
 * (ADR-0198 Decision 5). Main counts the files it can PROVE it made and answers nothing for a folder already offered or
 * with none; the files it cannot prove are counted apart and stay where they are, which the dialog says. Either answer is
 * remembered by main, so the question is asked once.
 */
export async function offerOldBackups(
  deps: Pick<DocumentCommandDeps, 'client' | 'ask'> & { readonly toast: ShowToast },
  docId: DocId,
): Promise<void> {
  const found = await deps.client['document.legacyBackups']({ docId });
  // CLOSED BEFORE THE ANSWER, or a problem that needs no sentence here: this is an offer, never a thing a person asked for.
  if (!found.ok || found.value.kind !== 'found') return;
  const { proven, unproven } = found.value;
  const answer = (await deps.ask(LEGACY_BACKUPS_DIALOG_ID, { proven, unproven })) as { readonly move: boolean } | undefined;
  // A DISMISSAL IS *LEAVE THEM*, and is remembered as the answer: the question is asked once.
  const moved = await deps.client['document.moveLegacyBackups']({ docId, move: answer?.move === true });
  if (moved.ok && moved.value.moved > 0) confirmDone(deps, TOAST_LEGACY_MOVED);
}
