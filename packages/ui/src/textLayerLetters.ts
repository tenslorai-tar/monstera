import type { OverlayPage } from './annotations/annotationSpace.js';
import { enginePointOnScreen } from './annotations/annotationSpace.js';

/**
 * WHERE EACH LETTER OF A TEXT LAYER LINE IS, ON SCREEN: the one geometry every rule of the layer reads
 * ([ADR-0280](../../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md), Decisions 4 to
 * 6). Built once per line from what the engine read, and asked two questions:
 *
 * - **rule (i)**, what a span of the line's text covers ({@link spanShape}), which the selection's painter and
 *   `readTextSelection` both take, so the look and the words cannot disagree;
 * - **rule (ii)**, which side of which letter a point is on ({@link caretAt}), which a press, a drag's moving end and a
 *   line's caret take.
 *
 * Nothing here asks the browser where a letter is: the layer's text is laid out in a substitute face whose letters stand
 * where that face puts them, not where the page's are.
 */

/** One line's letters, as `document.pageTextLayer` carries them (Decision 2), in the page's display space at scale 1. */
export interface LineLetters {
  readonly origin: { readonly x: number; readonly y: number };
  readonly direction: { readonly x: number; readonly y: number };
  readonly size: number;
  /** One per UTF-16 unit of the line's text, hundredths of a point; a pair's second unit advances 0. */
  readonly advances: readonly number[];
}

/** A point in the layer's own pixels. */
export interface LayerPoint {
  readonly x: number;
  readonly y: number;
}

/** A line's letters on screen. */
export interface LetterRun {
  /** The first letter's origin, on the baseline. */
  readonly origin: LayerPoint;
  /** The unit vector along the line, on screen. */
  readonly along: LayerPoint;
  /** The unit vector from the baseline toward the letters' tops, on screen. */
  readonly up: LayerPoint;
  /** Each UTF-16 unit's start along the line from the origin, and then where the last ends: `text.length + 1` values. */
  readonly edges: readonly number[];
  /** How far the band reaches below the baseline (negative) and above it, along {@link up}, on screen. */
  readonly band: readonly [number, number];
}

/**
 * How far a band reaches above and below the baseline, as fractions of the glyph size: a letter's ascent and descent in
 * the usual faces, so a span's shape covers the letters' ink and not the line's whole box, which on an angled line is the
 * box around a slanted run.
 */
const ASCENT = 0.9;
const DESCENT = 0.25;

/**
 * A line's letters on screen, or `null` for a line placed as before (no letters, or a direction that is not one).
 *
 * The line's origin and one point a unit along it and a unit up from it are converted through the page's own conversion
 * (`enginePointOnScreen`), so zoom and turn are the page's and nothing here multiplies by either.
 */
export function letterRun(letters: LineLetters | undefined, textLength: number, page: OverlayPage): LetterRun | null {
  if (letters?.advances.length !== textLength) return null;
  const { origin, direction, size } = letters;
  const length = Math.hypot(direction.x, direction.y);
  if (!(length > 0.5)) return null;
  const unit = { x: direction.x / length, y: direction.y / length };
  // UP in display space, where y runs down: the along vector turned a quarter against the clock.
  const upward = { x: unit.y, y: -unit.x };
  const start = enginePointOnScreen(origin, page);
  const onAlong = enginePointOnScreen({ x: origin.x + unit.x, y: origin.y + unit.y }, page);
  const onUp = enginePointOnScreen({ x: origin.x + upward.x, y: origin.y + upward.y }, page);
  const alongVector = { x: onAlong.x - start.x, y: onAlong.y - start.y };
  const upVector = { x: onUp.x - start.x, y: onUp.y - start.y };
  // PIXELS A POINT, from the page's own conversion: the zoom, without naming it.
  const scale = Math.hypot(alongVector.x, alongVector.y);
  if (!(scale > 0)) return null;
  const edges = [0];
  let place = 0;
  for (const advance of letters.advances) {
    place += advance;
    edges.push((place / 100) * scale);
  }
  return {
    origin: start,
    along: { x: alongVector.x / scale, y: alongVector.y / scale },
    up: { x: upVector.x / scale, y: upVector.y / scale },
    edges,
    band: [-DESCENT * size * scale, ASCENT * size * scale],
  };
}

/**
 * RULE (ii): the caret a point means on a line, from the engine's letters: the boundary nearest the point along the line,
 * so a point on a letter's first half is before it and on its second half after it. Before the first letter is 0, past
 * the last is the text's length. A pair's second unit advances 0, so the caret never lands between its two halves.
 */
export function caretAt(run: LetterRun, point: LayerPoint): number {
  const along = alongOf(run, point);
  const { edges } = run;
  const last = edges.length - 1;
  if (along <= (edges[0] ?? 0)) return 0;
  if (along >= (edges[last] ?? 0)) return last;
  const low = letterAt(run, point);
  const high = low + 1;
  const from = edges[low] ?? 0;
  const to = edges[high] ?? 0;
  let caret = along - from < to - along ? low : high;
  // NEVER BETWEEN A PAIR'S TWO HALVES: its second unit advances 0, so two edges coincide; take the later.
  while (caret < last && (edges[caret + 1] ?? 0) === (edges[caret] ?? 0)) caret += 1;
  return caret;
}

/** How far along the line a point is from its origin, on screen. */
function alongOf(run: LetterRun, point: LayerPoint): number {
  return (point.x - run.origin.x) * run.along.x + (point.y - run.origin.y) * run.along.y;
}

/** How far above the baseline a point is, on screen, along {@link LetterRun.up}. */
function upOf(run: LetterRun, point: LayerPoint): number {
  return (point.x - run.origin.x) * run.up.x + (point.y - run.origin.y) * run.up.y;
}

/**
 * WHERE A POINT IS AGAINST A LINE'S LETTERS: `'on'` inside the band from the first letter's start to the last letter's
 * end, `'before'` or `'after'` in the band beyond either end, `'off'` outside the band. The line a pointer is on, and the
 * line it is beside, are decided by this on a line with letters, at the line's own angle — the browser's hit test of
 * the substitute is not, since on a turned page or an angled line the substitute's text and the element's upright box
 * lie across other lines.
 *
 * `distance` is how far beyond the end the point is, along the line, and `middle` how far from the band's middle.
 */
export function bandPlace(run: LetterRun, point: LayerPoint): { readonly place: 'on' | 'before' | 'after' | 'off'; readonly distance: number; readonly middle: number } {
  const up = upOf(run, point);
  const [below, above] = run.band;
  const middle = Math.abs(up - (below + above) / 2);
  if (up < below || up > above) return { place: 'off', distance: 0, middle };
  const along = alongOf(run, point);
  const end = run.edges.at(-1) ?? 0;
  if (along < 0) return { place: 'before', distance: -along, middle };
  if (along > end) return { place: 'after', distance: along - end, middle };
  return { place: 'on', distance: 0, middle };
}

/**
 * The LETTER a point is on, by the engine's letters: the UTF-16 index whose advance holds the point along the line, the
 * first before the line's start and the last past its end. What a double click takes its word from, where
 * {@link caretAt} is the boundary between two letters. A pair's first unit, never its second, which advances 0.
 */
export function letterAt(run: LetterRun, point: LayerPoint): number {
  const along = alongOf(run, point);
  const { edges } = run;
  const last = edges.length - 1;
  if (last < 1) return 0;
  let low = 0;
  let high = last;
  // THE LAST EDGE AT OR BEFORE THE POINT, found by halving, since a dense line is a thousand edges.
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((edges[middle] ?? 0) <= along) low = middle;
    else high = middle;
  }
  // A ZERO-WIDTH UNIT (a pair's second) holds no point: step back to the unit that advanced.
  while (low > 0 && (edges[low + 1] ?? 0) === (edges[low] ?? 0)) low -= 1;
  return low;
}

/** Four corners of a span's shape on screen, in order around it. */
export type SpanShape = readonly [LayerPoint, LayerPoint, LayerPoint, LayerPoint];

/**
 * RULE (i): what the span `from` to `to` of a line's text covers on screen, from the engine's letters: from the start of
 * the first letter to the end of the last, across the band, at the line's own angle. `null` for an empty span.
 */
export function spanShape(run: LetterRun, from: number, to: number): SpanShape | null {
  const last = run.edges.length - 1;
  const start = run.edges[Math.max(0, Math.min(last, from))] ?? 0;
  const end = run.edges[Math.max(0, Math.min(last, to))] ?? 0;
  if (!(end > start)) return null;
  const at = (distance: number, height: number): LayerPoint => ({
    x: run.origin.x + run.along.x * distance + run.up.x * height,
    y: run.origin.y + run.along.y * distance + run.up.y * height,
  });
  const [below, above] = run.band;
  return [at(start, above), at(end, above), at(end, below), at(start, below)];
}

/** A span's shape's middle edge at one end, on the band's middle: where `readTextSelection` reads a run's two ends. */
export function spanEnd(shape: SpanShape, which: 'from' | 'to'): LayerPoint {
  const [topStart, topEnd, bottomEnd, bottomStart] = shape;
  return which === 'from'
    ? { x: (topStart.x + bottomStart.x) / 2, y: (topStart.y + bottomStart.y) / 2 }
    : { x: (topEnd.x + bottomEnd.x) / 2, y: (topEnd.y + bottomEnd.y) / 2 };
}
