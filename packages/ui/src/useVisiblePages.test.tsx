// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useVisiblePages } from './useVisiblePages.js';

/**
 * The visibility hook against an observer that behaves like a BROWSER'S.
 *
 * Every other file stubs `IntersectionObserver` with one that never calls back
 * until a case says so. A browser does call back: every `observe` is answered
 * with an initial report. That difference hid a render loop for weeks — a ref
 * callback of a new identity per render re-observed each slot, each report set a
 * new Set, and each new Set rendered again — because the quiet double could not
 * produce the report that closes the cycle. So the double here reports on
 * `observe`, and the reports are delivered by the case, one round at a time, so
 * a loop shows as rounds that never run dry rather than as a hung test.
 */

let observed: Element[] = [];
let pending: IntersectionObserverEntry[] = [];
let deliver: IntersectionObserverCallback | undefined;

beforeEach(() => {
  observed = [];
  pending = [];
  deliver = undefined;
  const target: { IntersectionObserver: typeof IntersectionObserver } = globalThis;
  target.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      deliver = callback;
    }
    observe(element: Element): void {
      observed.push(element);
      // THE INITIAL REPORT a browser sends for every observed element.
      pending.push({ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry);
    }
    unobserve(): void {
      // Nothing here reads it; the loop is visible through `observe` alone.
    }
    disconnect(): void {
      // Teardown is not this file's subject.
    }
  } as unknown as typeof IntersectionObserver;
});

/** Delivers every queued report; answers how many there were. */
function flush(): number {
  const batch = pending;
  pending = [];
  if (batch.length > 0 && deliver !== undefined) {
    const callback = deliver;
    act(() => {
      callback(batch, {} as unknown as IntersectionObserver);
    });
  }
  return batch.length;
}

const seen: ReadonlySet<number>[] = [];

function Host({ pages, label }: { pages: readonly number[]; label: string }): ReactElement {
  const { visible, slotRef } = useVisiblePages('0px');
  seen.push(visible);
  return (
    <div aria-label={label}>
      {pages.map((page) => (
        <div key={page} ref={slotRef(page)} />
      ))}
    </div>
  );
}

beforeEach(() => {
  seen.length = 0;
});

describe('useVisiblePages', () => {
  it('SETTLES: the reports a browser sends on observe run dry, instead of each one causing the next', () => {
    render(<Host label="a" pages={[0, 1, 2]} />);
    const rounds = [flush(), flush(), flush(), flush()];
    // Three slots observed once, reported once, and then nothing: the loop's
    // signature is a report in every round, for ever.
    expect(rounds).toStrictEqual([3, 0, 0, 0]);
  });

  it('CONTROL — a re-render does not re-observe a slot: the ref for a page is the same function every render', () => {
    const { rerender } = render(<Host label="a" pages={[0, 1]} />);
    const before = observed.length;
    rerender(<Host label="b" pages={[0, 1]} />);
    rerender(<Host label="c" pages={[0, 1]} />);
    expect(observed.length).toBe(before);
  });

  it('CONTROL — a report that moves nothing keeps the SAME set, and one that moves a page makes a new one', () => {
    render(<Host label="a" pages={[0, 1]} />);
    flush();
    const settled = seen[seen.length - 1];
    expect(settled === undefined ? [] : [...settled].sort()).toStrictEqual([0, 1]);

    // Page 0 reported in again: already in, so nothing a reader keys on may change.
    const zero = observed[0];
    if (zero === undefined || deliver === undefined) throw new Error('no slot was observed');
    const callback = deliver;
    act(() => {
      callback([{ target: zero, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as unknown as IntersectionObserver);
    });
    expect(seen[seen.length - 1]).toBe(settled);

    // Page 0 leaving IS a change, so the no-op above is a decision rather than a set that never updates.
    act(() => {
      callback([{ target: zero, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as unknown as IntersectionObserver);
    });
    const moved = seen[seen.length - 1];
    expect(moved).not.toBe(settled);
    expect(moved === undefined ? [] : [...moved]).toStrictEqual([1]);
  });
});
