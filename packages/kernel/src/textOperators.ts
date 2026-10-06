/**
 * A page's content stream as its text-showing operators, numbered as PDFium numbers its text objects
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
 * Decision 3). THE ONE OWNER of that numbering: the MuPDF writer finds the operator an edit names through it, and the
 * research instrument that measured the rule reads through it, so the rule is never spelt twice.
 *
 * ## The rule, measured
 *
 * PDFium's k-th text object is the page's k-th `Tj`, `TJ`, `'` or `"` OUTSIDE a form that shows at least one character
 * code; an operator that shows none (`() Tj`, a `TJ` of spacing alone) makes no object. Measured 2026-10-06 on PDFium
 * 155.0.8044.0's Linux build by `scripts/research/type3Correspondence.mjs`: a Helvetica page, a hand-built Type 3 page,
 * a page of hard shapes (empty strings, both quote operators, clip-only text, marked content, a saved state, a font the
 * resources lack) and a Chromium print all agree, by position and length.
 *
 * ## What it reads, and what it does not
 *
 * The streams of one page joined as ISO 32000 §7.8.2 joins them, tokenised by §7.2's lexical rules, with the text state
 * of §9.3 and the text matrices of §9.4.2 followed through every operator that sets them. A form's content is not
 * entered, as PDFium does not enter it for its page walk. An inline image's data is skipped whole, since it is bytes and
 * not tokens. Nothing here knows a font's widths: what an operator draws is the caller's to measure, from the font the
 * operator names.
 */

/** A 2D affine matrix `[a b c d e f]`, as a content stream writes one. */
export type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `left` then `right`: ISO 32000's row-vector convention, so `multiply(translation, tm)` moves within the text space. */
export function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [A, B, C, D, E, F] = right;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

/** One lexical token, with where it is in the bytes. */
type Token =
  | { readonly kind: 'number'; readonly value: number; readonly start: number; readonly end: number }
  | { readonly kind: 'name'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly kind: 'string'; readonly bytes: Uint8Array; readonly start: number; readonly end: number }
  | { readonly kind: 'array'; readonly items: readonly Token[]; readonly start: number; readonly end: number }
  | { readonly kind: 'other'; readonly start: number; readonly end: number }
  | { readonly kind: 'operator'; readonly value: string; readonly start: number; readonly end: number };

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/u;

/** A literal string's bytes from `start` (its opening parenthesis), and where it ends: §7.3.4.2's escapes. */
function literalString(bytes: Uint8Array, start: number): { readonly bytes: Uint8Array; readonly end: number } {
  const out: number[] = [];
  let depth = 1;
  let at = start + 1;
  while (at < bytes.length) {
    const c = bytes[at] ?? 0;
    if (c === 0x5c) {
      const next = bytes[at + 1] ?? 0;
      const escaped: Readonly<Record<number, number>> = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
      if (next >= 0x30 && next <= 0x37) {
        let value = 0;
        let digits = 0;
        while (digits < 3 && (bytes[at + 1 + digits] ?? 0) >= 0x30 && (bytes[at + 1 + digits] ?? 0) <= 0x37) {
          value = value * 8 + ((bytes[at + 1 + digits] ?? 0) - 0x30);
          digits += 1;
        }
        out.push(value & 0xff);
        at += 1 + digits;
      } else if (next === 0x0d || next === 0x0a) {
        // A BACKSLASH BEFORE AN END OF LINE continues the string onto the next line and adds nothing.
        at += next === 0x0d && bytes[at + 2] === 0x0a ? 3 : 2;
      } else {
        out.push(escaped[next] ?? next);
        at += 2;
      }
      continue;
    }
    if (c === 0x28) depth += 1;
    if (c === 0x29) {
      depth -= 1;
      if (depth === 0) return { bytes: Uint8Array.from(out), end: at + 1 };
    }
    out.push(c);
    at += 1;
  }
  throw new Error('a literal string in the content stream is not closed');
}

/** A hexadecimal string's bytes from `start` (its `<`), and where it ends: an odd last digit is followed by 0. */
function hexString(bytes: Uint8Array, start: number): { readonly bytes: Uint8Array; readonly end: number } {
  const digits: number[] = [];
  let at = start + 1;
  while (at < bytes.length && bytes[at] !== 0x3e) {
    const c = bytes[at] ?? 0;
    if (!WHITE.has(c)) {
      const value = Number.parseInt(String.fromCharCode(c), 16);
      if (Number.isNaN(value)) throw new Error('a hexadecimal string in the content stream holds a character that is not a digit');
      digits.push(value);
    }
    at += 1;
  }
  if (at >= bytes.length) throw new Error('a hexadecimal string in the content stream is not closed');
  if (digits.length % 2 === 1) digits.push(0);
  const out = new Uint8Array(digits.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = ((digits[2 * index] ?? 0) << 4) | (digits[2 * index + 1] ?? 0);
  return { bytes: out, end: at + 1 };
}

/** The first `word` at or after `from` with whitespace before and after it, or the end of the bytes. */
function wordAt(bytes: Uint8Array, word: string, from: number): number {
  const a = word.charCodeAt(0);
  const b = word.charCodeAt(1);
  for (let at = from; at + 1 < bytes.length; at += 1) {
    if (bytes[at] === a && bytes[at + 1] === b && WHITE.has(bytes[at - 1] ?? 0x20) && WHITE.has(bytes[at + 2] ?? 0x20)) {
      return at;
    }
  }
  return bytes.length;
}

/** Every token of `bytes`, arrays as one token holding theirs. */
function tokenise(bytes: Uint8Array): Token[] {
  const latin1 = new TextDecoder('latin1');
  const stack: { start: number; items: Token[] }[] = [];
  const top: Token[] = [];
  const emit = (token: Token): void => {
    (stack.at(-1)?.items ?? top).push(token);
  };
  let at = 0;
  while (at < bytes.length) {
    const c = bytes[at] ?? 0;
    if (WHITE.has(c)) {
      at += 1;
      continue;
    }
    if (c === 0x25) {
      while (at < bytes.length && bytes[at] !== 0x0a && bytes[at] !== 0x0d) at += 1;
      continue;
    }
    if (c === 0x28) {
      const string = literalString(bytes, at);
      emit({ kind: 'string', bytes: string.bytes, start: at, end: string.end });
      at = string.end;
      continue;
    }
    if (c === 0x3c && bytes[at + 1] === 0x3c) {
      // A DICTIONARY OPERAND (marked content's properties) is kept as one opaque token: nothing here reads it.
      let depth = 0;
      const start = at;
      while (at < bytes.length) {
        if (bytes[at] === 0x3c && bytes[at + 1] === 0x3c) {
          depth += 1;
          at += 2;
        } else if (bytes[at] === 0x3e && bytes[at + 1] === 0x3e) {
          depth -= 1;
          at += 2;
          if (depth === 0) break;
        } else if (bytes[at] === 0x28) {
          at = literalString(bytes, at).end;
        } else {
          at += 1;
        }
      }
      emit({ kind: 'other', start, end: at });
      continue;
    }
    if (c === 0x3c) {
      const string = hexString(bytes, at);
      emit({ kind: 'string', bytes: string.bytes, start: at, end: string.end });
      at = string.end;
      continue;
    }
    if (c === 0x5b) {
      stack.push({ start: at, items: [] });
      at += 1;
      continue;
    }
    if (c === 0x5d) {
      const open = stack.pop();
      if (open === undefined) throw new Error('an array in the content stream closes without opening');
      at += 1;
      emit({ kind: 'array', items: open.items, start: open.start, end: at });
      continue;
    }
    let end = at + 1;
    if (c === 0x2f) {
      while (end < bytes.length && !WHITE.has(bytes[end] ?? 0) && !DELIMITERS.has(bytes[end] ?? 0)) end += 1;
      emit({ kind: 'name', value: latin1.decode(bytes.subarray(at + 1, end)), start: at, end });
      at = end;
      continue;
    }
    while (end < bytes.length && !WHITE.has(bytes[end] ?? 0) && !DELIMITERS.has(bytes[end] ?? 0)) end += 1;
    const word = latin1.decode(bytes.subarray(at, end));
    if (NUMBER.test(word)) {
      emit({ kind: 'number', value: Number(word), start: at, end });
    } else if (word === 'true' || word === 'false' || word === 'null') {
      emit({ kind: 'other', start: at, end });
    } else if (word === 'BI') {
      // AN INLINE IMAGE'S DATA IS BYTES, not tokens: the instruction runs to the EI after its ID.
      const ei = wordAt(bytes, 'EI', wordAt(bytes, 'ID', end) + 3);
      emit({ kind: 'operator', value: 'BI', start: at, end: Math.min(bytes.length, ei + 2) });
      end = Math.min(bytes.length, ei + 2);
    } else {
      emit({ kind: 'operator', value: word, start: at, end });
    }
    at = end;
  }
  if (stack.length > 0) throw new Error('an array in the content stream is not closed');
  return top;
}

/** The text state of §9.3 at one operator, and the two matrices of §9.4.2. */
export interface TextState {
  readonly font: string | null;
  readonly size: number;
  readonly charSpacing: number;
  readonly wordSpacing: number;
  /** Horizontal scaling, as a fraction: `Tz 100` is 1. */
  readonly scale: number;
  readonly leading: number;
  readonly rise: number;
  readonly render: number;
  /** The text matrix as the operator begins to show. */
  readonly matrix: Matrix;
  /** The text line matrix as the operator begins to show. */
  readonly line: Matrix;
  /** The current transformation matrix the operator shows under: every `cm` before it, through `q` and `Q`. */
  readonly ctm: Matrix;
}

/** One text-showing operator. */
export interface ShowOperator {
  /**
   * The text object PDFium numbers for it, or `null` for an operator that shows no code and so makes none: the rule
   * this module exists to state once.
   */
  readonly object: number | null;
  readonly operator: 'Tj' | 'TJ' | "'" | '"';
  /** The whole instruction, operands and operator, as byte offsets into the joined content. */
  readonly start: number;
  readonly end: number;
  /** Every character code byte it shows, strings joined in order. */
  readonly codes: Uint8Array;
  /** For a `TJ`, each element: a string's bytes or an adjustment in thousandths of text space. */
  readonly elements: readonly (Uint8Array | number)[];
  /**
   * The text state as it begins to show — for `'` and `"`, after their own move to the next line. Its `matrix` is the one
   * the last positioning operator set: showing advances the matrix by widths this module does not know, so where earlier
   * operators showed since that positioning (`positionedAt`), the caller adds their advances.
   */
  readonly state: TextState;
  /**
   * The index, in the answer, of the first operator shown since the matrix was last set by `BT`, `Tm`, `Td`, `TD`, `T*`,
   * `'` or `"`: this operator's own index when it is the first. The operators from there to this one, this one
   * excluded, advanced the matrix before it.
   */
  readonly positionedAt: number;
  /** Where the `BT` of its text object begins. */
  readonly textObject: number;
  /**
   * The instructions between that `BT` and this operator that set what text is drawn WITH rather than where: the text
   * state, colour and the general graphics state. Their bytes reproduce this operator's state in a new text object.
   */
  readonly settings: readonly { readonly start: number; readonly end: number }[];
}

/** The operators that set how text is drawn, replayed into a new text object (ADR-0176 Decision 4). */
const SETTINGS = new Set([
  'Tc', 'Tw', 'Tz', 'TL', 'Tf', 'Tr', 'Ts',
  'w', 'J', 'j', 'M', 'd', 'ri', 'i', 'gs',
  'CS', 'cs', 'SC', 'SCN', 'sc', 'scn', 'G', 'g', 'RG', 'rg', 'K', 'k',
]);

const SHOWS = new Set(['Tj', 'TJ', "'", '"']);

/** The page's content streams joined, each followed by an end of line so no token runs from one into the next. */
export function joinedContent(streams: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(streams.reduce((total, stream) => total + stream.length + 1, 0));
  let at = 0;
  for (const stream of streams) {
    joined.set(stream, at);
    at += stream.length;
    joined[at] = 0x0a;
    at += 1;
  }
  return joined;
}

/** Every text-showing operator of a page's joined content, in order, numbered by PDFium's rule. */
export function showOperators(content: Uint8Array): readonly ShowOperator[] {
  const found: ShowOperator[] = [];
  let state: Omit<TextState, 'matrix' | 'line' | 'ctm'> = {
    font: null, size: 0, charSpacing: 0, wordSpacing: 0, scale: 1, leading: 0, rise: 0, render: 0,
  };
  let ctm: Matrix = IDENTITY;
  /** The graphics states `q` saved, text state and CTM included (§8.4.1). */
  const saved: { readonly state: typeof state; readonly ctm: Matrix }[] = [];
  let matrix: Matrix = IDENTITY;
  let line: Matrix = IDENTITY;
  let textObject = -1;
  let settings: { start: number; end: number }[] = [];
  let operands: Token[] = [];
  let numbered = 0;
  /** The index the next shown operator would have when the matrix was last set. */
  let positionedAt = 0;

  const nextLine = (tx: number, ty: number): void => {
    line = multiply([1, 0, 0, 1, tx, ty], line);
    matrix = line;
    positionedAt = found.length;
  };
  const number = (index: number): number => {
    const token = operands[index];
    return token?.kind === 'number' ? token.value : 0;
  };

  for (const token of tokenise(content)) {
    if (token.kind !== 'operator') {
      operands.push(token);
      continue;
    }
    const op = token.value;
    const start = operands[0]?.start ?? token.start;
    switch (op) {
      case 'q':
        saved.push({ state, ctm });
        break;
      case 'Q': {
        const restored = saved.pop();
        if (restored !== undefined) {
          state = restored.state;
          ctm = restored.ctm;
        }
        break;
      }
      case 'cm':
        ctm = multiply([number(0), number(1), number(2), number(3), number(4), number(5)], ctm);
        break;
      case 'BT':
        matrix = IDENTITY;
        line = IDENTITY;
        textObject = token.start;
        settings = [];
        positionedAt = found.length;
        break;
      case 'ET':
        textObject = -1;
        break;
      case 'Tc':
        state = { ...state, charSpacing: number(0) };
        break;
      case 'Tw':
        state = { ...state, wordSpacing: number(0) };
        break;
      case 'Tz':
        state = { ...state, scale: number(0) / 100 };
        break;
      case 'TL':
        state = { ...state, leading: number(0) };
        break;
      case 'Ts':
        state = { ...state, rise: number(0) };
        break;
      case 'Tr':
        state = { ...state, render: number(0) };
        break;
      case 'Tf': {
        const name = operands[0];
        state = { ...state, font: name?.kind === 'name' ? name.value : null, size: number(1) };
        break;
      }
      case 'Td':
        nextLine(number(0), number(1));
        break;
      case 'TD':
        state = { ...state, leading: -number(1) };
        nextLine(number(0), number(1));
        break;
      case 'Tm':
        line = [number(0), number(1), number(2), number(3), number(4), number(5)];
        matrix = line;
        positionedAt = found.length;
        break;
      case 'T*':
        nextLine(0, -state.leading);
        break;
      default:
        break;
    }
    if (op === "'" || op === '"') {
      if (op === '"') state = { ...state, wordSpacing: number(0), charSpacing: number(1) };
      nextLine(0, -state.leading);
    }
    if (SHOWS.has(op)) {
      const operand = operands.at(-1);
      const elements: (Uint8Array | number)[] =
        operand?.kind === 'array'
          ? operand.items.flatMap<Uint8Array | number>((item) =>
              item.kind === 'string' ? [item.bytes] : item.kind === 'number' ? [item.value] : [],
            )
          : operand?.kind === 'string'
            ? [operand.bytes]
            : [];
      const strings = elements.filter((element): element is Uint8Array => element instanceof Uint8Array);
      const codes = new Uint8Array(strings.reduce((total, string) => total + string.length, 0));
      let at = 0;
      for (const string of strings) {
        codes.set(string, at);
        at += string.length;
      }
      found.push({
        object: codes.length > 0 ? numbered : null,
        operator: op as ShowOperator['operator'],
        start,
        end: token.end,
        codes,
        elements,
        state: { ...state, matrix, line, ctm },
        positionedAt,
        textObject,
        settings: [...settings],
      });
      if (codes.length > 0) numbered += 1;
    } else if (textObject >= 0 && SETTINGS.has(op)) {
      settings.push({ start, end: token.end });
    }
    operands = [];
  }
  return found;
}

/** The operator PDFium's text object `object` is, or `undefined` where the content shows fewer. */
export function operatorOf(operators: readonly ShowOperator[], object: number): ShowOperator | undefined {
  return operators.find((operator) => operator.object === object);
}

/** How many text objects PDFium makes of this content: what the writer checks against PDFium's own count. */
export function textObjectCount(operators: readonly ShowOperator[]): number {
  return operators.filter((operator) => operator.object !== null).length;
}
