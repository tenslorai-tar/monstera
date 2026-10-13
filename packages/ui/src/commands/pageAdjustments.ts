import type { PageAdjustment, PageAdjustmentOutcome } from '@monstera/contract';
import type { DocId, MessageKey } from '@monstera/shared';

import { STRAIGHTEN_OUTCOME_DIALOG_ID } from '../dialogs/straightenOutcome.js';
import { DESKEW_PAGES_COMMAND_TITLE, GROUP_ADJUST, RIBBON_DESKEW, STRAIGHTEN_PROGRESS } from '../messages/en.js';
import { type CommandContext, type UiCommand, VISIBLE } from '../registries/commands.js';
import type { TrackTask } from '../runningTask.js';
import { type DocumentCommandDeps, applyDocumentCommand, hasDocument, reportProblem } from './documentCommands.js';

/**
 * What a page tool would do to each of `pages`, read one page at a time with progress and a cancel — the one walk both
 * page tools take before they write (the owner's N3), so what a person is told about each page is the engine's own
 * decision (`readPageAdjustment`) and never a guess from here.
 *
 * TRACKED, because the read is where the time goes: Straighten rasterises each page to measure its tilt, and Crop to
 * paper decodes each picture to find the sheet. The write afterwards is one command.
 *
 * @returns each page's outcome, or `null` when the person cancelled or a read was refused — the refusal reported here,
 *   so a caller given `null` says nothing more.
 */
export async function readAdjustments(
  deps: Pick<DocumentCommandDeps, 'client' | 'ask'> & { readonly track: TrackTask },
  docId: DocId,
  pages: readonly number[],
  adjustment: PageAdjustment,
  label: MessageKey,
): Promise<ReadonlyMap<number, PageAdjustmentOutcome> | null> {
  const task = deps.track(label, pages.length);
  const outcomes = new Map<number, PageAdjustmentOutcome>();
  try {
    for (const [index, page] of pages.entries()) {
      if (task.signal.aborted) return null;
      const read = await deps.client['document.pageAdjustment']({ docId, page, adjustment });
      if (!read.ok) {
        // A PAGE PAST THE END means the document lost pages while the walk ran; it is not a problem a person can act
        // on, so the walk stops and nothing is written, where a document refusal is said as itself.
        const { error } = read;
        if (error.code === 'page-out-of-range') return null;
        reportProblem(deps, error.code === 'internal' ? error : { code: error.code });
        return null;
      }
      outcomes.set(page, read.value.outcome);
      task.step(index + 1);
    }
  } finally {
    task.end();
  }
  return outcomes;
}

/** The pages a walk read as `changes`, in the order they were read. */
export function pagesThatChange(outcomes: ReadonlyMap<number, PageAdjustmentOutcome>): number[] {
  return [...outcomes].filter(([, outcome]) => outcome === 'changes').map(([page]) => page);
}

/**
 * Straightens crooked pages: turns a page whose lines of text or ruling are tilted until they are level.
 *
 * ## IT ASKS NOTHING AND SENDS NO ANGLE
 *
 * The kernel measures each page's own tilt from its ink and turns it back; the renderer's whole part is *which
 * document*. An angle is not something anybody reads off a screen in tenths of a degree, and the conversion between the
 * raster the measurement is taken in and the content stream it is written to must not cross a boundary (`pageSkew.ts`).
 *
 * ## READ FIRST, so the person is told what happened (the owner's N3)
 *
 * Each page is read through the apply's own decision (`levellingTurn`, via `document.pageAdjustment`) before anything
 * is written, so the outcome says how many pages are now straight and a document that was level already says so
 * rather than closing silently, which read as a tool that did nothing. A document with nothing to change sends nothing,
 * so no empty undo step is left behind.
 *
 * ## `'all'` on the wire, and the no-op is what makes that safe
 *
 * The apply skips a page that reads level by the same decision the read took, so `'all'` changes exactly the pages
 * the read counted, and stays one entry whatever the document's length (invariant L11) where a list of the pages that
 * change would not.
 */
export function deskewPagesCommand(deps: DocumentCommandDeps & { readonly track: TrackTask }): UiCommand {
  return {
    id: 'document.deskew-pages',
    feedback: VISIBLE,
    icon: 'RotateCwSquare',
    title: DESKEW_PAGES_COMMAND_TITLE,
    ribbonTitle: RIBBON_DESKEW,
    placements: [{ surface: 'ribbon', section: 'organize', group: GROUP_ADJUST, order: 44, size: 'small' }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, pageCount } = context;
      if (docId === undefined || pageCount === undefined || pageCount === 0) return;

      const every = Array.from({ length: pageCount }, (_, page) => page);
      const outcomes = await readAdjustments(deps, docId, every, 'level', STRAIGHTEN_PROGRESS);
      if (outcomes === null) return;
      const straightened = pagesThatChange(outcomes).length;
      if (straightened > 0) {
        const applied = await applyDocumentCommand(deps, docId, { kind: 'deskewPages', pages: 'all' });
        if (!applied) return;
      }
      void deps.ask(STRAIGHTEN_OUTCOME_DIALOG_ID, { pages: pageCount, straightened });
    },
  };
}
