import {
  type PDFDocument,
  type PDFName,
  type PDFOperator,
  type PDFPage,
  beginText,
  endText,
  moveText,
  rgb,
} from '@cantoo/pdf-lib';

import { lineSpans, paragraphDirection, paragraphLevels } from './bidiOrder.js';
import type { CidFont } from './cidFont.js';
import type { ComposeFonts, FaceRole, SetPiece } from './composeFonts.js';
import type { ComposePageSize } from './composeOutcome.js';
import { breakOpportunities, graphemeBoundaries } from './lineBreaks.js';

/**
 * Laying text out as new PDF pages, for every composer the compose host runs
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## One layout, and why it is its own module
 *
 * The Markdown composer and the CSV composer set the same pages, the same wrapping and the same table rows, and a
 * second copy of any of those would be two opinions about what a composed page looks like (B3a). The table rows
 * themselves are `composeTable.ts`', which sets them through this writer.
 *
 * ## Every character is drawn
 *
 * Text is set through `composeFonts.ts`, which gives every word a face that carries it and draws a character no face
 * carries as the missing-character box
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)).
 * So nothing here refuses text: the standard fonts' refusal of a character they could not encode is gone, and with
 * it the only reason a person's file was turned away for what it said.
 *
 * ## A paragraph is ordered, then broken, then each line ordered again
 *
 * The Unicode Bidirectional Algorithm resolves a paragraph's levels once (`bidiOrder.ts`); the paragraph is broken
 * into lines where `lineBreaks.ts` allows, measured in logical order; and each line is reordered for drawing on its
 * own, which is the algorithm's own sequence. A paragraph whose first strong character is right to left is set right
 * to left and aligned to the right edge of its room.
 *
 * ## It parses nothing
 *
 * Every function here takes text a composer has already read out of its source.
 */

/**
 * The page's inset, in points — `pageToc.ts`' figure, so a composed page and a
 * generated table of contents sit in one document with the same margins.
 */
export const MARGIN = 56;

/** Body type size and baseline distance, `pageToc.ts`' pair. */
export const BODY_SIZE = 11;
export const BODY_LEADING = 16;

/** One stretch of source text in one role at one size, and the source line it was read from. */
export interface Run {
  /** Its text; exactly `'\n'` for a hard break, which ends the line. */
  readonly text: string;
  readonly role: FaceRole;
  readonly size: number;
  /** The one-based source line of the block the text is in, which a box drawn in it is reported against. */
  readonly line: number | null;
}

/** One laid-out line: its pieces in drawing order, how wide they are, and the leading it takes. */
export interface Line {
  readonly pieces: readonly SetPiece[];
  readonly width: number;
  readonly leading: number;
  /** Whether its paragraph is set right to left, and so aligned to the right of its room. */
  readonly rtl: boolean;
}

/** One cell of a table's physical line: where it starts past the line's indent, how wide it is, and its line. */
export interface PlacedLine {
  readonly offset: number;
  readonly width: number;
  readonly line: Line | null;
}

/** How a paragraph may be broken: between words, or — for a line of code — only where it must, between graphemes. */
export type BreakRule = 'words' | 'graphemes';

/** A paragraph's text, and which run each of its stretches came from. */
interface Paragraph {
  readonly text: string;
  readonly parts: readonly { readonly start: number; readonly end: number; readonly run: Run }[];
}

/** Runs split into paragraphs at hard breaks, each its text and its runs' places in it. */
function paragraphsOf(runs: readonly Run[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let text = '';
  let parts: { start: number; end: number; run: Run }[] = [];
  for (const run of runs) {
    if (run.text === '\n') {
      paragraphs.push({ text, parts });
      text = '';
      parts = [];
      continue;
    }
    if (run.text === '') continue;
    parts.push({ start: text.length, end: text.length + run.text.length, run });
    text += run.text;
  }
  paragraphs.push({ text, parts });
  return paragraphs;
}

/** The stretches of `[start, end)` that lie in one run each, in logical order. */
function stretchesOf(paragraph: Paragraph, start: number, end: number): { start: number; end: number; run: Run }[] {
  return paragraph.parts.flatMap((part) => {
    const from = Math.max(start, part.start);
    const to = Math.min(end, part.end);
    return from < to ? [{ start: from, end: to, run: part.run }] : [];
  });
}

/** The width of `[start, end)` of a paragraph, measured run by run. */
function widthOf(paragraph: Paragraph, start: number, end: number, fonts: ComposeFonts): number {
  return stretchesOf(paragraph, start, end).reduce(
    (total, stretch) => total + fonts.width(paragraph.text.slice(stretch.start, stretch.end), stretch.run.role, stretch.run.size),
    0,
  );
}

/** Where `[start, end)` ends once its trailing whitespace is left off, which a line's end never draws. */
function trimmedEnd(text: string, start: number, end: number): number {
  let at = end;
  while (at > start && /\s/u.test(text[at - 1] ?? '')) at -= 1;
  return at;
}

/** The paragraph's breakable units, as `[start, end)` ranges in order. */
function atomsOf(paragraph: Paragraph, rule: BreakRule): { start: number; end: number }[] {
  const breaks = rule === 'words' ? breakOpportunities(paragraph.text) : graphemeBoundaries(paragraph.text);
  const atoms: { start: number; end: number }[] = [];
  let from = 0;
  for (const at of [...breaks, paragraph.text.length]) {
    if (at > from) atoms.push({ start: from, end: at });
    from = at;
  }
  return atoms;
}

/**
 * How wide a cell's text is as written and its widest unbreakable unit, which a table plans columns from. One rule
 * with {@link wrap}: the units are the ones it breaks between.
 */
export function measureRuns(runs: readonly Run[], fonts: ComposeFonts): { readonly content: number; readonly word: number } {
  let content = 0;
  let word = 0;
  for (const paragraph of paragraphsOf(runs)) {
    content = Math.max(content, widthOf(paragraph, 0, trimmedEnd(paragraph.text, 0, paragraph.text.length), fonts));
    for (const atom of atomsOf(paragraph, 'words')) {
      word = Math.max(word, widthOf(paragraph, atom.start, trimmedEnd(paragraph.text, atom.start, atom.end), fonts));
    }
  }
  return { content, word };
}

/**
 * Lays runs into lines no wider than `room`.
 *
 * A run whose text is exactly `'\n'` ends the line. A unit wider than the room is broken between its graphemes rather
 * than allowed to overhang the margin, because text past the page edge is text a reader of the composed document never
 * sees.
 */
export function wrap(
  runs: readonly Run[],
  room: number,
  leading: number,
  fonts: ComposeFonts,
  rule: BreakRule = 'words',
): Line[] {
  const lines: Line[] = [];
  const paragraphs = paragraphsOf(runs);
  paragraphs.forEach((paragraph, index) => {
    const last = index === paragraphs.length - 1;
    // AN EMPTY LAST PARAGRAPH IS NOTHING, and an empty earlier one is a blank line: a hard break ends a line, and the
    // text after the last one is the only paragraph a break did not end.
    if (paragraph.text === '') {
      if (!last) lines.push({ pieces: [], width: 0, leading, rtl: false });
      return;
    }
    const direction = paragraphDirection(paragraph.text);
    const levels = paragraphLevels(paragraph.text, direction);
    const ranges: { start: number; end: number }[] = [];
    let start = 0;
    let end = 0;
    // THE WIDTH OF [start, end) AS A SUM OF ITS UNITS, each measured alone: a unit's text recurs ("the ", "and ") so
    // its width is measured once, where measuring the growing line would shape every prefix of it again.
    let used = 0;
    const finish = (): void => {
      ranges.push({ start, end });
      start = end;
      used = 0;
    };
    for (const atom of atomsOf(paragraph, rule)) {
      const visible = widthOf(paragraph, atom.start, trimmedEnd(paragraph.text, atom.start, atom.end), fonts);
      if (end > start && used + visible > room) finish();
      if (used + visible <= room) {
        end = atom.end;
        used += widthOf(paragraph, atom.start, atom.end, fonts);
        continue;
      }
      // ONE UNIT WIDER THAN THE WHOLE ROOM, alone on its line, broken between its graphemes where it must be.
      const inside = graphemeBoundaries(paragraph.text.slice(atom.start, atom.end)).map((at) => atom.start + at);
      for (const boundary of [...inside, atom.end]) {
        if (end > start && widthOf(paragraph, start, trimmedEnd(paragraph.text, start, boundary), fonts) > room) finish();
        end = boundary;
      }
      used = widthOf(paragraph, start, end, fonts);
    }
    if (end > start) finish();
    for (const range of ranges) {
      lines.push(setLine(paragraph, levels, range.start, trimmedEnd(paragraph.text, range.start, range.end), leading, direction === 'rtl', fonts));
    }
  });
  return lines;
}

/** One line of a paragraph, ordered for drawing and set. */
function setLine(
  paragraph: Paragraph,
  levels: ReturnType<typeof paragraphLevels>,
  start: number,
  end: number,
  leading: number,
  rtl: boolean,
  fonts: ComposeFonts,
): Line {
  const pieces: SetPiece[] = [];
  for (const span of lineSpans(levels, start, end)) {
    const stretches = stretchesOf(paragraph, span.start, span.end);
    if (span.rtl) stretches.reverse();
    for (const stretch of stretches) {
      const { role, size, line } = stretch.run;
      pieces.push(...fonts.set(paragraph.text.slice(stretch.start, stretch.end), role, size, span.rtl, line));
    }
  }
  return { pieces, width: pieces.reduce((total, piece) => total + piece.width, 0), leading, rtl };
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
    readonly fonts: ComposeFonts,
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
    return this.row([{ offset: 0, width: this.room(indent), line }], line.leading, indent);
  }

  /**
   * Draws one physical line of cells, each from its own offset, sharing one baseline.
   *
   * The cells are placed by `Td`, which moves the text line's start by an exact amount whatever the glyphs before it
   * advanced, so a column begins where it was measured to rather than at the next space past its edge. A line set
   * right to left starts where its width ends at the cell's right edge.
   */
  row(cells: readonly PlacedLine[], leading: number, indent: number): { readonly page: PDFPage; readonly baseline: number } {
    const page = this.#pageWithRoomFor(leading);
    const tallest = cells.reduce(
      (most, cell) => Math.max(most, ...(cell.line?.pieces ?? []).map((piece) => piece.size)),
      0,
    );
    const baseline = this.#top - leading + (leading - tallest) / 2;
    // ONE TEXT OBJECT PER LINE, with the face switched inside it, never one
    // `drawText` per run. `drawText` writes a whole text object per call, and the
    // cost of that was measured 2026-09-13 with scratch probes: drawing a word at a
    // time, one MiB of prose took 16 s and 725 MiB peak RSS; merging adjacent runs
    // brought that to 2.2 s but left alternating faces — `*a*a*a…` — at 45 s and
    // 1,664 MiB for one MiB, because nothing adjacent shares a face. The same one
    // MiB of alternating runs drawn as one text object per line took 3.0 s, 395 MiB
    // and 188 KB against 40.7 s, 1,454 MiB and 22.8 MB. Inside a text object each
    // `TJ` advances by its glyphs' widths, so the pieces need no positions of their own.
    const operators: PDFOperator[] = [beginText(), moveText(MARGIN + indent, baseline)];
    const outlines: PDFOperator[] = [];
    let at = 0;
    let drew = false;
    for (const cell of cells) {
      const line = cell.line;
      if (line === null || line.pieces.length === 0) continue;
      const start = cell.offset + (line.rtl ? Math.max(0, cell.width - line.width) : 0);
      if (start !== at) {
        operators.push(moveText(start - at, 0));
        at = start;
      }
      let pen = MARGIN + indent + start;
      for (const piece of line.pieces) {
        operators.push(...this.fonts.textOperators(piece, this.#fontKey(page, piece.font)));
        outlines.push(...this.fonts.outlineOperators(piece, pen, baseline));
        pen += piece.width;
        drew = true;
      }
    }
    operators.push(endText());
    if (drew) {
      page.pushOperators(...operators, ...outlines);
      this.drewAnything = true;
    }
    this.#top -= leading;
    return { page, baseline };
  }

  /**
   * Draws `text` in `role` ending `gap` points before `x`, on `baseline`: a list item's marker in its hanging indent.
   */
  marker(page: PDFPage, text: string, role: FaceRole, size: number, x: number, baseline: number, line: number | null): void {
    const pieces = this.fonts.set(text, role, size, false, line);
    const width = pieces.reduce((total, piece) => total + piece.width, 0);
    const operators: PDFOperator[] = [beginText(), moveText(x - width, baseline)];
    for (const piece of pieces) operators.push(...this.fonts.textOperators(piece, this.#fontKey(page, piece.font)));
    operators.push(endText());
    page.pushOperators(...operators);
  }

  /**
   * The resource name a font is drawn under on a page, registered once per page.
   *
   * `newFontDictionary` adds a fresh entry every time it is called, so asking it per line would give each page a font
   * resource per line. One per font per page is what a page needs.
   */
  #fontKey(page: PDFPage, font: CidFont): PDFName {
    let keys = this.#fontKeys.get(page);
    if (keys === undefined) {
      keys = new Map();
      this.#fontKeys.set(page, keys);
    }
    let key = keys.get(font);
    if (key === undefined) {
      key = page.node.newFontDictionary('F', font.ref);
      keys.set(font, key);
    }
    return key;
  }

  readonly #fontKeys = new WeakMap<PDFPage, Map<CidFont, PDFName>>();

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
