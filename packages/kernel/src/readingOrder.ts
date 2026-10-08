/**
 * The order right-to-left text is READ in, from where its characters sit
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * ## Why the places and not PDFium's order
 *
 * A producer draws a right-to-left line in the order the glyphs appear on the page, left to right, and PDFium then answers
 * a different order depending on how the line was drawn. Measured 2026-10-08 against PDFium 155.0.8044.0 and 153.0.7999.0,
 * on one Hebrew sentence: a type 0 font with one text object of glyphs came back with each word's letters in reading order
 * and the words as they sit; the same words drawn by MuPDF's layout engine (the producer of Monstera's own text boxes) came
 * back with the letters of each word as they sit too. Nothing in the answer says which it is, and a deck that wrote either
 * as given shows a right-to-left paragraph backwards. Where each character starts across the page is true of every
 * producer, so the reading order is derived from that and from nothing PDFium decided.
 *
 * ## What it is, and is not
 *
 * Not the Unicode bidirectional algorithm. A line whose base direction is right to left, read from its visual order:
 * words that are right to left are reversed, and a run of words that read left to right (a Latin phrase, a number)
 * keeps its own order and moves as one. Nested embeddings, explicit direction marks and mirrored brackets are left as
 * drawn. A combining mark has no place of its own and is not ordered by one.
 */

const RIGHT_TO_LEFT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/gu;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** How many characters of `text` are in a script that runs right to left. */
export function rightToLeftCount(text: string): number {
  return (text.match(RIGHT_TO_LEFT) ?? []).length;
}

/**
 * A line's units (words, or runs) in the order they are READ, from the order they sit left to right.
 *
 * A unit holding any right-to-left character is a right-to-left unit. Units that read left to right and sit together keep
 * their own order and move as one, so `עולם see figure 3 שלום` reads `שלום see figure 3 עולם`, not `שלום 3 figure see עולם`.
 */
export function logicalWordOrder<T extends { readonly text: string }>(units: readonly T[]): T[] {
  const runsRight = (unit: T): boolean => rightToLeftCount(unit.text) > 0;
  const segments: { readonly right: boolean; readonly units: T[] }[] = [];
  for (const unit of units) {
    const right = runsRight(unit);
    const last = segments[segments.length - 1];
    if (last?.right === right) last.units.push(unit);
    else segments.push({ right, units: [unit] });
  }
  return segments.reverse().flatMap((segment) => (segment.right ? segment.units.reverse() : segment.units));
}

/** One drawn character and where it starts across the page. */
interface Placed {
  readonly char: string;
  readonly left: number;
}

type Strong = 'right' | 'left';

/** A word's characters, as they sit, in the order they are read. A word with no right-to-left character is untouched. */
function readWord(placed: readonly Placed[], asAnswered: string): string {
  if (rightToLeftCount(asAnswered) === 0) return asAnswered;
  const sitting = [...placed].sort((a, b) => a.left - b.left);
  const strong = sitting.map((entry): Strong | undefined =>
    rightToLeftCount(entry.char) > 0 ? 'right' : WORD_CHARACTER.test(entry.char) ? 'left' : undefined,
  );
  // A NEUTRAL (a mark of punctuation) takes the direction of the text on both sides when they agree, and the line's
  // own, right to left, when they do not.
  const resolved = strong.map((direction, at): Strong => {
    if (direction !== undefined) return direction;
    let before: Strong | undefined;
    for (let back = at - 1; back >= 0 && before === undefined; back -= 1) before = strong[back];
    let after: Strong | undefined;
    for (let ahead = at + 1; ahead < strong.length && after === undefined; ahead += 1) after = strong[ahead];
    return before === 'left' && after === 'left' ? 'left' : 'right';
  });
  const segments: { readonly right: boolean; readonly chars: string[] }[] = [];
  sitting.forEach((entry, at) => {
    const right = resolved[at] === 'right';
    const last = segments[segments.length - 1];
    if (last?.right === right) last.chars.push(entry.char);
    else segments.push({ right, chars: [entry.char] });
  });
  return segments
    .reverse()
    .map((segment) => (segment.right ? segment.chars.reverse() : segment.chars).join(''))
    .join('');
}

/**
 * `text` as PDFium answered it, in the order it is read.
 *
 * @param text the run's text, spaces included, and any space PDFium made up between two objects
 * @param lefts where each character of `text` that is NOT a space starts across the page, in the order `text` holds them
 * @returns the text unchanged where it has no right-to-left character, or where `lefts` does not account for its characters
 */
export function readingOrder(text: string, lefts: readonly number[]): string {
  if (rightToLeftCount(text) === 0) return text;
  const words = text.split(' ').filter((word) => word !== '');
  if (words.reduce((sum, word) => sum + word.length, 0) !== lefts.length) return text;
  let at = 0;
  const sitting = words.map((word) => {
    const placed = word.split('').map((char, index) => ({ char, left: lefts[at + index] ?? 0 }));
    at += word.length;
    return { text: readWord(placed, word), left: Math.min(...placed.map((entry) => entry.left)) };
  });
  sitting.sort((a, b) => a.left - b.left);
  return logicalWordOrder(sitting)
    .map((word) => word.text)
    .join(' ');
}
