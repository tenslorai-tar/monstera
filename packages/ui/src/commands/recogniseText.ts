import { MAX_TEXT_LAYER_LINES, type OcrLanguage } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { OCR_DIALOG_ID } from '../dialogs/ocr.js';
import { OCR_OUTCOME_DIALOG_ID } from '../dialogs/ocrOutcome.js';
import { OCR_RESULT } from '../dialogs/ocrResult.js';
import { ENHANCE_OUTCOME_DIALOG_ID } from '../dialogs/enhanceOutcome.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import {
  ENHANCE_COMMAND_TITLE,
  ENHANCE_PROGRESS,
  GROUP_OCR,
  OCR_COMMAND_TITLE,
  OCR_EXPORT_COMMAND_TITLE,
  OCR_PROGRESS,
} from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import type { TrackTask } from '../runningTask.js';
import {
  type DocumentCommandDeps,
  applyDocumentCommand,
  hasDocument,
  reportProblem,
} from './documentCommands.js';

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

      const walked = await recogniseScope(deps, docId, targets, parsed.data.language);

      // REPORTED EVEN WHEN IT DID NOTHING, because *nothing needed recognising* is
      // the one outcome a reader cannot see in their document — and reported after
      // a cancel too, which is this command's own rule rather than the spell
      // check's: the pages already done carry real text.
      void deps.ask(OCR_OUTCOME_DIALOG_ID, walked);
    },
  };
}

/**
 * Levels the scanned pages' own images.
 *
 * ## ONE COMMAND, a page list, and no dialog
 *
 * `deskewPagesCommand`'s shape: the operation has nothing to choose — the levels
 * come from each image's own histogram — so a dialog would be a step that asks
 * nothing. What it does have is a page **list**, because levelling is only
 * meaningful where the page's content is a raster, and `document.pageTextLayer`'s
 * `kind` is what says which pages those are.
 *
 * So the walk here is a READ and the write is ONE command: a reader who levels a
 * ten-page scan expects one undo, and the checkpoint that undo restores is one
 * document image rather than ten.
 *
 * ## IT SAYS WHEN IT DID NOTHING, which is the state this row can produce most
 *
 * A document with no image-only pages has nothing to level, and an image behind a
 * filter this engine cannot round-trip is skipped. Both arrive as a dialog rather
 * than as silence, for the reason the OCR outcome does: what a reader cannot see in
 * their document has to be said.
 */
export function enhanceScansCommand(
  deps: DocumentCommandDeps & { readonly track: TrackTask },
): UiCommand {
  return {
    id: 'document.enhance-scans',
    title: ENHANCE_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 30 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, pageCount } = context;
      if (docId === undefined || pageCount === undefined) return;

      // THE READ IS TRACKED TOO, and it is the only part of this command that takes
      // time per page: the write is one command. A four-hundred-page document is
      // four hundred reads before anything happens, which is what the status bar is
      // for.
      const task = deps.track(ENHANCE_PROGRESS, pageCount);
      const scanned: number[] = [];
      try {
        for (let page = 0; page < pageCount; page += 1) {
          if (task.signal.aborted) return;
          const layer = await deps.client['document.pageTextLayer']({
            docId,
            page,
            limit: MAX_TEXT_LAYER_LINES,
          });
          if (!layer.ok) break;
          if (layer.value.kind === 'image-only') scanned.push(page);
          task.step(page + 1);
        }
      } finally {
        task.end();
      }

      if (scanned.length === 0) {
        void deps.ask(ENHANCE_OUTCOME_DIALOG_ID, { pages: 0 });
        return;
      }
      const applied = await applyDocumentCommand(deps, docId, {
        kind: 'enhancePages',
        pages: scanned,
      });
      if (!applied) return;
      // THE PAGE COUNT AND NOT THE SKIPPED ONE: `document.execute` answers a version
      // and a byte length rather than what the command found, and the dialog's own
      // note records where that count does live.
      void deps.ask(ENHANCE_OUTCOME_DIALOG_ID, { pages: scanned.length });
    },
  };
}

/** What a walk did, and the shape `dialog.ocr-outcome` renders. */
export interface RecognisedWalk {
  readonly recognised: number;
  readonly skipped: number;
  readonly stopped: boolean;
}

/**
 * Recognises the image-only pages of a scope, one command each.
 *
 * **One walk, two commands.** `document.ocr` and
 * `document.export-searchable` both need *recognise the pages that need it, with
 * progress and a cancel*, and two copies of this loop would be two opinions about
 * which pages need it — the second one agreeing with the first for every ordinary
 * document and differing on a blank page (B3a). The export is the caller that
 * made it a function rather than the reason it exists.
 *
 * @param targets the pages to consider, already resolved from the scope.
 */
export async function recogniseScope(
  deps: DocumentCommandDeps & { readonly track: TrackTask },
  docId: DocId,
  targets: readonly number[],
  language: OcrLanguage,
): Promise<RecognisedWalk> {
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
        language,
        // TESSERACT, AND NOT A SETTING. This is the page and document scope, and
        // the handwriting engine is offered on a region only — it reads one text
        // line at seconds per line, so a page of thirty would take minutes
        // (ADR-0052 §4). A choice here would be a control whose honest behaviour
        // nobody would pick.
        engine: 'tesseract',
        // CARRIED AND UNUSED on this path, as `language` is on the other one.
        // `small` rather than the setting because nothing reads it here, and
        // reaching for the setting would imply it changes what this does.
        trocrSize: 'small',
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
  return { recognised, skipped, stopped: aborted() };
}

/**
 * Recognises every scanned page and writes a copy of the document.
 *
 * ## IT IS A REGISTRATION OVER TWO THINGS THAT ALREADY EXIST
 *
 * D6 row 5 asks for *export searchable PDF*, and once rows 2 and 3 landed there was
 * nothing left to build but the sequence: recognise the pages that need it, then
 * `document.saveCopy` — the same channel `saveCopyCommand` uses, which puts the
 * picker in main where every other write's picker is.
 *
 * **It does not go through `TessPDFRenderer`**, which is the alternative the core
 * makes available and which would rebuild the document from rasters. That loses
 * every page that already carries real text — replacing typed words with a
 * recognition of a picture of them — and it loses annotations, form fields and the
 * outline with them. A text layer written into the page keeps all of it, which is
 * row 3's shape and is why both rows use it.
 *
 * ## WHAT IT DOES TO THE OPEN DOCUMENT, said rather than hidden
 *
 * The recognition is applied to the document, so an export **also leaves the text
 * in the open document**, undoable page by page. The alternative — write the layer
 * into the copy's bytes only — needs a write path that does not reach the session,
 * which is the *which bytes win* question `savePipeline.ts` already carries as an
 * open B4. Doing it quietly here would be answering that question underneath a
 * feature, which is the failure this project exists to prevent.
 *
 * So the outcome dialog reports both halves, and a reader who wanted only the copy
 * has undo.
 */
export function exportSearchableCommand(
  deps: DocumentCommandDeps & { readonly track: TrackTask },
): UiCommand {
  return {
    id: 'document.export-searchable',
    title: OCR_EXPORT_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 20 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, page, pageCount } = context;
      if (docId === undefined || page === undefined || pageCount === undefined) return;

      const models = await deps.client['app.ocrLanguages']({});
      if (!models.ok) return;

      // THE SAME DIALOG, and the scope it answers is ignored deliberately: an
      // export is the whole document by definition, and a second dialog differing
      // only in the absence of two buttons would be a second place the language
      // list is rendered. The answer's `language` is what this command needs.
      const answered = await deps.ask(OCR_DIALOG_ID, {
        page,
        languages: models.value.languages,
      });
      const parsed = OCR_RESULT.safeParse(answered);
      if (!parsed.success) return;

      const walked = await recogniseScope(
        deps,
        docId,
        Array.from({ length: pageCount }, (_unused, index) => index),
        parsed.data.language,
      );
      // A CANCELLED WALK WRITES NO COPY. Half a document's pages recognised and a
      // file on disk called *searchable* is the pair this build must not produce —
      // and the pages already done are still in the open document, which the
      // outcome says.
      if (walked.stopped) {
        void deps.ask(OCR_OUTCOME_DIALOG_ID, walked);
        return;
      }

      const copied = await deps.client['document.saveCopy']({ docId });
      if (!copied.ok) {
        reportProblem(deps, copied.error);
        return;
      }
      if (copied.value.kind === 'copied' || copied.value.kind === 'cancelled') {
        // `saveCopyCommand`'s rule: the file is where the user put it, or they are
        // the one who cancelled. What is NOT silent is what happened to the open
        // document, which is why the outcome is still reported.
        void deps.ask(OCR_OUTCOME_DIALOG_ID, walked);
        return;
      }
      void deps.ask(SAVE_PROBLEM_DIALOG_ID, {
        outcome: copied.value.kind === 'write-failed' ? 'write-failed' : 'contested',
      });
    },
  };
}
