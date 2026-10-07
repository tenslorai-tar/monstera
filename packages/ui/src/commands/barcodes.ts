import { type AnnotationRect, type ContractClient, MAX_CHAT_TEXT } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { textToCopy } from '../dialogs/barcodeContent.js';
import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { MAX_LISTED_BARCODES, PAGE_BARCODES_DIALOG_ID, PAGE_BARCODES_REPORT } from '../dialogs/pageBarcodes.js';
import { PLACE_BARCODE_DIALOG_ID, type PlaceBarcodeAnswer } from '../dialogs/placeBarcode.js';
import {
  GROUP_OCR,
  READ_BARCODES_COMMAND_TITLE,
  TOAST_BARCODES_READING,
  TOAST_BARCODE_LINK_NOT_OPENED,
  TOAST_BARCODE_LINK_STALE,
} from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import { type CommandContext, RESULT_DIALOG, type UiCommand } from '../registries/commands.js';
import type { DialogReports } from '../registries/dialogs.js';
import type { TrackTask } from '../runningTask.js';
import type { ShowToast } from '../toasts.js';
import { confirmCopied } from './confirmWritten.js';
import { type DocumentCommandDeps, hasDocument, reportProblem } from './documentCommands.js';

/** What the barcode read needs: the client, the dialog, a toast and a task for the all-pages run. */
export interface ReadBarcodesDeps {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown, onUpdate?: DialogReports) => Promise<unknown>;
  readonly toast: ShowToast;
  readonly track: TrackTask;
}

/** One barcode as the dialog lists it: where it was read, by the page a person reads and its place on that page. */
interface ListedBarcode {
  readonly format: string;
  readonly text: string;
  readonly page: number;
  readonly index: number;
}

/**
 * Tools › OCR › Read barcodes — read the barcodes on the page on screen, or on every page (ADR-0076).
 *
 * `inspectPageStructureCommand`'s shape and its reasons: the request carries the zero-based index and the dialog the number
 * a person reads, each from `pageNumbering.ts`; and a refusal opens the dialog too.
 *
 * ## The dialog REPORTS, and this acts
 *
 * *Copy* and *Copy all* go through `main` (the renderer holds no clipboard). *Open link* names the barcode by its page and
 * place at the version it was read at, never by its text: `main` reads the address from the document and opens it only for a
 * scheme that is followed, so reading a barcode never opens anything and a press is the whole of the permission.
 * *Read barcodes on all pages* reads each page in turn with progress and Cancel, then answers the dialog with the new list.
 */
export function readBarcodesCommand(deps: ReadBarcodesDeps): UiCommand {
  return {
    id: 'document.read-barcodes',
    feedback: RESULT_DIALOG,
    icon: 'ScanBarcode',
    title: READ_BARCODES_COMMAND_TITLE,
    // TOOLS › OCR (the owner's order of 2026-10-07): reading a symbol is recognition, beside the other recognisers, and
    // *Add a barcode* is Edit's (see `placeBarcodeToolCommand`).
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 50, size: 'small' }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, page } = context;
      if (docId === undefined || page === undefined) return;
      const pageCount = context.pageCount ?? 1;

      const shown = pdfjsPageOf(page);
      const answer = await deps.client['document.pageBarcodes']({ docId, page });
      if (!answer.ok) {
        void deps.ask(PAGE_BARCODES_DIALOG_ID, { kind: 'refused', page: shown });
        return;
      }
      // WHAT IS LISTED NOW, and the version each page was read at: a press on a row is answered from these.
      let listed: readonly ListedBarcode[] = answer.value.barcodes.map((barcode, index) => ({ ...barcode, page: shown, index }));
      const versions = new Map<number, DocVersion>([[shown, answer.value.version]]);

      const copy = async (text: string): Promise<void> => {
        const copied = await deps.client['window.copyText']({ text: text.slice(0, MAX_CHAT_TEXT) });
        if (copied.ok && copied.value.copied) confirmCopied({ toast: deps.toast });
      };

      // Voided for `showWordCount`'s reason: the dialog's answers are reports, never a result this waits for.
      void deps.ask(
        PAGE_BARCODES_DIALOG_ID,
        { kind: 'read', page: shown, all: false, pageCount, barcodes: listed, truncated: answer.value.truncated },
        (report, reply) => {
          const parsed = PAGE_BARCODES_REPORT.safeParse(report);
          if (!parsed.success) return;
          const what = parsed.data;
          if (what.kind === 'copy') {
            void copy(what.text);
          } else if (what.kind === 'copy-all') {
            void copy(listed.map((barcode) => textToCopy(barcode.text)).join('\n\n'));
          } else if (what.kind === 'open') {
            const version = versions.get(what.page);
            if (version === undefined) return;
            void deps.client['document.openBarcodeLink']({ docId, version, page: what.page - 1, index: what.index }).then((opened) => {
              if (!opened.ok) {
                reportProblem(deps, opened.error);
                return;
              }
              if (opened.value.kind === 'stale') deps.toast('problem', TOAST_BARCODE_LINK_STALE);
              else if (opened.value.kind !== 'opened') deps.toast('problem', TOAST_BARCODE_LINK_NOT_OPENED);
            });
          } else {
            void readAll(deps, docId, pageCount, shown).then((all) => {
              if (all === undefined) return;
              listed = all.barcodes;
              for (const [at, version] of all.versions) versions.set(at, version);
              reply({ kind: 'read', page: shown, all: true, pageCount, barcodes: all.barcodes, truncated: all.truncated });
            });
          }
        },
      );
    },
  };
}

/**
 * Every page's barcodes, read one page after another so a long document shows progress and can be cancelled — what a page
 * reads is the one-page read's, unchanged. A page the read refuses is skipped, and the list is cut at what the dialog shows.
 * `undefined` when the person cancelled.
 */
async function readAll(
  deps: ReadBarcodesDeps,
  docId: DocId,
  pageCount: number,
  shown: number,
): Promise<{ readonly barcodes: readonly ListedBarcode[]; readonly versions: ReadonlyMap<number, DocVersion>; readonly truncated: boolean } | undefined> {
  const task = deps.track(TOAST_BARCODES_READING, pageCount);
  const barcodes: ListedBarcode[] = [];
  const versions = new Map<number, DocVersion>();
  let truncated = false;
  try {
    for (let at = 0; at < pageCount; at += 1) {
      if (task.signal.aborted) return undefined;
      const read = await deps.client['document.pageBarcodes']({ docId, page: at });
      task.step(1);
      if (!read.ok) continue;
      const number = pdfjsPageOf(at);
      versions.set(number, read.value.version);
      truncated ||= read.value.truncated;
      for (const [index, barcode] of read.value.barcodes.entries()) {
        if (barcodes.length >= MAX_LISTED_BARCODES) {
          truncated = true;
          break;
        }
        barcodes.push({ ...barcode, page: number, index });
      }
    }
  } finally {
    task.end();
  }
  // THE PAGE ON SHOW is the dialog's own `page`; nothing about the list depends on it.
  void shown;
  return { barcodes, versions, truncated };
}

/**
 * Places a barcode in the box a person dragged: asks what it says, then sends the words.
 *
 * `placeImage`'s route with the picker replaced by the dialog: the command that does it carries
 * bytes this side never holds, so main writes the symbol and mints it.
 *
 * ## A REFUSAL ASKS AGAIN, with what was typed
 *
 * Whether a type can carry a text is zxing-cpp's answer, in main. A refused try reopens the
 * dialog holding it, so a person changes the text or the type; dismissing it ends the loop and
 * adds nothing, which is what they asked for.
 */
export async function placeBarcode(
  deps: Pick<DocumentCommandDeps, 'ask' | 'client' | 'onApplied' | 'stamp'>,
  docId: DocId,
  page: number,
  rect: AnnotationRect,
): Promise<void> {
  let refused: PlaceBarcodeAnswer | undefined;
  for (;;) {
    const answer = (await deps.ask(PLACE_BARCODE_DIALOG_ID, refused === undefined ? {} : { refused })) as
      | PlaceBarcodeAnswer
      | undefined;
    if (answer === undefined) return;

    const placed = await deps.client['document.placeBarcode']({
      docId,
      pages: [page],
      rect,
      text: answer.text,
      format: answer.format,
      // Main builds the `placeImage`; who placed it and when are this side's (ADR-0103).
      stamp: deps.stamp(),
    });
    if (!placed.ok) {
      reportProblem(deps, placed.error);
      return;
    }
    if (placed.value.kind === 'refused') {
      refused = answer;
      continue;
    }
    deps.onApplied({ version: placed.value.version, byteLength: placed.value.byteLength });
    // INVARIANT 18, after `onApplied`, for `placeImage`'s reason.
    if (placed.value.historyDropped > 0) {
      void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: placed.value.historyDropped });
    }
    return;
  }
}
