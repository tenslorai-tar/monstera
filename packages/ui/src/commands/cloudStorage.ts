import type { CloudFile, CloudProviderId, CloudRefusal, ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { CLOUD_OUTCOME_DIALOG_ID } from '../dialogs/cloudOutcome.js';
import { CLOUD_DIALOG_ID, CLOUD_RESULT } from '../dialogs/cloudStorage.js';
import { CLOUD_VIEW_ONLY_DIALOG_ID, CLOUD_VIEW_ONLY_RESULT, type CloudViewOnlyMoment } from '../dialogs/cloudViewOnly.js';
import type { ShowBusy } from '../busyNote.js';
import {
  CLOUD_COMMAND_TITLE,
  CLOUD_CHOOSING,
  CLOUD_DOWNLOADING,
  CLOUD_DOWNLOADING_FILE,
  SAVE_BACK_TITLE,
  TOAST_CLOUD_COPY_SAVED,
  TOAST_SAVED_BACK,
} from '../messages/en.js';
import type { ShowToast } from '../toasts.js';
import { type CommandContext, TOASTS, type UiCommand, VISIBLE } from '../registries/commands.js';
import { confirmDone } from './confirmWritten.js';
import { type SettlesMarksFirst, type WritesItsOwnFile, hasDocument, reportProblem } from './documentCommands.js';
import type { OpenedDocument } from './importMarkdown.js';

/**
 * Cloud storage in the renderer (ADR-0091): one dialog, and *Save back*.
 *
 * ## The dialog makes no call; this command does, and shows it again
 *
 * `aiSetup.ts`' loop: the dialog answers what the person chose — sign in, sign out, show a
 * provider's PDFs, open one, upload the open document — this runs it through `main`, and the
 * dialog opens again saying what happened. Opening a file ends the loop with the document as a tab,
 * through the same two callbacks every other open uses.
 *
 * ## No path, no token, no client value reaches here
 *
 * A provider, a file id and a `DocId` go out; states, file names and open outcomes come back.
 */
/**
 * Tells the person a cloud file is shared with them to view, and makes the copy they ask for (the owner's decision A,
 * 2026-09-30). The copy is `cloud.uploadCopy`, which also links the document to it — so Save back afterwards goes to
 * the person's own copy rather than to a file they cannot change.
 */
async function offerCopy(
  deps: {
    readonly client: ContractClient;
    readonly ask: (id: string, props: unknown) => Promise<unknown>;
    readonly toast: ShowToast;
  },
  docId: DocId,
  provider: CloudProviderId,
  moment: CloudViewOnlyMoment,
): Promise<void> {
  const answered = CLOUD_VIEW_ONLY_RESULT.safeParse(await deps.ask(CLOUD_VIEW_ONLY_DIALOG_ID, { provider, moment }));
  if (!answered.success) return;
  const uploaded = await deps.client['cloud.uploadCopy']({ docId, provider });
  if (!uploaded.ok) {
    reportProblem(deps, uploaded.error);
    return;
  }
  if (uploaded.value.kind === 'refused') {
    void deps.ask(CLOUD_OUTCOME_DIALOG_ID, { outcome: uploaded.value.reason });
    return;
  }
  confirmDone(deps, TOAST_CLOUD_COPY_SAVED);
}

export function cloudStorageCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** Says a copy was saved, when a view-only file's copy is asked for at open. */
  readonly toast: ShowToast;
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
  /** Says a download is under way while `cloud.open` runs. */
  readonly busy: ShowBusy;
}): UiCommand {
  return {
    id: 'cloud.storage',
    feedback: VISIBLE,
    icon: 'Cloud',
    title: CLOUD_COMMAND_TITLE,
    // FILE, beside the other ways a document is opened. It needs no document — it is a way to START with one — so it
    // declares no `when`, and the menu and the palette reach it on the start screen too. It was Home › File's More
    // until the menu bar gave the application menus a home (ADR-0107).
    placements: [{ surface: 'menu-bar', menu: 'file', group: 0, order: 30 }],
    run: async (context: CommandContext): Promise<void> => {
      let listing: { provider: CloudProviderId; files: readonly CloudFile[] } | undefined;
      let problem: CloudRefusal | undefined;
      let note: 'signed-in' | 'signed-out' | 'uploaded' | undefined;

      for (;;) {
        const status = await deps.client['cloud.status']({});
        if (!status.ok) return;
        const answered = CLOUD_RESULT.safeParse(
          await deps.ask(CLOUD_DIALOG_ID, {
            providers: status.value.providers,
            documentOpen: context.docId !== undefined,
            ...(listing === undefined ? {} : { listing: { provider: listing.provider, files: [...listing.files] } }),
            ...(problem === undefined ? {} : { problem }),
            ...(note === undefined ? {} : { note }),
          }),
        );
        // A DISMISSAL ANSWERS NOTHING the schema accepts, and ends the loop (ADR-0038).
        if (!answered.success) return;
        const choice = answered.data;
        problem = undefined;
        note = undefined;

        if (choice.kind === 'sign-out') {
          await deps.client['cloud.signOut']({ provider: choice.provider });
          listing = undefined;
          note = 'signed-out';
          continue;
        }
        if (choice.kind === 'sign-in') {
          const signedIn = await deps.client['cloud.signIn']({ provider: choice.provider });
          if (signedIn.ok && signedIn.value.kind === 'refused') problem = signedIn.value.reason;
          else if (signedIn.ok) note = 'signed-in';
          continue;
        }
        if (choice.kind === 'list') {
          const listed = await deps.client['cloud.list']({ provider: choice.provider });
          if (listed.ok) {
            const answer = listed.value;
            if (answer.kind === 'refused') problem = answer.reason;
            else listing = { provider: choice.provider, files: answer.files };
          }
          continue;
        }
        if (choice.kind === 'upload') {
          if (context.docId === undefined) continue;
          const uploaded = await deps.client['cloud.uploadCopy']({ docId: context.docId, provider: choice.provider });
          if (!uploaded.ok) {
            reportProblem(deps, uploaded.error);
            return;
          }
          if (uploaded.value.kind === 'refused') problem = uploaded.value.reason;
          else note = 'uploaded';
          continue;
        }

        // A LINE ON SCREEN FOR THE DOWNLOAD: the dialog has closed and the tab arrives only when main has the
        // whole file, which the Stage 9 run measured at about sixteen seconds of nothing (see `busyNote.ts`).
        // THE PICKER'S TOO (ADR-0091, corrected 2026-09-29): the choice is made in the browser, so the line says the
        // application is waiting for it, and the chosen file then opens exactly as a listed one does.
        // THE LINE IS RAISED BEFORE THE REQUEST GOES — `done` first, then the call — and ended after its answer.
        const name = choice.kind === 'open' ? listing?.files.find((file) => file.id === choice.fileId)?.name : undefined;
        const done =
          choice.kind === 'pick'
            ? deps.busy(CLOUD_CHOOSING, {})
            : name === undefined
              ? deps.busy(CLOUD_DOWNLOADING, {})
              : deps.busy(CLOUD_DOWNLOADING_FILE, { name });
        const opened = await (
          choice.kind === 'pick'
            ? deps.client['cloud.pick']({ provider: choice.provider })
            : deps.client['cloud.open']({ provider: choice.provider, fileId: choice.fileId })
        ).finally(done);
        if (!opened.ok) return;
        const result = opened.value;
        if (result.kind === 'opened') {
          deps.onOpened({ docId: result.docId, version: result.version, byteLength: result.byteLength, name: result.name });
          // SAID BEFORE ANY EDIT: a file the provider says this person may not change is named as such the moment it
          // opens, rather than discovered at Save back after the work is done.
          const access = await deps.client['cloud.access']({ docId: result.docId });
          if (access.ok && access.value.kind === 'from-cloud' && access.value.canEdit === false) {
            await offerCopy(deps, result.docId, access.value.provider, 'opened');
          }
          return;
        }
        if (result.kind === 'already-open') {
          deps.onAlreadyOpen(result.docId);
          return;
        }
        // THE REFUSALS AND THE OPEN FAILURES stay in the dialog, said by name, so the person can
        // choose another file or sign in again without starting over.
        problem = result.kind === 'refused' ? result.reason : 'rejected';
      }
    },
  };
}

/**
 * *Save back to cloud*: the document is saved to its working copy and sent to the cloud file it
 * came from. Offered for every open document and SAYS so for one that did not come from the cloud:
 * the renderer does not know a document's origin, and a hidden command would leave a person with a
 * cloud document no way to learn why nothing is offered.
 *
 * ## It writes the document's own file, so it records the save as Save does
 *
 * {@link WritesItsOwnFile}: main saves the working copy FIRST, so a refusal on the way out still
 * leaves the document saved at the version it names, and the tab must agree with
 * `document.unsaved` in both cases. Only the two answers that saved nothing leave it dirty.
 */
export function saveBackCommand(
  deps: {
    readonly client: ContractClient;
    readonly ask: (id: string, props: unknown) => Promise<unknown>;
  } & WritesItsOwnFile &
    SettlesMarksFirst,
): UiCommand {
  return {
    id: 'cloud.save-back',
    feedback: TOASTS,
    icon: 'CloudUpload',
    title: SAVE_BACK_TITLE,
    placements: [{ surface: 'menu-bar', menu: 'file', group: 1, order: 30 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId } = context;
      if (docId === undefined) return;
      // A SAVE, and the file it writes is shared by definition: the marks question is Save's.
      if (!(await deps.settleMarks(docId, 'save'))) return;
      const answer = await deps.client['cloud.saveBack']({ docId });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      // THE STATE FIRST, THEN THE ANNOUNCEMENT, as `saveDocument` orders them.
      if (result.kind === 'saved-back' || result.kind === 'refused') deps.onSaved(docId, result.version);
      if (result.kind === 'saved-back') {
        confirmDone(deps, TOAST_SAVED_BACK);
        return;
      }
      // A FILE THIS PERSON MAY NOT CHANGE is not an error to report: the offer is a copy in their own storage. Known at
      // open (`read-only`), or learnt from the provider's 403 now (`forbidden`) — never "sign in again".
      if (result.kind === 'refused' && (result.reason === 'read-only' || result.reason === 'forbidden')) {
        const access = await deps.client['cloud.access']({ docId });
        if (access.ok && access.value.kind === 'from-cloud') {
          await offerCopy(deps, docId, access.value.provider, result.reason);
          return;
        }
      }
      void deps.ask(CLOUD_OUTCOME_DIALOG_ID, { outcome: result.kind === 'refused' ? result.reason : result.kind });
    },
  };
}
