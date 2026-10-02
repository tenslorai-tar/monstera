import type { DocId } from '@monstera/shared';

import { COMPARE_COMMAND_TITLE, GROUP_COMPARE, GROUP_DISPLAY, RIBBON_COMPARE } from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Review › Compare — opens Side by Side with this document on the left (ADR-0131, FEATURES row 66).
 *
 * ## It opens the surface, and the surface compares
 *
 * Which document goes on the right, and whether to compare at all, are chosen on Side by Side itself: each half lists
 * every open document and can open another from disk, and *Compare* there starts the walk. So this command chooses
 * only a sensible first pair — the next open document, or this one again when it is the only one, which a reader then
 * changes in the right half's list or with *Open another PDF…*. A command that asked first in a dialog would be a
 * second place to choose what the halves already choose.
 */
export function compareDocumentsCommand(deps: {
  /** Opens Side by Side on these two documents; `App.tsx`'s one writer of that state. */
  readonly show: (left: DocId, right: DocId) => void;
}): UiCommand {
  return {
    id: 'document.compare',
    icon: 'Columns2',
    title: COMPARE_COMMAND_TITLE,
    ribbonTitle: RIBBON_COMPARE,
    placements: [
      { surface: 'ribbon', section: 'review', group: GROUP_COMPARE, order: 10 },
      // AND HOME › DISPLAY, last, as v5-02 draws *Compare*: two documents side by side is a way of viewing.
      { surface: 'ribbon', section: 'home', group: GROUP_DISPLAY, order: 208 },
    ],
    when: hasDocument,
    run: (context: CommandContext): void => {
      const { docId } = context;
      if (docId === undefined) return;
      const other = context.openDocuments.find((document) => document.docId !== docId);
      deps.show(docId, other?.docId ?? docId);
    },
  };
}
