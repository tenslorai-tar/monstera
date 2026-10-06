import { hasRightToLeftLetter, logicalFromDrawn } from './bidiOrder.js';

/**
 * A run as the reading of a line needs it: the glyphs it draws in the order they are drawn, the text it says on its own,
 * and where its glyphs begin.
 */
export interface DrawnRun {
  /** The run's glyphs, left to right as drawn ({@link readBackOf}'s inverse of what a text page read). */
  readonly drawn: string;
  /** What the run says read alone: the answer where the line cannot be taken as a whole. */
  readonly text: string;
  readonly left: number;
}

/** A line's runs in the order the line reads, and what each says. */
export interface LogicalLine<T> {
  readonly runs: readonly T[];
  readonly texts: readonly string[];
}

/**
 * One line, made of one object or several, in the order it was typed
 * ([ADR-0185](../../../docs/DECISIONS/0185-a-line-of-several-objects-is-read-and-written-as-one-line.md)).
 *
 * ## The reordering belongs to the LINE
 *
 * A page stores the glyphs in the order they are drawn, and a text page reads the objects of a line by position. The
 * order the line was typed in is the algorithm's reordering of the whole drawn line (rules L1 and L2), so it is found
 * here, once, from every run of the line: the glyphs of each run, in drawing order, concatenated left to right; the
 * line's direction by its majority ({@link logicalFromDrawn}); and the line as typed, with where each of its units came
 * from. Measured 2026-10-06 on PDFium 155.0.8044.0's Linux build, a line this editor wrote in two objects,
 * `Hello مرحبا العالم`, was read as ` مرحبا العالمHello` when each object was reordered alone.
 *
 * ## A run keeps its place in the line, and its text is the line's own words over it
 *
 * Each run's text is the part of the line as typed that its glyphs came from, and the runs come back in the order of
 * those parts, so that joining them gives the line as typed and an edit names runs by the words they hold. That is
 * possible when every run's glyphs end up together in the line as typed, which reordering whole objects of one direction
 * always gives. Where a run's glyphs are split by another's (a run that ends in the middle of a right-to-left phrase in
 * the other's direction), the line cannot be named by runs, and each run keeps the text it has read alone, in the order
 * it was given: the document is as it was and the editor shows each run's own words, which is what an engine that has no
 * notion of a line would show.
 *
 * A line with no right-to-left letter in it is returned as it came.
 *
 * @param runs the line's runs, in the order the page gives them
 */
export function logicalLine<T extends DrawnRun>(runs: readonly T[]): LogicalLine<T> {
  const given: LogicalLine<T> = { runs, texts: runs.map((run) => run.text) };
  if (!runs.some((run) => hasRightToLeftLetter(run.drawn))) return given;

  // LEFT TO RIGHT AS DRAWN: the page's order is a text page's reading, which is by position for objects but is not a
  // promise about the order of two runs that begin at one place.
  const visual = runs
    .map((run, at) => ({ run, at }))
    .sort((a, b) => a.run.left - b.run.left || a.at - b.at);
  const starts = new Map<number, number>();
  let drawn = '';
  for (const { at, run } of visual) {
    starts.set(at, drawn.length);
    drawn += run.drawn;
  }
  const { text, from } = logicalFromDrawn(drawn);
  if (from.length !== text.length) return given;

  // WHERE EACH RUN'S GLYPHS ARE IN THE LINE AS TYPED, as one stretch or not at all.
  const places = runs.map((run, at) => {
    const first = starts.get(at) ?? 0;
    const last = first + run.drawn.length;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let count = 0;
    from.forEach((source, position) => {
      if (source < first || source >= last) return;
      low = Math.min(low, position);
      high = Math.max(high, position);
      count += 1;
    });
    return { run, low, high, count, whole: count === run.drawn.length && high - low + 1 === count };
  });
  if (places.some((place) => !place.whole && place.count > 0)) return given;

  const ordered = places.filter((place) => place.count > 0).sort((a, b) => a.low - b.low);
  // A RUN OF NO GLYPHS (it drew nothing) is not placed, so it has no words; the rest are.
  if (ordered.length !== places.length) return given;
  return {
    runs: ordered.map((place) => place.run),
    texts: ordered.map((place) => text.slice(place.low, place.high + 1)),
  };
}
