/**
 * A text box's styled words, laid out and drawn by Monstera
 * ([ADR-0211](../../../docs/DECISIONS/0211-a-text-box-with-styled-words-has-an-appearance-monstera-writes-itself.md)).
 *
 * MuPDF draws a FreeText in three faces with one style and nothing more (measured 2026-10-08, 1.28.0), so bold on a word, a
 * fill, justified lines and the line pitch are written here: the words as `/Contents`, the styled runs as `/RC`, the box's own
 * style as `/DS`, the fill as `/IC` and the margins as `/RD` — and the appearance, which every reader but Acrobat draws
 * instead of the others, as a function of those. This module is PURE: the width of a word is asked of a `Measure` the
 * caller hands in, so the one place that knows where a line ends (B3a) is testable without an engine, and the engine's
 * own faces answer it where it runs.
 *
 * ## The faces are the base 14, and a script they cannot write is refused whole
 *
 * Nothing is embedded. `/RC`'s runs and this module's lines are drawn in Helvetica, Times or Courier, regular, bold, italic
 * or bold italic, in WinAnsi. A character outside WinAnsi — Hebrew, Arabic, CJK — makes {@link layoutBox} answer
 * `undefined`: the caller leaves the engine's appearance in place and the panel says the styles are not available for that
 * box. Never a style dropped on some of its words (*preserve, never drop*).
 */

import { DEFAULT_TEXT_LINE_HEIGHT, MAX_TEXT_LINE_HEIGHT, MAX_TEXT_PADDING, MIN_TEXT_LINE_HEIGHT } from '@monstera/shared';

/** An RGB colour, each channel 0 to 1, as every annotation here carries one. */
export type Rgb = readonly [number, number, number];

/** The three families a person chooses between. */
export type Family = 'sans' | 'serif' | 'mono';

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

const FACES: Readonly<Record<Family, readonly [Face, Face, Face, Face]>> = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};

/** The face for a family, bold and italic. */
export function faceFor(family: Family, bold: boolean, italic: boolean): Face {
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
  /** The margin between the box's edge and its words, in points, on every side (`/RD`). */
  readonly padding: number;
  /** The border's width in points, and its colour (`/BS`, `/C`). */
  readonly borderWidth: number;
  readonly borderColour: Rgb;
}

/** The look a box starts from: what MuPDF's own text box says, so a box restyled in one field changes only that field. */
export const DEFAULT_LOOK: BoxLook = {
  family: 'sans',
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
  borderWidth: 0,
  borderColour: [0, 0, 0],
};

// THE BOUNDS ARE THE CONTRACT'S, so the schema that refuses a value and the writer that clamps one cannot disagree (B3a).
export const MIN_LINE_HEIGHT = MIN_TEXT_LINE_HEIGHT;
export const MAX_LINE_HEIGHT = MAX_TEXT_LINE_HEIGHT;
export const MAX_PADDING = MAX_TEXT_PADDING;

/** The width of `text` in `face` at `size`, in points. */
export type Measure = (face: Face, text: string, size: number) => number;

// ---------------------------------------------------------------------------------------------------------------------
// WinAnsi

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

/** Whether every character of `text` (but a line break) has a WinAnsi code. */
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

// ---------------------------------------------------------------------------------------------------------------------
// Layout

/** One drawn piece of a line: a stretch in one face and colour, with its decorations. */
export interface Piece {
  readonly text: string;
  readonly face: Face;
  readonly colour: Rgb;
  readonly underline: boolean;
  readonly strike: boolean;
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

/** A word, or a space, or a break, with the style it is drawn in. */
interface Token {
  readonly text: string;
  readonly kind: 'word' | 'space' | 'break';
  readonly face: Face;
  readonly colour: Rgb;
  readonly underline: boolean;
  readonly strike: boolean;
}

function tokensOf(runs: readonly TextRun[], look: BoxLook): Token[] {
  const tokens: Token[] = [];
  for (const run of runs) {
    const bold = run.bold ?? look.bold;
    const italic = run.italic ?? look.italic;
    const style = {
      face: faceFor(look.family, bold, italic),
      colour: run.colour ?? look.colour,
      underline: run.underline ?? look.underline,
      strike: run.strike ?? look.strike,
    };
    for (const part of run.text.split(/(\r\n|\n|\r|[ \t]+)/u)) {
      if (part === '') continue;
      if (/^(\r\n|\n|\r)$/u.test(part)) tokens.push({ ...style, text: part, kind: 'break' });
      else if (/^[ \t]+$/u.test(part)) tokens.push({ ...style, text: ' '.repeat(part.length), kind: 'space' });
      else tokens.push({ ...style, text: part, kind: 'word' });
    }
  }
  return tokens;
}

/**
 * Lays `runs` out in a box `width` by `height` points, or answers `undefined` for a box it cannot draw (a character outside
 * WinAnsi, or no room for any text at all).
 *
 * Greedy, the way every word processor breaks: a word goes on the line while it fits, a word wider than the line is cut at
 * the character that no longer fits, a space that would start a line is dropped, a hard break starts one. A `justify` box
 * spreads each line but the last (and any ended by a hard break) across the width by widening its spaces.
 */
export function layoutBox(
  width: number,
  height: number,
  look: BoxLook,
  runs: readonly TextRun[],
  measure: Measure,
): Layout | undefined {
  if (!runs.every((run) => writable(run.text))) return undefined;
  const inner = width - 2 * look.padding - 2 * look.borderWidth;
  if (!(inner > 0) || !(look.size > 0)) return undefined;

  interface Row { pieces: Token[]; widths: number[]; ended: 'wrap' | 'break' | 'end' }
  const rows: Row[] = [];
  let row: Row = { pieces: [], widths: [], ended: 'end' };
  let used = 0;
  const widthOf = (token: Token): number => measure(token.face, token.text, look.size);
  const finish = (ended: Row['ended']): void => {
    // A line does not END in a space it would have to show: the trailing ones are dropped from the width.
    while (row.pieces.at(-1)?.kind === 'space') {
      row.pieces.pop();
      row.widths.pop();
    }
    row.ended = ended;
    rows.push(row);
    row = { pieces: [], widths: [], ended: 'end' };
    used = 0;
  };

  for (const token of tokensOf(runs, look)) {
    if (token.kind === 'break') {
      finish('break');
      continue;
    }
    if (token.kind === 'space') {
      // A space that would start a line is dropped.
      if (row.pieces.length === 0) continue;
      const wide = widthOf(token);
      if (used + wide > inner) {
        finish('wrap');
        continue;
      }
      row.pieces.push(token);
      row.widths.push(wide);
      used += wide;
      continue;
    }
    let rest = token;
    for (;;) {
      const wide = widthOf(rest);
      if (used + wide <= inner) {
        row.pieces.push(rest);
        row.widths.push(wide);
        used += wide;
        break;
      }
      if (row.pieces.length > 0) {
        finish('wrap');
        continue;
      }
      // A WORD WIDER THAN THE LINE is cut at the character that no longer fits (at least one, so it always advances).
      let count = 1;
      const characters = Array.from(rest.text);
      while (count < characters.length && measure(rest.face, characters.slice(0, count + 1).join(''), look.size) <= inner) count += 1;
      const head = characters.slice(0, count).join('');
      row.pieces.push({ ...rest, text: head });
      row.widths.push(measure(rest.face, head, look.size));
      finish('wrap');
      rest = { ...rest, text: characters.slice(count).join('') };
      if (rest.text === '') break;
    }
  }
  if (row.pieces.length > 0 || rows.length === 0) finish('end');

  const pitch = look.size * look.lineHeight;
  const top = look.padding + look.borderWidth;
  const lines: Line[] = rows.map((one, at) => {
    const natural = one.widths.reduce((sum, each) => sum + each, 0);
    const spaces = one.pieces.filter((piece) => piece.kind === 'space').length;
    const stretch = look.align === 'justify' && one.ended === 'wrap' && spaces > 0 ? (inner - natural) / spaces : 0;
    const slack = inner - natural;
    let x = top + (look.align === 'center' ? slack / 2 : look.align === 'right' ? slack : 0);
    const pieces: Piece[] = [];
    one.pieces.forEach((token, index) => {
      const own = (one.widths[index] ?? 0) + (token.kind === 'space' ? stretch : 0);
      const previous = pieces.at(-1);
      // ADJACENT PIECES OF ONE STYLE ARE ONE DRAW, so an underline runs across a phrase and not word by word.
      if (
        previous?.face === token.face &&
        sameColour(previous.colour, token.colour) &&
        previous.underline === token.underline &&
        previous.strike === token.strike &&
        stretch === 0
      ) {
        pieces[pieces.length - 1] = { ...previous, text: previous.text + token.text, width: previous.width + own };
      } else {
        pieces.push({
          text: token.text,
          face: token.face,
          colour: token.colour,
          underline: token.underline,
          strike: token.strike,
          x,
          width: own,
        });
      }
      x += own;
    });
    // THE BASELINE: half the leading above the glyphs, and the ascent below that.
    return { baseline: top + at * pitch + (pitch - look.size) / 2 + look.size * 0.8, pieces };
  });
  return { width, height, lines };
}

// ---------------------------------------------------------------------------------------------------------------------
// The appearance stream

/** Two colours are one when each channel is. */
export function sameColour(one: Rgb, other: Rgb): boolean {
  return one[0] === other[0] && one[1] === other[1] && one[2] === other[2];
}

const fixed = (value: number): string => {
  const text = value.toFixed(3).replace(/\.?0+$/u, '');
  return text === '-0' || text === '' ? '0' : text;
};

const colourOps = (colour: Rgb, stroke: boolean): string =>
  `${colour.map(fixed).join(' ')} ${stroke ? 'RG' : 'rg'}`;

/** The resource names of the faces a layout uses, `F1`… in the order first met, so a stream and its dictionary agree. */
export function faceNames(layout: Layout): ReadonlyMap<Face, string> {
  const names = new Map<Face, string>();
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
  for (const line of layout.lines) {
    const y = height - line.baseline;
    for (const piece of line.pieces) {
      const name = names.get(piece.face);
      if (piece.text.trim() !== '' && name !== undefined) {
        ops.push(
          'BT',
          colourOps(piece.colour, false),
          `/${name} ${fixed(look.size)} Tf`,
          `${fixed(piece.x)} ${fixed(y)} Td`,
          `${pdfString(piece.text)} Tj`,
          'ET',
        );
      }
      const stroke = Math.max(0.5, look.size * 0.06);
      if (piece.underline) {
        ops.push('q', colourOps(piece.colour, false), `${fixed(piece.x)} ${fixed(y - look.size * 0.14)} ${fixed(piece.width)} ${fixed(stroke)} re f`, 'Q');
      }
      if (piece.strike) {
        ops.push('q', colourOps(piece.colour, false), `${fixed(piece.x)} ${fixed(y + look.size * 0.26)} ${fixed(piece.width)} ${fixed(stroke)} re f`, 'Q');
      }
    }
  }
  ops.push('Q');
  return `${ops.join('\n')}\n`;
}
