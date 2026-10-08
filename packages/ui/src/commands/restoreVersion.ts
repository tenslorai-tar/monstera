import type { DocId } from '@monstera/shared';

import { OPEN_PROBLEM_DIALOG_ID } from '../dialogs/openProblem.js';
import { RESTORE_VERSION_DIALOG_ID } from '../dialogs/restoreVersion.js';
import { RESTORE_VERSION_RESULT } from '../dialogs/restoreVersionResult.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import {
  RESTORE_VERSION_COMMAND_TITLE,
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
 * As a document opens, moves the old `.bak` files beside it that Monstera made into its own folder, with no dialog, no setting
 * and no notice (ADR-0198 Decision 5, corrected 2026-10-09: the owner overruled the offer). Main moves only the files it can
 * PROVE it made; a failure leaves the file where it is and this says nothing.
 */
export async function adoptOldBackups(deps: Pick<DocumentCommandDeps, 'client'>, docId: DocId): Promise<void> {
  await deps.client['document.adoptOldBackups']({ docId });
}
