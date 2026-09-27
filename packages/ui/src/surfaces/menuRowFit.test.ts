import { describe, expect, it } from 'vitest';

import { LABELLED, nextRowFit } from './menuRowFit.js';

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
