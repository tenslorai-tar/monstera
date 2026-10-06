import type { DocId } from '@monstera/shared';

import { GROUP_PROOFING, SPELL_CHECK_COMMAND_TITLE } from '../messages/en.js';
import { type CommandContext, type UiCommand, VISIBLE } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Spell check: opens the context panel on its Spelling tab and starts a review of the document in front of the reader
 * (ADR-0156 Decision 1). It opens no dialog. The review — a walk of the pages and, as the options say, the comments
 * and fields, then one word at a time beside the page — is `spelling/reviewRun.ts`'s, and the panel is
 * `SpellingPanel`; this command is the ribbon's way in, and `start` is App's, which holds the panel and the document
 * stores.
 *
 * ## The walk is per page, and it reuses the text layer's channel
 *
 * `document.pageTextLayer` already carries one page's lines, bounded by the caller — it is what the transparent
 * selection layer is built from, and what the page highlight is drawn over, so an occurrence's line and offset are the
 * highlight's own. Extracted text is 3.59× a document's bytes and is never held
 * ([ADR-0035](../../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)); the review keeps only
 * its misspelt words and the line each sits in.
 */
export function checkSpellingCommand(deps: {
  /** Opens the Spelling tab and starts a review of `docId`'s `pageCount` pages. */
  readonly start: (docId: DocId, pageCount: number) => void;
}): UiCommand {
  return {
    id: 'document.spell-check',
    feedback: VISIBLE,
    icon: 'SpellCheck',
    title: SPELL_CHECK_COMMAND_TITLE,
    // EDIT › PROOFING, beside word count. Both read the whole document's text
    // and both are things a person does to prose, which is what a group is.
    // AND REVIEW › PROOFING: BUILD-PROMPT lists the pass under D4's editing
    // tools and again under D8's review tools. One command placed twice is the
    // registry saying so; a second command would be a second opinion about what
    // a spell check pass does.
    placements: [
      // 210 ON EDIT: after Text (from 10) and Find (110), the owner's order for the section.
      { surface: 'ribbon', section: 'edit', group: GROUP_PROOFING, order: 210 },
      { surface: 'ribbon', section: 'review', group: GROUP_PROOFING, order: 10 },
    ],
    when: hasDocument,
    run: (context: CommandContext): void => {
      const { docId, pageCount } = context;
      if (docId === undefined || pageCount === undefined || pageCount <= 0) return;
      deps.start(docId, pageCount);
    },
  };
}
