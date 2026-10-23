import type { DocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { afterOp, createPagePlans, inverseOf, pageOpOf, plannedPages, plannedRotation } from './pagePlan.js';

const v = (n: number): DocVersion => n as DocVersion;
/** A value the case needs to be there: a plan the holder refused fails the case here, by name, not as a later null. */
function given<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value, and the holder answered none');
  return value;
}
const sources = (pages: readonly { source: number; turn: number }[] | null): string =>
  pages === null ? 'none' : pages.map((page) => `${String(page.source)}${page.turn === 0 ? '' : `+${String(page.turn)}`}`).join(' ');

describe('pageOpOf — a page command as a plan reads it', () => {
  it('reads rotate, move, swap and delete, runs included', () => {
    expect(pageOpOf({ kind: 'rotatePages', pages: [[1, 2]], quarterTurns: 1 }, 4)).toStrictEqual({ kind: 'rotate', pages: [1, 2], quarterTurns: 1 });
    expect(pageOpOf({ kind: 'movePage', from: 0, to: 3 }, 4)).toStrictEqual({ kind: 'move', from: 0, to: 3 });
    expect(pageOpOf({ kind: 'swapPages', a: 1, b: 2 }, 4)).toStrictEqual({ kind: 'swap', a: 1, b: 2 });
    expect(pageOpOf({ kind: 'deletePages', pages: [0, 3] }, 4)).toStrictEqual({ kind: 'delete', pages: [0, 3] });
  });

  it('plans nothing for a page the document does not have, or for another command', () => {
    expect(pageOpOf({ kind: 'movePage', from: 0, to: 4 }, 4)).toBeNull();
    expect(pageOpOf({ kind: 'deletePages', pages: [[2, 9]] }, 4)).toBeNull();
    // CONTROL: the same delete inside the document is planned, so the refusal is the range.
    expect(pageOpOf({ kind: 'deletePages', pages: [[2, 3]] }, 4)).not.toBeNull();
  });
});

describe('afterOp and plannedPages — what each slot shows', () => {
  const four = Array.from({ length: 4 }, (_unused, source) => ({ source, turn: 0 }));

  it('a move puts the page where the page-tree writer puts it, and a delete keeps the rest in order', () => {
    expect(sources(afterOp(four, { kind: 'move', from: 0, to: 2 }))).toBe('1 2 0 3');
    expect(sources(afterOp(four, { kind: 'move', from: 3, to: 0 }))).toBe('3 0 1 2');
    expect(sources(afterOp(four, { kind: 'delete', pages: [1, 2] }))).toBe('0 3');
    expect(sources(afterOp(four, { kind: 'swap', a: 0, b: 3 }))).toBe('3 1 2 0');
  });

  it('turns add up, modulo a whole turn, and follow their page through a later move', () => {
    const turned = afterOp(afterOp(four, { kind: 'rotate', pages: [1], quarterTurns: 3 }), { kind: 'rotate', pages: [1], quarterTurns: 2 });
    expect(sources(turned)).toBe('0 1+1 2 3');
    expect(sources(afterOp(turned, { kind: 'move', from: 1, to: 3 }))).toBe('0 2 3 1+1');
  });

  it('a view that has drawn the first of two ops shows only the second ahead of it', () => {
    const pending = [
      { op: { kind: 'move', from: 0, to: 3 } as const, produced: v(5) },
      { op: { kind: 'rotate', pages: [0], quarterTurns: 1 } as const, produced: undefined },
    ];
    // OVER VERSION 4: both ops are ahead.
    expect(sources(plannedPages(pending, v(4), 4))).toBe('1+1 2 3 0');
    // OVER VERSION 5, which has the move: the rotate alone, now naming version 5's page 0.
    expect(sources(plannedPages(pending, v(5), 4))).toBe('0+1 1 2 3');
    // CONTROL: once a view has everything, nothing is planned.
    expect(plannedPages([{ ...given(pending[0]), produced: v(5) }], v(5), 4)).toBeNull();
  });

  it('an op naming a page the layout lacks draws nothing ahead, rather than a wrong page', () => {
    expect(plannedPages([{ op: { kind: 'move', from: 0, to: 6 }, produced: undefined }], v(1), 4)).toBeNull();
  });

  it('the rotation drawn is the page’s own in the view, turned by the plan', () => {
    expect(plannedRotation({ source: 0, turn: 2 })).toStrictEqual({ turnedFromOwn: 2 });
    expect(plannedRotation({ source: 0, turn: 0 })).toBeUndefined();
  });
});

describe('createPagePlans — the holder', () => {
  it('plans over a current view, and not over a view behind the store with nothing planned between', () => {
    const plans = createPagePlans();
    expect(plans.propose({ kind: 'rotate', pages: [0], quarterTurns: 1 }, v(3), v(2))).toBeNull();
    expect(plans.getSnapshot()).toHaveLength(0);
    // CONTROL: the same op over a current view is planned.
    expect(plans.propose({ kind: 'rotate', pages: [0], quarterTurns: 1 }, v(3), v(3))).not.toBeNull();
    expect(plans.getSnapshot()).toHaveLength(1);
  });

  it('a second op composes while the first is pending, though the store has moved past the view', () => {
    const plans = createPagePlans();
    const first = plans.propose({ kind: 'move', from: 0, to: 1 }, v(3), v(3));
    plans.answered(given(first), v(4));
    expect(plans.propose({ kind: 'delete', pages: [0] }, v(4), v(3))).not.toBeNull();
    expect(sources(plannedPages(plans.getSnapshot(), v(3), 3))).toBe('0 2');
  });

  it('leaves as the page draws each version, and a refusal drops every pending op', () => {
    const plans = createPagePlans();
    const handle = plans.propose({ kind: 'swap', a: 0, b: 1 }, v(1), v(1));
    plans.answered(given(handle), v(2));
    plans.viewShown(v(1), 2);
    expect(plans.getSnapshot()).toHaveLength(1);
    plans.viewShown(v(2), 2);
    expect(plans.getSnapshot()).toHaveLength(0);
    expect(plans.view()).toStrictEqual({ version: v(2), pageCount: 2 });
    plans.propose({ kind: 'swap', a: 0, b: 1 }, v(2), v(2));
    plans.refused();
    expect(plans.getSnapshot()).toHaveLength(0);
  });

  it('an undo is planned from the inverse of the op that produced the version, and a redo from the op undone', () => {
    const plans = createPagePlans();
    const move = { kind: 'move', from: 0, to: 2 } as const;
    plans.answered(given(plans.propose(move, v(1), v(1))), v(2));
    expect(plans.undoOf(v(2))).toStrictEqual({ kind: 'move', from: 2, to: 0 });
    plans.undone(move, v(3));
    expect(plans.redoOf(v(3))).toStrictEqual(move);
    // CONTROL: a version no planned op produced plans no undo.
    expect(plans.undoOf(v(1))).toBeNull();
    expect(inverseOf({ kind: 'delete', pages: [0] })).toBeNull();
  });
});
