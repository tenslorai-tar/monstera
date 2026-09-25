import type { AnnotationRect, ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { PAGE_BARCODES_DIALOG_ID } from '../dialogs/pageBarcodes.js';
import { PLACE_BARCODE_DIALOG_ID, type PlaceBarcodeAnswer } from '../dialogs/placeBarcode.js';
import { GROUP_MARKS, READ_BARCODES_COMMAND_TITLE } from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { type DocumentCommandDeps, hasDocument, reportProblem } from './documentCommands.js';

/**
 * Organize › Barcodes — read the barcodes on the page on screen (ADR-0076).
 *
 * `inspectPageStructureCommand`'s shape and its reasons: one page, the one a person is looking
 * at; the request carries the zero-based index and the dialog the number a person reads, each
 * from `pageNumbering.ts`; and a refusal opens the dialog too.
 */
export function readBarcodesCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'document.read-barcodes',
    icon: 'ScanBarcode',
    title: READ_BARCODES_COMMAND_TITLE,
    // 20, after the tool that adds one at 10: the group reads make, then read.
    // ORGANIZE › MARKS, secondary, after placing one (see `placeBarcodeToolCommand`).
    placements: [{ surface: 'ribbon', section: 'organize', group: GROUP_MARKS, order: 62, prominence: 'secondary' }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, page } = context;
      if (docId === undefined || page === undefined) return;

      const shown = pdfjsPageOf(page);
      const answer = await deps.client['document.pageBarcodes']({ docId, page });
      // Voided for `showWordCount`'s reason: the dialog declares no result.
      void deps.ask(
        PAGE_BARCODES_DIALOG_ID,
        answer.ok
          ? { kind: 'read', page: shown, barcodes: answer.value.barcodes, truncated: answer.value.truncated }
          : { kind: 'refused', page: shown },
      );
    },
  };
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
