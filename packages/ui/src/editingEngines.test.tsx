// @vitest-environment happy-dom
import { channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditingEnginesStarted } from './editingEngines.js';

/** A client that counts `app.prepareEditing`. */
function counting() {
  const asked: string[] = [];
  const client = createClient(channels, (id) => {
    asked.push(id);
    if (id === 'app.prepareEditing') return Promise.resolve(ok({ started: true }));
    throw new Error(`no answer for ${id}`);
  });
  return { client, asked };
}

/** Longer than any host's idle time, so a case over it needs no copy of `main`'s constant across the boundary. */
const TEN_MINUTES = 10 * 60_000;

describe('the editing hosts started as the Edit tab opens, and not kept up there (ADR-0048’s correction of 2026-10-26)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once as the tab comes into use and NEVER AGAIN while it stays in use, so the hosts stop by their idle rule', () => {
    // THE CONTROL is the code this replaced: it renewed the ask every 20 s, and over ten minutes on the tab asked 31
    // times, each a call that restarted the hosts' idle time. One ask is what lets `main`'s idle rule end them
    // (`idleRetire.test.ts`: a host stops its idle time after its last call).
    const { client, asked } = counting();
    renderHook(() => {
      useEditingEnginesStarted(client, true);
    });
    expect(asked).toStrictEqual(['app.prepareEditing']);
    vi.advanceTimersByTime(TEN_MINUTES);
    expect(asked).toStrictEqual(['app.prepareEditing']);
  });

  it('asks again when the tab comes into use again, so a return to it starts the hosts before the first read', () => {
    const { client, asked } = counting();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useEditingEnginesStarted(client, active);
      },
      { initialProps: { active: true } },
    );
    rerender({ active: false });
    vi.advanceTimersByTime(TEN_MINUTES);
    rerender({ active: true });
    expect(asked).toStrictEqual(['app.prepareEditing', 'app.prepareEditing']);
  });

  it('asks nothing while the tab is not in use', () => {
    const { client, asked } = counting();
    renderHook(() => {
      useEditingEnginesStarted(client, false);
    });
    vi.advanceTimersByTime(TEN_MINUTES);
    expect(asked).toStrictEqual([]);
  });
});
