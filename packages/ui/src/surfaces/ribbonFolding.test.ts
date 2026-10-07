// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { type MessageKey, messageKey } from '@monstera/shared';

import { foldGroups, foldRow, ribbonUnits, splitFold, type GroupWidths, type RibbonUnit } from './ribbonFolding.js';
import { innerWidthOf } from './useRibbonFold.js';

/**
 * The ribbon's fold, over widths alone.
 *
 * Every case states the numbers it is built from, because a fold is arithmetic and a case whose
 * expected counts were read off a screenshot proves only that the screenshot was taken.
 */

/** A group of `count` buttons, each `each` wide, with `chrome` of padding and separator. */
function group(count: number, each = 60, chrome = 10): GroupWidths {
  // NO GAP AND NO CAPTION, so every case above the gap's own states its arithmetic in buttons and chrome alone.
  return { buttons: Array.from({ length: count }, () => each), chrome, caption: 0, gap: 0 };
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

  it('folds by COUNT: many short buttons do not fold below a few long ones', () => {
    // The Comment ribbon at 1280, reduced to its shape: Markup's many short marks against Measure's
    // three long labels. Markup is 10 + 8 × 60 = 490 and Measure 10 + 3 × 150 = 460, so a fold by
    // WIDTH takes from Markup until it is narrower than Measure — two marks and a More (170) beside
    // three measures at the real widths — while the design folds every group to the same count.
    //
    // 520 available: by count, Markup goes 8 → 3 (10 + 180 + 40 = 230), then the two are level at
    // three and the wider, Measure, folds to two (10 + 300 + 40 = 350): 580, still over; Markup to two
    // (170): 520. Both end at two. The width rule, worked the same way on these numbers, ends at
    // Markup 4 and Measure 1 — so this case separates the two rules rather than agreeing with both.
    const marks = group(8, 60);
    const measures = group(3, 150);

    expect(foldGroups([marks, measures], 520, MORE)).toStrictEqual([
      { shown: 2, more: true },
      { shown: 2, more: true },
    ]);
  });

  it('a CAPTION WIDER THAN ITS BUTTONS is the group’s width, so a row of icon columns under long words hides a group (ADR-0194)', () => {
    // One 22 px icon under a 57 px caption, 13 of chrome: the group draws 13 + 57 = 70, not 13 + 22 = 35. Two of them
    // are 140. At 110 available a fold that counted the buttons alone believed 70 and drew both, 30 past its row —
    // the Comment ribbon's Measure and Links groups under a wider font, 25 px past it on 2026-10-08.
    const icons: GroupWidths = { buttons: [22], chrome: 13, caption: 57, gap: 0 };

    // The one left gets 110 − the row's 40 More = 70, which is exactly its 13 + 57.
    expect(foldRow([icons, icons], 110, MORE, 0).hiddenFrom).toBe(1);
    // CONTROL: the same groups with a caption no wider than their button are the 35 each the buttons say, and both fit.
    const narrow: GroupWidths = { ...icons, caption: 10 };
    expect(foldRow([narrow, narrow], 110, MORE, 0).hiddenFrom).toBe(2);
  });

  it('charges the GAP between neighbours, a More included, so a row that fits only without them folds', () => {
    // Three 60 px buttons, 10 of chrome, 8 between neighbours: 10 + 180 + 2 × 8 = 206. Without the
    // gaps it is 190, so 200 available separates the two: a fold that ignored gaps draws all three
    // and runs 6 px past its row, which is what one section did at 1024 on 2026-09-24.
    const spaced: GroupWidths = { buttons: [60, 60, 60], chrome: 10, caption: 0, gap: 8 };

    // Folded to one button and a More: 10 + 60 + 40 + 8 = 118, inside 200. Two and a More would be
    // 10 + 120 + 40 + 16 = 186, also inside — and the loop stops at the first fold that fits.
    expect(foldGroups([spaced], 200, MORE)).toStrictEqual([{ shown: 2, more: true }]);
    // CONTROL: with the room the gaps need, nothing folds.
    expect(foldGroups([spaced], 206, MORE)).toStrictEqual([{ shown: 3, more: false }]);
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
    const wide: GroupWidths = { buttons: [200, 30, 30], chrome: 10, caption: 0, gap: 0 };
    const narrow: GroupWidths = { buttons: [30, 30, 30], chrome: 10, caption: 0, gap: 0 };

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
    const stubborn: GroupWidths = { buttons: [30, 30], chrome: 10, caption: 0, gap: 0 };

    expect(foldGroups([stubborn], 1, MORE)).toStrictEqual([{ shown: 2, more: false }]);
  });

  it('CONTROL: the same groups at their natural width are untouched, so a fold means a shortage', () => {
    // Without this, every case above could be satisfied by a function that always folds.
    const wide: GroupWidths = { buttons: [200, 30, 30], chrome: 10, caption: 0, gap: 0 };
    const narrow: GroupWidths = { buttons: [30, 30, 30], chrome: 10, caption: 0, gap: 0 };

    expect(foldGroups([wide, narrow], 370, MORE)).toStrictEqual([
      { shown: 3, more: false },
      { shown: 3, more: false },
    ]);
  });

  it('an EMPTY row of groups is an empty answer, not a hang', () => {
    expect(foldGroups([], 0, MORE)).toStrictEqual([]);
  });
});

describe('foldRow — whole groups into the row’s More, only past every group’s floor', () => {
  const GAP = 10;

  it('CONTROL: a row the groups can fold into hides no group, and folds exactly as foldGroups does', () => {
    // Three groups of four: 3 × (10 + 240) = 750 plus two gaps = 770. At 700 the groups fold but all stay.
    const groups = [group(4), group(4), group(4)];

    const row = foldRow(groups, 700, MORE, GAP);

    expect(row.hiddenFrom).toBe(3);
    expect(row.groups).toStrictEqual(foldGroups(groups, 700 - 2 * GAP, MORE));
  });

  it('hides the LAST group once every group is at its floor, and the rest are folded again with the room it freed', () => {
    // A group of four shows 1, 2 or 3 buttons at 110, 170 or 230 (10 of chrome, the buttons, a 40 More). Three at
    // their floor with two gaps is 350.
    // - At 300, two drawn get 300 − 2 × 10 − 40 = 240: two at 170 is over, so both fold to one (220).
    // - At 355, all three fit at their floor (330 + 20).
    // - At 349, two drawn get 289: 170 + 110 = 280 fits, so one of them shows TWO — more than the floor it was at
    //   with three drawn, which only a stage that folds the remaining groups again produces.
    const groups = [group(4), group(4), group(4)];

    expect(foldRow(groups, 300, MORE, GAP)).toStrictEqual({
      groups: [
        { shown: 1, more: true },
        { shown: 1, more: true },
        { shown: 4, more: false },
      ],
      hiddenFrom: 2,
    });
    expect(foldRow(groups, 355, MORE, GAP).hiddenFrom).toBe(3);
    const refolded = foldRow(groups, 349, MORE, GAP);
    expect(refolded.hiddenFrom).toBe(2);
    expect(refolded.groups.slice(0, 2).map((fold) => fold.shown)).toStrictEqual([1, 2]);
  });

  it('charges the row’s More and its gap: a row that fits only without them hides one group more', () => {
    // Two groups at their floor, 2 × 110 + one gap = 230, fit at 230 with nothing hidden. At 229 one must go, and
    // the one left gets 229 − 10 − 40 = 179: room for 10 + 60 + 60 + 40 = 170, two buttons.
    const groups = [group(4), group(4)];

    expect(foldRow(groups, 230, MORE, GAP).hiddenFrom).toBe(2);
    expect(foldRow(groups, 229, MORE, GAP)).toStrictEqual({
      groups: [
        { shown: 2, more: true },
        { shown: 4, more: false },
      ],
      hiddenFrom: 1,
    });
  });

  it('never answers a row wider than its box: at no room, every group is in the More', () => {
    expect(foldRow([group(4), group(2)], 50, MORE, GAP)).toStrictEqual({
      groups: [
        { shown: 4, more: false },
        { shown: 2, more: false },
      ],
      hiddenFrom: 0,
    });
  });
});

describe('splitFold — nothing is lost when a group folds', () => {
  interface Tool {
    readonly command: { readonly id: string };
    readonly secondary: boolean;
    readonly menu: MessageKey | undefined;
  }
  const tool = (id: string, secondary = false, menu?: MessageKey): Tool => ({ command: { id }, secondary, menu });
  const ids = (entries: readonly Tool[]): string[] => entries.map((entry) => entry.command.id);
  /** A row's buttons by the command each is measured as, a menu written as its members. */
  const buttons = (units: readonly RibbonUnit<Tool>[]): string[] =>
    units.map((unit) => (unit.menu === undefined ? unit.key : `${unit.menu}[${ids(unit.entries).join(',')}]`));
  const tools = ['open', 'save', 'print', 'undo', 'redo'].map((id) => tool(id));

  it('the two halves are a PARTITION at every depth, in order', () => {
    // THE WIRED-TOOLS RULE APPLIED TO FOLDING: a tool that vanished when the window narrowed would
    // be a control that stops existing at a width. Asserted at every depth rather than at one,
    // because an off-by-one in the slice is correct at exactly one of them.
    for (let shown = 1; shown <= tools.length; shown += 1) {
      const split = splitFold(tools, { shown, more: shown < tools.length });
      expect([...split.shown.flatMap((unit) => unit.entries), ...split.folded], `shown ${String(shown)}`).toStrictEqual(tools);
      expect(split.shown).toHaveLength(shown);
    }
  });

  it('NOT MEASURED YET draws everything and folds nothing', () => {
    // Distinct from a fold that hides nothing, which is what the control below says.
    const split = splitFold(tools, undefined);
    expect(buttons(split.shown)).toStrictEqual(['open', 'save', 'print', 'undo', 'redo']);
    expect(split.folded).toStrictEqual([]);
  });

  it('CONTROL: a fold that hides nothing also folds nothing, and the two are reached differently', () => {
    // Without this the case above passes for a function that ignores its fold entirely.
    const split = splitFold(tools, { shown: tools.length, more: false });
    expect(split.folded).toStrictEqual([]);
    expect(buttons(split.shown)).toStrictEqual(['open', 'save', 'print', 'undo', 'redo']);
    // AND A FOLD THAT HIDES EVERYTHING BUT ONE really does, so `shown` is read rather than assumed.
    expect(ids(splitFold(tools, { shown: 1, more: true }).folded)).toStrictEqual(['save', 'print', 'undo', 'redo']);
  });

  it('a NAMED MENU is ONE button, gathered where its first member falls (ADR-0101)', () => {
    const EXPORT = messageKey('test.menu.export');
    const IMPORT = messageKey('test.menu.import');
    // Interleaved, as `order` can put them: the six format commands, export and import alternating.
    const data = [
      tool('export-json', false, EXPORT),
      tool('import-json', false, IMPORT),
      tool('export-xfdf', false, EXPORT),
      tool('import-xfdf', false, IMPORT),
    ];
    expect(buttons(ribbonUnits(data))).toStrictEqual([
      'test.menu.export[export-json,export-xfdf]',
      'test.menu.import[import-json,import-xfdf]',
    ]);
    // A FOLDED MENU'S MEMBERS reach the More one per line, so nothing becomes unreachable at a width.
    const narrow = splitFold(data, { shown: 1, more: true });
    expect(buttons(narrow.shown)).toStrictEqual(['test.menu.export[export-json,export-xfdf]']);
    expect(ids(narrow.folded)).toStrictEqual(['import-json', 'import-xfdf']);
  });

  it('CONTROL: entries with no menu are a button each, so the gathering is what the menu key causes', () => {
    expect(buttons(ribbonUnits([tool('a'), tool('b')]))).toStrictEqual(['a', 'b']);
  });

  it('SECONDARIES are drawn in the row while there is room, after the primaries, and are the FIRST to fold', () => {
    // ADR-0098's correction of 2 October. Interleaved on purpose: the projection orders by `order`, and a
    // secondary can sit between two primaries — the row must still put every primary ahead of every secondary.
    const mixed = [tool('open'), tool('save-copy', true), tool('save'), tool('pdfa', true), tool('print')];

    // NOT MEASURED YET: every tool drawn, the secondaries after the primaries, nothing folded.
    expect(buttons(splitFold(mixed, undefined).shown)).toStrictEqual(['open', 'save', 'print', 'save-copy', 'pdfa']);
    expect(ids(splitFold(mixed, undefined).folded)).toStrictEqual([]);

    // ROOM FOR EVERYTHING: the secondaries are in the row, and there is no More to fill.
    expect(ids(splitFold(mixed, { shown: 5, more: false }).folded)).toStrictEqual([]);

    // ONE SHORT: the LAST secondary leaves first; every primary stays.
    expect(ids(splitFold(mixed, { shown: 4, more: true }).folded)).toStrictEqual(['pdfa']);
    // ROOM FOR THE PRIMARIES ONLY: both secondaries are in the More, in the row's order.
    expect(ids(splitFold(mixed, { shown: 3, more: true }).folded)).toStrictEqual(['save-copy', 'pdfa']);

    // NARROWER: a primary folds only after every secondary, and comes FIRST in the More, as the more-used tool.
    const narrow = splitFold(mixed, { shown: 2, more: true });
    expect(buttons(narrow.shown)).toStrictEqual(['open', 'save']);
    expect(ids(narrow.folded)).toStrictEqual(['print', 'save-copy', 'pdfa']);
  });

  it('CONTROL: with no secondaries the row is the placement order, so the reordering above is what `secondary` causes', () => {
    const plain = [tool('open'), tool('save-copy'), tool('save')];
    expect(buttons(ribbonUnits(plain))).toStrictEqual(['open', 'save-copy', 'save']);
  });
});

describe('ribbonUnits — a run of small tools is columns of at most three (ADR-0194)', () => {
  interface Sized {
    readonly command: { readonly id: string };
    readonly secondary: boolean;
    readonly menu: MessageKey | undefined;
    readonly size: 'large' | 'small' | 'icon';
  }
  const tool = (id: string, size: Sized['size'] = 'large', secondary = false, menu?: MessageKey): Sized => ({
    command: { id },
    secondary,
    menu,
    size,
  });
  /** Each unit as `key:member,member`, a column marked by its size, so the columns and their members are both read. */
  const shape = (entries: readonly Sized[]): string[] =>
    ribbonUnits(entries).map((unit) =>
      unit.stack === undefined ? unit.key : `${unit.stack}[${unit.entries.map((entry) => entry.command.id).join(',')}]`,
    );
  const run = (count: number, size: Sized['size']): Sized[] => Array.from({ length: count }, (_, index) => tool(`t${String(index)}`, size));

  it('gathers seven icons as 3 + 2 + 2, never 3 + 3 + 1, and three small as one column', () => {
    expect(shape(run(7, 'icon'))).toStrictEqual(['icon[t0,t1,t2]', 'icon[t3,t4]', 'icon[t5,t6]']);
    expect(shape(run(3, 'small'))).toStrictEqual(['small[t0,t1,t2]']);
    expect(shape(run(4, 'small'))).toStrictEqual(['small[t0,t1]', 'small[t2,t3]']);
    expect(shape(run(1, 'small'))).toStrictEqual(['small[t0]']);
  });

  it('CONTROL: the same seven tools with no size are seven buttons, so the columns are what `size` causes', () => {
    expect(shape(run(7, 'large'))).toStrictEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
  });

  it('a run ends at a large tool and at a different small size, and keeps the placement order', () => {
    const entries = [tool('a', 'small'), tool('b', 'small'), tool('big'), tool('c', 'small'), tool('d', 'icon'), tool('e', 'icon')];
    expect(shape(entries)).toStrictEqual(['small[a,b]', 'big', 'small[c]', 'icon[d,e]']);
  });

  it('a NAMED MENU ends a run, and the SECONDARIES are gathered among themselves, after every primary', () => {
    const MENU = messageKey('test.menu.convert');
    const entries = [tool('a', 'small'), tool('x', 'small', false, MENU), tool('b', 'small'), tool('later', 'small', true), tool('c', 'small')];
    // `a` and `b` are not one run — the menu between them ended it — and `c` joins `b`'s column, so `b` is a column of two.
    expect(ribbonUnits(entries).map((unit) => unit.key)).toStrictEqual(['a', 'x', 'b', 'later']);
    expect(ribbonUnits(entries).map((unit) => unit.entries.length)).toStrictEqual([1, 1, 2, 1]);
    expect(ribbonUnits(entries).map((unit) => unit.stack)).toStrictEqual(['small', undefined, 'small', 'small']);
    // A secondary is not gathered with the primaries around it, and two secondaries of one size are one column.
    expect(shape([tool('a', 'small'), tool('s1', 'small', true), tool('b', 'small'), tool('s2', 'small', true)])).toStrictEqual([
      'small[a,b]',
      'small[s1,s2]',
    ]);
  });

  it('a folded column puts EVERY member in the More, one command per line, and nothing is in both', () => {
    const entries = [...run(3, 'small'), tool('big'), ...[tool('u', 'icon'), tool('v', 'icon')]];
    const units = ribbonUnits(entries);
    for (let shown = 1; shown <= units.length; shown += 1) {
      const split = splitFold(entries, { shown, more: shown < units.length });
      const all = [...split.shown.flatMap((unit) => unit.entries), ...split.folded].map((entry) => entry.command.id);
      expect(all, `shown ${String(shown)}`).toStrictEqual(entries.map((entry) => entry.command.id));
    }
    expect(splitFold(entries, { shown: 1, more: true }).folded.map((entry) => entry.command.id)).toStrictEqual(['big', 'u', 'v']);
  });
});

describe('innerWidthOf', () => {
  /** A row as the browser reports it: a box width, and the padding and border its computed style carries. */
  function row(box: number, style: Partial<CSSStyleDeclaration>): HTMLElement {
    const element = document.createElement('div');
    Object.assign(element.style, style);
    element.getBoundingClientRect = () => ({ width: box }) as DOMRect;
    document.body.append(element);
    return element;
  }

  it('is the CONTENT box — the box less its padding AND its border, the case CI measured on Linux', () => {
    // The failing case's own numbers (2026-09-29): box 972, 8 px padding and a 1 px border each side, groups
    // summing to 955.97. The room is 954, and 955.97 does not fit it.
    const bordered = row(972, { paddingLeft: '8px', paddingRight: '8px', borderLeft: '1px solid', borderRight: '1px solid' });
    expect(innerWidthOf(bordered)).toBe(954);
    // CONTROL: the same row without a border has the 2 px back, so the case above is the border being subtracted
    // rather than a constant — and a rule that ignored the border would answer 956 for both.
    expect(innerWidthOf(row(972, { paddingLeft: '8px', paddingRight: '8px' }))).toBe(956);
  });
});
