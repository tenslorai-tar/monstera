import { PDFDocument } from '@cantoo/pdf-lib';
import MarkdownIt, { type Token as MarkdownToken } from 'markdown-it';

import { ComposeFonts, type FaceRole } from './composeFonts.js';
import { BODY_LEADING, BODY_SIZE, MARGIN, PageWriter, type Run, wrap } from './composeLayout.js';
import {
  type ComposePageSize,
  ComposeRefused,
  type ComposedSource,
  type SourceBlock,
  boxedPositions,
} from './composeOutcome.js';
import { type TableRow, drawTable } from './composeTable.js';
import type { FaceSource } from './fontCatalogue.js';

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
 * ## Every character is drawn, and a missing one is SAID
 *
 * The text is set in the bundled faces and any face the catalogue holds that carries a word
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)),
 * so nothing a person wrote is refused for its characters. A character no face carries is drawn as a box that copies
 * as the character, and the composition answers where each one is in the source — its line and its column — so the
 * person is told which characters and where, rather than finding boxes later.
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
 * quotations are Markdown's. The page writer, wrapping and the table layout are
 * `composeLayout.ts`' and `composeTable.ts`', because a CSV table sets the same rows.
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

/** How far a list item's marker ends before its text. */
const MARKER_GAP = 4;

/** A tab in code is set as this many spaces: a tab is a movement to a stop, and no font draws one. */
const TAB_SPACES = 4;

/**
 * Sets a Markdown source as a new PDF, answering its bytes and every character drawn as the box.
 *
 * @param source the file's bytes, exactly as picked
 * @param page the size every page is set at
 * @param faces the catalogue the text is set from
 * @throws ComposeRefused for a source that is not UTF-8 or draws nothing at all
 */
export async function composeMarkdown(
  source: Uint8Array,
  page: ComposePageSize,
  faces: FaceSource,
): Promise<ComposedSource> {
  let text: string;
  try {
    // FATAL, so a byte sequence that is not UTF-8 is refused by name rather than
    // decoded into replacement characters that would be drawn as though the file said them.
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    throw new ComposeRefused('not-utf8', null, 'the source is not UTF-8 text');
  }

  const tokens = new MarkdownIt().parse(text, {});

  // PINNED, for `monstera/no-unpinned-pdf-load`'s reason: pdf-lib stamps the
  // creation and modification dates by default, and a composition that differed
  // on every run could not be compared with itself.
  const document = await PDFDocument.create({ updateMetadata: false });
  const fonts = new ComposeFonts(document, faces);
  const writer = new PageWriter(document, fonts, page);
  const walker = new BlockWalker(tokens, writer);
  walker.walk();

  if (!writer.drewAnything) {
    throw new ComposeRefused(
      'nothing-to-draw',
      null,
      'the source holds no text to set, so a composed document would be blank',
    );
  }
  fonts.finish();
  return { pdf: await document.save(), boxed: boxedPositions(text, fonts.boxed, walker.blocks) };
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
  /** Every block set, by the line its runs report: the lines it spans, which a box in it is searched for in. */
  readonly blocks = new Map<number, SourceBlock>();

  constructor(
    private readonly tokens: readonly MarkdownToken[],
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

  /**
   * The one-based line a block starts on, recorded with the lines it spans. `markdown-it`'s `map` is the block's
   * first line and the line after its last, both zero-based.
   */
  #lineOf(token: MarkdownToken): number | null {
    if (token.map === null) return null;
    const [first, after] = token.map;
    this.blocks.set(first + 1, { from: first + 1, to: Math.max(first + 1, after) });
    return first + 1;
  }

  #block(token: MarkdownToken): void {
    switch (token.type) {
      case 'heading_open': {
        const level = Number.parseInt(token.tag.slice(1), 10);
        const style = HEADING[Math.min(Math.max(level, 1), 6) - 1] ?? HEADING[3];
        const line = this.#lineOf(token);
        const inline = this.#takeInline();
        if (inline === null || style === undefined) return;
        this.writer.gap(style.leading / 2);
        this.#paragraph(inline, { bold: true, italic: false }, style.size, style.leading, line);
        this.writer.gap(BLOCK_GAP);
        return;
      }
      case 'paragraph_open': {
        const line = this.#lineOf(token);
        const inline = this.#takeInline();
        if (inline === null) return;
        this.#paragraph(inline, { bold: false, italic: false }, BODY_SIZE, BODY_LEADING, line);
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
      case 'code_block': {
        // A FENCE'S FIRST LINE IS THE FENCE, so its code starts on the line after; an indented block's first line is
        // its code.
        const line = token.map === null ? null : token.map[0] + (token.type === 'fence' ? 2 : 1);
        this.#code(token.content, line);
        this.writer.gap(BLOCK_GAP);
        return;
      }
      case 'hr':
        this.writer.rule();
        return;
      case 'table_open':
        this.#table(this.#lineOf(token));
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
    const runs = inlineRuns(inline.children ?? [], base, size, sourceLine);
    const indent = this.#indent;
    const lines = wrap(runs, this.writer.room(indent), leading, this.writer.fonts);
    const marker = this.#pendingMarker;
    this.#pendingMarker = null;
    lines.forEach((line, at) => {
      const placed = this.writer.line(line, indent);
      if (this.#quoteDepth > 0) this.writer.bar(placed.page, indent, placed.baseline, leading, INDENT);
      if (at === 0 && marker !== null && marker !== '') {
        this.writer.marker(placed.page, marker, 'regular', size, MARGIN + indent - MARKER_GAP, placed.baseline, sourceLine);
      }
    });
  }

  /**
   * A block of code, each of its lines its own paragraph, broken only where a line is wider than the page and then
   * between graphemes — code's spaces are its meaning, so it is never wrapped between words.
   *
   * @param firstLine the one-based source line the code's first line is on
   */
  #code(content: string, firstLine: number | null): void {
    const indent = this.#indent + INDENT / 2;
    const room = this.writer.room(indent);
    const expanded = content.replaceAll('\t', ' '.repeat(TAB_SPACES));
    const sourceLines = expanded.endsWith('\n') ? expanded.slice(0, -1).split('\n') : expanded.split('\n');
    sourceLines.forEach((text, offset) => {
      const line = firstLine === null ? null : firstLine + offset;
      if (line !== null) this.blocks.set(line, { from: line, to: line });
      const run: Run = { text, role: 'mono', size: CODE_SIZE, line };
      for (const piece of wrap([run], room, CODE_LEADING, this.writer.fonts, 'graphemes')) {
        this.writer.line(piece, indent);
      }
    });
  }

  /**
   * A table's rows, read out of the tokens and set by `composeTable.ts`' `drawTable`.
   *
   * Header cells are set bold. Every cell carries the table's opening line, which is
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
        rows.push({ header: current.header, cells: current.cells });
        current = null;
      }
      if (token.type === 'inline' && current !== null) {
        current.cells.push(inlineRuns(token.children ?? [], { bold: current.header, italic: false }, BODY_SIZE, sourceLine));
      }
    }
    drawTable(rows, this.writer, this.#indent);
  }
}

/** The role an inline style is set in. */
function roleFor(style: InlineStyle): FaceRole {
  if (style.bold && style.italic) return 'boldItalic';
  if (style.bold) return 'bold';
  if (style.italic) return 'italic';
  return 'regular';
}

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
  size: number,
  line: number | null,
): Run[] {
  const runs: Run[] = [];
  let style = base;
  let href: string | null = null;
  let linkText = '';
  const push = (text: string, role: FaceRole): void => {
    runs.push({ text, role, size, line });
  };
  for (const child of children) {
    switch (child.type) {
      case 'text':
        push(child.content, roleFor(style));
        if (href !== null) linkText += child.content;
        break;
      case 'code_inline':
        push(child.content, 'mono');
        if (href !== null) linkText += child.content;
        break;
      case 'softbreak':
        push(' ', roleFor(style));
        break;
      case 'hardbreak':
        push('\n', 'regular');
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
        if (href !== null && href !== '' && href !== linkText) push(` (${href})`, roleFor(style));
        href = null;
        break;
      case 'image': {
        const alt = child.content === '' ? 'image' : child.content;
        push(`[image: ${alt}]`, 'italic');
        break;
      }
      default:
        break;
    }
  }
  return runs;
}
