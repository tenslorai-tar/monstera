/**
 * When a replacement would have to move the text after it on its line (the owner's answer of 2026-10-05).
 *
 * A text object keeps its origin when its string changes, so a wider replacement draws into the object after it on the
 * line and a narrower one leaves a gap before it. Moving those objects needs the line: which objects make it up, in
 * what order, with what spacing. That is ADR-0049's grouping, which the editor confirms with the person and a Replace
 * does not have, so a Replace that would need it is refused and writes nothing. The fix that moves them is P1 (fonts)
 * and P2 (paragraphs).
 *
 * ## The boxes are the characters', not the objects'
 *
 * `textRuns`' reason: `FPDFPageObj_GetBounds` includes the font's ascent and descent, so adjacent lines' object boxes
 * overlap and every line would read as following every other. The characters' ink decides the line, and their
 * advances decide where a run ends ({@link RunBox}).
 *
 * ## Erring towards refusal
 *
 * *Follows on the line* is any object whose characters overlap the replaced one's vertically by more than half the
 * shorter height and which starts to the right of the replaced one's start. Text in another column on the same baseline
 * counts, so a replacement there is refused that a person might have accepted; the refusal writes nothing and names the
 * tool that can make the edit, and the wrong answer the other way overwrites a word.
 */

/**
 * One text object on its line, in page space: where its characters' ink starts and spans vertically, and where its
 * last ADVANCE ends, which is where the text after it starts. The end is the advance's and not the ink's: `WID` and
 * `WDI` are one width in Helvetica and end their ink at different places, and an ink rule refused the second as a move.
 */
export interface RunBox {
  readonly left: number;
  readonly end: number;
  readonly bottom: number;
  readonly top: number;
}

/**
 * How far a run's end may move, in points, before the text after it would have to: a quarter of a point, under any
 * gap a reader sees and over the rounding of reading the same characters' boxes twice.
 */
export const LINE_EDGE_TOLERANCE = 0.25;

/** Whether `a` and `b` sit on one line: their characters overlap vertically by more than half the shorter height. */
function onOneLine(a: RunBox, b: RunBox): boolean {
  const overlap = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
  return overlap > 0.5 * Math.min(a.top - a.bottom, b.top - b.bottom);
}

/**
 * The replaced objects whose new width would move text after them on their line, by index.
 *
 * @param before every text object's box before the write, by index
 * @param after each replaced object's box after the write by index, or `null` where the replacement removes it; an
 *   object missing here is one whose write could not be measured, which the read-back refuses on its own terms
 */
export function replacementsMovingTheirLine(
  before: ReadonlyMap<number, RunBox>,
  after: ReadonlyMap<number, RunBox | null>,
): number[] {
  const moving: number[] = [];
  for (const [index, now] of after) {
    const was = before.get(index);
    if (was === undefined) continue;
    const end = now === null ? was.left : now.end;
    if (Math.abs(end - was.end) <= LINE_EDGE_TOLERANCE) continue;
    const followed = [...before].some(
      ([other, box]) => other !== index && after.get(other) !== null && box.left > was.left + LINE_EDGE_TOLERANCE && onOneLine(was, box),
    );
    if (followed) moving.push(index);
  }
  return moving;
}
