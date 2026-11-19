/**
 * The type size of a line of recognised words, from how tall each word's box is and which letters it holds: the ONE
 * statement of that reading (B3a). The recognition layer sets every word of a line at it (`ocrTextLayer.ts`), and the
 * operator writer reads it again from a layer written before that, which sized each word by its own box
 * (`operatorEdit.ts`).
 *
 * ## Why a box is not a size
 *
 * A recogniser's word box runs from the word's lowest ink to its highest, so it depends on the letters: *are* reaches the
 * x-height, *The* the capitals, *year* the descender. Taken as the size, one line of 10.5-point text read 4.7 to 10.1
 * points on the guide's scan (2026-11-19), and every reader of the page saw a line of a dozen sizes: the editor drew the
 * words at them, the block grouping measured word gaps in them and split a paragraph into words, and an edit set the
 * line in them.
 *
 * ## The proportions
 *
 * Read from the common Latin faces, in ems: capitals, digits and ascenders reach 0.72 (Helvetica 0.718, Arial 0.716,
 * Times 0.662 to 0.683), the x-height is 0.52 (Helvetica 0.523, Arial 0.519, Times 0.448), and descenders fall 0.21
 * (Helvetica 0.207, Times 0.217). A word's box is its top less its bottom; the size is its height over that. The line
 * takes the MEDIAN of its words, so a face whose proportions differ moves a few words' readings and not the line's, and
 * most words of a line reach an ascender, where the faces agree best.
 *
 * Only words of Latin letters, digits and common punctuation are read: another script's proportions are not these, and a
 * line with no such word answers `null`, for the caller to keep the box it has.
 */

/** How far capitals, digits and ascenders reach above the baseline, in ems. */
export const LATIN_ASCENT_EM = 0.72;
/** How far the x-height reaches above the baseline, in ems. */
const X_HEIGHT_EM = 0.52;
/** How far descenders fall below the baseline, in ems. */
export const LATIN_DESCENT_EM = 0.21;

/** A word this reading can measure: Latin letters, digits and the punctuation set among them. */
const MEASURABLE = /^[A-Za-z0-9.,;:'"!?()&%/-]+$/u;
const REACHES_UP = /[A-Z0-9bdfhiklt]/u;
const REACHES_DOWN = /[gjpqy]/u;

/** Whether `word` has a descender, so its box's foot is below its baseline. */
export function fallsBelow(word: string): boolean {
  return REACHES_DOWN.test(word);
}

/** The size one word's box says, or `undefined` where its letters are not ones this reading measures. */
function sizeOfWord(text: string, height: number): number | undefined {
  const word = text.trim();
  if (word.length === 0 || !MEASURABLE.test(word) || !/[A-Za-z0-9]/u.test(word) || !(height > 0)) return undefined;
  const top = REACHES_UP.test(word) ? LATIN_ASCENT_EM : X_HEIGHT_EM;
  const bottom = fallsBelow(word) ? LATIN_DESCENT_EM : 0;
  return height / (top + bottom);
}

/**
 * The type size of one line of words, each with its box's height along the line's upright: the median of what each
 * measurable word says, or `null` where none is measurable.
 */
export function typeSizeOfWords(words: readonly { readonly text: string; readonly height: number }[]): number | null {
  const sizes = words.flatMap((word) => {
    const size = sizeOfWord(word.text, word.height);
    return size === undefined ? [] : [size];
  });
  if (sizes.length === 0) return null;
  sizes.sort((a, b) => a - b);
  const middle = Math.floor(sizes.length / 2);
  return sizes.length % 2 === 1 ? (sizes[middle] ?? null) : ((sizes[middle - 1] ?? 0) + (sizes[middle] ?? 0)) / 2;
}
