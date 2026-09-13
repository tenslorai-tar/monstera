import {
  type PDFDocument,
  type PDFFont,
  type PDFName,
  type PDFOperator,
  type PDFPage,
  StandardFonts,
  beginText,
  endText,
  moveText,
  rgb,
  setFontAndSize,
  showText,
} from '@cantoo/pdf-lib';

import type { ComposeRefusal } from '@monstera/contract';

/**
 * Laying text out as new PDF pages, for every composer the compose host runs
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## One layout, and why it is its own module
 *
 * The Markdown composer was its only caller until a CSV table needed the same page
 * writer, the same wrapping, the same refusal of a character the faces cannot draw
 * and the same table rows. A second copy of any of those would be two opinions about
 * what a composed page looks like and when a character is refused (B3a), and they
 * would agree on every input except the one that differs.
 *
 * ## It parses nothing
 *
 * Every function here takes text a composer has already read out of its source.
 * The parsers — `markdown-it`, the CSV reader — stay in their own modules, which
 * are the ones `proof:kernelload` keeps off the kernel's barrel.
 */

/** A source a composer will not set, named so the channel can say which. */
export class ComposeRefused extends Error {
  constructor(
    readonly reason: ComposeRefusal,
    /** The one-based source line the refusal is about, where there is one. */
    readonly line: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ComposeRefused';
  }
}

/** A page's size in points. */
export interface ComposePageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The page's inset, in points — `pageToc.ts`' figure, so a composed page and a
 * generated table of contents sit in one document with the same margins.
 */
export const MARGIN = 56;

/** Body type size and baseline distance, `pageToc.ts`' pair. */
export const BODY_SIZE = 11;
export const BODY_LEADING = 16;

/** The standard faces a composer sets, by role. */
export interface Faces {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
  readonly boldItalic: PDFFont;
  readonly mono: PDFFont;
}

/** One stretch of text in one face at one size. */
export interface Run {
  readonly text: string;
  readonly font: PDFFont;
  readonly size: number;
}

/** One laid-out line: its runs, left to right, and the leading it takes. */
export interface Line {
  readonly runs: readonly Run[];
  readonly leading: number;
}

/** The standard-14 faces, embedded once per composed document. */
export async function embedFaces(document: PDFDocument): Promise<Faces> {
  return {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    italic: await document.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await document.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await document.embedFont(StandardFonts.Courier),
  };
}

/**
 * Places laid-out lines on pages, starting a new page where the next line would
 * cross the bottom margin.
 */
export class PageWriter {
  #page: PDFPage | null = null;
  #top = 0;
  drewAnything = false;

  constructor(
    private readonly document: PDFDocument,
    private readonly faces: Faces,
    private readonly size: ComposePageSize,
  ) {}

  /** The width a line may take at an indent. */
  room(indent: number): number {
    return this.size.width - 2 * MARGIN - indent;
  }

  /** Draws one line at an indent, answering the page and the baseline it used. */
  line(line: Line, indent: number): { readonly page: PDFPage; readonly baseline: number } {
    const page = this.#pageWithRoomFor(line.leading);
    const baseline = this.#top - line.leading + (line.leading - maxSize(line)) / 2;
    // ONE TEXT OBJECT PER LINE, with the face switched inside it, never one
    // `drawText` per run. `drawText` writes a whole text object per call, and the
    // cost of that was measured 2026-09-13 with scratch probes: drawing a word at a
    // time, one MiB of prose took 16 s and 725 MiB peak RSS; merging adjacent runs
    // brought that to 2.2 s but left alternating faces — `*a*a*a…` — at 45 s and
    // 1,664 MiB for one MiB, because nothing adjacent shares a face. The same one
    // MiB of alternating runs drawn as one text object per line took 3.0 s, 395 MiB
    // and 188 KB against 40.7 s, 1,454 MiB and 22.8 MB. Inside a text object each
    // `Tj` advances by its glyphs' widths, so the runs need no positions of their own.
    const operators: PDFOperator[] = [beginText(), moveText(MARGIN + indent, baseline)];
    let face: PDFFont | null = null;
    let size = 0;
    for (const run of line.runs) {
      if (run.text === '') continue;
      if (run.font !== face || run.size !== size) {
        operators.push(setFontAndSize(this.#fontKey(page, run.font), run.size));
        face = run.font;
        size = run.size;
      }
      operators.push(showText(run.font.encodeText(run.text)));
    }
    operators.push(endText());
    if (face !== null) {
      page.pushOperators(...operators);
      this.drewAnything = true;
    }
    this.#top -= line.leading;
    return { page, baseline };
  }

  /**
   * The resource name a face is drawn under on a page, registered once per page.
   *
   * `newFontDictionary` adds a fresh entry every time it is called — it is what
   * `drawText` calls on every draw — so asking it per line would give each page a
   * font resource per line. One per face per page is what a page needs.
   */
  #fontKey(page: PDFPage, font: PDFFont): PDFName {
    let keys = this.#fontKeys.get(page);
    if (keys === undefined) {
      keys = new Map();
      this.#fontKeys.set(page, keys);
    }
    let key = keys.get(font);
    if (key === undefined) {
      key = page.node.newFontDictionary(font.name, font.ref);
      keys.set(font, key);
    }
    return key;
  }

  readonly #fontKeys = new WeakMap<PDFPage, Map<PDFFont, PDFName>>();

  /** Leaves vertical space, never carrying it onto a fresh page. */
  gap(points: number): void {
    if (this.#page === null) return;
    this.#top -= points;
  }

  /** A horizontal rule across the text column. */
  rule(): void {
    const page = this.#pageWithRoomFor(BODY_LEADING);
    const middle = this.#top - BODY_LEADING / 2;
    page.drawLine({
      start: { x: MARGIN, y: middle },
      end: { x: this.size.width - MARGIN, y: middle },
      thickness: 0.75,
      color: rgb(0.6, 0.6, 0.6),
    });
    this.drewAnything = true;
    this.#top -= BODY_LEADING;
  }

  /** A vertical bar beside a quotation's line. */
  bar(page: PDFPage, indent: number, baseline: number, leading: number, step: number): void {
    const x = MARGIN + indent - step / 2;
    page.drawLine({
      start: { x, y: baseline - leading / 4 },
      end: { x, y: baseline + leading * 0.75 },
      thickness: 1.5,
      color: rgb(0.75, 0.75, 0.75),
    });
  }

  /** The face every run of plain body text is set in. */
  get body(): PDFFont {
    return this.faces.regular;
  }

  #pageWithRoomFor(leading: number): PDFPage {
    if (this.#page === null || this.#top - leading < MARGIN) {
      this.#page = this.document.addPage([this.size.width, this.size.height]);
      this.#top = this.size.height - MARGIN;
    }
    return this.#page;
  }
}

/** The tallest type size on a line, which its baseline is set against. */
function maxSize(line: Line): number {
  return line.runs.reduce((largest, run) => Math.max(largest, run.size), 0);
}

/**
 * Refuses a run holding a character its face cannot encode, naming the source line.
 *
 * The face's own character set is the authority, as in `documentSign.ts`: pdf-lib
 * would otherwise throw a message about glyphs nobody can act on, or — for a code
 * point it maps — draw a different character.
 */
export function checked(run: Run, sourceLine: number | null): Run {
  const encodable = characterSet(run.font);
  for (const character of run.text) {
    if (!encodable.has(character.codePointAt(0) ?? -1)) {
      const where = sourceLine === null ? '' : ` on line ${String(sourceLine)}`;
      throw new ComposeRefused(
        'unencodable-text',
        sourceLine,
        `the source${where} holds a character the standard fonts cannot draw`,
      );
    }
  }
  return run;
}

/** Each face's character set, built once per face rather than once per run. */
const CHARACTER_SETS = new WeakMap<PDFFont, ReadonlySet<number>>();

function characterSet(font: PDFFont): ReadonlySet<number> {
  const known = CHARACTER_SETS.get(font);
  if (known !== undefined) return known;
  const built = new Set(font.getCharacterSet());
  CHARACTER_SETS.set(font, built);
  return built;
}

/**
 * Lays runs into lines no wider than `room`, breaking between words.
 *
 * A run whose text is exactly `'\n'` ends the line. A single word wider than the room
 * is broken by characters rather than allowed to overhang the margin, because text
 * past the page edge is text a reader of the composed document never sees.
 */
export function wrap(
  runs: readonly Run[],
  room: number,
  leading: number,
  sourceLine: number | null,
): Line[] {
  const lines: Line[] = [];
  let current: Run[] = [];
  let used = 0;

  const finish = (): void => {
    lines.push({ runs: current, leading });
    current = [];
    used = 0;
  };

  for (const run of runs) {
    if (run.text === '\n') {
      finish();
      continue;
    }
    checked(run, sourceLine);
    // Words keep their trailing space, so a line breaks between words and the
    // space that ended a line does not start the next one.
    for (const word of run.text.split(/(?<= )/u)) {
      const piece: Run = { text: word, font: run.font, size: run.size };
      const width = run.font.widthOfTextAtSize(word, run.size);
      if (used + width > room && used > 0) {
        finish();
        if (word.trim() === '') continue;
      }
      if (width > room) {
        for (const part of breakByWidth(piece, room)) {
          if (used > 0) finish();
          current.push(part);
          used = run.font.widthOfTextAtSize(part.text, run.size);
        }
        continue;
      }
      current.push(piece);
      used += width;
    }
  }
  if (current.length > 0) finish();
  return lines;
}

/** Splits one run into pieces no wider than `room`, by characters. */
export function breakByWidth(run: Run, room: number): Run[] {
  if (run.font.widthOfTextAtSize(run.text, run.size) <= room) return [run];
  const pieces: Run[] = [];
  let piece = '';
  for (const character of run.text) {
    const next = piece + character;
    if (piece !== '' && run.font.widthOfTextAtSize(next, run.size) > room) {
      pieces.push({ ...run, text: piece });
      piece = character;
    } else {
      piece = next;
    }
  }
  if (piece !== '') pieces.push({ ...run, text: piece });
  return pieces;
}

/**
 * A run of spaces that advances approximately `points`, set in the regular face.
 *
 * Approximate by at most one space's width, which is the resolution a column start
 * needs — the next cell begins at the next space boundary past its edge.
 */
function spacer(font: PDFFont, points: number): Run {
  const space = font.widthOfTextAtSize(' ', BODY_SIZE);
  const count = space <= 0 ? 0 : Math.ceil(points / space);
  return { text: ' '.repeat(count), font, size: BODY_SIZE };
}

/** The inset between a cell's edge and its text, either side. */
const CELL_PADDING = 4;

/**
 * The most columns a table can have at an indent, from the face's own width.
 *
 * A cell narrower than three digits at body size holds almost nothing, and `wrap`
 * would break its text one character per line, which reads as a page of noise. So
 * the width of `000` in the body face, plus the padding either side, is the
 * narrowest cell this layout sets — derived from the font, never a column count
 * written down.
 */
export function maxTableColumns(writer: PageWriter, faces: Faces, indent: number): number {
  const narrowest = faces.regular.widthOfTextAtSize('000', BODY_SIZE) + 2 * CELL_PADDING;
  return Math.max(1, Math.floor(writer.room(indent) / narrowest));
}

/** One table row: whether it is a header, and each cell's runs. */
export interface TableRow {
  readonly header: boolean;
  readonly cells: readonly (readonly Run[])[];
  /** The one-based source line the row came from, for a refusal inside it. */
  readonly sourceLine: number | null;
}

/**
 * A table, as rows of equal-width cells whose text wraps within the cell.
 *
 * Equal widths rather than widths fitted to content: a fitted layout needs a
 * measuring pass over every cell first, and a column squeezed to its widest word is
 * still wrong for the next row. The composer decides which runs are bold; this sets
 * them.
 *
 * Nothing is drawn for a table with no columns.
 *
 * @throws ComposeRefused `too-many-columns`, naming the first row's line, for a table
 *   wider than {@link maxTableColumns} — refused by name rather than drawn one
 *   character per line, which is the rule every composed page follows.
 */
export function drawTable(
  rows: readonly TableRow[],
  writer: PageWriter,
  faces: Faces,
  indent: number,
): void {
  const columns = rows.reduce((most, row) => Math.max(most, row.cells.length), 0);
  if (columns === 0) return;
  const limit = maxTableColumns(writer, faces, indent);
  if (columns > limit) {
    const line = rows[0]?.sourceLine ?? null;
    throw new ComposeRefused(
      'too-many-columns',
      line,
      `a table has ${String(columns)} columns, and a page has room for ${String(limit)}`,
    );
  }
  const cellWidth = writer.room(indent) / columns;
  const padding = CELL_PADDING;

  for (const row of rows) {
    const cellLines = row.cells.map((cell) =>
      wrap(cell, cellWidth - 2 * padding, BODY_LEADING, row.sourceLine),
    );
    const height = cellLines.reduce((most, lines) => Math.max(most, lines.length), 1);
    for (let at = 0; at < height; at += 1) {
      // ONE PHYSICAL LINE ACROSS ALL CELLS, so a row's cells share baselines and
      // the row breaks onto a new page as one unit of height at a time.
      const runs: Run[] = [];
      let used = 0;
      cellLines.forEach((lines, column) => {
        const target = column * cellWidth + padding;
        if (target > used) {
          runs.push({ text: '', font: faces.regular, size: BODY_SIZE });
          runs.push(spacer(faces.regular, target - used));
          used = target;
        }
        for (const run of lines[at]?.runs ?? []) {
          runs.push(run);
          used += run.font.widthOfTextAtSize(run.text, run.size);
        }
      });
      writer.line({ runs, leading: BODY_LEADING }, indent);
    }
    writer.gap(2);
  }
}
