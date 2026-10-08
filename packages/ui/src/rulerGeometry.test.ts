import { describe, expect, it } from 'vitest';

import { gridSpacing, pageRuns, rulerTicks } from './rulerGeometry.js';

/**
 * The ruler's arithmetic.
 *
 * Every case states its own boxes, which is the reason this is a module rather
 * than a component body: happy-dom has no layout, so a component test could
 * assert none of it.
 */

/** A tick's label, or `-` where it has none, so a case can read a run of them. */
function labels(ticks: readonly { readonly label?: string }[]): string {
  return ticks.map((tick) => tick.label ?? '-').join('');
}

describe('rulerTicks', () => {
  it('marks whole inches at 100%, labelled from zero', () => {
    const ticks = rulerTicks(300, 'in', 1);
    const majors = ticks.filter((tick) => tick.major);
    expect(majors.map((tick) => tick.offset)).toStrictEqual([0, 72, 144, 216, 288]);
    expect(majors.map((tick) => tick.label)).toStrictEqual(['0', '1', '2', '3', '4']);
  });

  it('divides an inch into eighths and a centimetre into millimetres', () => {
    // NOT ONE SUBDIVISION FOR BOTH. Ten ticks to the inch is a decimal ruler,
    // which no inch ruler is, and eight to the centimetre is meaningless.
    //
    // The centimetre is read at 300%, because at 100% a centimetre is 28px and
    // its millimetres are dropped as too fine — which the case below is about.
    // Reading it here at a zoom where they survive is what makes this a
    // statement about the DIVISIONS rather than about the threshold.
    expect(labels(rulerTicks(72, 'in', 1)).length).toBe(9);
    const cm = rulerTicks((72 / 2.54) * 3, 'cm', 3);
    expect(cm.length).toBe(11);
  });

  it('scales with the zoom, because a ruler measures the PAGE not the screen', () => {
    // One inch of page is 144 screen pixels at 200%. A ruler that kept 72 would
    // be measuring the display, which is the defect this case exists for.
    const majors = rulerTicks(300, 'in', 2).filter((tick) => tick.major);
    expect(majors.map((tick) => tick.offset)).toStrictEqual([0, 144, 288]);
    expect(majors.map((tick) => tick.label)).toStrictEqual(['0', '1', '2']);
  });

  it('labels every second or fifth unit rather than crowding, as the zoom shrinks', () => {
    // At 50% an inch is 36px, below the legibility floor, so majors step to 2
    // inches — and the LABELS still read in inches, not in majors. A ruler that
    // labelled 0,1,2 at two-inch spacing would be confidently wrong.
    const majors = rulerTicks(400, 'in', 0.5).filter((tick) => tick.major);
    expect(majors.map((tick) => tick.offset)).toStrictEqual([0, 72, 144, 216, 288, 360]);
    expect(majors.map((tick) => tick.label)).toStrictEqual(['0', '2', '4', '6', '8', '10']);
  });

  it('drops the minors before they become a solid band', () => {
    // The separating property: at a small enough zoom the minors would be a
    // pixel apart, and a ruler drawn as a grey fill is worse than one drawn
    // with fewer marks.
    //
    // CENTIMETRES, because inches never reach it and that is worth knowing:
    // the major ladder holds a major above 56px, so an inch's eighths are never
    // closer than 7px and are always drawn. Ten divisions is what can crowd,
    // and a case written on inches would assert a branch nothing reaches.
    expect(rulerTicks(400, 'cm', 1).every((tick) => tick.major)).toBe(true);
    // ... and at 300% they are present, which makes the line above a statement
    // about the threshold rather than about millimetres never being drawn.
    expect(rulerTicks(400, 'cm', 3).some((tick) => !tick.major)).toBe(true);
  });

  it('keeps its marks on the PAGES grid when the origin is negative', () => {
    // A scrolled ruler. The page's zero is 100px above the visible strip, so
    // the first mark on screen is the one at page coordinate 100/72 inches —
    // NOT a fresh zero at the top of the viewport, which is the bug that makes
    // a ruler drift as you scroll.
    const ticks = rulerTicks(300, 'in', 1, -100);
    const majors = ticks.filter((tick) => tick.major);
    expect(majors.map((tick) => tick.offset)).toStrictEqual([44, 116, 188, 260]);
    expect(majors.map((tick) => tick.label)).toStrictEqual(['2', '3', '4', '5']);
  });

  it('refuses a degenerate zoom or length instead of looping', () => {
    // A zero zoom makes the step zero, and the loop bound would be infinite —
    // so this is a refusal at the top rather than a guard inside, which would
    // still have computed a first tick.
    expect(rulerTicks(300, 'in', 0)).toStrictEqual([]);
    expect(rulerTicks(300, 'in', -1)).toStrictEqual([]);
    expect(rulerTicks(0, 'in', 1)).toStrictEqual([]);
    expect(rulerTicks(Number.POSITIVE_INFINITY, 'in', 1)).toStrictEqual([]);
  });
});

describe('pageRuns', () => {
  /** The majors a person SEES, at their place on the ruler: each run's marks moved to its start, inside the ruler. */
  const seen = (runs: ReturnType<typeof pageRuns>, lengthPx: number): string[] =>
    runs.flatMap((run) =>
      run.ticks
        .filter((tick) => tick.major && run.start + tick.offset >= 0 && run.start + tick.offset <= lengthPx)
        .map((tick) => `${String(run.start + tick.offset)}:${tick.label ?? ''}`),
    );

  it('starts every page at its OWN zero, so the second page reads 0 at its top rather than continuing', () => {
    // Two 2-inch pages at 100%, 16 px apart. Zeroed on the first page alone, the second page's top would be the
    // first page's 160 px, labelled with no whole inch, and its foot would read 4.
    const runs = pageRuns(
      [
        { start: 0, end: 144 },
        { start: 160, end: 304 },
      ],
      400,
      'in',
      1,
    );
    expect(seen(runs, 400)).toStrictEqual(['0:0', '72:1', '144:2', '160:0', '232:1', '304:2']);
  });

  it('draws nothing in the gap between two pages: each run is as long as its page', () => {
    const runs = pageRuns(
      [
        { start: 0, end: 144 },
        { start: 160, end: 304 },
      ],
      250,
      'in',
      1,
    );
    expect(runs.map((run) => [run.start, run.length])).toStrictEqual([
      [0, 144],
      [160, 144],
    ]);
    expect(runs.every((run) => run.ticks.every((tick) => tick.offset >= 0 && tick.offset <= run.length))).toBe(true);
  });

  it('keeps a page scrolled half past the top on its own grid', () => {
    // A page whose top is 100 px above the strip: the first major on screen is its 2-inch mark, at 44.
    expect(seen(pageRuns([{ start: -100, end: 188 }], 300, 'in', 1), 300)).toStrictEqual(['44:2', '116:3', '188:4']);
  });

  it('A SCROLL MOVES A RUN AND CHANGES NO MARK: the same page at two scroll positions has the same marks', () => {
    // THE PROPERTY THE RUNS EXIST FOR. Each mark is measured from its page's zero, so a ruler that redraws only the
    // run's start keeps every mark element as it was.
    const [at] = pageRuns([{ start: 40, end: 328 }], 800, 'in', 1);
    const [scrolled] = pageRuns([{ start: -73.5, end: 214.5 }], 800, 'in', 1);
    expect(scrolled?.ticks).toStrictEqual(at?.ticks);
    expect([at?.start, scrolled?.start]).toStrictEqual([40, -73.5]);
    // CONTROL: the same marks placed from the RULER'S start, as they were before, differ at every scroll position.
    expect(rulerTicks(800, 'in', 1, -73.5)).not.toStrictEqual(rulerTicks(800, 'in', 1, 40));
  });

  it('a page wholly off the ruler has no run, and one partly on it has its whole run', () => {
    const runs = pageRuns(
      [
        { start: -400, end: -112 },
        { start: -96, end: 192 },
        { start: 900, end: 1188 },
      ],
      800,
      'in',
      1,
    );
    expect(runs.map((run) => run.start)).toStrictEqual([-96]);
    expect(runs[0]?.ticks.at(0)?.offset).toBe(0);
  });

  it('marks a facing pair once down the side, where both pages share one extent', () => {
    const pair = pageRuns(
      [
        { start: 0, end: 144 },
        { start: 0, end: 144 },
      ],
      300,
      'in',
      1,
    );
    expect(seen(pair, 300)).toStrictEqual(['0:0', '72:1', '144:2']);
  });
});

describe('gridSpacing', () => {
  it('is the rulers OWN major interval, so a line is a mark you can read off it', () => {
    // THE POINT OF THE FUNCTION. Two independent spacings would both look
    // regular and mean nothing together, so this case compares the grid against
    // the ruler rather than against a number typed here.
    for (const zoom of [0.5, 1, 2, 4]) {
      const majors = rulerTicks(4000, 'in', zoom).filter((tick) => tick.major);
      const between = (majors[1]?.offset ?? 0) - (majors[0]?.offset ?? 0);
      expect(gridSpacing('in', zoom)?.major).toBeCloseTo(between, 6);
    }
  });

  it('answers undefined rather than a spacing that would render as a fill', () => {
    expect(gridSpacing('in', 0)).toBeUndefined();
    expect(gridSpacing('in', -1)).toBeUndefined();
  });

  it('draws FAINT SQUARES inside each major one: a major at 96 px split in four is 24 — CONTROL: one division draws none', () => {
    // 1 inch is 72 pt; at zoom 1.5 it is 108 px, and a chosen size of 1 keeps it, so the major is 108 and a quarter is 27.
    expect(gridSpacing('in', 1.5, { size: 'one', divisions: 4 })).toStrictEqual({ major: 108, minor: 27 });
    expect(gridSpacing('in', 1.5, { size: 'one', divisions: 1 })).toStrictEqual({ major: 108, minor: undefined });
  });

  it('a CHOSEN SIZE is that many units, doubled while it would be too fine to read, and the faint lines are dropped when they would be a fill', () => {
    // Half an inch at zoom 1 is 36 px, under the 56 px floor, so it is doubled once to 72.
    expect(gridSpacing('in', 1, { size: 'half', divisions: 2 })).toStrictEqual({ major: 72, minor: 36 });
    // Ten divisions of 72 px is 7.2 px, past the 6 px floor, and kept; of 57.6 px it would be 5.76 and dropped.
    expect(gridSpacing('in', 1, { size: 'one', divisions: 10 })?.minor).toBeCloseTo(7.2, 6);
    expect(gridSpacing('in', 0.8, { size: 'one', divisions: 10 })).toStrictEqual({ major: 57.6, minor: undefined });
  });
});
