import { type DispatchableCommand, MAX_TEXT_LAYER_LINES } from '@monstera/contract';
import type { DocId } from '@monstera/shared';
import type { z } from 'zod';

import { COMMAND_PROBLEM_DIALOG } from '../dialogs/commandProblem.js';
import { TEXT_COLOUR } from '../annotations/textTools.js';
import type { AnnotationStyle } from '../annotations/annotationStyle.js';
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
}

/** The engine the panel names, from the command's own field: a network engine, or this computer's. */
function engineOf(command: RegionReadCommand): RegionReadProps['engine'] {
  return command.engine;
}

/**
 * The words the read ADDED to a page: its lines after, less the lines that were already there.
 *
 * The recognised words are written into the page as an invisible layer, and the page's text layer is the one answer to
 * *what does this page say* (ADR-0035 and the reader row 3 exists to keep single), so the read is shown by asking it
 * again rather than by a second route that would carry the words out of the writer. A line that was on the page before is
 * taken out ONCE per occurrence, so a box over words the page already had still shows what was added.
 */
export function addedLines(before: readonly string[], after: readonly string[]): readonly string[] {
  const remaining = new Map<string, number>();
  for (const line of before) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  return after.filter((line) => {
    const left = remaining.get(line) ?? 0;
    if (left === 0) return true;
    remaining.set(line, left - 1);
    return false;
  });
}

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
export async function readRegionInPanel(deps: ReadRegionDeps, docId: DocId, command: RegionReadCommand): Promise<boolean> {
  const engine = engineOf(command);
  /** How the panel is answered, once it has said it is up; `undefined` before, and after it closed. */
  const panel: { reply?: ((props: RegionReadProps) => void) | undefined; closed: boolean } = { closed: false };
  /** The words the panel is showing, for its two actions. */
  const shown: { text?: string } = {};

  const onReport: DialogReports = (report, reply) => {
    const parsed = REGION_READ_REPORT.safeParse(report);
    if (!parsed.success) return;
    if (parsed.data.kind === 'ready') {
      panel.reply = reply;
      return;
    }
    const text = shown.text;
    if (text === undefined) return;
    if (parsed.data.kind === 'copy') {
      void deps.client['window.copyText']({ text }).then((copied) => {
        if (copied.ok && copied.value.copied) confirmCopied({ toast: deps.toast });
      });
      return;
    }
    // THE WORDS AS A TEXT BOX where the box was, in the text box tool's own style: an ordinary mark, one undo step.
    void applyDocumentCommand(deps, docId, {
      kind: 'addAnnotation',
      page: command.page,
      annotation: {
        type: 'text-box',
        rect: command.region,
        text,
        colour: deps.style.colour(TEXT_COLOUR),
        opacity: deps.style.opacity,
        fontSize: deps.style.fontSize,
        font: deps.style.font,
        direction: deps.style.direction,
      },
    }).then((added) => {
      if (added) confirmDone(deps, TOAST_REGION_INSERTED);
    });
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

  const wholeLines = async (): Promise<readonly string[] | undefined> => {
    const layer = await deps.client['document.pageTextLayer']({ docId, page: command.page, limit: MAX_TEXT_LAYER_LINES });
    return layer.ok && !layer.value.truncated ? layer.value.lines.map((line) => line.text) : undefined;
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
  const added = before === undefined || after === undefined ? [] : addedLines(before, after);
  const text = added.join('\n').slice(0, MAX_REGION_TEXT).trim();
  if (text === '') {
    answer({ state: 'nothing', engine });
    return true;
  }
  shown.text = text;
  answer({ state: 'read', engine, text });
  return true;
}
