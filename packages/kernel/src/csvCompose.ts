import { PDFDocument } from '@cantoo/pdf-lib';

import { ComposeFonts, type FaceRole } from './composeFonts.js';
import { BODY_SIZE, PageWriter, type Run } from './composeLayout.js';
import {
  type ComposePageSize,
  ComposeRefused,
  type ComposedSource,
  type SourceBlock,
  boxedPositions,
} from './composeOutcome.js';
import { type TableRow, drawTable } from './composeTable.js';
import { readCsv } from './csvRead.js';
import type { FaceSource } from './fontCatalogue.js';

/**
 * A CSV file, set as a PDF table
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## This module runs in the COMPOSE HOST and nowhere else
 *
 * `markdownCompose.ts`' reason: the bytes are a picked file's, and §2 keeps parsing
 * of any kind out of `main`. The reader is `csvRead.ts` and the layout is
 * `composeLayout.ts`', shared with the Markdown composer's tables.
 *
 * ## What it decides
 *
 * - **UTF-8, refused by name otherwise**, and a byte-order mark is not content.
 * - **The first record is set bold, as a header.** RFC 4180's header is optional and
 *   a file does not say whether it has one; most do, and a bold first row misreads a
 *   headerless file far less than a plain one misreads a header. A stated choice,
 *   not a detection.
 * - **A line break inside a quoted field is a line break in the cell**, and a tab is
 *   four spaces, because a tab is a movement to a stop and no font draws one.
 * - **Every character is drawn** (ADR-0172), and one no face carries is a box the composition reports by its line
 *   and column, which for a field spanning lines is the line the character is on.
 * - **A file whose every field is empty draws nothing and is refused.** The table
 *   layout would otherwise set spaces between empty cells and produce a blank page
 *   that looks composed.
 */

/** A tab in a cell is set as this many spaces, `markdownCompose.ts`' figure. */
const TAB_SPACES = 4;

/**
 * Sets a CSV source as a table on new PDF pages, answering its bytes and every character drawn as the box.
 *
 * @param source the file's bytes, exactly as picked
 * @param page the size every page is set at
 * @param faces the catalogue the text is set from
 * @throws ComposeRefused for a source that is not UTF-8, breaks RFC 4180 or has no field with anything in it — never
 *   for its width, which `composeTable.ts` fits, and never for its characters
 */
export async function composeCsv(source: Uint8Array, page: ComposePageSize, faces: FaceSource): Promise<ComposedSource> {
  let text: string;
  try {
    // `ignoreBOM` false, the default: a leading byte-order mark is consumed, never
    // drawn — it is how the file was saved, not something it says.
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    throw new ComposeRefused('not-utf8', null, 'the source is not UTF-8 text');
  }

  const records = readCsv(text);
  if (!records.some((record) => record.cells.some((cell) => cell.trim() !== ''))) {
    throw new ComposeRefused('nothing-to-draw', null, 'the source holds no field with anything in it');
  }

  // PINNED, for `markdownCompose.ts`' reason: a composition that differed on every
  // run could not be compared with itself.
  const document = await PDFDocument.create({ updateMetadata: false });
  const fonts = new ComposeFonts(document, faces);
  const writer = new PageWriter(document, fonts, page);

  // A RECORD SPANS ITS FIRST LINE AND ONE MORE FOR EACH LINE BREAK INSIDE A QUOTED FIELD, which is where a box drawn
  // in it is searched for.
  const blocks = new Map<number, SourceBlock>();
  const rows: TableRow[] = records.map((record, index) => {
    const breaks = record.cells.reduce((total, cell) => total + (cell.match(/\n/gu)?.length ?? 0), 0);
    blocks.set(record.line, { from: record.line, to: record.line + breaks });
    return {
      header: index === 0,
      cells: record.cells.map((cell) => cellRuns(cell, index === 0 ? 'bold' : 'regular', record.line)),
    };
  });
  drawTable(rows, writer, 0);

  fonts.finish();
  return { pdf: await document.save(), boxed: boxedPositions(text, fonts.boxed, blocks) };
}

/** One field's runs: its lines, with a hard break between them. */
function cellRuns(text: string, role: FaceRole, line: number): Run[] {
  const runs: Run[] = [];
  text
    .replaceAll('\t', ' '.repeat(TAB_SPACES))
    .split('\n')
    .forEach((part, at) => {
      if (at > 0) runs.push({ text: '\n', role, size: BODY_SIZE, line });
      if (part !== '') runs.push({ text: part, role, size: BODY_SIZE, line });
    });
  return runs;
}
