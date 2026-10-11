/**
 * A text box's styled words, laid out and drawn by Monstera
 * ([ADR-0211](../../../docs/DECISIONS/0211-a-text-box-with-styled-words-has-an-appearance-monstera-writes-itself.md),
 * [ADR-0228](../../../docs/DECISIONS/0228-the-formatting-set-is-whole-in-both-text-writers-and-a-tab-is-a-marked-gap.md)).
 *
 * MuPDF draws a FreeText in three faces with one style and nothing more (measured 2026-10-08, 1.28.0), so bold on a word, a
 * fill, justified lines and the line pitch are written here: the words as `/Contents`, the styled runs as `/RC`, the box's own
 * style as `/DS`, the fill as `/IC` — and the appearance, which every reader but Acrobat draws instead of the others, as a
 * function of those.
 *
 * ## This module is PURE, and the faces are a {@link Typesetter} handed in
 *
 * It owns where a line ends (B3a) and nothing about a font. A word's pieces, their faces and their widths come from the
 * typesetter the caller hands in, so the one place that breaks lines is testable without an engine, and the engine's faces
 * answer it where it runs: the base 14 for a word a standard face can write, the resolver's embedded faces for every other
 * (K2, ADR-0228 Decision 3). A word NO typesetter can set makes {@link layoutBox} answer `undefined`, and the caller leaves
 * the engine's appearance in place — never a style dropped on some of the words (*preserve, never drop*).
 */

import {
  DEFAULT_TEXT_LINE_HEIGHT,
  MAX_TEXT_LINE_HEIGHT,
  MAX_TEXT_PADDING,
  MIN_TEXT_LINE_HEIGHT,
  nextTabStop,
} from '@monstera/shared';

import { hasRightToLeftLetter, lineSpans, paragraphDirection, paragraphLevels } from './bidiOrder.js';
import {
  HIGHLIGHT_ABOVE,
  HIGHLIGHT_BELOW,
  STRIKE_RISE,
  UNDERLINE_DROP,
  UNDERLINE_THICKNESS,
  spaceable,
  spacedBy,
} from './markFigures.js';

/** An RGB colour, each channel 0 to 1, as every annotation here carries one. */
export type Rgb = readonly [number, number, number];

/** A family, by the name a person chose it under: one of the base 14's three, or a face the resolver knows (K2). */
export type Family = string;

/** The base 14's twelve text faces, by their PostScript names. */
export type Face =
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Helvetica-BoldOblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Times-Italic'
  | 'Times-BoldItalic'
  | 'Courier'
  | 'Courier-Bold'
  | 'Courier-Oblique'
  | 'Courier-BoldOblique';

/** The base 14's three text families, by the names the font picker lists them under. */
export const BASE14_FAMILIES = ['Helvetica', 'Times', 'Courier'] as const;
export type Base14Family = (typeof BASE14_FAMILIES)[number];

const FACES: Readonly<Record<Base14Family, readonly [Face, Face, Face, Face]>> = {
  Helvetica: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  Times: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  Courier: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};

/** The base-14 family a name is, ignoring case, or `undefined` for any other family. */
export function base14Of(family: Family): Base14Family | undefined {
  const lower = family.trim().toLowerCase();
  return BASE14_FAMILIES.find((each) => each.toLowerCase() === lower);
}

/**
 * The base-14 family a family falls back to where a reader draws the words itself (ADR-0228 Decision 3): the family where it
 * is one, else the one nearest its class. The ONE rule a text box's `/DA` and a form field's (ADR-0229) both take.
 */
export function nearestBase14(family: Family, classOf: (family: Family) => 'sans' | 'serif' | 'mono'): Base14Family {
  return base14Of(family) ?? ({ sans: 'Helvetica', serif: 'Times', mono: 'Courier' } as const)[classOf(family)];
}

/** The base-14 face for a base-14 family, bold and italic. */
export function faceFor(family: Base14Family, bold: boolean, italic: boolean): Face {
  const [regular, boldFace, italicFace, boldItalicFace] = FACES[family];
  if (bold && italic) return boldItalicFace;
  return bold ? boldFace : italic ? italicFace : regular;
}

/** The text alignments a box may carry. `justify` is `/DS`'s; `/Q` keeps the nearest of the other three. */
export type BoxAlign = 'left' | 'center' | 'right' | 'justify';

/** What a run of words may say of itself over the box's own style. Absent is the box's. */
export interface RunStyle {
  readonly bold?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
  readonly strike?: boolean | undefined;
  readonly colour?: Rgb | undefined;
  /** A colour behind the words, `null` for none over a box that has one (ADR-0228 Decision 1). */
  readonly highlight?: Rgb | null | undefined;
  /** Character spacing, a fraction of the size (ADR-0228 Decision 1). */
  readonly spacing?: number | undefined;
}

/** A stretch of the box's words and what it says of itself. The runs, joined, are the box's `/Contents`. */
export interface TextRun extends RunStyle {
  readonly text: string;
}

/** The box's own style: the base every run is read against. */
export interface BoxLook {
  readonly family: Family;
  readonly size: number;
  readonly colour: Rgb;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly align: BoxAlign;
  /** The line pitch as a multiple of the size: 1 is tight, 1.2 the default, 3 the most. */
  readonly lineHeight: number;
  /** The fill behind the words, or `null` for none (`/IC`). */
  readonly fill: Rgb | null;
  /** The margin between the box's edge and its words, in points, on every side. */
  readonly padding: number;
  /** The whole box's character spacing, a fraction of the size: 0 for none (ADR-0228 Decision 1). */
  readonly spacing: number;
  /** The border's width in points, and its colour (`/BS`, `/C`). */
  readonly borderWidth: number;
  readonly borderColour: Rgb;
}

/** The look a box starts from: what MuPDF's own text box says, so a box restyled in one field changes only that field. */
export const DEFAULT_LOOK: BoxLook = {
  family: 'Helvetica',
  size: 12,
  colour: [0, 0, 0],
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: 'left',
  lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
  fill: null,
  padding: 0,
  spacing: 0,
  borderWidth: 0,
  borderColour: [0, 0, 0],
};

// THE BOUNDS ARE THE CONTRACT'S, so the schema that refuses a value and the writer that clamps one cannot disagree (B3a).
export const MIN_LINE_HEIGHT = MIN_TEXT_LINE_HEIGHT;
export const MAX_LINE_HEIGHT = MAX_TEXT_LINE_HEIGHT;
export const MAX_PADDING = MAX_TEXT_PADDING;

/** The width of `text` in `face` at `size`, in points: the base 14's own widths, which the engine answers. */
export type Measure = (face: Face, text: string, size: number) => number;

/** The family, weight and slant a stretch of words asks for. */
export interface FaceStyle {
  readonly family: Family;
  readonly bold: boolean;
  readonly italic: boolean;
}

/**
 * A stretch of words in one face, how wide it is drawn at the size asked, and the operators that draw it with `Tf` set:
 * a WinAnsi string for the base 14, an embedded face's codes for the resolver's. `face` is the typesetter's own key.
 *
 * **The operators come with the width, decided once**, so a piece is drawn by exactly the glyphs it was measured by: a
 * right-to-left word is shaped once, in its direction, and two pieces drawn one after the other are two shows in sequence,
 * never a joined text shaped again.
 */
export interface SetPiece {
  readonly face: string;
  readonly text: string;
  readonly width: number;
  readonly show: string;
}

/**
 * What sets words in faces: the pieces `text` is drawn as, in logical order, each in one face and with its width at `size`,
 * or `undefined` where this setter cannot draw it. `rtl` says the stretch is drawn right to left, which a shaper needs.
 */
export interface Typesetter {
  set(text: string, style: FaceStyle, size: number, rtl: boolean): readonly SetPiece[] | undefined;
}

/** The first typesetter that can set a stretch, so a word goes to the base 14 where they write it and to the resolver otherwise. */
export function firstOf(...setters: readonly Typesetter[]): Typesetter {
  return {
    set: (text, style, size, rtl) => {
      for (const setter of setters) {
        const pieces = setter.set(text, style, size, rtl);
        if (pieces !== undefined) return pieces;
      }
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// WinAnsi, and the base 14 as a typesetter

/** Windows-1252's 0x80–0x9F, the only place it differs from Latin-1; `undefined` is a hole. */
const WIN_1252_HIGH: readonly (number | undefined)[] = [
  0x20ac, undefined, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, undefined, 0x017d,
  undefined, undefined, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153,
  undefined, 0x017e, 0x0178,
];

const WIN_ANSI_OF = new Map<number, number>();
for (let code = 0x20; code <= 0x7e; code += 1) WIN_ANSI_OF.set(code, code);
for (let code = 0xa0; code <= 0xff; code += 1) WIN_ANSI_OF.set(code, code);
WIN_1252_HIGH.forEach((point, at) => {
  if (point !== undefined) WIN_ANSI_OF.set(point, 0x80 + at);
});

/** The WinAnsi code for a code point, or `undefined` where the base 14 has none. */
export function winAnsiCode(point: number): number | undefined {
  return WIN_ANSI_OF.get(point);
}

/** Whether every character of `text` (but a line break or a tab) has a WinAnsi code. */
export function writable(text: string): boolean {
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point === 0x0a || point === 0x0d || point === 0x09) continue;
    if (!WIN_ANSI_OF.has(point)) return false;
  }
  return true;
}

/** A PDF literal string for `text`, in WinAnsi: parentheses and the backslash escaped, bytes above 0x7e in octal. */
export function pdfString(text: string): string {
  let out = '';
  for (const character of text) {
    const code = WIN_ANSI_OF.get(character.codePointAt(0) ?? 0x20) ?? 0x3f;
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code > 0x7e || code < 0x20) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `(${out})`;
}

/**
 * The base 14 as a typesetter: a stretch in a base-14 family that WinAnsi can write is one piece in that family's face,
 * unembedded (ADR-0228 Decision 3); anything else is not this setter's.
 */
export function base14Typesetter(measure: Measure): Typesetter {
  return {
    set: (text, style, size, rtl) => {
      const family = base14Of(style.family);
      // A RIGHT-TO-LEFT STRETCH IS NEVER THE BASE 14'S: WinAnsi holds no right-to-left letter, and a neutral run the bidi
      // algorithm drew right to left is set with its neighbours.
      if (family === undefined || rtl || !writable(text)) return undefined;
      const face = faceFor(family, style.bold, style.italic);
      return [{ face, text, width: measure(face, text, size), show: `${pdfString(text)} Tj` }];
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout

/** One drawn piece of a line: a stretch in one face and colour, with its decorations. */
export interface Piece {
  readonly text: string;
  readonly face: string;
  /** The set pieces' operators, drawn one after the other from the piece's start. */
  readonly shows: readonly string[];
  readonly colour: Rgb;
  readonly underline: boolean;
  readonly strike: boolean;
  /** The colour behind the piece, or `null`. */
  readonly highlight: Rgb | null;
  /** Points `Tc` adds after every character the piece shows. */
  readonly spacing: number;
  readonly x: number;
  readonly width: number;
}

/** One line: where its baseline is and what is on it. */
export interface Line {
  readonly baseline: number;
  readonly pieces: readonly Piece[];
}

/** A laid-out box: its lines top to bottom, in the box's own space (origin at the top left, y down). */
export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly Line[];
}

/** A word, or a space, or a break, with the style it is drawn in and, for a word or a space, how it is set. */
interface Token {
  readonly text: string;
  /** A tab is a gap to the next stop from the box's inner left (ADR-0228 Decision 2), as wide as where it starts says. */
  readonly kind: 'word' | 'space' | 'tab' | 'break';
  readonly style: FaceStyle;
  readonly colour: Rgb;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly highlight: Rgb | null;
  /** Character spacing, a fraction of the size. */
  readonly spacing: number;
  /** Where the token's text begins in its paragraph, so a line's words can be put in drawing order. */
  readonly offset: number;
  readonly paragraph: number;
}

interface SetToken extends Token {
  readonly pieces: readonly SetPiece[];
  readonly width: number;
}

function tokensOf(runs: readonly TextRun[], look: BoxLook): { readonly tokens: Token[]; readonly paragraphs: string[] } {
  const tokens: Token[] = [];
  const paragraphs = [''];
  for (const run of runs) {
    const style = {
      style: { family: look.family, bold: run.bold ?? look.bold, italic: run.italic ?? look.italic },
      colour: run.colour ?? look.colour,
      underline: run.underline ?? look.underline,
      strike: run.strike ?? look.strike,
      highlight: run.highlight ?? null,
      spacing: run.spacing ?? look.spacing,
    };
    for (const part of run.text.split(/(\r\n|\n|\r|\t| +)/u)) {
      if (part === '') continue;
      const paragraph = paragraphs.length - 1;
      const offset = paragraphs[paragraph]?.length ?? 0;
      if (/^(\r\n|\n|\r)$/u.test(part)) {
        tokens.push({ ...style, text: part, kind: 'break', offset, paragraph });
        paragraphs.push('');
        continue;
      }
      tokens.push({ ...style, text: part, kind: part === '\t' ? 'tab' : /^ +$/u.test(part) ? 'space' : 'word', offset, paragraph });
      paragraphs[paragraph] = (paragraphs[paragraph] ?? '') + part;
    }
  }
  return { tokens, paragraphs };
}

/**
 * Lays `runs` out in a box `width` by `height` points, or answers `undefined` for a box it cannot draw (a word no typesetter
 * can set, or no room for any text at all).
 *
 * Greedy, the way every word processor breaks: a word goes on the line while it fits, a word wider than the line is cut at
 * the character that no longer fits, a space that would start a line is dropped, a hard break starts one. A `justify` box
 * spreads each line but the last (and any ended by a hard break) across the width by widening its spaces. A line holding
 * right-to-left words is drawn in the order the bidirectional algorithm gives (rules L1 and L2, `bidiOrder.ts`).
 */
export function layoutBox(
  width: number,
  height: number,
  look: BoxLook,
  runs: readonly TextRun[],
  setter: Typesetter,
  /** `false` keeps each paragraph on one line, as a single-line form field's value is (ADR-0229): aligned, never wrapped. */
  wraps = true,
): Layout | undefined {
  const inner = width - 2 * look.padding - 2 * look.borderWidth;
  if (!(inner > 0) || !(look.size > 0)) return undefined;
  /** How wide a line may grow before it wraps: the box's inner width, or without end where nothing wraps. */
  const room = wraps ? inner : Infinity;
  const { tokens, paragraphs } = tokensOf(runs, look);
  const directions = paragraphs.map((text) => paragraphDirection(text));
  const levels = paragraphs.map((text, at) => paragraphLevels(text, directions[at] ?? 'ltr'));
  // A STRETCH IS SET RIGHT TO LEFT where it holds a right-to-left letter; a neutral one goes with its paragraph.
  const rtlOf = (token: Token): boolean =>
    hasRightToLeftLetter(token.text) || (token.kind === 'space' && directions[token.paragraph] === 'rtl');
  // CHARACTER SPACING IN POINTS, by the one rule both page writers take (`spacedBy`): after every character, and never in
  // a joined right-to-left script.
  const spacingOf = (token: Token): number => token.spacing * look.size;
  const setOf = (token: Token, text: string): SetToken | undefined => {
    const pieces = setter.set(text, token.style, look.size, rtlOf(token));
    if (pieces === undefined) return undefined;
    const spaced = pieces.reduce((sum, piece) => sum + spacedBy(piece.text, spacingOf(token)), 0);
    return { ...token, text, pieces, width: pieces.reduce((sum, piece) => sum + piece.width, 0) + spaced };
  };

  interface Row { tokens: SetToken[]; ended: 'wrap' | 'break' | 'end'; paragraph: number }
  const rows: Row[] = [];
  let row: Row = { tokens: [], ended: 'end', paragraph: 0 };
  let used = 0;
  const finish = (ended: Row['ended']): void => {
    // A line does not END in a space it would have to show: the trailing ones are dropped from the width.
    while (row.tokens.at(-1)?.kind === 'space') row.tokens.pop();
    row.ended = ended;
    rows.push(row);
    row = { tokens: [], ended: 'end', paragraph: row.paragraph };
    used = 0;
  };

  for (const token of tokens) {
    if (token.kind === 'break') {
      finish('break');
      row.paragraph = token.paragraph + 1;
      continue;
    }
    row.paragraph = token.paragraph;
    if (token.kind === 'tab') {
      // A TAB GOES TO THE NEXT STOP, and to the next line where that stop is past the edge, where it is a whole stop.
      if (row.tokens.length > 0 && nextTabStop(used, 0) > room) finish('wrap');
      const here = nextTabStop(used, 0) - used;
      row.tokens.push({ ...token, pieces: [], width: here });
      used += here;
      continue;
    }
    const set = setOf(token, token.text);
    if (set === undefined) return undefined;
    if (token.kind === 'space') {
      // A space that would start a line is dropped.
      if (row.tokens.length === 0) continue;
      if (used + set.width > room) {
        finish('wrap');
        continue;
      }
      row.tokens.push(set);
      used += set.width;
      continue;
    }
    let rest = set;
    for (;;) {
      if (used + rest.width <= room) {
        row.tokens.push(rest);
        used += rest.width;
        break;
      }
      if (row.tokens.length > 0) {
        finish('wrap');
        continue;
      }
      // A WORD WIDER THAN THE LINE is cut at the character that no longer fits (at least one, so it always advances).
      const characters = Array.from(rest.text);
      let count = 1;
      while (count < characters.length && (setOf(rest, characters.slice(0, count + 1).join(''))?.width ?? Infinity) <= inner) count += 1;
      const head = setOf(rest, characters.slice(0, count).join(''));
      const tail = characters.slice(count).join('');
      if (head === undefined) return undefined;
      row.tokens.push(head);
      finish('wrap');
      if (tail === '') break;
      const next = setOf({ ...rest, offset: rest.offset + head.text.length }, tail);
      if (next === undefined) return undefined;
      rest = next;
    }
  }
  if (row.tokens.length > 0 || rows.length === 0) finish('end');

  const pitch = look.size * look.lineHeight;
  const top = look.padding + look.borderWidth;
  const lines: Line[] = rows.map((one, at) => {
    const natural = one.tokens.reduce((sum, token) => sum + token.width, 0);
    const spaces = one.tokens.filter((token) => token.kind === 'space').length;
    const stretch = look.align === 'justify' && one.ended === 'wrap' && spaces > 0 ? (inner - natural) / spaces : 0;
    const slack = inner - natural;
    let x = top + (look.align === 'center' ? slack / 2 : look.align === 'right' ? slack : 0);
    const pieces: Piece[] = [];
    for (const token of drawingOrder(one.tokens, levels[one.paragraph])) {
      // A TAB DRAWS NOTHING and moves the pen to where it was laid out to end.
      if (token.kind === 'tab') {
        x += token.width;
        continue;
      }
      const extra = token.kind === 'space' ? stretch : 0;
      token.pieces.forEach((set, index) => {
        const spacing = spaceable(set.text) ? spacingOf(token) : 0;
        const own = set.width + spacedBy(set.text, spacingOf(token)) + (index === token.pieces.length - 1 ? extra : 0);
        const previous = pieces.at(-1);
        // ADJACENT PIECES OF ONE STYLE ARE ONE DRAW, so an underline runs across a phrase and not word by word. ADJACENT, so a
        // piece after a gap the pen jumped (a tab) starts a draw of its own at its own place.
        if (
          previous !== undefined &&
          Math.abs(previous.x + previous.width - x) < 1e-6 &&
          previous.face === set.face &&
          sameColour(previous.colour, token.colour) &&
          previous.underline === token.underline &&
          previous.strike === token.strike &&
          sameHighlight(previous.highlight, token.highlight) &&
          previous.spacing === spacing &&
          stretch === 0
        ) {
          pieces[pieces.length - 1] = {
            ...previous,
            text: previous.text + set.text,
            shows: [...previous.shows, set.show],
            width: previous.width + own,
          };
        } else {
          pieces.push({
            text: set.text,
            face: set.face,
            shows: [set.show],
            colour: token.colour,
            underline: token.underline,
            strike: token.strike,
            highlight: token.highlight,
            spacing,
            x,
            width: own,
          });
        }
        x += own;
      });
    }
    // THE BASELINE: half the leading above the glyphs, and the ascent below that.
    return { baseline: top + at * pitch + (pitch - look.size) / 2 + look.size * 0.8, pieces };
  });
  return { width, height, lines };
}

/**
 * A line's tokens in the order they are drawn, left to right. A line with no right-to-left letter and a left-to-right
 * paragraph is drawn as typed; any other is put in the order rules L1 and L2 give, each token taking the level of its
 * first character (a token is one word or one run of spaces, which the algorithm does not split in practice).
 */
function drawingOrder(tokens: readonly SetToken[], paragraph: ReturnType<typeof paragraphLevels> | undefined): readonly SetToken[] {
  const first = tokens[0];
  const last = tokens.at(-1);
  if (paragraph === undefined || first === undefined || last === undefined) return tokens;
  if (paragraph.direction === 'ltr' && !tokens.some((token) => hasRightToLeftLetter(token.text))) return tokens;
  const spans = lineSpans(paragraph, first.offset, last.offset + last.text.length);
  const ordered: SetToken[] = [];
  for (const span of spans) {
    const inside = tokens.filter((token) => token.offset >= span.start && token.offset < span.end);
    ordered.push(...(span.rtl ? [...inside].reverse() : inside));
  }
  // EVERY TOKEN ONCE: a token the spans did not hold (an offset the algorithm's text does not have) keeps its place at the end.
  for (const token of tokens) if (!ordered.includes(token)) ordered.push(token);
  return ordered;
}

// ---------------------------------------------------------------------------------------------------------------------
// The appearance stream

/** Two colours are one when each channel is. */
export function sameColour(one: Rgb, other: Rgb): boolean {
  return one[0] === other[0] && one[1] === other[1] && one[2] === other[2];
}

/** Two highlights are one when both are none or both are one colour. */
function sameHighlight(one: Rgb | null, other: Rgb | null): boolean {
  return one === null || other === null ? one === other : sameColour(one, other);
}

const fixed = (value: number): string => {
  const text = value.toFixed(3).replace(/\.?0+$/u, '');
  return text === '-0' || text === '' ? '0' : text;
};

const colourOps = (colour: Rgb, stroke: boolean): string =>
  `${colour.map(fixed).join(' ')} ${stroke ? 'RG' : 'rg'}`;

/** The resource names of the faces a layout uses, `F1`… in the order first met, so a stream and its dictionary agree. */
export function faceNames(layout: Layout): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const line of layout.lines) {
    for (const piece of line.pieces) {
      if (piece.text.trim() !== '' && !names.has(piece.face)) names.set(piece.face, `F${String(names.size + 1)}`);
    }
  }
  return names;
}

/**
 * The normal appearance's content stream for `layout` in a box `width` by `height` whose lower left is the form's origin.
 * The layout's space is y down from the top left; the stream's is PDF's, y up from the bottom left.
 */
export function appearanceContent(layout: Layout, look: BoxLook): string {
  const { width, height } = layout;
  const names = faceNames(layout);
  const ops: string[] = [];
  if (look.fill !== null) ops.push('q', colourOps(look.fill, false), `0 0 ${fixed(width)} ${fixed(height)} re f`, 'Q');
  if (look.borderWidth > 0) {
    const half = look.borderWidth / 2;
    ops.push(
      'q',
      colourOps(look.borderColour, true),
      `${fixed(look.borderWidth)} w`,
      `${fixed(half)} ${fixed(half)} ${fixed(width - look.borderWidth)} ${fixed(height - look.borderWidth)} re S`,
      'Q',
    );
  }
  // THE WORDS ARE CLIPPED TO THE BOX: a box too short for its lines shows the ones that fit, as every reader's does.
  const inset = look.borderWidth;
  ops.push('q', `${fixed(inset)} ${fixed(inset)} ${fixed(width - 2 * inset)} ${fixed(height - 2 * inset)} re W n`);
  /** The `Tc` in force: none at the stream's start. */
  let spacing = 0;
  for (const line of layout.lines) {
    const y = height - line.baseline;
    // THE HIGHLIGHTS FIRST, the whole line's, so no word of the line is drawn under a neighbour's colour.
    for (const piece of line.pieces) {
      if (piece.highlight === null) continue;
      ops.push(
        'q',
        colourOps(piece.highlight, false),
        `${fixed(piece.x)} ${fixed(y - look.size * HIGHLIGHT_BELOW)} ${fixed(piece.width)} ${fixed(look.size * (HIGHLIGHT_ABOVE + HIGHLIGHT_BELOW))} re f`,
        'Q',
      );
    }
    for (const piece of line.pieces) {
      const name = names.get(piece.face);
      if (piece.text.trim() !== '' && name !== undefined) {
        ops.push(
          'BT',
          colourOps(piece.colour, false),
          `/${name} ${fixed(look.size)} Tf`,
          // `Tc` IS TEXT STATE AND OUTLIVES ET, so it is said wherever a piece's differs from the one in force.
          ...(piece.spacing === spacing ? [] : [`${fixed(piece.spacing)} Tc`]),
          `${fixed(piece.x)} ${fixed(y)} Td`,
          ...piece.shows,
          'ET',
        );
        spacing = piece.spacing;
      }
      // THE RULES BY THE PAGE WRITERS' FIGURES (`markFigures.ts`), so a struck word is struck at one height everywhere.
      const stroke = Math.max(0.5, look.size * UNDERLINE_THICKNESS);
      if (piece.underline) {
        ops.push(
          'q',
          colourOps(piece.colour, false),
          `${fixed(piece.x)} ${fixed(y - look.size * UNDERLINE_DROP - stroke)} ${fixed(piece.width)} ${fixed(stroke)} re f`,
          'Q',
        );
      }
      if (piece.strike) {
        ops.push('q', colourOps(piece.colour, false), `${fixed(piece.x)} ${fixed(y + look.size * STRIKE_RISE)} ${fixed(piece.width)} ${fixed(stroke)} re f`, 'Q');
      }
    }
  }
  ops.push('Q');
  return `${ops.join('\n')}\n`;
}
