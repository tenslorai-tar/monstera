import type { ContractClient } from '@monstera/contract';

import { PAGE_STRUCTURE_DIALOG_ID } from '../dialogs/pageStructure.js';
import { GROUP_ACCESSIBILITY, PAGE_STRUCTURE_COMMAND_TITLE } from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Shows the tagged structure of the page on screen — D8's reading-order /
 * tagged-PDF inspection.
 *
 * ## ONE PAGE, the one a person is looking at
 *
 * `document.pageStructure` answers one page, for ADR-0035's reason, and a page's
 * tagging is read against the page beside it on screen. A document-wide walk would
 * be a report; this is an inspection, and moving to the next page and asking again
 * is how a person reads a structure tree a page at a time.
 *
 * ## TWO PAGE NUMBERS, and each is taken from where it is defined
 *
 * The request carries the context's zero-based index, which is what every page
 * index crossing the contract is. The dialog carries the number a person reads,
 * from `pdfjsPageOf` — `pageNumbering.ts` is the one place the two meet, and a
 * `+ 1` here would be a second.
 *
 * ## A refusal opens the dialog too
 *
 * A control that did nothing when the lane refused would be the display-only
 * defect, so the dialog says the page could not be read.
 */
export function inspectPageStructureCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'document.inspect-page-structure',
    title: PAGE_STRUCTURE_COMMAND_TITLE,
    // REVIEW, which is where `BUILD-PROMPT.md`:491 lists it, in a group of its own:
    // the accessibility check will sit beside it and reads the same structure.
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_ACCESSIBILITY, order: 10 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, page } = context;
      // BOTH, for `showWordCount`'s reason: `when` decides what is shown, not what
      // a palette can dispatch.
      if (docId === undefined || page === undefined) return;

      const shown = pdfjsPageOf(page);
      const answer = await deps.client['document.pageStructure']({ docId, page });

      // Voided for `showWordCount`'s reason: the dialog declares no result.
      void deps.ask(
        PAGE_STRUCTURE_DIALOG_ID,
        answer.ok
          ? {
              kind: 'read',
              page: shown,
              nodes: answer.value.nodes,
              truncated: answer.value.truncated,
              untaggedLines: answer.value.untaggedLines,
              images: answer.value.images,
            }
          : { kind: 'refused', page: shown },
      );
    },
  };
}
