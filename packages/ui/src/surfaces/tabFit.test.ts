import { describe, expect, it } from 'vitest';

import { tabCapacity, tabsShown } from './tabFit.js';

/** A row 600 wide at the narrowest tab this build draws, both gaps 8. */
const ROW = { available: 600, minimumTab: 112, control: 32, tabGap: 8, controlGap: 8 } as const;

describe('which tabs the strip draws (Part A1)', () => {
  it('HOLDS every tab while they fit at the narrowest, beside the one end control, and shows no list', () => {
    // 600 - (32 + 8) = 560 of room; 4 tabs take 4 * 112 + 3 * 8 = 472, 5 take 592.
    expect(tabCapacity(ROW, 4)).toBe(4);
    expect(tabsShown(4, 3, tabCapacity(ROW, 4))).toStrictEqual([0, 1, 2, 3]);
  });

  it('PAST THE NARROWEST, takes the list button out of the room too and holds fewer', () => {
    // 600 - 2 * 40 = 520 of room; 4 tabs take 472, 5 take 592, so 4 with the list.
    expect(tabCapacity(ROW, 9)).toBe(4);
    // At 640, five tabs fit beside one control (600 of room, 592 taken), so five open draw all five. A sixth brings
    // the list button, whose room costs the fifth: the second control is taken out only when it is drawn.
    expect(tabCapacity({ ...ROW, available: 640 }, 5)).toBe(5);
    expect(tabCapacity({ ...ROW, available: 640 }, 6)).toBe(4);
  });

  it('counts the gap BETWEEN TABS and the gap BEFORE A CONTROL each where it falls', () => {
    // 620 wide, five open. Gaps of 16 between tabs and none before the control: 588 of room, and 5 tabs take
    // 5 * 112 + 4 * 16 = 624, so 4 are drawn. CONTROL: the same two gaps swapped leave 572, and 5 tabs take 560.
    expect(tabCapacity({ ...ROW, available: 620, tabGap: 16, controlGap: 0 }, 5)).toBe(4);
    expect(tabCapacity({ ...ROW, available: 620, tabGap: 0, controlGap: 16 }, 5)).toBe(5);
  });

  it('ALWAYS DRAWS the current tab, in the last place, keeping the order of the rest', () => {
    expect(tabsShown(9, 7, 4)).toStrictEqual([0, 1, 2, 7]);
    // CONTROL: a current tab already in the window moves nothing.
    expect(tabsShown(9, 1, 4)).toStrictEqual([0, 1, 2, 3]);
  });

  it('a row too narrow for even one tab still draws the current one', () => {
    expect(tabCapacity({ ...ROW, available: 40 }, 3)).toBe(1);
    expect(tabsShown(3, 2, 1)).toStrictEqual([2]);
  });
});
