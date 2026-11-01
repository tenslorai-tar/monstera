/**
 * WHERE A PERSON'S TEXT MAY BE CUT AT A CHANNEL'S BOUND: the one rule every selection command takes, so no caller writes
 * its own `slice` and none cuts in silence. A cut is never presented as the whole: each caller either carries the whole
 * length with what it cut, so the line under an asked turn says *cut short* (`carriedSelection`), or sends every piece
 * (`translationPieces`, in `channels.ts`), so nothing is dropped.
 *
 * At the last white space at or before the bound, so a word is not split in two, and never between the two halves of a
 * surrogate pair. Text with no white space in reach is cut at the bound itself, one unit earlier where that would split a
 * pair.
 *
 * @returns the length of the part that stays, between 1 and `bound` for any text longer than `bound`; the whole length
 *   for text within it
 */
export function cutPoint(text: string, bound: number): number {
  if (text.length <= bound) return text.length;
  // THE LAST WHITE SPACE IN REACH, kept with the part before it, so joining the parts again needs no separator.
  for (let at = bound; at > bound / 2; at -= 1) {
    if (/\s/u.test(text.charAt(at - 1))) return at;
  }
  const code = text.charCodeAt(bound - 1);
  // A HIGH SURROGATE LAST would leave its low half in the next part.
  return code >= 0xd800 && code <= 0xdbff ? bound - 1 : bound;
}
