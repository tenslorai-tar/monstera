import type { DocId } from '@monstera/shared';

import { GROUP_ACCESSIBILITY, PAGE_STRUCTURE_COMMAND_TITLE } from '../messages/en.js';
import { type CommandContext, type UiCommand, VISIBLE } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Review › Accessibility › *Reading order* — D8's tagged-PDF inspection of the page a person is looking at.
 *
 * ## ONE PAGE, the one on screen
 *
 * `document.pageStructure` answers one page, for ADR-0035's reason, and a page's tagging is read against the page
 * beside it. The panel reads it again as the person turns pages.
 *
 * It opens no dialog (ADR-0183): the Accessibility tab lists the page's items beside it and marks the one chosen. `show`
 * is App's; it opens the tab at the reading-order section, which reads the page.
 */
export function inspectPageStructureCommand(deps: {
  /** Opens the Accessibility tab on the reading order of `docId`'s current page. */
  readonly show: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.inspect-page-structure',
    feedback: VISIBLE,
    icon: 'ListTree',
    title: PAGE_STRUCTURE_COMMAND_TITLE,
    // REVIEW, which is where `BUILD-PROMPT.md`:491 lists it, in a group of its own beside the check.
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_ACCESSIBILITY, order: 10 }],
    when: hasDocument,
    run: (context: CommandContext): void => {
      const { docId, page } = context;
      // BOTH, for `showWordCount`'s reason: `when` decides what is shown, not what a palette can dispatch.
      if (docId === undefined || page === undefined) return;
      deps.show(docId);
    },
  };
}
