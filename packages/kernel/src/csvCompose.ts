import { PDFDocument, type PDFFont } from '@cantoo/pdf-lib';

import {
  BODY_SIZE,
  type ComposePageSize,
  ComposeRefused,
  PageWriter,
  type Run,
  type TableRow,
  drawTable,
  embedFaces,
} from './composeLayout.js';
import { readCsv } from './csvRead.js';

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
 *   four spaces, because WinAnsi has no glyph for either.
 * - **A file whose every field is empty draws nothing and is refused.** The table
 *   layout would otherwise set spaces between empty cells and produce a blank page
 *   that looks composed.
 */

/** A tab in a cell is set as this many spaces, `markdownCompose.ts`' figure. */
const TAB_SPACES = 4;

/**
 * Sets a CSV source as a table on new PDF pages, answering its bytes.
 *
 * @param source the file's bytes, exactly as picked
 * @param page the size every page is set at
 * @throws ComposeRefused for a source that is not UTF-8, breaks RFC 4180, holds a
 *   character the standard faces cannot draw, has more columns than a page holds, or
 *   has no field with anything in it
 */
export async function composeCsv(source: Uint8Array, page: ComposePageSize): Promise<Uint8Array> {
  let text: string;
  try {
    // `ignoreBOM` false, the default: a leading byte-order mark is consumed, never
    // drawn — it has no WinAnsi glyph, and refusing a file for it would blame the
    // font for how the file was saved.
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
  const faces = await embedFaces(document);
  const writer = new PageWriter(document, faces, page);

  const rows: TableRow[] = records.map((record, index) => ({
    header: index === 0,
    sourceLine: record.line,
    cells: record.cells.map((cell) => cellRuns(cell, index === 0 ? faces.bold : faces.regular)),
  }));
  drawTable(rows, writer, faces, 0);

  return document.save();
}

/** One field's runs: its lines, with a hard break between them. */
function cellRuns(text: string, font: PDFFont): Run[] {
  const runs: Run[] = [];
  text
    .replaceAll('\t', ' '.repeat(TAB_SPACES))
    .split('\n')
    .forEach((part, at) => {
      if (at > 0) runs.push({ text: '\n', font, size: BODY_SIZE });
      if (part !== '') runs.push({ text: part, font, size: BODY_SIZE });
    });
  return runs;
}
