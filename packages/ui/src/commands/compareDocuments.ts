import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { COMPARE_COMMAND_TITLE, GROUP_COMPARE, GROUP_DISPLAY, RIBBON_COMPARE } from '../messages/en.js';
import { type CommandContext, type UiCommand, VISIBLE } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Review › Compare — opens Side by Side on this document and the next open one (ADR-0131, FEATURES row 66).
 *
 * ## It opens the surface, and the surface compares
 *
 * Which documents go in the halves, and whether to compare at all, are chosen on Side by Side itself: each half lists
 * every open document and can open another from disk, and *Compare* there starts the walk. So this command chooses
 * only a sensible first pair — the next open document, or this one again when it is the only one, which a reader then
 * changes in the right half's list or with *Open another PDF…*. A command that asked first in a dialog would be a
 * second place to choose what the halves already choose.
 *
 * ## THE NEWER FILE ON THE RIGHT (cloud-4 8a, F-C3)
 *
 * The summary reads left to right: *inserted* is what the right has and the left does not. With the newer file on the
 * left it would read backwards, and the newer one is usually the one opened last, which is the one in front — so
 * putting this document on the left put the newer file there most of the time. Main answers which file was written
 * later; when it cannot tell, this document stays on the left.
 */
export function compareDocumentsCommand(deps: {
  readonly client: ContractClient;
  /** Opens Side by Side on these two documents; `App.tsx`'s one writer of that state. */
  readonly show: (left: DocId, right: DocId) => void;
}): UiCommand {
  return {
    id: 'document.compare',
    feedback: VISIBLE,
    icon: 'Columns2',
    title: COMPARE_COMMAND_TITLE,
    ribbonTitle: RIBBON_COMPARE,
    placements: [
      { surface: 'ribbon', section: 'review', group: GROUP_COMPARE, order: 10 },
      // AND HOME › DISPLAY, last, as v5-02 draws *Compare*: two documents side by side is a way of viewing.
      { surface: 'ribbon', section: 'home', group: GROUP_DISPLAY, order: 208 },
    ],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId } = context;
      if (docId === undefined) return;
      const other = context.openDocuments.find((document) => document.docId !== docId)?.docId;
      if (other === undefined) {
        deps.show(docId, docId);
        return;
      }
      const answer = await deps.client['document.newerOf']({ first: docId, second: other });
      // THIS DOCUMENT IS THE NEWER: it goes on the right. Any other answer, a failure included, keeps it on the left.
      if (answer.ok && answer.value.newer === 'first') deps.show(other, docId);
      else deps.show(docId, other);
    },
  };
}
