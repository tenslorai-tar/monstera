/**
 * The editor kit's model ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)
 * section 5): a block of paragraphs, each a list of runs of text in one style. Plain data and pure functions — no DOM,
 * no engine, nothing about where the block came from — so Edit text, Text box, Typewriter and callouts can all hold their
 * words in it, and every operation a person performs is a unit-tested function from one model to the next.
 *
 * ## Positions
 *
 * A position is a paragraph and a UTF-16 offset into that paragraph's text, which is what the browser's selection and the
 * contract's marks both count in. Deletion moves by GRAPHEME (`Intl.Segmenter`), so a letter with its accent, an emoji or
 * a pair of surrogates is removed whole, never split.
 *
 * ## A run is kept only where its style differs
 *
 * Every operation ends in {@link normalised}: adjacent runs of one style are joined and empty runs dropped, except the one
 * an empty paragraph keeps so that its style survives (a person who empties a heading and types gets heading letters).
 * Two models with the same words in the same styles are therefore equal as data, which is what undo and "unchanged"
 * compare.
 */

/** A colour, 0 to 255 per channel. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** How a run's letters are set. `face` is opaque to the kit: the caller's name for a face it can draw and write. */
export interface RunStyle {
  readonly face: string;
  readonly size: number;
  readonly colour: Rgb;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  /** A superscript or subscript the person chose; the page's own raise of a run is {@link RunStyle.lift}. */
  readonly rise: 'none' | 'superscript' | 'subscript';
  /** How far, in points, the page raises the run's baseline off its line (negative lowers it): drawn, never chosen. */
  readonly lift: number;
  /** Space added after each character, as a fraction of the size. */
  readonly spacing: number;
  readonly highlight: Rgb | null;
}

/**
 * Letters in one style. `base`, where the caller gives one, is the style the letters ARE where nobody changed them —
 * the page's run they came from, or the run they were typed into — so a caller can say what the person changed and
 * nothing else: a mark over words that are as the page has them says nothing, and the writer refuses an edit that
 * changes nothing (the editor this kit replaces paid for that as VVVVVVV-16).
 */
export interface Run {
  readonly text: string;
  readonly style: RunStyle;
  readonly base?: RunStyle;
}

export type Alignment = 'left' | 'center' | 'right' | 'justify';

/** How a paragraph is set. Line spacing is a multiple of the paragraph's own pitch; the rest are points. */
export interface ParagraphSetting {
  readonly align: Alignment;
  readonly lineSpacing: number;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  readonly firstIndent: number;
  readonly leftIndent: number;
}

/** A paragraph; `base` is how it is set where nobody changed it, for the reason {@link Run.base} is. */
export interface Paragraph extends ParagraphSetting {
  readonly runs: readonly Run[];
  readonly base?: ParagraphSetting;
}

export interface Model {
  readonly paragraphs: readonly Paragraph[];
}

export interface Position {
  readonly paragraph: number;
  readonly offset: number;
}

/** Where a selection began (`anchor`) and where it now ends (`focus`); collapsed is the caret. */
export interface Selection {
  readonly anchor: Position;
  readonly focus: Position;
}

/** A model and where the caret or selection is in it: what every editing operation returns. */
export interface Edited {
  readonly model: Model;
  readonly selection: Selection;
}

const SAME_COLOUR = (a: Rgb | null, b: Rgb | null): boolean =>
  a === b || (a !== null && b !== null && a.r === b.r && a.g === b.g && a.b === b.b);

/** Whether two styles set letters alike. */
export function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return (
    a.face === b.face &&
    a.size === b.size &&
    SAME_COLOUR(a.colour, b.colour) &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.rise === b.rise &&
    a.lift === b.lift &&
    a.spacing === b.spacing &&
    SAME_COLOUR(a.highlight, b.highlight)
  );
}

/** Whether two runs may be one: the same style, and the same base or none. */
function sameRun(a: Run, b: Run): boolean {
  return sameStyle(a.style, b.style) && (a.base === b.base || (a.base !== undefined && b.base !== undefined && sameStyle(a.base, b.base)));
}

export function paragraphText(paragraph: Paragraph): string {
  return paragraph.runs.map((run) => run.text).join('');
}

/** The block's words, paragraphs parted by a line feed: what a copy of the whole block gives and what a caller writes. */
export function modelText(model: Model): string {
  return model.paragraphs.map(paragraphText).join('\n');
}

/** A paragraph with adjacent runs of one style joined and empty runs dropped, one kept where it has no text. */
export function normalised(paragraph: Paragraph): Paragraph {
  const runs: Run[] = [];
  for (const run of paragraph.runs) {
    const last = runs[runs.length - 1];
    if (run.text === '') continue;
    if (last !== undefined && sameRun(last, run)) runs[runs.length - 1] = { ...last, text: last.text + run.text };
    else runs.push(run);
  }
  const first = paragraph.runs[0];
  if (runs.length === 0 && first !== undefined) runs.push({ ...first, text: '' });
  return { ...paragraph, runs };
}

export function comparePositions(a: Position, b: Position): number {
  return a.paragraph === b.paragraph ? a.offset - b.offset : a.paragraph - b.paragraph;
}

export function isCollapsed(selection: Selection): boolean {
  return comparePositions(selection.anchor, selection.focus) === 0;
}

/** The selection's two ends, first one first. */
export function ordered(selection: Selection): { readonly from: Position; readonly to: Position } {
  return comparePositions(selection.anchor, selection.focus) <= 0
    ? { from: selection.anchor, to: selection.focus }
    : { from: selection.focus, to: selection.anchor };
}

export function caret(position: Position): Selection {
  return { anchor: position, focus: position };
}

/** A position held inside the model: a paragraph that exists, an offset within its text. */
export function clamped(model: Model, position: Position): Position {
  const paragraph = Math.max(0, Math.min(model.paragraphs.length - 1, position.paragraph));
  const length = paragraphText(paragraphAt(model, paragraph)).length;
  return { paragraph, offset: Math.max(0, Math.min(length, position.offset)) };
}

function paragraphAt(model: Model, index: number): Paragraph {
  const paragraph = model.paragraphs[index];
  if (paragraph === undefined) throw new Error(`the model has no paragraph ${String(index)}`);
  return paragraph;
}

/** A paragraph's runs cut in two at `offset`. */
function splitRuns(paragraph: Paragraph, offset: number): { readonly before: Run[]; readonly after: Run[] } {
  const before: Run[] = [];
  const after: Run[] = [];
  let at = 0;
  for (const run of paragraph.runs) {
    const end = at + run.text.length;
    if (end <= offset) before.push(run);
    else if (at >= offset) after.push(run);
    else {
      before.push({ ...run, text: run.text.slice(0, offset - at) });
      after.push({ ...run, text: run.text.slice(offset - at) });
    }
    at = end;
  }
  return { before, after };
}

/**
 * The run a letter typed at `position` joins: the letter before it in its paragraph, or at a paragraph's start the letter
 * after it — as a word processor does, so typing at the end of a bold word continues bold.
 */
function runAt(model: Model, position: Position): Run {
  const paragraph = paragraphAt(model, position.paragraph);
  let at = 0;
  let found: Run | undefined;
  for (const run of paragraph.runs) {
    const end = at + run.text.length;
    if (position.offset > at && position.offset <= end) found = run;
    at = end;
  }
  const first = paragraph.runs[0];
  if (found !== undefined) return found;
  if (first !== undefined) return first;
  throw new Error(`paragraph ${String(position.paragraph)} has no run to take a style from`);
}

/** The style a letter typed at `position` takes ({@link runAt}). */
export function styleAt(model: Model, position: Position): RunStyle {
  return runAt(model, position).style;
}

/**
 * `from` to `to` replaced by `text`, its letters in `style` over the base of the run they join; a line feed in `text`
 * parts a paragraph, the new paragraph set as the one it was parted from. The caret ends after the inserted text.
 */
export function replaceRange(model: Model, from: Position, to: Position, text: string, style: RunStyle): Edited {
  const start = paragraphAt(model, from.paragraph);
  const end = paragraphAt(model, to.paragraph);
  const head = splitRuns(start, from.offset).before;
  const tail = splitRuns(end, to.offset).after;
  const { base } = runAt(model, from);
  const pieces = text.replace(/\r\n?/gu, '\n').split('\n');
  const made: Paragraph[] = pieces.map((piece, k) => {
    const runs: Run[] = [];
    if (k === 0) runs.push(...head);
    runs.push(base === undefined ? { text: piece, style } : { text: piece, style, base });
    if (k === pieces.length - 1) runs.push(...tail);
    // A PARAGRAPH PARTED OFF is set as the one it came from, as a word processor's Enter keeps the paragraph's setting.
    return normalised({ ...start, runs });
  });
  const paragraphs = [...model.paragraphs.slice(0, from.paragraph), ...made, ...model.paragraphs.slice(to.paragraph + 1)];
  const lastPiece = pieces[pieces.length - 1] ?? '';
  const landed: Position = {
    paragraph: from.paragraph + pieces.length - 1,
    offset: (pieces.length === 1 ? from.offset : 0) + lastPiece.length,
  };
  return { model: { paragraphs }, selection: caret(landed) };
}

/** `text` typed over the selection, in `pending` where the person chose a style for the next letters, else as at the caret. */
export function insertText(model: Model, selection: Selection, text: string, pending?: RunStyle): Edited {
  const { from, to } = ordered(selection);
  return replaceRange(model, from, to, text, pending ?? styleAt(model, from));
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The offset one grapheme before or after `offset` in `text`. */
function graphemeStep(text: string, offset: number, direction: -1 | 1): number {
  let last = 0;
  for (const { index, segment } of graphemes.segment(text)) {
    const end = index + segment.length;
    if (direction === 1 && index >= offset) return end;
    if (direction === -1 && end >= offset) return index;
    last = end;
  }
  return direction === 1 ? text.length : last;
}

/** The position one grapheme before or after `position`, crossing into the neighbouring paragraph at its ends. */
export function stepped(model: Model, position: Position, direction: -1 | 1): Position {
  const text = paragraphText(paragraphAt(model, position.paragraph));
  if (direction === -1 && position.offset === 0) {
    if (position.paragraph === 0) return position;
    const previous = paragraphText(paragraphAt(model, position.paragraph - 1));
    return { paragraph: position.paragraph - 1, offset: previous.length };
  }
  if (direction === 1 && position.offset >= text.length) {
    if (position.paragraph === model.paragraphs.length - 1) return position;
    return { paragraph: position.paragraph + 1, offset: 0 };
  }
  return { paragraph: position.paragraph, offset: graphemeStep(text, position.offset, direction) };
}

/** Backspace (`-1`) or Delete (`1`): the selection removed, or with a caret one grapheme, joining paragraphs at their ends. */
export function deleteFrom(model: Model, selection: Selection, direction: -1 | 1): Edited {
  if (!isCollapsed(selection)) {
    const { from, to } = ordered(selection);
    return replaceRange(model, from, to, '', styleAt(model, from));
  }
  const other = stepped(model, selection.focus, direction);
  if (comparePositions(other, selection.focus) === 0) return { model, selection };
  const from = direction === -1 ? other : selection.focus;
  const to = direction === -1 ? selection.focus : other;
  return replaceRange(model, from, to, '', styleAt(model, from));
}

/** The style properties a format change may set; `face` included, so a chosen font is set like any other property. */
export type StylePatch = Partial<RunStyle>;

/** `patch` applied to every letter from `from` to `to`. */
export function applyStyle(model: Model, selection: Selection, patch: StylePatch): Edited {
  const { from, to } = ordered(selection);
  const paragraphs = model.paragraphs.map((paragraph, index) => {
    if (index < from.paragraph || index > to.paragraph) return paragraph;
    const length = paragraphText(paragraph).length;
    const start = index === from.paragraph ? from.offset : 0;
    const end = index === to.paragraph ? to.offset : length;
    if (start >= end && length > 0) return paragraph;
    const runs: Run[] = [];
    let at = 0;
    for (const run of paragraph.runs) {
      const runEnd = at + run.text.length;
      const a = Math.max(start, at) - at;
      const b = Math.min(end, runEnd) - at;
      if (b <= a && run.text !== '') runs.push(run);
      else {
        runs.push({ ...run, text: run.text.slice(0, a) });
        runs.push({ ...run, text: run.text.slice(a, b), style: { ...run.style, ...patch } });
        runs.push({ ...run, text: run.text.slice(b) });
      }
      at = runEnd;
    }
    // AN EMPTY PARAGRAPH'S ONE RUN takes the patch, so its style is what a letter typed there gets.
    if (length === 0) return normalised({ ...paragraph, runs: paragraph.runs.map((run) => ({ ...run, style: { ...run.style, ...patch } })) });
    return normalised({ ...paragraph, runs });
  });
  return { model: { paragraphs }, selection };
}

/** `patch` applied to every paragraph the selection touches. */
export function applyParagraph(model: Model, selection: Selection, patch: Partial<ParagraphSetting>): Edited {
  const { from, to } = ordered(selection);
  const paragraphs = model.paragraphs.map((paragraph, index) => (index < from.paragraph || index > to.paragraph ? paragraph : { ...paragraph, ...patch }));
  return { model: { paragraphs }, selection };
}

/** Every letter of the block, as a selection: Ctrl+A, and a box-level change that applies to the whole block. */
export function wholeBlock(model: Model): Selection {
  const last = model.paragraphs.length - 1;
  return { anchor: { paragraph: 0, offset: 0 }, focus: { paragraph: last, offset: paragraphText(paragraphAt(model, last)).length } };
}

/** The selection's words as plain text, paragraphs parted by a line feed: what a copy carries. */
export function selectedText(model: Model, selection: Selection): string {
  const { from, to } = ordered(selection);
  const parts: string[] = [];
  for (let index = from.paragraph; index <= to.paragraph; index += 1) {
    const text = paragraphText(paragraphAt(model, index));
    parts.push(text.slice(index === from.paragraph ? from.offset : 0, index === to.paragraph ? to.offset : text.length));
  }
  return parts.join('\n');
}

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** The word at a position, as a double-click selects it; where the position is in space between words, that space. */
export function wordAt(model: Model, position: Position): Selection {
  const text = paragraphText(paragraphAt(model, position.paragraph));
  for (const { index, segment } of words.segment(text)) {
    const end = index + segment.length;
    if (position.offset >= index && position.offset < end) {
      return { anchor: { paragraph: position.paragraph, offset: index }, focus: { paragraph: position.paragraph, offset: end } };
    }
  }
  return caret(position);
}

/** The whole paragraph at a position, as a triple-click selects it. */
export function paragraphAround(model: Model, position: Position): Selection {
  const length = paragraphText(paragraphAt(model, position.paragraph)).length;
  return { anchor: { paragraph: position.paragraph, offset: 0 }, focus: { paragraph: position.paragraph, offset: length } };
}

/**
 * Where Ctrl+Left or Ctrl+Right moves the caret: to the start of the word before it, or past the end of the word after
 * it, crossing paragraphs at their ends.
 */
export function wordStep(model: Model, position: Position, direction: -1 | 1): Position {
  const text = paragraphText(paragraphAt(model, position.paragraph));
  if ((direction === -1 && position.offset === 0) || (direction === 1 && position.offset >= text.length)) return stepped(model, position, direction);
  const segments = [...words.segment(text)].filter((segment) => segment.isWordLike === true);
  if (direction === 1) {
    const next = segments.find((segment) => segment.index + segment.segment.length > position.offset);
    return { paragraph: position.paragraph, offset: next === undefined ? text.length : next.index + next.segment.length };
  }
  const previous = [...segments].reverse().find((segment) => segment.index < position.offset);
  return { paragraph: position.paragraph, offset: previous === undefined ? 0 : previous.index };
}

/** What a toggle shows for the selection: every letter on, none, or some of each. */
export type Toggle = 'on' | 'off' | 'mixed';

/** The value most of the letters have, by count, and whether any letter differs. */
export interface MostUsed<T> {
  readonly value: T;
  readonly mixed: boolean;
}

/**
 * What the format controls show for a selection ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)
 * section 3): each toggle on, off or mixed over the selected letters, and the size, face and colour most of them use.
 * With a caret, the toggles are the style the next letter would take — `pending` where the person chose one — and the
 * size, face and colour are those most of the CARET'S PARAGRAPH uses: one small marker beside the caret must not speak
 * for the paragraph, and a block's other paragraphs must not either (the stage audit's YYYYYYYY-21 on the editor this
 * kit replaces, which counted the whole block).
 */
export interface FormatState {
  readonly bold: Toggle;
  readonly italic: Toggle;
  readonly underline: Toggle;
  readonly strike: Toggle;
  readonly superscript: Toggle;
  readonly subscript: Toggle;
  readonly size: MostUsed<number>;
  readonly face: MostUsed<string>;
  readonly colour: MostUsed<Rgb>;
  readonly align: MostUsed<Alignment>;
}

/** Every letter the selection holds with its style; white space left out, since it shows no style. */
function lettersIn(model: Model, from: Position, to: Position): RunStyle[] {
  const styles: RunStyle[] = [];
  for (let index = from.paragraph; index <= to.paragraph; index += 1) {
    const paragraph = paragraphAt(model, index);
    const start = index === from.paragraph ? from.offset : 0;
    const end = index === to.paragraph ? to.offset : Number.POSITIVE_INFINITY;
    let at = 0;
    for (const run of paragraph.runs) {
      const slice = run.text.slice(Math.max(0, start - at), Math.max(0, end - at));
      for (const letter of slice) if (letter.trim() !== '') styles.push(run.style);
      at += run.text.length;
    }
  }
  return styles;
}

function mostUsed<T>(values: readonly T[], key: (value: T) => string, fallback: T): MostUsed<T> {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const k = key(value);
    const known = counts.get(k);
    counts.set(k, { value, count: (known?.count ?? 0) + 1 });
  }
  let best: { value: T; count: number } | undefined;
  for (const entry of counts.values()) if (best === undefined || entry.count > best.count) best = entry;
  return { value: best?.value ?? fallback, mixed: counts.size > 1 };
}

const toggle = (styles: readonly RunStyle[], on: (style: RunStyle) => boolean): Toggle => {
  const count = styles.filter(on).length;
  return count === 0 ? 'off' : count === styles.length ? 'on' : 'mixed';
};

const colourKey = (colour: Rgb): string => `${String(colour.r)},${String(colour.g)},${String(colour.b)}`;

export function formatState(model: Model, selection: Selection, pending?: RunStyle): FormatState {
  const { from, to } = ordered(selection);
  const collapsed = isCollapsed(selection);
  const here = pending ?? styleAt(model, from);
  const selected = collapsed ? [here] : lettersIn(model, from, to);
  const letters = selected.length === 0 ? [here] : selected;
  // THE VALUES' SOURCE: the selected letters, or at a caret the letters of its paragraph.
  const paragraphLetters = collapsed ? lettersIn(model, { paragraph: from.paragraph, offset: 0 }, { paragraph: from.paragraph, offset: Number.MAX_SAFE_INTEGER }) : letters;
  const valued = collapsed && pending === undefined && paragraphLetters.length > 0 ? paragraphLetters : letters;
  const paragraphs = model.paragraphs.slice(from.paragraph, to.paragraph + 1);
  return {
    bold: toggle(letters, (style) => style.bold),
    italic: toggle(letters, (style) => style.italic),
    underline: toggle(letters, (style) => style.underline),
    strike: toggle(letters, (style) => style.strike),
    superscript: toggle(letters, (style) => style.rise === 'superscript'),
    subscript: toggle(letters, (style) => style.rise === 'subscript'),
    size: mostUsed(valued.map((style) => style.size), String, here.size),
    face: mostUsed(valued.map((style) => style.face), (face) => face, here.face),
    colour: mostUsed(valued.map((style) => style.colour), colourKey, here.colour),
    align: mostUsed(paragraphs.map((paragraph) => paragraph.align), (align) => align, 'left'),
  };
}

/** A paragraph's runs joined wherever the STYLE agrees, whatever their bases: what a reader of the page would see. */
function shown(paragraph: Paragraph): Paragraph {
  return normalised({ ...paragraph, runs: paragraph.runs.map((run) => ({ text: run.text, style: run.style })) });
}

/** Whether two models hold the same words in the same styles, set the same way: what the person would see as one. */
export function sameModel(a: Model, b: Model): boolean {
  if (a.paragraphs.length !== b.paragraphs.length) return false;
  return a.paragraphs.every((paragraph, index) => {
    const other = b.paragraphs[index];
    if (other === undefined) return false;
    const x = shown(paragraph);
    const y = shown(other);
    return (
      x.align === y.align &&
      x.lineSpacing === y.lineSpacing &&
      x.spaceBefore === y.spaceBefore &&
      x.spaceAfter === y.spaceAfter &&
      x.firstIndent === y.firstIndent &&
      x.leftIndent === y.leftIndent &&
      x.runs.length === y.runs.length &&
      x.runs.every((run, k) => {
        const twin = y.runs[k];
        return run.text === twin?.text && sameStyle(run.style, twin.style);
      })
    );
  });
}
