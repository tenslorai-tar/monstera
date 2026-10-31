import { MAX_TEXT_LAYER_LINE, MAX_TEXT_LAYER_LINES } from '@monstera/contract/host';

/**
 * WHERE EACH LETTER OF A PAGE'S TEXT LAYER IS: the one format, its one writer and its one reader (in `main`), side by
 * side ([ADR-0280](../../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md) and its
 * second correction), to cross in a file beside `engine/page-text`'s answer, binary, little-endian.
 *
 * **NOTHING PRODUCES THE WALKED LINES YET, and that is the open question, not an oversight.** Measured 2026-10-31 by
 * cloud run 30: the binding's `StructuredText.walk` skips structure blocks (`mupdfRaw.ts`, `block_type === 2`), and the
 * substrate read's `segment` puts every line inside one, so it walks no character of the read the JSON comes from; and
 * the walk costs about seven FFI calls and a new `Font` per character, 14.8 to 25 ms on a dense page beside the JSON's
 * 1.7 to 2.5. Which producer to build is the owner's (B4); this module is what any of them writes into.
 *
 * ## One record per walked line, in the walk's order, for the first `MAX_TEXT_LAYER_LINES` lines
 *
 * | bytes | field |
 * |---|---|
 * | 2 | direction x, a signed 16-bit fraction of {@link DIRECTION_ONE} |
 * | 2 | direction y, the same |
 * | 2 | glyph size, unsigned 16-bit, hundredths of a point |
 * | 4 | check value: 32-bit FNV-1a over the line's characters AS THE BINDING CUTS THEM (below) |
 * | 2 | how many advances follow, unsigned 16-bit, at most `MAX_TEXT_LAYER_LINE` |
 * | 2 × n | each character's advance along the direction, signed 16-bit, hundredths of a point |
 *
 * So a line is 12 + 2n bytes, and a page at most {@link LETTERS_FILE_MAX_BYTES}.
 *
 * ## One advance per CHARACTER, and the check value, because the host cannot tell what a character was
 *
 * The binding builds each character it hands `onChar` with `String.fromCharCode` (`mupdfRaw.ts`), which keeps the low
 * 16 bits of a code point past U+FFFF: an emoji arrives as one unit that is not what the page holds, and the host cannot
 * know it was cut. MuPDF still calls `onChar` once per character, with that character's own origin and quad, so the
 * advances are right; only the value is cut. `main`, which holds the line's real text from the JSON, applies the SAME
 * cut to each of its code points ({@link cutOf}) and compares check values — an exact pairing on both sides, with no
 * change to the binding — then gives a code point past U+FFFF its advance on its first UTF-16 unit and 0 on its second.
 *
 * A line whose letters the host cannot carry — an advance past {@link ADVANCE_LIMIT} either way — is written with no
 * advances; `main` then finds its count wrong and places that line as today. So is a line whose check value or count
 * disagrees with the JSON's: the host is hostile by invariant 25, and nothing it says about a line is used unchecked.
 */

/** The fixed part of a line's record, in bytes. */
export const LETTERS_LINE_HEADER_BYTES = 12;

/** Bytes per advance. */
const ADVANCE_BYTES = 2;

/**
 * The largest letters' file one page may produce, DERIVED from the text layer's own two bounds: the host writes records
 * for at most `MAX_TEXT_LAYER_LINES` lines, each at most `MAX_TEXT_LAYER_LINE` advances. 2,048 × (12 + 2 × 1,024) =
 * 4,218,880 bytes. `main` refuses an answer naming more before it reads a byte.
 */
export const LETTERS_FILE_MAX_BYTES = MAX_TEXT_LAYER_LINES * (LETTERS_LINE_HEADER_BYTES + ADVANCE_BYTES * MAX_TEXT_LAYER_LINE);

/** A direction component of 1, as the file writes it. */
export const DIRECTION_ONE = 16384;

/** The furthest one advance may go either way, in points: what a signed 16-bit count of hundredths holds. */
export const ADVANCE_LIMIT = 32767 / 100;

/** One line's letters as `main` reads them, once checked against the line's text. */
export interface LineLetters {
  /** The unit vector along the line, in the page's display space. */
  readonly direction: { readonly x: number; readonly y: number };
  /** The glyph size, in points. */
  readonly size: number;
  /** Each UTF-16 unit's advance along the direction, in hundredths of a point: one per unit of the line's text. */
  readonly advances: readonly number[];
}

/** One walked line, as the host collects it from `beginLine` and `onChar`. */
export interface WalkedLine {
  readonly direction: { readonly x: number; readonly y: number };
  readonly size: number;
  /** Each character as the binding handed it, and its origin; then where the last one ends. */
  readonly characters: readonly { readonly c: string; readonly x: number; readonly y: number }[];
  readonly end: { readonly x: number; readonly y: number };
}

/** A code point as the binding's `String.fromCharCode` leaves it: its low 16 bits. The ONE statement of the cut. */
export function cutOf(codePoint: number): number {
  return codePoint & 0xffff;
}

/** 32-bit FNV-1a over a sequence of 16-bit values. */
function fnv(values: Iterable<number>): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= value >>> 8;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * THE WRITER, in the host: each walked line's record, for the first `MAX_TEXT_LAYER_LINES` lines and the first
 * `MAX_TEXT_LAYER_LINE` characters of each, as the text layer keeps them.
 */
export function writeLetters(lines: readonly WalkedLine[]): Uint8Array {
  const kept = lines.slice(0, MAX_TEXT_LAYER_LINES);
  const records = kept.map((line) => {
    const characters = line.characters.slice(0, MAX_TEXT_LAYER_LINE);
    // A CLIPPED LINE ENDS WHERE ITS FIRST DROPPED LETTER BEGINS, so its last kept letter advances as every other does;
    // the end of the whole line would give that one letter the width of everything dropped.
    const end = line.characters[characters.length] ?? line.end;
    const first = characters[0] ?? end;
    // EACH LETTER'S PLACE ROUNDED, and the advances their differences, so a line's last letter is as near its place as
    // its first: rounding each advance alone would let the error grow along the line, half a hundredth a letter.
    const place = (to: { x: number; y: number }): number => Math.round(((to.x - first.x) * line.direction.x + (to.y - first.y) * line.direction.y) * 100);
    const places = [...characters.map(place), place(end)];
    const advances = characters.map((_, at) => (places[at + 1] ?? 0) - (places[at] ?? 0));
    // A LINE THAT CANNOT BE CARRIED carries no advances, and `main` places it as today.
    const carried = advances.every((advance) => Math.abs(advance) <= 32767) ? advances : [];
    return { line, characters, advances: carried };
  });
  const bytes = new Uint8Array(records.reduce((sum, record) => sum + LETTERS_LINE_HEADER_BYTES + ADVANCE_BYTES * record.advances.length, 0));
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const { line, characters, advances } of records) {
    view.setInt16(at, Math.round(line.direction.x * DIRECTION_ONE), true);
    view.setInt16(at + 2, Math.round(line.direction.y * DIRECTION_ONE), true);
    view.setUint16(at + 4, Math.min(0xffff, Math.max(0, Math.round(line.size * 100))), true);
    view.setUint32(at + 6, fnv(characters.map((character) => character.c.charCodeAt(0))), true);
    view.setUint16(at + 10, advances.length, true);
    at += LETTERS_LINE_HEADER_BYTES;
    for (const advance of advances) {
      view.setInt16(at, advance, true);
      at += ADVANCE_BYTES;
    }
  }
  return bytes;
}

/** Why a letters' file was not used at all; a single line that disagrees is not a reason, it falls back alone. */
export type LettersRefusal = 'past-bound' | 'malformed';

/**
 * THE READER, in `main`: each of the page's lines' letters, or `undefined` for a line that is placed as today. `texts`
 * are the lines' texts as the text layer keeps them, in order. A file past the bound, or one whose records run past its
 * end, is refused whole; a line whose count or check value disagrees with its text falls back alone.
 */
export function readLetters(bytes: Uint8Array, texts: readonly string[]): { readonly lines: readonly (LineLetters | undefined)[] } | { readonly refused: LettersRefusal } {
  if (bytes.length > LETTERS_FILE_MAX_BYTES) return { refused: 'past-bound' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lines: (LineLetters | undefined)[] = [];
  let at = 0;
  for (const text of texts) {
    if (at === bytes.length) {
      lines.push(undefined);
      continue;
    }
    if (at + LETTERS_LINE_HEADER_BYTES > bytes.length) return { refused: 'malformed' };
    const direction = { x: view.getInt16(at, true) / DIRECTION_ONE, y: view.getInt16(at + 2, true) / DIRECTION_ONE };
    const size = view.getUint16(at + 4, true) / 100;
    const check = view.getUint32(at + 6, true);
    const count = view.getUint16(at + 10, true);
    at += LETTERS_LINE_HEADER_BYTES;
    if (at + ADVANCE_BYTES * count > bytes.length) return { refused: 'malformed' };
    const advances: number[] = [];
    for (let k = 0; k < count; k += 1) advances.push(view.getInt16(at + ADVANCE_BYTES * k, true));
    at += ADVANCE_BYTES * count;
    lines.push(paired(text, { direction, size, check, advances }));
  }
  return { lines };
}

/**
 * One line's record against its text: the same count of characters, the same check value over the binding's cut of
 * each, and a direction that is a direction — or `undefined`, and the line is placed as today. Each character's advance
 * goes on its first UTF-16 unit; a code point past U+FFFF advances 0 on its second.
 */
function paired(text: string, record: { direction: { x: number; y: number }; size: number; check: number; advances: readonly number[] }): LineLetters | undefined {
  const points = Array.from(text, (character) => character.codePointAt(0) ?? 0);
  if (points.length !== record.advances.length || points.length === 0) return undefined;
  if (fnv(points.map(cutOf)) !== record.check) return undefined;
  const length = Math.hypot(record.direction.x, record.direction.y);
  if (!(Math.abs(length - 1) < 0.01)) return undefined;
  const advances: number[] = [];
  points.forEach((point, k) => {
    advances.push(record.advances[k] ?? 0);
    if (point > 0xffff) advances.push(0);
  });
  return { direction: { x: record.direction.x / length, y: record.direction.y / length }, size: record.size, advances };
}
