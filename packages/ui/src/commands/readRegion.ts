import { type AnnotationColour, type DispatchableCommand, MAX_ANNOTATION_TEXT, MAX_TEXT_LAYER_LINES } from '@monstera/contract';
import { type DocId, type DocVersion, viewportPoint } from '@monstera/shared';
import type { z } from 'zod';

import { COMMAND_PROBLEM_DIALOG } from '../dialogs/commandProblem.js';
import { type OverlayPage, draggedRect, unscaledTransform } from '../annotations/annotationSpace.js';
import type { AnnotationStyle } from '../annotations/annotationStyle.js';
import { type ReadLine, addedReadLines, fitSize, isTabular, readingText, rowsOf } from './regionRows.js';
import { REGION_READ_DIALOG_ID, REGION_READ_REPORT, type RegionReadProps, MAX_REGION_TEXT } from '../dialogs/regionRead.js';
import type { DialogReports } from '../registries/dialogs.js';
import { TOAST_REGION_INSERTED } from '../messages/en.js';
import type { ShowToast } from '../toasts.js';
import { confirmCopied, confirmDone } from './confirmWritten.js';
import { type DocumentCommandDeps, applyDocumentCommand } from './documentCommands.js';

/** The `ocrPage` command a box tool sends: a region, so a service reads the box and never the page (ADR-0052). */
export type RegionReadCommand = Extract<DispatchableCommand, { readonly kind: 'ocrPage' }> & {
  readonly region: NonNullable<Extract<DispatchableCommand, { readonly kind: 'ocrPage' }>['region']>;
};

/** Whether a command is a box's read: an `ocrPage` that carries a region. */
export function isRegionRead(command: DispatchableCommand): command is RegionReadCommand {
  return command.kind === 'ocrPage' && command.region !== undefined;
}

/** What the panel and its two actions need beyond the dispatcher's bag. */
export interface ReadRegionDeps extends DocumentCommandDeps {
  readonly toast: ShowToast;
  /** The style a new text box is drawn in — the text box tool's own, so inserted words look like typed ones. */
  readonly style: AnnotationStyle;
  /** Opens a dialog with a report handler (ADR-0094), settling when it closes. */
  readonly ask: (id: string, props: unknown, onUpdate?: DialogReports) => Promise<unknown>;
  /** Starts a command of the registry by id, for the panel's Word and Excel: the page's own exports, asked as they always are. */
  readonly run: (commandId: string) => void;
}

/** The engine the panel names, from the command's own field: a network engine, or this computer's. */
function engineOf(command: RegionReadCommand): RegionReadProps['engine'] {
  return command.engine;
}

/**
 * THE TEXT THE WORDS ARE PUT BACK IN: the ordinary text colour, black — not the annotation colour, which is the style's
 * highlighter yellow and read as small yellow serif text down the left edge of the box (the owner's recording of 2026-10-08).
 * The read words are the page's own, and a person who inserts them wants them to look like the page.
 */
const READ_TEXT_COLOUR: AnnotationColour = [0, 0, 0];

/** How far a line's box is widened where it is put back, in points: a text box's own inset would otherwise clip its edge. */
const INSERT_PAD = 2;

/**
 * Reads a dragged box and SHOWS what was read — Step 7c of the owner's order of 2026-10-08.
 *
 * ## What the person sees
 *
 * The panel opens at once, saying which reader is at work (a service takes seconds); the read then runs through the one
 * dispatcher, and the panel is answered with the words and two actions — *Copy* and *Insert as text on the page* — or with
 * a plain sentence for a box that held nothing, or a read that was refused. Before this the words went into the page
 * unseen, so a read that worked looked like a drag that did nothing.
 *
 * ## It changes what the read DOES in nothing
 *
 * The same `ocrPage` command, through `applyDocumentCommand`, one undo step, the invisible layer exactly as before. The
 * panel is the addition: the words are read back from the page's text layer, before and after, and the difference is shown.
 *
 * ## A refusal is said IN the panel
 *
 * `keep` takes the refusal from the dispatcher's generic dialog, which would replace the panel — a second dialog asked
 * while one is open closes it. If the panel was closed before the answer arrived (or something else, such as the signed
 * document question, replaced it), the answer opens it again, so the result is never lost to a dismissal.
 *
 * @returns whether the read changed the document, for the overlay that holds a committed shape until the page redraws
 */
export async function readRegionInPanel(
  deps: ReadRegionDeps,
  docId: DocId,
  command: RegionReadCommand,
  /** The page as the overlay drew it at the release: what turns a line's display-space box back into the page's own. */
  page: OverlayPage,
): Promise<boolean> {
  const engine = engineOf(command);
  /** How the panel is answered, once it has said it is up; `undefined` before, and after it closed. */
  const panel: { reply?: ((props: RegionReadProps) => void) | undefined; closed: boolean } = { closed: false };
  /** What the panel is showing, for its actions: the words, and the lines each came from. */
  const shown: { text?: string; lines?: readonly ReadLine[] } = {};

  const onReport: DialogReports = (report, reply) => {
    const parsed = REGION_READ_REPORT.safeParse(report);
    if (!parsed.success) return;
    if (parsed.data.kind === 'ready') {
      panel.reply = reply;
      return;
    }
    const text = shown.text;
    const lines = shown.lines;
    if (text === undefined || lines === undefined) return;
    if (parsed.data.kind === 'copy') {
      void deps.client['window.copyText']({ text }).then((copied) => {
        if (copied.ok && copied.value.copied) confirmCopied({ toast: deps.toast });
      });
      return;
    }
    if (parsed.data.kind === 'word' || parsed.data.kind === 'excel') {
      deps.run(parsed.data.kind === 'word' ? 'document.export-word' : 'document.export-excel');
      return;
    }
    void insertLines(deps, docId, command.page, lines, page);
  };

  /** Opens the panel in `props`, remembering that it closed. */
  const open = (props: RegionReadProps): void => {
    panel.closed = false;
    panel.reply = undefined;
    void deps.ask(REGION_READ_DIALOG_ID, props, onReport).then(() => {
      panel.closed = true;
      panel.reply = undefined;
    });
  };
  /** Answers the panel with the outcome: in place if it is still up, else by opening it again. */
  const answer = (props: RegionReadProps): void => {
    if (!panel.closed && panel.reply !== undefined) panel.reply(props);
    else open(props);
  };

  const wholeLines = async (): Promise<readonly ReadLine[] | undefined> => {
    const layer = await deps.client['document.pageTextLayer']({ docId, page: command.page, limit: MAX_TEXT_LAYER_LINES });
    return layer.ok && !layer.value.truncated ? layer.value.lines.map((line) => ({ text: line.text, box: line.box })) : undefined;
  };

  const before = await wholeLines();
  open({ state: 'reading', engine });

  const failure: { problem?: z.infer<typeof COMMAND_PROBLEM_DIALOG.props> } = {};
  const applied = await applyDocumentCommand(deps, docId, command, {
    keep: (error) => {
      // `internal` KEEPS ITS INCIDENT, and a code with a declared detail its detail: `reportProblem`'s own rule, so the
      // panel says what the generic dialog would have.
      // `breaks-signatures` is the signed-document question, which the dispatcher asked itself: it has no sentence here.
      if (error.code !== 'breaks-signatures') failure.problem = 'detail' in error || error.code === 'internal' ? error : { code: error.code };
      return true;
    },
  });
  if (!applied) {
    // NO REFUSAL TO SAY means the read went to a COPY (a signed document's question was answered that way), and the panel
    // was already replaced by that question: there is nothing here to answer.
    if (failure.problem !== undefined) answer({ state: 'failed', engine, problem: failure.problem });
    return false;
  }

  const after = await wholeLines();
  // A PAGE TOO FULL TO READ BACK WHOLE (its text layer was cut at the bound) cannot say what was added, and says so rather
  // than showing a part as the whole: the words are on the page either way.
  const added = before === undefined || after === undefined ? [] : addedReadLines(before, after);
  // IN ROWS, as a person reads a page: the lines at one height are one row and a table's cells a tab apart, never one word to
  // a line.
  const rows = rowsOf(added);
  const text = readingText(rows).slice(0, MAX_REGION_TEXT).trim();
  if (text === '') {
    answer({ state: 'nothing', engine });
    return true;
  }
  shown.text = text;
  shown.lines = rows.flat();
  answer({ state: 'read', engine, text, table: isTabular(rows) });
  return true;
}

/**
 * Puts the read lines back on the page, EACH WHERE IT WAS READ: one typewriter text (no box) per line, in its own box turned
 * back into the page's space, sized to fit it, in the ordinary text colour. The commands are one gesture — each joins the
 * step the one before produced (ADR-0200) — so Undo takes the whole insertion out at once. A refused line stops the rest,
 * which `applyDocumentCommand` has already said.
 */
async function insertLines(
  deps: ReadRegionDeps,
  docId: DocId,
  pageIndex: number,
  lines: readonly ReadLine[],
  page: OverlayPage,
): Promise<void> {
  const step: { version?: DocVersion } = {};
  let added = 0;
  for (const line of lines) {
    const text = line.text.trim();
    if (text === '') continue;
    // THE ENGINE'S DISPLAY SPACE AT SCALE 1, back to the page: `annotationSpace.ts`' second conversion, the one place it is
    // spelled, and then ordered because the page's y runs the other way.
    const a = draggedRect(viewportPoint(line.box.x0, line.box.y0), viewportPoint(line.box.x1, line.box.y1), unscaledTransform(page));
    const rect = {
      x0: Math.min(a.x0, a.x1) - INSERT_PAD,
      y0: Math.min(a.y0, a.y1) - INSERT_PAD,
      x1: Math.max(a.x0, a.x1) + INSERT_PAD,
      y1: Math.max(a.y0, a.y1) + INSERT_PAD,
    };
    const ok = await applyDocumentCommand(
      deps,
      docId,
      {
        kind: 'addAnnotation',
        page: pageIndex,
        annotation: {
          type: 'typewriter',
          rect,
          text: text.slice(0, MAX_ANNOTATION_TEXT),
          colour: READ_TEXT_COLOUR,
          opacity: 1,
          fontSize: fitSize(line.box, text),
          font: 'sans',
          direction: deps.style.direction,
        },
      },
      {
        ...(step.version === undefined ? {} : { joinsStep: step.version }),
        produced: (version) => {
          step.version = version;
        },
      },
    );
    if (!ok) return;
    added += 1;
  }
  if (added > 0) confirmDone(deps, TOAST_REGION_INSERTED);
}
