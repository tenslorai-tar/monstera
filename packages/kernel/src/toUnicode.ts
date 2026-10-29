/**
 * A font's ToUnicode CMap, read: which character each code draws, and which code draws a character
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
 * Decision 5: a word stays in the run's own font when the font's ToUnicode, read backwards, gives every character a
 * code). The one reader of the format in the kernel; `cidFont.ts` writes it.
 *
 * ## What it reads
 *
 * ISO 32000 §9.10.3 and the CMap specification (Technical Note 5014) as a ToUnicode stream uses them:
 * `begincodespacerange`, which fixes how many bytes a code is, `beginbfchar` and `beginbfrange` in both of its forms (a
 * starting destination incremented in its last byte, and an array of destinations). Destinations are UTF-16BE, so a
 * character past the BMP arrives as its surrogate pair and is read whole. Everything else in the stream — the PostScript
 * that wraps a CMap, `usecmap` — is skipped: a ToUnicode names no parent in practice, and one that did would be read as
 * what it says itself, never as more.
 */

import { type Result, err, ok } from '@monstera/shared';

/** A ToUnicode read: each code's text, and how many bytes a code is. */
export interface ToUnicode {
  /** The text each code draws, by code. */
  readonly text: ReadonlyMap<number, string>;
  /** How many bytes one code is: the codespace's, or 1 where the CMap declares none. */
  readonly bytes: 1 | 2 | 3 | 4;
}

type Token = { readonly hex: Uint8Array } | { readonly word: string } | { readonly array: readonly Uint8Array[] };

const WHITE = /\s/u;

function tokens(source: string): Result<Token[], string> {
  const out: Token[] = [];
  let at = 0;
  let array: Uint8Array[] | null = null;
  while (at < source.length) {
    const c = source.charAt(at);
    if (WHITE.test(c)) {
      at += 1;
    } else if (c === '%') {
      while (at < source.length && source.charAt(at) !== '\n' && source.charAt(at) !== '\r') at += 1;
    } else if ((c === '<' || c === '>') && source.charAt(at + 1) === c) {
      // A DICTIONARY'S BRACKETS, `<<` and `>>`, are two characters each: read as one, never as a hexadecimal string.
      out.push({ word: c + c });
      at += 2;
    } else if (c === '<') {
      const end = source.indexOf('>', at);
      if (end < 0) return err('a hexadecimal string that is not closed');
      let digits = source.slice(at + 1, end).replace(/\s+/gu, '');
      if (!/^[0-9a-fA-F]*$/u.test(digits)) return err('a hexadecimal string with a character that is not a digit');
      if (digits.length % 2 === 1) digits += '0';
      const hex = new Uint8Array(digits.length / 2);
      for (let index = 0; index < hex.length; index += 1) hex[index] = Number.parseInt(digits.slice(2 * index, 2 * index + 2), 16);
      if (array === null) out.push({ hex });
      else array.push(hex);
      at = end + 1;
    } else if (c === '[') {
      array = [];
      at += 1;
    } else if (c === ']') {
      out.push({ array: array ?? [] });
      array = null;
      at += 1;
    } else if (c === '(') {
      // A LITERAL STRING appears only in the PostScript around the CMap (a name, a registry): skipped, nesting kept.
      let depth = 0;
      while (at < source.length) {
        const d = source.charAt(at);
        if (d === '\\') at += 1;
        else if (d === '(') depth += 1;
        else if (d === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        at += 1;
      }
      at += 1;
    } else {
      let end = at + 1;
      while (end < source.length && !WHITE.test(source.charAt(end)) && !'<>[]()%'.includes(source.charAt(end))) end += 1;
      if (array === null) out.push({ word: source.slice(at, end) });
      at = end;
    }
  }
  return ok(out);
}

/** A big-endian number of `bytes`. */
function codeOf(bytes: Uint8Array): number {
  let code = 0;
  for (const byte of bytes) code = code * 256 + byte;
  return code;
}

/** UTF-16BE `bytes` as text, surrogate pairs whole. */
function utf16(bytes: Uint8Array): string {
  const units: number[] = [];
  for (let at = 0; at + 1 < bytes.length; at += 2) units.push(((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0));
  return String.fromCharCode(...units);
}

/** The destination `start` incremented by `step` in its last unit, as §9.10.3's first `bfrange` form says. */
function incremented(start: Uint8Array, step: number): string {
  const units: number[] = [];
  for (let at = 0; at + 1 < start.length; at += 2) units.push(((start[at] ?? 0) << 8) | (start[at + 1] ?? 0));
  if (units.length === 0) return '';
  units[units.length - 1] = ((units[units.length - 1] ?? 0) + step) & 0xffff;
  return String.fromCharCode(...units);
}

/** The bound one `bfrange` may span: a two-byte range's whole space. */
const MAX_RANGE = 0x10000;

/**
 * Reads a ToUnicode CMap's bytes, or answers why it cannot: a stream that says what it cannot mean is a font whose
 * characters are unknown, an ANSWER for a writer that then keeps no word in that font, so it is a result and not a throw
 * (`ShapingFace.readable`'s reason).
 */
export function readToUnicode(cmap: Uint8Array): Result<ToUnicode, string> {
  const source = new TextDecoder('latin1').decode(cmap);
  const listed = tokens(source);
  if (!listed.ok) return listed;
  const list = listed.value;
  const text = new Map<number, string>();
  let width = 0;
  let at = 0;
  const hexAt = (index: number): Uint8Array | null => {
    const token = list[index];
    return token !== undefined && 'hex' in token ? token.hex : null;
  };
  while (at < list.length) {
    const token = list[at];
    const word = token !== undefined && 'word' in token ? token.word : null;
    at += 1;
    if (word === 'begincodespacerange') {
      while (at < list.length && !(list[at] !== undefined && 'word' in (list[at] ?? {}))) {
        const low = hexAt(at);
        if (low !== null) width = Math.max(width, low.length);
        at += 1;
      }
    } else if (word === 'beginbfchar') {
      while (hexAt(at) !== null && hexAt(at + 1) !== null) {
        text.set(codeOf(hexAt(at) ?? new Uint8Array()), utf16(hexAt(at + 1) ?? new Uint8Array()));
        at += 2;
      }
    } else if (word === 'beginbfrange') {
      while (hexAt(at) !== null && hexAt(at + 1) !== null) {
        const low = codeOf(hexAt(at) ?? new Uint8Array());
        const high = codeOf(hexAt(at + 1) ?? new Uint8Array());
        if (high < low || high - low >= MAX_RANGE) return err(`a range that runs from ${String(low)} to ${String(high)}`);
        const destination = list[at + 2];
        if (destination !== undefined && 'array' in destination) {
          destination.array.forEach((value, step) => {
            if (low + step <= high) text.set(low + step, utf16(value));
          });
        } else if (destination !== undefined && 'hex' in destination) {
          for (let code = low; code <= high; code += 1) text.set(code, incremented(destination.hex, code - low));
        } else {
          return err('a range with no destination');
        }
        at += 3;
      }
    }
  }
  const bytes = width === 0 ? 1 : width;
  if (bytes > 4) return err(`a codespace ${String(bytes)} bytes wide`);
  return ok({ text, bytes: bytes as ToUnicode['bytes'] });
}

/**
 * `text` with each JOINED-LETTER presentation form (U+FB00 to U+FB06: ff, fi, fl, ffi, ffl, long s t, st) spelt as the
 * letters it joins, and everything else as it is. A browser's print names a ligature glyph of a drawn font by its
 * presentation form in the ToUnicode and marks it `/ActualText` with its letters, which is what both engines read the
 * word as (measured 2026-10-29, Chromium 151 printing Carlito, cloud run 25 item 25b). Only these forms: NFKC would also
 * make `²` a `2` and a full-width letter a narrow one, which are different glyphs, not joined letters.
 */
export function lettersOf(text: string): string {
  return Array.from(text, (character) => {
    const point = character.codePointAt(0) ?? 0;
    return point >= JOINED_LETTERS.first && point <= JOINED_LETTERS.last ? character.normalize('NFKC') : character;
  }).join('');
}

/** The code points of the joined-letter presentation forms (Unicode's Alphabetic Presentation Forms, Latin ligatures). */
export const JOINED_LETTERS = { first: 0xfb00, last: 0xfb06 } as const;

/**
 * The codes that draw `characters`, or `null` where some part has none: the CMap read backwards. A character's own code
 * is taken where it has one, as always; only where it has none is a code naming that character and the ones after it
 * looked for, the shortest first — a glyph PDFium reads as `=` and a mark, one code for two characters, or a joined-letter
 * glyph named by its presentation form, found by its letters ({@link lettersOf}). So text a single-character code already
 * sets is set exactly as before, and a ligature is never chosen over its letters. Where two codes name the same text the
 * lowest is taken, so the answer is the same on every run; a code's letters are a name only where no code says them.
 */
export function codesFor(map: ToUnicode, characters: string): number[] | null {
  const backwards = new Map<string, number>();
  let longest = 1;
  const sorted = [...map.text].sort(([left], [right]) => left - right);
  for (const [code, value] of sorted) {
    if (value === '' || backwards.has(value)) continue;
    backwards.set(value, code);
    longest = Math.max(longest, Array.from(value).length);
  }
  for (const [code, value] of sorted) {
    const letters = lettersOf(value);
    if (letters === value || backwards.has(letters)) continue;
    backwards.set(letters, code);
    longest = Math.max(longest, Array.from(letters).length);
  }
  const points = Array.from(characters);
  // FROM THE END BACK: `rest[at]` is the codes that draw the characters from `at` on, or `null` where none do — each point
  // taking the SHORTEST text that leaves the rest drawable, so a letter's own code wins wherever the letters after it can
  // still be drawn, and a two-character code is used only where it must be.
  const rest: (readonly number[] | null)[] = new Array<readonly number[] | null>(points.length + 1).fill(null);
  rest[points.length] = [];
  for (let at = points.length - 1; at >= 0; at -= 1) {
    for (let length = 1; length <= Math.min(longest, points.length - at); length += 1) {
      const code = backwards.get(points.slice(at, at + length).join(''));
      const after = rest[at + length];
      if (code !== undefined && after !== null && after !== undefined) {
        rest[at] = [code, ...after];
        break;
      }
    }
  }
  return rest[0] === null || rest[0] === undefined ? null : [...rest[0]];
}
