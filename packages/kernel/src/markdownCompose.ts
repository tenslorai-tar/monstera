import { PDFDocument, type PDFFont } from '@cantoo/pdf-lib';
import MarkdownIt, { type Token as MarkdownToken } from 'markdown-it';

import {
  BODY_LEADING,
  BODY_SIZE,
  type ComposePageSize,
  ComposeRefused,
  type Faces,
  MARGIN,
  PageWriter,
  type Run,
  type TableRow,
  breakByWidth,
  checked,
  drawTable,
  embedFaces,
  wrap,
} from './composeLayout.js';

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
 * So the font's own character set is asked first — `composeLayout.ts`' `checked`,
 * which every composer shares — and the refusal names the source line.
 *
 * ## An image is its ALT TEXT, and its path is never read
 *
 * A relative image path names a file beside the Markdown, which this process was
 * never handed and cannot reach — and reading it would be the reach invariant 25
 * forbids. The alt text is drawn in its place, marked as an image.
 *
 * ## What is this module's and what is shared
 *
 * The walk over `markdown-it`'s tokens, the inline styles, headings, lists, code and
 * quotations are Markdown's. The page writer, wrapping, the encodability refusal and
 * the table layout are `composeLayout.ts`', because a CSV table sets the same rows.
 */

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

/**
 * Sets a Markdown source as a new PDF, answering its bytes.
 *
 * @param source the file's bytes, exactly as picked
 * @param page the size every page is set at
 * @throws ComposeRefused for a source that is not UTF-8, holds a character the
 *   standard faces cannot draw, or draws nothing at all
 */
export async function composeMarkdown(source: Uint8Array, page: ComposePageSize): Promise<Uint8Array> {
  let text: string;
  try {
    // FATAL, so a byte sequence that is not UTF-8 is refused by name rather than
    // decoded into replacement characters that would then be refused as
    // unencodable — which would blame the font for the file's encoding.
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    throw new ComposeRefused('not-utf8', null, 'the source is not UTF-8 text');
  }

  const tokens = new MarkdownIt().parse(text, {});

  // PINNED, for `monstera/no-unpinned-pdf-load`'s reason: pdf-lib stamps the
  // creation and modification dates by default, and a composition that differed
  // on every run could not be compared with itself.
  const document = await PDFDocument.create({ updateMetadata: false });
  const faces = await embedFaces(document);

  const writer = new PageWriter(document, faces, page);
  new BlockWalker(tokens, faces, writer).walk();

  if (!writer.drewAnything) {
    throw new ComposeRefused(
      'nothing-to-draw',
      null,
      'the source holds no text to set, so a composed document would be blank',
    );
  }
  return document.save();
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
      if (this.#quoteDepth > 0) this.writer.bar(placed.page, indent, placed.baseline, leading, INDENT);
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
   * A table's rows, read out of the tokens and set by `composeLayout.ts`' `drawTable`.
   *
   * Header cells are set bold. Every row carries the table's opening line, which is
   * the line `markdown-it` records for the table block.
   */
  #table(sourceLine: number | null): void {
    const rows: TableRow[] = [];
    let current: { header: boolean; cells: (readonly Run[])[] } | null = null;
    let inHead = false;
    while (this.#index < this.tokens.length) {
      const token = this.tokens[this.#index];
      this.#index += 1;
      if (token === undefined || token.type === 'table_close') break;
      if (token.type === 'thead_open') inHead = true;
      if (token.type === 'thead_close') inHead = false;
      if (token.type === 'tr_open') current = { header: inHead, cells: [] };
      if (token.type === 'tr_close' && current !== null) {
        rows.push({ header: current.header, cells: current.cells, sourceLine });
        current = null;
      }
      if (token.type === 'inline' && current !== null) {
        current.cells.push(
          inlineRuns(token.children ?? [], { bold: current.header, italic: false }, this.faces, BODY_SIZE),
        );
      }
    }
    drawTable(rows, this.writer, this.faces, this.#indent);
  }
}

/** The one-based source line a block token starts on, where the parser recorded one. */
function lineOf(token: MarkdownToken): number | null {
  return token.map === null ? null : token.map[0] + 1;
}

/** The face an inline style is set in. */
function faceFor(style: InlineStyle, faces: Faces): PDFFont {
  if (style.bold && style.italic) return faces.boldItalic;
  if (style.bold) return faces.bold;
  if (style.italic) return faces.italic;
  return faces.regular;
}

/** The marker a hard break is carried as through `wrap`. */
const HARD_BREAK = (faces: Faces, size: number): Run => ({ text: '\n', font: faces.regular, size });

/**
 * Turns an inline token's children into runs.
 *
 * A soft break is a space and a hard break is kept as a run of its own, which
 * `wrap` ends the line on. A link is its text, followed by its address in
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
