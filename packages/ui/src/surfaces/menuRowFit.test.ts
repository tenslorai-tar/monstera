import { describe, expect, it } from 'vitest';

import { LABELLED, menusThatFit, nextRowFit } from './menuRowFit.js';

describe('nextRowFit (ADR-0113)', () => {
  it('keeps the words while the row has room, and remembers how wide they are', () => {
    expect(nextRowFit(LABELLED, 0, 190)).toStrictEqual({ iconsOnly: false, labelled: 190 });
    expect(nextRowFit(LABELLED, 40, 190)).toStrictEqual({ iconsOnly: false, labelled: 190 });
  });

  it('drops the words the moment the row has less room than it must hold', () => {
    expect(nextRowFit({ iconsOnly: false, labelled: 190 }, -1, 190)).toStrictEqual({ iconsOnly: true, labelled: 190 });
  });

  it('brings them back only when the room covers what the words add — no flicker at the edge', () => {
    const narrow = { iconsOnly: true, labelled: 190 } as const;
    // The icons are 70 wide, so the words add 120. At 119 of room they would overflow again.
    expect(nextRowFit(narrow, 119, 70)).toBe(narrow);
    expect(nextRowFit(narrow, 120, 70)).toStrictEqual({ iconsOnly: false, labelled: 190 });
  });

  it('CONTROL: a rule that came back on ANY room would have answered labelled at 1 px — this one does not', () => {
    expect(nextRowFit({ iconsOnly: true, labelled: 190 }, 1, 70).iconsOnly).toBe(true);
  });

  it('stays on icons it has no labelled width for, rather than guessing one', () => {
    const unseen = { iconsOnly: true, labelled: undefined };
    expect(nextRowFit(unseen, 5000, 70)).toBe(unseen);
  });
});

describe('menusThatFit (ADR-0146 Decision 5)', () => {
  // Three menus of 40, 50 and 60 with gaps of 2: 154 drawn whole, and a More of 30.
  const widths = [40, 50, 60] as const;

  it('draws every menu when all of them fit, with no room kept for a More nobody needs', () => {
    expect(menusThatFit(widths, 2, 154, 30)).toBe(3);
  });

  it('folds from the END, and counts the More and its gap in the room the drawn ones leave', () => {
    // One short of whole: two menus (92) + gap + More (30) = 124 fit in 153.
    expect(menusThatFit(widths, 2, 153, 30)).toBe(2);
    // Two menus and the More need exactly 124.
    expect(menusThatFit(widths, 2, 124, 30)).toBe(2);
    expect(menusThatFit(widths, 2, 123, 30)).toBe(1);
  });

  it('CONTROL: a rule that left the More out of the sum would keep two menus at 123 — this one keeps one', () => {
    // 92 of two menus fits in 123 on its own; only the More's 32 makes it not.
    expect(widths[0] + widths[1] + 2).toBeLessThanOrEqual(123);
    expect(menusThatFit(widths, 2, 123, 30)).toBe(1);
  });

  it('folds every menu into the More when not even the first fits beside it', () => {
    expect(menusThatFit(widths, 2, 71, 30)).toBe(0);
  });
});
