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
    in: { points: 72, divisions: 8 },
    // 1 inch is exactly 2.54 cm by definition, so a centimetre is 72 / 2.54
    // points. Written as the division rather than as 28.3465 so the definition
    // is visible and the value is not a rounded copy of it.
    cm: { points: 72 / 2.54, divisions: 10 },
    pt: { points: 72, divisions: 6 },
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
export function gridSpacing(unit: RulerUnit, zoom: number): number | undefined {
  if (!Number.isFinite(zoom) || zoom <= 0) return undefined;
  const unitPx = UNITS[unit].points * zoom;
  const spacing = unitPx * majorEvery(unitPx);
  return spacing >= MIN_MAJOR_PX ? spacing : undefined;
}
