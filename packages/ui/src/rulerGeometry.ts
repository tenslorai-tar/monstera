import { POINTS_PER_UNIT } from '@monstera/contract';

/**
 * Where a ruler's marks go, as arithmetic with no DOM in it.
 *
 * **Named `rulerGeometry` and not `rulers`** because `Rulers.tsx` is the
 * component beside it, and on a case-insensitive filesystem the two names are
 * the same file — TypeScript reports it, but only on the machines where it is
 * true. A pair that builds on Linux and not on Windows is worth avoiding by
 * naming rather than by remembering.
 *
 * ## Why this is a module and not a component's body
 *
 * Every interesting property here is a number: that the marks land on whole
 * units, that they stay legible as the zoom shrinks them, that the labels read
 * in the unit a person chose. A component test in happy-dom can assert none of
 * those, because it has no layout — so the arithmetic lives where a case can
 * state its inputs, and the component is the thin part.
 *
 * ## The unit is a length in POINTS, which is the only coordinate here
 *
 * A PDF user unit is 1/72 inch, and PDF.js's viewport at scale 1 is one CSS
 * pixel per point. So a page coordinate in points becomes a CSS offset by
 * multiplying by the zoom, and there is no second conversion anywhere in this
 * file. That is deliberate: L3's coordinate spaces exist because conversions
 * scattered through components is how a y-flip gets assumed, and a ruler is
 * exactly the kind of chrome that would grow one.
 */

/** What a reader thinks in. */
export type RulerUnit = 'in' | 'cm' | 'pt';

/**
 * One unit, in points, and how finely it is divided.
 *
 * The subdivisions are the ones each unit is conventionally read in — eighths
 * of an inch, millimetres, twelfths of a point-inch — rather than a single
 * number applied to all three, which would put decimal ticks on an inch ruler.
 */
const UNITS: Readonly<Record<RulerUnit, { readonly points: number; readonly divisions: number }>> =
  {
    // THE CONTRACT'S TABLE, which the measurements read too, so a ruler and a measurement cannot disagree about how
    // long a centimetre is (B3a).
    in: { points: POINTS_PER_UNIT.in, divisions: 8 },
    cm: { points: POINTS_PER_UNIT.cm, divisions: 10 },
    // A POINT RULER IS MARKED EVERY INCH'S WORTH of points, labelled in points: a mark per point would be a grey band.
    pt: { points: POINTS_PER_UNIT.in, divisions: 6 },
  };

/**
 * The narrowest a MAJOR mark may be spaced before the ruler thins itself out.
 *
 * Below this, labels collide and the ruler becomes a grey band. The response is
 * to label every second or fifth unit rather than to shrink the text, because a
 * ruler whose labels are unreadable is worse than one that marks less often.
 */
const MIN_MAJOR_PX = 56;

/** The narrowest a MINOR mark may be spaced before minors are dropped entirely. */
const MIN_MINOR_PX = 6;

/** One mark on a ruler. */
export interface RulerTick {
  /** Where it sits, in CSS pixels from the ruler's origin. */
  readonly offset: number;
  /** Whether it carries a label. */
  readonly major: boolean;
  /** The label, in whole units, present only on a major tick. */
  readonly label?: string;
}

/**
 * The multiple of the unit that majors are drawn at.
 *
 * Steps through 1, 2, 5, 10, 20, 50 … rather than doubling, because those are
 * the intervals a person reads without arithmetic — a ruler marked every 4
 * centimetres is technically regular and unusable.
 */
function majorEvery(unitPx: number): number {
  const ladder = [1, 2, 5, 10, 20, 50, 100];
  return ladder.find((step) => unitPx * step >= MIN_MAJOR_PX) ?? 100;
}

/**
 * The marks along one edge.
 *
 * @param lengthPx how long the ruler is, in CSS pixels
 * @param unit what a reader chose
 * @param zoom CSS pixels per point
 * @param originPx where the page's zero sits along this ruler, in CSS pixels.
 *   May be negative: the page starts above or left of the visible ruler once it
 *   is scrolled, and a ruler that clamped to zero would put its zero mark in
 *   the wrong place, which is worse than not drawing one.
 */
export function rulerTicks(
  lengthPx: number,
  unit: RulerUnit,
  zoom: number,
  originPx = 0,
): readonly RulerTick[] {
  // A ZERO OR NEGATIVE ZOOM IS NOT A SMALL RULER. It makes the step zero and
  // the loop below unbounded, so it is refused here rather than guarded inside
  // the loop — the same reason `resolveZoom` refuses a degenerate box.
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(lengthPx) || lengthPx <= 0) return [];

  const unitPx = UNITS[unit].points * zoom;
  const every = majorEvery(unitPx);
  const majorPx = unitPx * every;
  const minorPx = majorPx / UNITS[unit].divisions;
  const drawMinors = minorPx >= MIN_MINOR_PX;
  const step = drawMinors ? minorPx : majorPx;

  const ticks: RulerTick[] = [];
  // Counted from the first mark AT OR BEFORE the ruler's start, so a scrolled
  // ruler keeps its marks on the page's grid rather than starting a fresh one
  // at whatever is currently on screen.
  const first = Math.ceil(-originPx / step);
  const last = Math.floor((lengthPx - originPx) / step);
  for (let index = first; index <= last; index += 1) {
    const offset = originPx + index * step;
    const perMajor = drawMinors ? UNITS[unit].divisions : 1;
    const major = index % perMajor === 0;
    ticks.push(
      major
        ? { offset, major, label: String((index / perMajor) * every) }
        : { offset, major: false },
    );
  }
  return ticks;
}

/** Where one page lies along a ruler, in CSS pixels from the ruler's start. */
export interface RulerSpan {
  readonly start: number;
  readonly end: number;
}

/** One page's run along a ruler: where its zero sits on the ruler, how long it is, and its marks from that zero. */
export interface RulerRun {
  /** Where the page's zero sits, in CSS pixels from the ruler's start; negative once scrolled past it. */
  readonly start: number;
  /** How long the page is along the ruler, in CSS pixels. */
  readonly length: number;
  /** The page's marks, each `offset` measured from the PAGE'S zero — never from the ruler's start. */
  readonly ticks: readonly RulerTick[];
}

/**
 * The runs along one edge when several pages lie along it, EACH READ FROM ITS OWN PAGE'S ZERO.
 *
 * A ruler zeroed on the first page counts on past that page's foot, so page 2's top reads 11 inches and page 9's
 * reads 99: numbers for page 1 and arithmetic for every page after it. A person measuring a page measures from its
 * corner, so each page gets its own run, starting at 0 at its own top or left, and the gap between two pages carries
 * no marks at all.
 *
 * ## The marks are in the page's frame, so a scroll moves a run and changes no mark
 *
 * A mark's offset from its page's zero is the same at every scroll position; only where the run starts moves. So the
 * ruler moves one element per page on screen as the view scrolls, rather than redrawing every mark. Measured
 * 2026-10-04 on Chromium 151: with each mark placed from the RULER'S start, an 8 s wheel scroll over forty dense pages
 * at 1.5x removed and inserted 3,644 mark elements — every mark on every frame, since each key held its scrolled
 * offset — at a frame p95 of 100 ms.
 *
 * A page off the ruler entirely has no run. A span that starts inside the one before it is skipped: the right page of
 * a facing pair has the left page's extent down the vertical ruler, and two runs over one stretch would draw every
 * label twice.
 *
 * @param spans the pages along this ruler, in any order
 * @param lengthPx how long the ruler is, in CSS pixels
 * @param unit what a reader chose
 * @param zoom CSS pixels per point
 */
export function pageRuns(
  spans: readonly RulerSpan[],
  lengthPx: number,
  unit: RulerUnit,
  zoom: number,
): readonly RulerRun[] {
  const runs: RulerRun[] = [];
  let reached = Number.NEGATIVE_INFINITY;
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  for (const span of ordered) {
    if (span.start < reached) continue;
    reached = span.end;
    if (span.end < 0 || span.start > lengthPx) continue;
    const length = span.end - span.start;
    runs.push({ start: span.start, length, ticks: rulerTicks(length, unit, zoom) });
  }
  return runs;
}

/**
 * The spacing of the grid overlay, in CSS pixels.
 *
 * The SAME unit and the same major interval as the ruler, which is the point of
 * a grid: a line under the reader's cursor should be a mark they can read off
 * the ruler. Two independent spacings would look correct and mean nothing.
 *
 * @returns `undefined` where a grid cannot be drawn — the zoom is degenerate,
 *   or the spacing has collapsed to something that would render as a fill
 */
export function gridSpacing(unit: RulerUnit, zoom: number, look: GridLook = AUTO_GRID_LOOK): GridLines | undefined {
  if (!Number.isFinite(zoom) || zoom <= 0) return undefined;
  const unitPx = UNITS[unit].points * zoom;
  let major = look.size === 'auto' ? unitPx * majorEvery(unitPx) : unitPx * GRID_SIZE_UNITS[look.size];
  // A CHOSEN SIZE THAT WOULD BE TOO FINE AT THIS ZOOM is doubled until it is not, as the ruler thins its own majors, rather
  // than hiding the grid the moment a person zooms out: the grid they asked for, at the coarsest multiple that can be read.
  for (let guard = 0; guard < 24 && major < MIN_MAJOR_PX; guard += 1) major *= 2;
  if (!(major >= MIN_MAJOR_PX)) return undefined;
  const minor = look.divisions > 1 ? major / look.divisions : undefined;
  // THE FAINT LINES ARE DROPPED, never the squares, when they would be a grey fill.
  return { major, minor: minor !== undefined && minor >= MIN_MINOR_PX ? minor : undefined };
}

/** The sizes of a major square: the ruler's own interval, or this many of the unit (inches, centimetres or points' inch). */
export const GRID_SIZES = ['auto', 'half', 'one', 'two', 'five'] as const;

export type GridSize = (typeof GRID_SIZES)[number];

/** How many of the unit a chosen size is. Named members, because the settings registry refuses numeric ones (zod moves them to the front). */
export const GRID_SIZE_UNITS: Readonly<Record<Exclude<GridSize, 'auto'>, number>> = { half: 0.5, one: 1, two: 2, five: 5 };

/** How many faint squares each major square holds. */
export const GRID_DIVISIONS = ['none', 'two', 'four', 'five', 'ten'] as const;

export type GridDivisions = (typeof GRID_DIVISIONS)[number];

/** Across how many each divides: `none` is one, which draws no faint line. */
export const GRID_DIVISION_COUNTS: Readonly<Record<GridDivisions, number>> = { none: 1, two: 2, four: 4, five: 5, ten: 10 };

/** What a reader chose of the grid: how big a major square is and how many faint ones it holds. Pure display, never written to a document. */
export interface GridLook {
  readonly size: GridSize;
  readonly divisions: number;
}

/** The two spacings drawn: the major lines, and the faint ones between them where they are not too close to read. */
export interface GridLines {
  readonly major: number;
  readonly minor: number | undefined;
}

/** The grid as it was before it could be chosen: the ruler's own major interval, with no faint lines. */
export const AUTO_GRID_LOOK: GridLook = { size: 'auto', divisions: 1 };
