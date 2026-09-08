import type { ContractClient } from '@monstera/contract';

import { WORD_COUNT_DIALOG_ID } from '../dialogs/wordCount.js';
import { WORD_COUNT_COMMAND_TITLE } from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Counts the document's words and shows the totals.
 *
 * ## THE WALK IS PER PAGE, and that is invariant 11 rather than a style
 *
 * A whole-document count is three small numbers, and getting them means reading
 * every page's text. `document.pageWordCount` reads one page inside the
 * document's lane, counts it, and drops the text — so three integers cross and
 * the text never does.
 *
 * The alternative is a channel that counts the document, and it would have to
 * hold every page's text somewhere while it worked.
 * [ADR-0035](../../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)
 * measured extracted text at **3.59× a document's bytes**, which is why it is
 * never resident in main. Walking here keeps that property and costs a round
 * trip per page.
 *
 * ## A page that refuses does not abandon the count
 *
 * It stops it. The pages walked so far are reported with `pagesCounted`, and the
 * dialog says the totals are incomplete — because a total that is short and
 * silent is indistinguishable from a correct total for a shorter document, and
 * it is the figure somebody would quote.
 *
 * **Stopping rather than skipping** is the choice, and the reason is that the
 * refusals available here are all about the document rather than about a page:
 * `document-not-open`, `document-busy`, `document-poisoned`. A skip would ask
 * every remaining page the question that has just been answered.
 *
 * ## The version is checked on every page
 *
 * A command applied while this walks moves the version, and pages counted either
 * side of it describe two documents. The first answer's version is the one this
 * count is about; a later page answering at a different one stops the walk the
 * same way a refusal does.
 *
 * ## What this does NOT have, stated rather than left to be discovered
 *
 * No progress and no cancellation. A four-hundred-page document is four hundred
 * round trips before anything appears, and the only feedback is that the dialog
 * has not opened yet. `runDocumentSearch` has both, and the surface that gives
 * it them is the find bar rather than a dialog — so adding them here is a
 * surface question rather than a missing `await`, and it is recorded on the
 * FEATURES row instead of being half-built.
 */
export function showWordCountCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'document.word-count',
    title: WORD_COUNT_COMMAND_TITLE,
    // EMPTY, AND THE PALETTE STILL REACHES IT. `paletteModel` reads no
    // placements — *"a command absent from the registry is absent here for
    // free"* — so a registered command is dispatchable whether or not any
    // surface shows a button for it.
    //
    // `docs/FEATURES.md` puts D4 on the ribbon's **Edit** section, and no
    // command in this build carries a `ribbon` placement yet because no ribbon
    // projection renders one. Naming a section here would put this command on a
    // surface that does not exist, which reads in the registry as a control
    // somebody can find. When the ribbon lands, this is one line.
    placements: [],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, pageCount } = context;
      // BOTH, and not just `docId`. `when` keeps this off surfaces with no
      // document, and a `when` is a predicate about what to SHOW rather than a
      // guarantee about what a palette can dispatch — every command here that
      // reads the context checks it again.
      if (docId === undefined || pageCount === undefined || pageCount <= 0) return;

      let words = 0;
      let characters = 0;
      let charactersNoSpaces = 0;
      let pagesCounted = 0;
      let expected: unknown;

      for (let page = 0; page < pageCount; page += 1) {
        const answer = await deps.client['document.pageWordCount']({ docId, page });
        if (!answer.ok) break;
        // THE FIRST PAGE FIXES THE VERSION this count is about, and every later
        // page must agree. Comparing against the context's version instead would
        // compare with what was true when the palette was opened.
        expected ??= answer.value.version;
        if (answer.value.version !== expected) break;

        words += answer.value.words;
        characters += answer.value.characters;
        charactersNoSpaces += answer.value.charactersNoSpaces;
        pagesCounted += 1;
      }

      // Voided: this dialog declares no result and settles only on dismissal,
      // so awaiting it would keep the command running until the reader closed a
      // box of numbers. `showAbout` says the same.
      void deps.ask(WORD_COUNT_DIALOG_ID, {
        words,
        characters,
        charactersNoSpaces,
        pagesCounted,
        pageCount,
      });
    },
  };
}
