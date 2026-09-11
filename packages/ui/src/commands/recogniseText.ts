import { MAX_TEXT_LAYER_LINES } from '@monstera/contract';

import { OCR_DIALOG_ID } from '../dialogs/ocr.js';
import { OCR_OUTCOME_DIALOG_ID } from '../dialogs/ocrOutcome.js';
import { OCR_RESULT } from '../dialogs/ocrResult.js';
import { GROUP_OCR, OCR_COMMAND_TITLE, OCR_PROGRESS } from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import type { TrackTask } from '../runningTask.js';
import { type DocumentCommandDeps, applyDocumentCommand, hasDocument } from './documentCommands.js';

/**
 * Recognises the text on a document's scanned pages and writes it into them.
 *
 * ## ONE COMMAND PER PAGE, and that is the law rather than a convenience
 *
 * `ocrPage` names a single page because
 * [ADR-0035](../../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)
 * forbids a document's extracted text being resident in `main` — a scoped command
 * would hold every named page's recognition at once. So the scope the dialog
 * answers is walked **here**, one dispatch per page, which is the shape
 * `showWordCount` and `checkSpelling` already walk for the same ADR's reason.
 *
 * Three things fall out of that rather than being designed:
 *
 * - **Progress with real numbers**, which `BUILD-PROMPT.md` M5 requires for OCR by
 *   name. Recognition is 3.8–4.4 s per page, so a four-hundred-page scan is half
 *   an hour and a dialog that has not opened yet is not feedback.
 * - **A cancel that leaves correct work behind.** A recognised page carries real
 *   text; stopping after three of ten is three pages done, not a partial answer.
 *   That is the opposite of `checkSpelling`'s *a cancelled walk publishes nothing*,
 *   and the asymmetry is the noun: a list of misspellings from some of the pages
 *   reads as the document's whole answer, where a page's text layer is about that
 *   page and nothing else.
 * - **Undo per page.** Ten pages is ten entries, which is what *each page is
 *   independently reversible* means once a cancel can leave half of them done.
 *
 * ## IT ASKS WHAT EACH PAGE IS, and skips the ones that already have text
 *
 * The detector landed as row 1 and `document.pageTextLayer` carries its answer —
 * `kind: 'image-only'` is *a raster and no text*. A page that already carries text
 * is left alone, and that is not tidiness: recognising it would draw a second,
 * worse copy of its words underneath the real ones, and search would then find
 * both. The kernel's apply deliberately does **not** make that check, because *what
 * is this page made of* is the detector's question and the region row will want to
 * recognise a rectangle on a page full of text.
 *
 * The read is one channel call per page in scope, which is the cost of asking
 * honestly rather than guessing: the alternative is recognising every page and
 * paying four seconds each to find out.
 *
 * ## The language list is the MACHINE's
 *
 * `app.ocrLanguages` answers which models are provisioned, and an empty answer is
 * the state §10.5 requires to be designed — the dialog says what is missing and
 * offers no control to start. The list is asked **at run time** rather than when
 * the registry was built: a model provisioned while the application is open must
 * appear on the next run without a restart.
 */
export function recogniseTextCommand(
  deps: DocumentCommandDeps & {
    /** Reports progress and carries the cancel. `UNTRACKED` where nothing renders one. */
    readonly track: TrackTask;
  },
): UiCommand {
  return {
    id: 'document.ocr',
    title: OCR_COMMAND_TITLE,
    // TOOLS › OCR, which `BUILD-PROMPT.md`:472 names for D6.
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 10 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, page, pageCount } = context;
      if (docId === undefined || page === undefined || pageCount === undefined) return;

      const models = await deps.client['app.ocrLanguages']({});
      // A CHANNEL REFUSAL IS NOT AN EMPTY LIST. This channel declares no failure
      // code, so `ok === false` here is an internal one — and opening the dialog
      // with no languages would tell a reader their models are missing when what
      // actually happened is that nothing answered.
      if (!models.ok) return;

      const answered = await deps.ask(OCR_DIALOG_ID, {
        page,
        languages: models.value.languages,
      });
      // A DISMISSAL ANSWERS NOTHING, which is the mutation-dialog gate (ADR-0038):
      // nothing was dispatched, so there is nothing to undo.
      const parsed = OCR_RESULT.safeParse(answered);
      if (!parsed.success) return;

      const targets =
        parsed.data.pages === 'all'
          ? Array.from({ length: pageCount }, (_unused, index) => index)
          : parsed.data.pages;

      const task = deps.track(OCR_PROGRESS, targets.length);
      // A FUNCTION rather than a read of `signal.aborted` at each site, which is
      // `showWordCount`'s shape: the two checks in the loop must ask the same
      // question, and a second spelling of it is where they stop doing so.
      const aborted = (): boolean => task.signal.aborted;
      let recognised = 0;
      let skipped = 0;
      let done = 0;
      try {
        for (const target of targets) {
          if (aborted()) break;
          const layer = await deps.client['document.pageTextLayer']({
            docId,
            page: target,
            limit: MAX_TEXT_LAYER_LINES,
          });
          if (aborted()) break;
          if (!layer.ok) break;
          if (layer.value.kind !== 'image-only') {
            // A BLANK PAGE IS SKIPPED TOO, and it is not counted as one that
            // already had text: `'empty'` is *no raster and no text*, so there is
            // nothing on it to read. Counting it with the skipped pages would tell
            // a reader a blank sheet already carried words.
            if (layer.value.kind === 'text') skipped += 1;
            done += 1;
            task.step(done);
            continue;
          }

          const applied = await applyDocumentCommand(deps, docId, {
            kind: 'ocrPage',
            page: target,
            language: parsed.data.language,
          });
          // A REFUSED PAGE STOPS THE WALK. `applyDocumentCommand` has already
          // reported it, and carrying on would stack one dialog per page behind a
          // condition — a closed document, a poisoned one — that is not going to
          // clear itself.
          if (!applied) break;
          recognised += 1;
          done += 1;
          task.step(done);
        }
      } finally {
        task.end();
      }

      // REPORTED EVEN WHEN IT DID NOTHING, because *nothing needed recognising* is
      // the one outcome a reader cannot see in their document — and reported after
      // a cancel too, which is this command's own rule rather than the spell
      // check's: the pages already done carry real text.
      void deps.ask(OCR_OUTCOME_DIALOG_ID, { recognised, skipped, stopped: aborted() });
    },
  };
}
