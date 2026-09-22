import type { CloudFile, CloudProviderId, CloudRefusal, ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { CLOUD_OUTCOME_DIALOG_ID } from '../dialogs/cloudOutcome.js';
import { CLOUD_DIALOG_ID, CLOUD_RESULT } from '../dialogs/cloudStorage.js';
import { CLOUD_COMMAND_TITLE, GROUP_FILE, SAVE_BACK_TITLE } from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { hasDocument, reportProblem } from './documentCommands.js';
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
export function cloudStorageCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'cloud.storage',
    icon: 'Cloud',
    title: CLOUD_COMMAND_TITLE,
    // HOME › FILE, beside the other ways a document is opened and saved. It needs no document —
    // it is a way to START with one — so it declares no `when`, and the palette reaches it on the
    // start screen too.
    placements: [{ surface: 'ribbon', section: 'home', group: GROUP_FILE, order: 35 }],
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

        const opened = await deps.client['cloud.open']({ provider: choice.provider, fileId: choice.fileId });
        if (!opened.ok) return;
        const result = opened.value;
        if (result.kind === 'opened') {
          deps.onOpened({ docId: result.docId, version: result.version, byteLength: result.byteLength, name: result.name });
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
 */
export function saveBackCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'cloud.save-back',
    icon: 'CloudUpload',
    title: SAVE_BACK_TITLE,
    placements: [{ surface: 'ribbon', section: 'home', group: GROUP_FILE, order: 36 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      if (context.docId === undefined) return;
      const answer = await deps.client['cloud.saveBack']({ docId: context.docId });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      void deps.ask(CLOUD_OUTCOME_DIALOG_ID, { outcome: result.kind === 'refused' ? result.reason : result.kind });
    },
  };
}
