import { describe, expect, it } from 'vitest';

import { factsThatFit } from './statusFacts.js';

// A name of 120, three facts of 50, 40 and 34, dots of 4 with 4 either side, and a name that may shorten to 66.
const WIDTHS = { name: 120, pages: 50, size: 40, saved: 34 } as const;
const DOT = 4 + 2 * 4;
const SHORT_NAME = 66;
const shown = (room: number): string[] => [...factsThatFit(WIDTHS, SHORT_NAME, 4, 4, room)].sort();

describe('factsThatFit', () => {
  it('holds all four while they fit, the name shortened to its least before anything leaves', () => {
    const all = SHORT_NAME + 50 + 40 + 34 + 3 * DOT;
    expect(shown(all)).toStrictEqual(['name', 'pages', 'saved', 'size']);
    // CONTROL: one pixel less and the SIZE goes — not the name, which would still read, and not a shortened size.
    expect(shown(all - 1)).toStrictEqual(['name', 'pages', 'saved']);
  });

  it('gives up whole facts in its order — the size, the length, the name — and whether it is saved last', () => {
    const withoutSize = SHORT_NAME + 50 + 34 + 2 * DOT;
    expect(shown(withoutSize - 1)).toStrictEqual(['name', 'saved']);
    const nameAndSaved = SHORT_NAME + 34 + DOT;
    expect(shown(nameAndSaved - 1)).toStrictEqual(['saved']);
    expect(shown(34)).toStrictEqual(['saved']);
    // NOT EVEN SAVED WHOLE: nothing, never a shortened *Sa…* — the tab says it instead.
    expect(shown(33)).toStrictEqual([]);
  });

  it('counts a short name at its own width, not at the least it may shorten to', () => {
    const short = { ...WIDTHS, name: 30 };
    const all = 30 + 50 + 40 + 34 + 3 * DOT;
    expect([...factsThatFit(short, SHORT_NAME, 4, 4, all)]).toHaveLength(4);
  });
});
