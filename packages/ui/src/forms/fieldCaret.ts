/**
 * Where a caret goes in a line of text, given how far along the line a press landed (ADR-0226 Decision 3).
 *
 * `widthOf` measures a prefix of the text in the face the box shows it in; the caret goes to the boundary between two
 * characters nearest the press, so a press on the right half of a letter puts the caret after it, as a text box does.
 * Measured by prefix rather than by summing letters, so kerning and ligatures the face applies are counted as drawn.
 *
 * A press before the start is the start and past the end is the end. Boundaries are between UTF-16 code units, except
 * that a caret is never put inside a surrogate pair, which would split one character into two halves nobody can see.
 */
export function caretIndexAt(text: string, x: number, widthOf: (prefix: string) => number): number {
  if (x <= 0 || text === '') return 0;
  let best = 0;
  let bestDistance = Math.abs(x);
  for (let at = 1; at <= text.length; at += 1) {
    const code = text.charCodeAt(at - 1);
    // INSIDE A SURROGATE PAIR, after its high half: not a boundary.
    if (code >= 0xd800 && code <= 0xdbff && at < text.length) continue;
    const distance = Math.abs(widthOf(text.slice(0, at)) - x);
    if (distance < bestDistance) {
      best = at;
      bestDistance = distance;
    }
  }
  return best;
}
