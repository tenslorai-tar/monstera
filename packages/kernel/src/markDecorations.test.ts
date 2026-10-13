import { describe, expect, it } from 'vitest';

import { type PageDecoration, decorationBand, decorationKindOf, decorationsOf } from './markDecorations.js';

/** A run of 12-point words on the baseline at 700, from 100 to 160. */
const RUN = { left: 100, right: 160, baseline: 700, size: 12 } as const;
const BLACK = { r: 0, g: 0, b: 0 } as const;
const YELLOW = { r: 255, g: 241, b: 118 } as const;

/** A decoration of `kind` drawn for `run` exactly where the writer draws it, from `left` to `right`. */
function drawnFor(kind: PageDecoration['kind'], left: number = RUN.left, right: number = RUN.right, run = RUN): PageDecoration {
  return { kind, left, right, ...decorationBand(kind, run.baseline, run.size), colour: kind === 'behind' ? YELLOW : BLACK };
}

describe('decorationsOf (the owner’s L2)', () => {
  it('gives a run each decoration drawn for it, where the writer draws it', () => {
    expect(decorationsOf(RUN, [drawnFor('under'), drawnFor('through'), drawnFor('behind')])).toStrictEqual({
      underline: true,
      strike: true,
      highlight: YELLOW,
    });
  });

  it('CONTROL: a run on the next line, under the same rectangles, carries none of them', () => {
    // 14 POINTS LOWER: the next line at ordinary leading. The rectangles are this line's, not that one's.
    expect(decorationsOf({ ...RUN, baseline: 686 }, [drawnFor('under'), drawnFor('through'), drawnFor('behind')])).toStrictEqual({});
  });

  it('CONTROL: a rectangle spanning less than half the run is a neighbour’s, not the run’s', () => {
    expect(decorationsOf(RUN, [drawnFor('under', 140, 200)])).toStrictEqual({});
    // AND MORE THAN HALF is the run's, so the cut above is the share's and not the place's.
    expect(decorationsOf(RUN, [drawnFor('under', 120, 200)])).toStrictEqual({ underline: true });
  });

  it('CONTROL: an underline is not read as a strike, nor a strike as an underline: each kind in its own band', () => {
    const struck = { ...drawnFor('through'), kind: 'under' as const };
    expect(decorationsOf(RUN, [struck])).toStrictEqual({});
  });

  it('reads only the kinds it draws from a mark’s value', () => {
    expect(['under', 'through', 'behind', 'over', '', null].map((value) => decorationKindOf(value))).toStrictEqual([
      'under',
      'through',
      'behind',
      undefined,
      undefined,
      undefined,
    ]);
  });
});
