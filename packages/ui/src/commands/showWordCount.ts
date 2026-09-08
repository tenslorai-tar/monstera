import type { ContractClient } from '@monstera/contract';

import { WORD_COUNT_DIALOG_ID } from '../dialogs/wordCount.js';
import { GROUP_PROOFING, WORD_COUNT_COMMAND_TITLE, WORD_COUNT_PROGRESS } from '../messages/en.js';
import type { TrackTask } from '../runningTask.js';
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
 * ## PROGRESS AND CANCELLATION, and where the surface for them came from
 *
 * This section said there were none, and was right about why: *"a surface
 * question rather than a missing `await`"*. A four-hundred-page document is
 * four hundred round trips, and a dialog cannot report them — its props are
 * validated at the `ask` call, so a dialog is where a walk ENDS.
 *
 * The surface is the **status bar**, which is present for the whole of a
 * document's life, and `runningTask.ts` is the seam. `track` is a command
 * dependency like `ask` and `onApplied` rather than a new registry.
 *
 * **A cancelled walk publishes nothing** — `documentSearch.ts`'s rule, for its
 * reason: *your document has 4,000 words* about a document with 40,000 is
 * indistinguishable from a complete answer once it is on screen, and a reader
 * who cancelled has no way to tell. So a cancel opens no dialog at all.
 */
export function showWordCountCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** Reports progress and carries the cancel. `UNTRACKED` where nothing renders one. */
  readonly track: TrackTask;
}): UiCommand {
  return {
    id: 'document.word-count',
    title: WORD_COUNT_COMMAND_TITLE,
    // THE RIBBON LANDED 2026-09-08 AND THIS IS THE ONE LINE IT PREDICTED. The
    // note here said a section could not be named because no projection
    // rendered one, and that a placement would read in the registry as a
    // control nobody can find. `docs/FEATURES.md` puts D4 on **Edit**; the
    // group is Proofing, which this shares with spell check.
    placements: [{ surface: 'ribbon', section: 'edit', group: GROUP_PROOFING, order: 20 }],
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

      const task = deps.track(WORD_COUNT_PROGRESS, pageCount);
      // A FUNCTION, not a read of `signal.aborted` at each site —
      // `documentSearch.ts`'s note: the flag is flipped from outside between
      // the two checks, which is what the compiler's narrowing assumes cannot
      // happen, and reading it inline makes the second check "unintentional".
      const aborted = (): boolean => task.signal.aborted;
      try {
        for (let page = 0; page < pageCount; page += 1) {
          // CHECKED BEFORE THE CALL, so a cancel between pages costs no round
          // trip, and again after it, because the answer to the page in flight
          // arrives after the reader pressed cancel.
          if (aborted()) return;

          const answer = await deps.client['document.pageWordCount']({ docId, page });
          // AND AGAIN AFTER IT. The next iteration's check would stop the walk
          // anyway, so what this buys is one thing and it is visible: without
          // it the page in flight when the reader pressed cancel is counted and
          // `step` reports it, so the bar ticks once MORE after the button was
          // pressed. Asserted on the reports rather than on the dialog, which
          // is absent either way.
          if (aborted()) return;
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
          task.step(pagesCounted);
        }
      } finally {
        // IN A `finally`, so the indicator goes whichever way this leaves — a
        // cancel, a refusal, a version that moved, or the end. A status bar
        // still counting after a walk stopped is worse than none: it is the one
        // piece of chrome a reader trusts to be current.
        task.end();
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
