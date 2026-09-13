import {
  PDFDocument,
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
import MarkdownIt, { type Token as MarkdownToken } from 'markdown-it';

import type { MarkdownComposeRefusal } from '@monstera/contract';

/**
 * A Markdown source, set as a new PDF
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## This module runs in the COMPOSE HOST and nowhere else
 *
 * The source is a file a person picked, so its bytes were chosen by whoever wrote
 * it (threat model §1.9), and §2 keeps document parsing of any kind out of `main`.
 * Nothing in the kernel's barrel exports this file; the compose host's entry is its
 * one importer.
 *
 * ## The parser's own bound, not a second opinion about Markdown
 *
 * `markdown-it`'s `maxNesting` stops a crafted descent — measured 2026-09-13 at 200
 * and 347 tokens for 20,000 nested quotes and 2,000 nested list levels. `html`
 * stays at its default `false`, so a raw HTML line arrives as text and is drawn as
 * text; nothing here interprets markup the parser did not.
 *
 * ## Standard-14 faces, and a character they cannot draw is REFUSED
 *
 * `pageToc.ts` accepts an illegible title, because a table of contents is still
 * usable with one. This is a document's whole body, and drawing through whatever
 * WinAnsi byte a character maps to would lose its content while looking complete.
 * So the font's own character set is asked first, as `documentSign.ts` asks it,
 * and the refusal names the source line.
 *
 * ## An image is its ALT TEXT, and its path is never read
 *
 * A relative image path names a file beside the Markdown, which this process was
 * never handed and cannot reach — and reading it would be the reach invariant 25
 * forbids. The alt text is drawn in its place, marked as an image.
 */

/** A source this module will not set, named so the channel can say which. */
export class MarkdownComposeRefused extends Error {
  constructor(
    readonly reason: MarkdownComposeRefusal,
    /** The one-based source line the refusal is about, where there is one. */
    readonly line: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'MarkdownComposeRefused';
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
const MARGIN = 56;

/** Body type size and baseline distance, `pageToc.ts`' pair. */
const BODY_SIZE = 11;
const BODY_LEADING = 16;

/** Monospace type for code, a point smaller so a line of code fits as prose does. */
const CODE_SIZE = 10;
const CODE_LEADING = 14;

/** Heading sizes by level, one to six, and the leading each is set on. */
const HEADING: readonly { readonly size: number; readonly leading: number }[] = [
  { size: 20, leading: 26 },
  { size: 16, leading: 22 },
  { size: 13, leading: 18 },
  { size: 11, leading: 16 },
  { size: 11, leading: 16 },
  { size: 11, leading: 16 },
];

/** Space kept after a block, before the next one begins. */
const BLOCK_GAP = 6;

/** How far one level of list or quotation indents. */
const INDENT = 18;

/** A tab in code is set as this many spaces: WinAnsi has no glyph for a tab. */
const TAB_SPACES = 4;

/** The standard faces this module sets, by role. */
interface Faces {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
  readonly boldItalic: PDFFont;
  readonly mono: PDFFont;
}

/** One stretch of text in one face at one size. */
interface Run {
  readonly text: string;
  readonly font: PDFFont;
  readonly size: number;
}

/** One laid-out line: its runs, left to right, and the leading it takes. */
interface Line {
  readonly runs: readonly Run[];
  readonly leading: number;
}

/**
 * Sets a Markdown source as a new PDF, answering its bytes.
 *
 * @param source the file's bytes, exactly as picked
 * @param page the size every page is set at
 * @throws MarkdownComposeRefused for a source that is not UTF-8, holds a character
 *   the standard faces cannot draw, or draws nothing at all
 */
export async function composeMarkdown(source: Uint8Array, page: ComposePageSize): Promise<Uint8Array> {
  let text: string;
  try {
    // FATAL, so a byte sequence that is not UTF-8 is refused by name rather than
    // decoded into replacement characters that would then be refused as
    // unencodable — which would blame the font for the file's encoding.
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    throw new MarkdownComposeRefused('not-utf8', null, 'the source is not UTF-8 text');
  }

  const tokens = new MarkdownIt().parse(text, {});

  // PINNED, for `monstera/no-unpinned-pdf-load`'s reason: pdf-lib stamps the
  // creation and modification dates by default, and a composition that differed
  // on every run could not be compared with itself.
  const document = await PDFDocument.create({ updateMetadata: false });
  const faces: Faces = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    italic: await document.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await document.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await document.embedFont(StandardFonts.Courier),
  };

  const writer = new PageWriter(document, faces, page);
  new BlockWalker(tokens, faces, writer, page).walk();

  if (!writer.drewAnything) {
    throw new MarkdownComposeRefused(
      'nothing-to-draw',
      null,
      'the source holds no text to set, so a composed document would be blank',
    );
  }
  return document.save();
}

/**
 * Places laid-out lines on pages, starting a new page where the next line would
 * cross the bottom margin.
 */
class PageWriter {
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
  bar(page: PDFPage, indent: number, baseline: number, leading: number): void {
    const x = MARGIN + indent - INDENT / 2;
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

/** The inline style a run inherits from the tags open around it. */
interface InlineStyle {
  readonly bold: boolean;
  readonly italic: boolean;
}

/**
 * Walks `markdown-it`'s block tokens in order and sets each block.
 *
 * The token types handled are the ones the parser was measured to emit on
 * 2026-09-13 for headings, paragraphs, both list kinds, quotations, fenced and
 * indented code, rules, tables and inline images. A token type not handled here is
 * skipped rather than guessed at, and a block with nothing drawable draws nothing.
 */
class BlockWalker {
  #index = 0;
  /** One entry per open list: its kind and the number its next item takes. */
  readonly #lists: { ordered: boolean; next: number }[] = [];
  #quoteDepth = 0;

  constructor(
    private readonly tokens: readonly MarkdownToken[],
    private readonly faces: Faces,
    private readonly writer: PageWriter,
    private readonly size: ComposePageSize,
  ) {}

  walk(): void {
    while (this.#index < this.tokens.length) {
      const token = this.tokens[this.#index];
      if (token === undefined) break;
      this.#index += 1;
      this.#block(token);
    }
  }

  /** The indent the current nesting of lists and quotations puts a block at. */
  get #indent(): number {
    return (this.#lists.length + this.#quoteDepth) * INDENT;
  }

  #block(token: MarkdownToken): void {
    switch (token.type) {
      case 'heading_open': {
        const level = Number.parseInt(token.tag.slice(1), 10);
        const style = HEADING[Math.min(Math.max(level, 1), 6) - 1] ?? HEADING[3];
        const inline = this.#takeInline();
        if (inline === null || style === undefined) return;
        this.writer.gap(style.leading / 2);
        this.#paragraph(inline, { bold: true, italic: false }, style.size, style.leading, lineOf(token));
        this.writer.gap(BLOCK_GAP);
        return;
      }
      case 'paragraph_open': {
        const inline = this.#takeInline();
        if (inline === null) return;
        this.#paragraph(inline, { bold: false, italic: false }, BODY_SIZE, BODY_LEADING, lineOf(token));
        // A PARAGRAPH INSIDE A LIST ITEM keeps the items together; the gap belongs
        // after the list, not between its items.
        if (this.#lists.length === 0) this.writer.gap(BLOCK_GAP);
        return;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const start = Number(token.attrGet('start') ?? 1);
        this.#lists.push({
          ordered: token.type === 'ordered_list_open',
          next: Number.isFinite(start) ? start : 1,
        });
        return;
      }
      case 'bullet_list_close':
      case 'ordered_list_close':
        this.#lists.pop();
        if (this.#lists.length === 0) this.writer.gap(BLOCK_GAP);
        return;
      case 'list_item_open':
        this.#pendingMarker = this.#marker();
        return;
      case 'blockquote_open':
        this.#quoteDepth += 1;
        return;
      case 'blockquote_close':
        this.#quoteDepth -= 1;
        this.writer.gap(BLOCK_GAP);
        return;
      case 'fence':
      case 'code_block':
        this.#code(token.content, lineOf(token));
        this.writer.gap(BLOCK_GAP);
        return;
      case 'hr':
        this.writer.rule();
        return;
      case 'table_open':
        this.#table(lineOf(token));
        this.writer.gap(BLOCK_GAP);
        return;
      default:
        return;
    }
  }

  /** The marker the next list item's first line carries, set in the hanging indent. */
  #pendingMarker: string | null = null;

  #marker(): string {
    const list = this.#lists[this.#lists.length - 1];
    if (list === undefined) return '';
    if (!list.ordered) return '•';
    const marker = `${String(list.next)}.`;
    list.next += 1;
    return marker;
  }

  /** The inline token that follows an open tag, consuming it and its close. */
  #takeInline(): MarkdownToken | null {
    const inline = this.tokens[this.#index];
    if (inline?.type !== 'inline') return null;
    this.#index += 2;
    return inline;
  }

  #paragraph(
    inline: MarkdownToken,
    base: InlineStyle,
    size: number,
    leading: number,
    sourceLine: number | null,
  ): void {
    const runs = inlineRuns(inline.children ?? [], base, this.faces, size);
    const indent = this.#indent;
    const lines = wrap(runs, this.writer.room(indent), leading, sourceLine);
    const marker = this.#pendingMarker;
    this.#pendingMarker = null;
    lines.forEach((line, at) => {
      const placed = this.writer.line(line, indent);
      if (this.#quoteDepth > 0) this.writer.bar(placed.page, indent, placed.baseline, leading);
      if (at === 0 && marker !== null && marker !== '') {
        const markerRun = checked({ text: marker, font: this.faces.regular, size }, sourceLine);
        const width = markerRun.font.widthOfTextAtSize(markerRun.text, size);
        placed.page.drawText(markerRun.text, {
          x: MARGIN + indent - width - 4,
          y: placed.baseline,
          size,
          font: markerRun.font,
        });
      }
    });
  }

  #code(content: string, sourceLine: number | null): void {
    const indent = this.#indent + INDENT / 2;
    const room = this.writer.room(indent);
    const expanded = content.replaceAll('\t', ' '.repeat(TAB_SPACES));
    const sourceLines = expanded.endsWith('\n') ? expanded.slice(0, -1).split('\n') : expanded.split('\n');
    sourceLines.forEach((text, offset) => {
      const line = sourceLine === null ? null : sourceLine + offset + 1;
      const run = checked({ text, font: this.faces.mono, size: CODE_SIZE }, line);
      for (const piece of breakByWidth(run, room)) {
        this.writer.line({ runs: [piece], leading: CODE_LEADING }, indent);
      }
    });
  }

  /**
   * A table, as rows of equal-width cells whose text wraps within the cell.
   *
   * Equal widths rather than widths fitted to content: a fitted layout needs a
   * measuring pass over every cell first, and a column squeezed to its widest word
   * is still wrong for the next row. Header cells are set bold.
   */
  #table(sourceLine: number | null): void {
    const rows: { header: boolean; cells: MarkdownToken[] }[] = [];
    let current: { header: boolean; cells: MarkdownToken[] } | null = null;
    let inHead = false;
    while (this.#index < this.tokens.length) {
      const token = this.tokens[this.#index];
      this.#index += 1;
      if (token === undefined || token.type === 'table_close') break;
      if (token.type === 'thead_open') inHead = true;
      if (token.type === 'thead_close') inHead = false;
      if (token.type === 'tr_open') current = { header: inHead, cells: [] };
      if (token.type === 'tr_close' && current !== null) {
        rows.push(current);
        current = null;
      }
      if (token.type === 'inline' && current !== null) current.cells.push(token);
    }

    const columns = rows.reduce((most, row) => Math.max(most, row.cells.length), 0);
    if (columns === 0) return;
    const indent = this.#indent;
    const cellWidth = this.writer.room(indent) / columns;
    const padding = 4;

    for (const row of rows) {
      const cellLines = row.cells.map((cell) =>
        wrap(
          inlineRuns(cell.children ?? [], { bold: row.header, italic: false }, this.faces, BODY_SIZE),
          cellWidth - 2 * padding,
          BODY_LEADING,
          sourceLine,
        ),
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
            runs.push({ text: '', font: this.faces.regular, size: BODY_SIZE });
            runs.push(spacer(this.faces.regular, target - used));
            used = target;
          }
          for (const run of lines[at]?.runs ?? []) {
            runs.push(run);
            used += run.font.widthOfTextAtSize(run.text, run.size);
          }
        });
        this.writer.line({ runs, leading: BODY_LEADING }, indent);
      }
      this.writer.gap(2);
    }
    void this.size;
  }
}

/** The one-based source line a block token starts on, where the parser recorded one. */
function lineOf(token: MarkdownToken): number | null {
  return token.map === null ? null : token.map[0] + 1;
}

/**
 * A run of spaces that advances approximately `points`, set in the regular face.
 *
 * Approximate by at most one space's width, which is the resolution a column
 * start needs — the next cell begins at the next space boundary past its edge.
 */
function spacer(font: PDFFont, points: number): Run {
  const space = font.widthOfTextAtSize(' ', BODY_SIZE);
  const count = space <= 0 ? 0 : Math.ceil(points / space);
  return { text: ' '.repeat(count), font, size: BODY_SIZE };
}

/** The face an inline style is set in. */
function faceFor(style: InlineStyle, faces: Faces): PDFFont {
  if (style.bold && style.italic) return faces.boldItalic;
  if (style.bold) return faces.bold;
  if (style.italic) return faces.italic;
  return faces.regular;
}

/**
 * Turns an inline token's children into runs.
 *
 * A soft break is a space and a hard break is kept as a run of its own, which
 * {@link wrap} ends the line on. A link is its text, followed by its address in
 * parentheses when the two differ — the address is part of what the author wrote,
 * and a PDF reader of the composed document has no other way to see it.
 */
function inlineRuns(
  children: readonly MarkdownToken[],
  base: InlineStyle,
  faces: Faces,
  size: number,
): Run[] {
  const runs: Run[] = [];
  let style = base;
  let href: string | null = null;
  let linkText = '';
  for (const child of children) {
    switch (child.type) {
      case 'text':
        runs.push({ text: child.content, font: faceFor(style, faces), size });
        if (href !== null) linkText += child.content;
        break;
      case 'code_inline':
        runs.push({ text: child.content, font: faces.mono, size });
        if (href !== null) linkText += child.content;
        break;
      case 'softbreak':
        runs.push({ text: ' ', font: faceFor(style, faces), size });
        break;
      case 'hardbreak':
        runs.push(HARD_BREAK(faces, size));
        break;
      case 'strong_open':
        style = { ...style, bold: true };
        break;
      case 'strong_close':
        style = { ...style, bold: base.bold };
        break;
      case 'em_open':
        style = { ...style, italic: true };
        break;
      case 'em_close':
        style = { ...style, italic: base.italic };
        break;
      case 'link_open':
        href = String(child.attrGet('href') ?? '');
        linkText = '';
        break;
      case 'link_close':
        if (href !== null && href !== '' && href !== linkText) {
          runs.push({ text: ` (${href})`, font: faceFor(style, faces), size });
        }
        href = null;
        break;
      case 'image': {
        const alt = child.content === '' ? 'image' : child.content;
        runs.push({ text: `[image: ${alt}]`, font: faces.italic, size });
        break;
      }
      default:
        break;
    }
  }
  return runs;
}

/** The marker a hard break is carried as through {@link wrap}. */
const HARD_BREAK = (faces: Faces, size: number): Run => ({ text: '\n', font: faces.regular, size });

/**
 * Refuses a run holding a character its face cannot encode, naming the source line.
 *
 * The face's own character set is the authority, as in `documentSign.ts`: pdf-lib
 * would otherwise throw a message about glyphs nobody can act on, or — for a code
 * point it maps — draw a different character.
 */
function checked(run: Run, sourceLine: number | null): Run {
  const encodable = characterSet(run.font);
  for (const character of run.text) {
    if (!encodable.has(character.codePointAt(0) ?? -1)) {
      const where = sourceLine === null ? '' : ` on line ${String(sourceLine)}`;
      throw new MarkdownComposeRefused(
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
 * A single word wider than the room is broken by characters rather than allowed to
 * overhang the margin, because text past the page edge is text a reader of the
 * composed document never sees.
 */
function wrap(runs: readonly Run[], room: number, leading: number, sourceLine: number | null): Line[] {
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
function breakByWidth(run: Run, room: number): Run[] {
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
