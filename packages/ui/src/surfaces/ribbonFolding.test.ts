import { describe, expect, it } from 'vitest';

import { foldGroups, splitFold, type GroupWidths } from './ribbonFolding.js';

/**
 * The ribbon's fold, over widths alone.
 *
 * Every case states the numbers it is built from, because a fold is arithmetic and a case whose
 * expected counts were read off a screenshot proves only that the screenshot was taken.
 */

/** A group of `count` buttons, each `each` wide, with `chrome` of padding and separator. */
function group(count: number, each = 60, chrome = 10): GroupWidths {
  return { buttons: Array.from({ length: count }, () => each), chrome };
}

const MORE = 40;

describe('foldGroups', () => {
  it('folds NOTHING when the row fits — no group draws a More', () => {
    // Four groups of three 60 px buttons with 10 px of chrome each: 4 × (10 + 180) = 760.
    const groups = [group(3), group(3), group(3), group(3)];

    expect(foldGroups(groups, 760, MORE)).toStrictEqual([
      { shown: 3, more: false },
      { shown: 3, more: false },
      { shown: 3, more: false },
      { shown: 3, more: false },
    ]);
  });

  it('charges for the More it adds, so one pixel short folds by MORE THAN ONE BUTTON', () => {
    // 759 available against 760 natural. Dropping one button frees 60 and spends 40 on the More, a
    // net 20 — which is the case that separates this from a fold that forgets to charge for it.
    const folded = foldGroups([group(3), group(3), group(3), group(3)], 759, MORE);

    expect(folded[0]).toStrictEqual({ shown: 2, more: true });
    expect(folded.filter((entry) => entry.more)).toHaveLength(1);
  });

  it('takes from the WIDEST group each time, so groups fold evenly rather than one emptying', () => {
    // One group of six against three of two. A fold that walked the groups in order would empty the
    // first two small ones; the design folds the big one.
    const groups = [group(6), group(2), group(2), group(2)];

    const folded = foldGroups(groups, 500, MORE);

    expect(folded[1]).toStrictEqual({ shown: 2, more: false });
    expect(folded[2]).toStrictEqual({ shown: 2, more: false });
    expect(folded[3]).toStrictEqual({ shown: 2, more: false });
    expect(folded[0]?.shown).toBeLessThan(6);
  });

  it('a group with ONE button never folds: it has nothing to fold into a More', () => {
    const folded = foldGroups([group(1), group(1)], 10, MORE);

    expect(folded).toStrictEqual([
      { shown: 1, more: false },
      { shown: 1, more: false },
    ]);
  });

  it('stops at ONE button plus its More, and reports a row that still does not fit', () => {
    // Nothing fits in 1 px. The floor is what the design needs: a group is a caption over at least
    // one named control, never over a lone More. So the answer is deliberately too wide, and the
    // surface — not this function — decides what a window that narrow does.
    const folded = foldGroups([group(4), group(4)], 1, MORE);

    expect(folded).toStrictEqual([
      { shown: 1, more: true },
      { shown: 1, more: true },
    ]);
  });

  it('a group folds even when its FIRST fold widens it, because a later one pays for the More', () => {
    // The real ribbon's buttons differ: *Save back to cloud* against *Save*. Here the wide group is
    // 10 + 200 + 30 + 30 = 270 and the narrow one 100, so the row is 370 naturally.
    //
    // Folding the wide group by one gives 10 + 200 + 30 + 40 = 280 — WIDER than it was, because the
    // More costs more than the 30 px button it hid. A rule that asked only whether the next step
    // helps would refuse to fold this group at all and leave the row over its budget with a 200 px
    // button still on screen. Its floor, 10 + 200 + 40 = 250, is what makes the fold worth starting.
    const wide: GroupWidths = { buttons: [200, 30, 30], chrome: 10 };
    const narrow: GroupWidths = { buttons: [30, 30, 30], chrome: 10 };

    const folded = foldGroups([wide, narrow], 340, MORE);

    expect(folded[0]).toStrictEqual({ shown: 1, more: true });
    // 250 + 80 = 330, inside 340. The narrow group had to fold too, for the same reason in reverse:
    // at 100 natural and 110 once folded, only its floor of 80 fits the space that was left.
    expect(folded[1]).toStrictEqual({ shown: 1, more: true });
  });

  it('a group whose fold could never help is LEFT ALONE, however short the row is', () => {
    // One button of 30 and a More of 40: every fold of this group makes it wider, at every depth.
    // So it keeps both buttons and the row stays too wide — the honest answer, against a loop that
    // would hide a control and gain nothing.
    const stubborn: GroupWidths = { buttons: [30, 30], chrome: 10 };

    expect(foldGroups([stubborn], 1, MORE)).toStrictEqual([{ shown: 2, more: false }]);
  });

  it('CONTROL: the same groups at their natural width are untouched, so a fold means a shortage', () => {
    // Without this, every case above could be satisfied by a function that always folds.
    const wide: GroupWidths = { buttons: [200, 30, 30], chrome: 10 };
    const narrow: GroupWidths = { buttons: [30, 30, 30], chrome: 10 };

    expect(foldGroups([wide, narrow], 370, MORE)).toStrictEqual([
      { shown: 3, more: false },
      { shown: 3, more: false },
    ]);
  });

  it('an EMPTY row of groups is an empty answer, not a hang', () => {
    expect(foldGroups([], 0, MORE)).toStrictEqual([]);
  });
});

describe('splitFold — nothing is lost when a group folds', () => {
  const tools = ['open', 'save', 'print', 'undo', 'redo'];

  it('the two halves are a PARTITION at every depth, in order', () => {
    // THE WIRED-TOOLS RULE APPLIED TO FOLDING: a tool that vanished when the window narrowed would
    // be a control that stops existing at a width. Asserted at every depth rather than at one,
    // because an off-by-one in the slice is correct at exactly one of them.
    for (let shown = 1; shown <= tools.length; shown += 1) {
      const split = splitFold(tools, { shown, more: shown < tools.length });
      expect([...split.shown, ...split.folded], `shown ${String(shown)}`).toStrictEqual(tools);
      expect(split.shown).toHaveLength(shown);
    }
  });

  it('NOT MEASURED YET draws everything and folds nothing', () => {
    // Distinct from a fold that hides nothing, which is what the control below says.
    expect(splitFold(tools, undefined)).toStrictEqual({ shown: tools, folded: [] });
  });

  it('CONTROL: a fold that hides nothing also folds nothing, and the two are reached differently', () => {
    // Without this the case above passes for a function that ignores its fold entirely.
    const split = splitFold(tools, { shown: tools.length, more: false });
    expect(split.folded).toStrictEqual([]);
    expect(split.shown).toStrictEqual(tools);
    // AND A FOLD THAT HIDES EVERYTHING BUT ONE really does, so `shown` is read rather than assumed.
    expect(splitFold(tools, { shown: 1, more: true }).folded).toStrictEqual(['save', 'print', 'undo', 'redo']);
  });
});
