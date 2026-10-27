// @vitest-environment happy-dom
import { asDocVersion } from '@monstera/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTLE_MS, useSettledPages, useSettledRead } from './useSettledPages.js';

/** The pages, as a new set on every call: what the page list hands over on every render. */
const pages = (...at: number[]): ReadonlySet<number> => new Set(at);

describe('useSettledPages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles the first pages at once, so a document opens with its reads', () => {
    const { result } = renderHook(({ shown }) => useSettledPages(shown), { initialProps: { shown: pages(0, 1) } });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect([...result.current.pages]).toStrictEqual([0, 1]);
    expect(result.current.paused).toBe(true);
  });

  it('holds the pages a scroll is passing, and settles on the ones it stops on after the pause', () => {
    const { result, rerender } = renderHook(({ shown }) => useSettledPages(shown), { initialProps: { shown: pages(0, 1) } });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // THE SCROLL: a new set every two frames, each shorter-lived than the pause.
    for (const at of [2, 3, 4, 5]) {
      rerender({ shown: pages(at, at + 1) });
      act(() => {
        vi.advanceTimersByTime(SETTLE_MS - 1);
      });
      // CONTROL: none of the pages passed is asked for; the pages from before the scroll are still the answer.
      expect([...result.current.pages]).toStrictEqual([0, 1]);
      // AND NOTHING IS PAUSED while the set moves, which is what holds every editing read back.
      expect(result.current.paused).toBe(false);
    }
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect([...result.current.pages]).toStrictEqual([5, 6]);
    expect(result.current.paused).toBe(true);
  });

  it('keeps the same set while the same pages are shown, so a read keyed on it is not asked again', () => {
    const { result, rerender } = renderHook(({ shown }) => useSettledPages(shown), { initialProps: { shown: pages(3) } });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const held = result.current.pages;
    rerender({ shown: pages(3) });
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 2);
    });
    expect(result.current.pages).toBe(held);
    expect(result.current.paused).toBe(true);
  });

  it('settles at once after an empty set, which is a list that had measured no page yet', () => {
    const { result, rerender } = renderHook(({ shown }) => useSettledPages(shown), { initialProps: { shown: pages() } });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    rerender({ shown: pages(0) });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect([...result.current.pages]).toStrictEqual([0]);
  });
});

describe('useSettledRead', () => {
  it('says not to read while a scroll moves, and to read once it pauses', () => {
    const { result, rerender } = renderHook(({ paused, version }) => useSettledRead(paused, asDocVersion(version)), { initialProps: { paused: false, version: 1 } });
    // THE DECISION: a page mounted during a scroll is not read.
    expect(result.current).toBe(false);
    rerender({ paused: true, version: 1 });
    expect(result.current).toBe(true);
  });

  it('keeps reading at that version when a scroll starts again, so an answer in flight is not cut short', () => {
    const { result, rerender } = renderHook(({ paused, version }) => useSettledRead(paused, asDocVersion(version)), { initialProps: { paused: true, version: 1 } });
    rerender({ paused: false, version: 1 });
    expect(result.current).toBe(true);
    // CONTROL: a NEW version during a scroll waits again, so a write lands no read in the middle of one.
    rerender({ paused: false, version: 2 });
    expect(result.current).toBe(false);
    rerender({ paused: true, version: 2 });
    expect(result.current).toBe(true);
  });
});
