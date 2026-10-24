// @vitest-environment happy-dom
import { channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDITING_RENEW_MS, useEditingEnginesKept } from './editingEngines.js';

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

describe('the editing hosts kept running while the Edit tab is in use (ADR-0048’s correction, item 7a)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks at once, then again every renewal for as long as the tab is in use', () => {
    const { client, asked } = counting();
    renderHook(() => {
      useEditingEnginesKept(client, true);
    });
    expect(asked).toStrictEqual(['app.prepareEditing']);
    // TWO MINUTES IN THE TAB, the owner's case: six renewals, so the hosts' 60 s idle never runs out.
    vi.advanceTimersByTime(2 * 60_000);
    expect(asked).toHaveLength(1 + (2 * 60_000) / EDITING_RENEW_MS);
    // A RENEWAL SOONER THAN THE IDLE TIME, with room to spare: what keeps the hosts up between renewals.
    expect(EDITING_RENEW_MS).toBeLessThan(60_000 / 2);
  });

  it('CONTROL: leaving the tab ends the renewals, so the hosts stop by their idle rule', () => {
    const { client, asked } = counting();
    const { rerender } = renderHook(({ active }: { active: boolean }) => {
      useEditingEnginesKept(client, active);
    }, { initialProps: { active: true } });
    vi.advanceTimersByTime(EDITING_RENEW_MS);
    expect(asked).toHaveLength(2);
    rerender({ active: false });
    vi.advanceTimersByTime(5 * EDITING_RENEW_MS);
    expect(asked).toHaveLength(2);
  });

  it('asks nothing while the tab is not in use', () => {
    const { client, asked } = counting();
    renderHook(() => {
      useEditingEnginesKept(client, false);
    });
    vi.advanceTimersByTime(5 * EDITING_RENEW_MS);
    expect(asked).toStrictEqual([]);
  });
});
