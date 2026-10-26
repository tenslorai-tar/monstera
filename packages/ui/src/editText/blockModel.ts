import type { BlockFormatting, BlockMarkSet, ParagraphProps, TextBlockStyle } from '@monstera/contract';
import { joinAfterLine, lineText, paragraphEdges } from '@monstera/shared';

import type { Model, Paragraph, ParagraphSetting, Run, RunStyle } from '../editorKit/model.js';
import type { TextBlock } from '../textBlock.js';
import { wordsOfBlock } from '../textBlockOps.js';

/**
 * Edit text's side of the editor kit
 * ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 5): a block
 * as the page read it turned into the kit's model, and the model turned back into the writer's existing wire — the words,
 * the marks over them and the paragraphs the person set (`editTextBlock`'s `text` and `formatting`). The writer is
 * unchanged by the kit, so this is the whole of what the kit says to it.
 *
 * ## A mark says only what the person changed
 *
 * Each run keeps the page's style it came from as its `base` (`Run.base`), so a letter is marked only where its style now
 * differs from that, and only in the properties that differ. A mark over words as the page has them says nothing, and
 * the writer refuses an edit that changes nothing.
 *
 * ## The words are the kernel's own join
 *
 * {@link modelOfBlock}'s text is `wordsOfBlock`'s, line for line — one space where a line ended in a soft wrap, nothing
 * where it already ended in one, a paragraph where it ended on purpose (`joinAfterLine`) — because the kernel diffs the
 * words it is sent against exactly that join, and every offset after a disagreement would name the wrong letter (B3a).
 */

/** The face a run of no named font is drawn and kept in: its kind, the one thing the page says of it. */
export function kindFace(style: Pick<TextBlockStyle, 'serif' | 'mono'>): string {
  return style.mono ? KIND_FACES.mono : style.serif ? KIND_FACES.serif : KIND_FACES.sans;
}

/** The faces that name a kind rather than a font: never written as a family, since the resolver knows no such family. */
export const KIND_FACES = { serif: 'kind:serif', sans: 'kind:sans', mono: 'kind:mono' } as const;

/** Whether a face is one of {@link KIND_FACES}. */
export function isKindFace(face: string): boolean {
  return face.startsWith('kind:');
}

/** How a run the page read is set, as the kit holds it. */
export function runStyleOf(style: TextBlockStyle): RunStyle {
  return {
    face: style.font ?? kindFace(style),
    size: style.size,
    colour: style.colour,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline === true,
    strike: style.strike === true,
    rise: 'none',
    lift: style.rise ?? 0,
    spacing: 0,
    highlight: style.highlight ?? null,
  };
}

/** A block opened: the model, and for each paragraph the offsets at which the page broke its lines. */
export interface OpenedBlock {
  readonly model: Model;
  /**
   * Where the page ended each line of each paragraph but the last, as an offset into the paragraph's words: a paragraph
   * nobody changed is laid out at these breaks, so its lines are where the page drew them.
   */
  readonly wraps: readonly (readonly number[])[];
}

/** A block's lines, grouped into paragraphs: a line ending soft carries on in the next. */
function linesByParagraph(block: TextBlock): TextBlock['lines'][number][][] {
  const paragraphs: TextBlock['lines'][number][][] = [];
  let open: TextBlock['lines'][number][] = [];
  for (const [at, line] of block.lines.entries()) {
    open.push(line);
    if (!line.soft || at === block.lines.length - 1) {
      paragraphs.push(open);
      open = [];
    }
  }
  return paragraphs;
}

/**
 * The block as the kit's model: a paragraph per hard break, a run per page run in its own style and base, the space a
 * soft wrap stands for in the style of the run before it; each paragraph at its own edges on the page (`paragraphEdges`,
 * the function the writer sets it with), and aligned as the block is.
 */
export function modelOfBlock(block: TextBlock): OpenedBlock {
  const edges =
    block.shape.align === 'left'
      ? paragraphEdges(
          block.lines.map((line) => ({ x0: line.box.x0, x1: line.box.x1, characters: lineText(line.runs).length })),
          block.lines.map((line) => line.soft),
        )
      : [];
  const wraps: number[][] = [];
  const grouped = linesByParagraph(block);
  const [firstLine, secondLine] = block.lines;
  const pitch = firstLine !== undefined && secondLine !== undefined && firstLine.baseline > secondLine.baseline ? firstLine.baseline - secondLine.baseline : undefined;
  const paragraphs = grouped.map((lines, place): Paragraph => {
    const runs: Run[] = [];
    const breaks: number[] = [];
    let length = 0;
    for (const [at, line] of lines.entries()) {
      for (const run of line.runs) {
        const style = runStyleOf(run.style);
        runs.push({ text: run.text, style, base: style });
        length += run.text.length;
      }
      if (at === lines.length - 1) continue;
      const join = joinAfterLine(lineText(line.runs), true);
      const last = line.runs.at(-1);
      if (join !== '' && last !== undefined) {
        const style = runStyleOf(last.style);
        runs.push({ text: join, style, base: style });
        length += join.length;
      }
      breaks.push(length);
    }
    wraps.push(breaks);
    const edge = edges[place];
    // THE SPACE THE PAGE LEAVES ABOVE THE PARAGRAPH beyond the block's even pitch: its first baseline less where the lines
    // above, set at the pitch, would put it. Measured 2026-10-24 on a contract clause of three numbered paragraphs, whose
    // baselines were 700, 686, 669, 655 and 636 against an even 700 to 644: without it the editor ended 8 points above the
    // page's last line (the editor this kit replaces, `paragraphPlaces`).
    const above = grouped[place - 1];
    const lead = lines[0];
    const spaceBefore = pitch === undefined || above?.[0] === undefined || lead === undefined ? 0 : above[0].baseline - above.length * pitch - lead.baseline;
    const setting: ParagraphSetting = {
      align: block.shape.align,
      lineSpacing: 1,
      spaceBefore,
      spaceAfter: 0,
      firstIndent: edge === undefined ? 0 : edge.firstIndent,
      leftIndent: edge === undefined ? 0 : Math.max(0, edge.left - block.box.x0),
    };
    const blockStyle = runStyleOf(block.style);
    return { ...setting, base: setting, runs: runs.length === 0 ? [{ text: '', style: blockStyle, base: blockStyle }] : runs };
  });
  const model: Model = { paragraphs };
  return { model, wraps };
}

/** Whether `opened`'s words are the kernel's join of the block's: the check {@link modelOfBlock} exists to pass. */
export function joinsAsTheKernelDoes(block: TextBlock, opened: OpenedBlock): boolean {
  return opened.model.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') === wordsOfBlock(block);
}

/** What a letter's style says beyond its base: the properties the person changed, by the contract's names. */
export function changedFrom(style: RunStyle, was: RunStyle | undefined): BlockMarkSet {
  const set: { -readonly [K in keyof BlockMarkSet]: BlockMarkSet[K] } = {};
  if (style.bold !== was?.bold) set.bold = style.bold;
  if (style.italic !== was?.italic) set.italic = style.italic;
  if (style.underline !== was?.underline) set.underline = style.underline;
  if (style.strike !== was?.strike) set.strike = style.strike;
  if (style.size !== was?.size) set.size = style.size;
  if (!sameRgb(style.colour, was?.colour)) set.colour = style.colour;
  // NO HIGHLIGHT where nothing was known of one says nothing; one taken off a run that had one is `null`.
  if (!sameRgb(style.highlight, was === undefined ? null : was.highlight)) set.highlight = style.highlight;
  if (style.spacing !== (was?.spacing ?? 0)) set.spacing = style.spacing;
  if (style.rise !== 'none' && style.rise !== was?.rise) set.rise = style.rise;
  // A FACE OF A KIND is not a family the resolver knows: the letters keep the page's, and nothing names it.
  if (style.face !== was?.face && !isKindFace(style.face)) set.family = style.face;
  return set;
}

/** Whether two colours are one, `null` being none and `undefined` unknown. */
function sameRgb(a: RunStyle['highlight'] | undefined, b: RunStyle['highlight'] | undefined): boolean {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/** The paragraph settings that differ from how the paragraph was found: what the person set, and nothing else. */
function settingChanged(paragraph: Paragraph): Omit<ParagraphProps, 'block' | 'paragraph'> {
  const was = paragraph.base;
  const changed: { -readonly [K in keyof Omit<ParagraphProps, 'block' | 'paragraph'>]?: ParagraphProps[K] } = {};
  if (paragraph.align !== was?.align) changed.align = paragraph.align;
  if (paragraph.lineSpacing !== was?.lineSpacing) changed.lineSpacing = paragraph.lineSpacing;
  if (paragraph.spaceBefore !== was?.spaceBefore) changed.spaceBefore = paragraph.spaceBefore;
  if (paragraph.spaceAfter !== was?.spaceAfter) changed.spaceAfter = paragraph.spaceAfter;
  if (paragraph.firstIndent !== was?.firstIndent || paragraph.leftIndent !== was.leftIndent) {
    // THE TWO INDENTS TOGETHER: the writer reads a left indent the person set as where the first line goes too, so one
    // without the other would move a line the person did not.
    changed.firstIndent = paragraph.firstIndent;
    changed.leftIndent = paragraph.leftIndent;
  }
  return changed;
}

/** The model as the writer's wire: its words, a mark per span of letters the person changed alike, and the paragraphs set. */
export function editOf(model: Model): { readonly text: string; readonly formatting: BlockFormatting } {
  const marks: { from: number; to: number; set: BlockMarkSet }[] = [];
  const settings: Omit<ParagraphProps, 'block'>[] = [];
  let text = '';
  for (const [place, paragraph] of model.paragraphs.entries()) {
    if (place > 0) text += '\n';
    for (const run of paragraph.runs) {
      const from = text.length;
      text += run.text;
      if (run.text === '') continue;
      const set = changedFrom(run.style, run.base);
      if (Object.keys(set).length === 0) continue;
      const last = marks.at(-1);
      // ADJACENT LETTERS CHANGED ALIKE are one mark, however many runs the editing left them in.
      if (last?.to === from && JSON.stringify(last.set) === JSON.stringify(set)) last.to = text.length;
      else marks.push({ from, to: text.length, set });
    }
    const changed = settingChanged(paragraph);
    if (Object.keys(changed).length > 0) settings.push({ paragraph: place, ...changed });
  }
  return { text, formatting: { ...(marks.length === 0 ? {} : { marks }), ...(settings.length === 0 ? {} : { paragraphs: settings }) } };
}
