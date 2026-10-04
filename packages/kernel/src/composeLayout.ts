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
 * would agree on every input except the one that differs. The table rows themselves
 * are `composeTable.ts`', which sets them through this writer.
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
    /** The one-based position of the picked file the refusal is about, for a multi-file import. */
    readonly item: number | null = null,
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

/** One cell of a table's physical line: where it starts past the line's indent, and its runs. */
export interface PlacedRuns {
  readonly offset: number;
  readonly runs: readonly Run[];
}

/**
 * Places laid-out lines on pages, starting a new page where the next line would
 * cross the bottom margin, or where the pages are now set at another size.
 */
export class PageWriter {
  #page: PDFPage | null = null;
  #pageSize: ComposePageSize | null = null;
  #top = 0;
  #size: ComposePageSize;
  drewAnything = false;

  constructor(
    private readonly document: PDFDocument,
    private readonly faces: Faces,
    /** The size the composer was asked for, which every page is set at unless a wide table turns it. */
    readonly base: ComposePageSize,
  ) {
    this.#size = base;
  }

  /** The asked-for size with its long side across, which is itself where it already is. */
  get turned(): ComposePageSize {
    return {
      width: Math.max(this.base.width, this.base.height),
      height: Math.min(this.base.width, this.base.height),
    };
  }

  /**
   * Sets the pages from here on at `size`. A page already begun at another size takes nothing more: the next line
   * starts a page at this one, so a turned table never shares a page with the prose either side of it.
   */
  useSize(size: ComposePageSize): void {
    this.#size = size;
  }

  /** The width a line may take at an indent, on the pages being set. */
  room(indent: number): number {
    return this.#size.width - 2 * MARGIN - indent;
  }

  /** The height between the margins of a page being set. */
  get textHeight(): number {
    return this.#size.height - 2 * MARGIN;
  }

  /** Whether `points` more of height fit on the page being written, without starting another. */
  fits(points: number): boolean {
    return this.#page !== null && this.#onSize() && this.#top - points >= MARGIN;
  }

  /** Ends the page being written: the next line starts a new one. */
  breakPage(): void {
    this.#page = null;
  }

  /** Draws one line at an indent, answering the page and the baseline it used. */
  line(line: Line, indent: number): { readonly page: PDFPage; readonly baseline: number } {
    return this.row([{ offset: 0, runs: line.runs }], line.leading, indent);
  }

  /**
   * Draws one physical line of cells, each from its own offset, sharing one baseline.
   *
   * The cells are placed by `Td`, which moves the text line's start by an exact amount whatever the glyphs before it
   * advanced, so a column begins where it was measured to rather than at the next space past its edge.
   */
  row(cells: readonly PlacedRuns[], leading: number, indent: number): { readonly page: PDFPage; readonly baseline: number } {
    const page = this.#pageWithRoomFor(leading);
    const tallest = cells.reduce((most, cell) => Math.max(most, maxSize({ runs: cell.runs, leading })), 0);
    const baseline = this.#top - leading + (leading - tallest) / 2;
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
    let at = 0;
    for (const cell of cells) {
      if (!cell.runs.some((run) => run.text !== '')) continue;
      if (cell.offset !== at) {
        operators.push(moveText(cell.offset - at, 0));
        at = cell.offset;
      }
      for (const run of cell.runs) {
        if (run.text === '') continue;
        if (run.font !== face || run.size !== size) {
          operators.push(setFontAndSize(this.#fontKey(page, run.font), run.size));
          face = run.font;
          size = run.size;
        }
        operators.push(showText(run.font.encodeText(run.text)));
      }
    }
    operators.push(endText());
    if (face !== null) {
      page.pushOperators(...operators);
      this.drewAnything = true;
    }
    this.#top -= leading;
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
      end: { x: this.#size.width - MARGIN, y: middle },
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

  #onSize(): boolean {
    return this.#pageSize?.width === this.#size.width && this.#pageSize.height === this.#size.height;
  }

  #pageWithRoomFor(leading: number): PDFPage {
    if (this.#page === null || !this.#onSize() || this.#top - leading < MARGIN) {
      this.#page = this.document.addPage([this.#size.width, this.#size.height]);
      this.#pageSize = this.#size;
      this.#top = this.#size.height - MARGIN;
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
