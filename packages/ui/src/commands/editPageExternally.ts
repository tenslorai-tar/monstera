import type { ChannelResult } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { EXTERNAL_EDIT_PROBLEM_DIALOG_ID } from '../dialogs/externalEditProblem.js';
import type { ExternalEditProblem } from '../dialogs/externalEditProblemReasons.js';
import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { REIMPORT_EXTERNAL_EDIT_DIALOG_ID } from '../dialogs/reimportExternalEdit.js';
import { REIMPORT_EXTERNAL_EDIT_RESULT } from '../dialogs/reimportExternalEditResult.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import { EDIT_PAGE_EXTERNALLY_COMMAND_TITLE, GROUP_PAGES } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { type DocumentCommandDeps, hasDocument, reportProblem } from './documentCommands.js';
import type { OpenedDocument } from './importMarkdown.js';

/**
 * D9's *Edit page in external app & reimport*
 * ([ADR-0062](../../../../docs/DECISIONS/0062-a-page-edited-in-another-application-leaves-as-a-named-file-and-returns-by-the-one-open-route.md)).
 *
 * ## IT SENDS AN INDEX AND A VERSION, and the page never crosses
 *
 * Main runs the save dialog, writes the page, hands it to the operating system's PDF handler
 * and watches it. The version is the one `context.page` was read at, and the reimport's
 * `replacePage` carries it, so a document that moved is refused by the bus rather than
 * having a different page replaced (ADR-0062's 2026-09-14 correction).
 *
 * ## ON ORGANIZE › PAGES, beside *Replace page*
 *
 * D9's section is the Tools ribbon, but its groups there are Create, OCR, Display and
 * Application, and none of them is about a page that already exists. The act this control
 * ends in is a page replaced, which is where *Replace page* already sits.
 */

/** How a send-out that did not go out is told, or `null` for the answers that need no sentence. */
export function sendOutProblem(
  answer: ChannelResult<'document.editPageExternally'>,
):
  | { readonly kind: 'save'; readonly outcome: 'write-failed' | 'contested' }
  | { readonly kind: 'external'; readonly reason: ExternalEditProblem }
  | null {
  switch (answer.kind) {
    // THE SAME WRITE A COPY MAKES, so the same sentence a copy gets (B3a).
    case 'refused':
      return { kind: 'save', outcome: 'contested' };
    case 'write-failed':
      return { kind: 'save', outcome: 'write-failed' };
    case 'not-pdf':
    case 'launch-failed':
    case 'not-watchable':
      return { kind: 'external', reason: answer.kind };
    // Named rather than defaulted, `markdownImportProblem`'s rule.
    case 'sent':
    case 'cancelled':
      return null;
  }
}

/** How a reimport that put nothing back is told, or `null` for the answers that need no sentence. */
export function reimportProblem(
  answer: ChannelResult<'document.reimportExternalEdit'>,
): ExternalEditProblem | null {
  switch (answer.kind) {
    case 'document-changed':
    case 'open-elsewhere':
    case 'absent':
    case 'at-capacity':
      return answer.kind;
    case 'reimported':
    case 'no-edit':
      return null;
  }
}

/**
 * Sends the page on screen to another application, and offers to put it back each time it
 * is saved there.
 */
export function editPageExternallyCommand(
  deps: DocumentCommandDeps & {
    readonly onOpened: (opened: OpenedDocument) => void;
    readonly onActivate: (docId: DocId) => void;
  },
): UiCommand {
  return {
    id: 'document.edit-page-externally',
    title: EDIT_PAGE_EXTERNALLY_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'organize', group: GROUP_PAGES, order: 75 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined || context.version === undefined) {
        return;
      }
      const docId = context.docId;
      const page = context.page;

      const sent = await deps.client['document.editPageExternally']({
        docId,
        page,
        version: context.version,
      });
      if (!sent.ok) {
        reportProblem(deps, sent.error);
        return;
      }
      if (sent.value.kind !== 'sent') {
        const problem = sendOutProblem(sent.value);
        if (problem?.kind === 'save') void deps.ask(SAVE_PROBLEM_DIALOG_ID, { outcome: problem.outcome });
        if (problem?.kind === 'external') {
          void deps.ask(EXTERNAL_EDIT_PROBLEM_DIALOG_ID, { reason: problem.reason });
        }
        return;
      }

      // BOUNDED BY WHAT MAIN ANSWERS, not by a counter — the text-line edit loop's rule. Every
      // wait returns within thirty seconds, and `ended` is the way out: the document closed,
      // or the page went out again from another run, which ends this one's watch.
      for (;;) {
        const waited = await deps.client['document.awaitExternalEdit']({ docId });
        if (!waited.ok) {
          reportProblem(deps, waited.error);
          return;
        }
        if (waited.value.kind === 'ended') return;
        if (waited.value.kind === 'unchanged') continue;

        // A DISMISSAL IS *NOT NOW*: the page stays out, and the next save asks again. Main
        // announces each edit once, so this does not reopen at once.
        const asked = REIMPORT_EXTERNAL_EDIT_RESULT.safeParse(
          await deps.ask(REIMPORT_EXTERNAL_EDIT_DIALOG_ID, { page }),
        );
        if (!asked.success) continue;

        const back = await deps.client['document.reimportExternalEdit']({ docId });
        if (!back.ok) {
          reportProblem(deps, back.error);
          return;
        }
        const result = back.value;
        if (result.kind === 'reimported') {
          deps.onApplied({ version: result.version, byteLength: result.byteLength });
          deps.onOpened(result.opened);
          deps.onActivate(docId);
          // INVARIANT 18, after `onApplied` and guarded on a positive count, for
          // `applyDocumentCommand`'s reason: the dialog's schema refuses zero.
          if (result.historyDropped > 0) {
            void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: result.historyDropped });
          }
          // THE SAME PAGE MAY BE SAVED AGAIN, and each save can come back.
          continue;
        }
        const problem = reimportProblem(result);
        if (problem === null) continue;
        void deps.ask(EXTERNAL_EDIT_PROBLEM_DIALOG_ID, { reason: problem });
        // A MOVED DOCUMENT OR A GONE FILE ENDS IT: every later reimport would be refused the
        // same way, so asking again would only repeat the refusal.
        if (problem === 'document-changed' || problem === 'absent') return;
      }
    },
  };
}
