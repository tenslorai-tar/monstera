import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CSV_CONVERTING } from '../messages/en.js';
import { type RunningTask, trackerOver } from '../runningTask.js';
import { WORK_PROGRESS_INTERVAL_MS, withWorkProgress } from './workProgress.js';

/**
 * The shared work-in-progress follower (the owner's O9 and O10): the work is named, its progress is asked for under that
 * name while the call is in flight, Cancel asks main to stop it, and the notice leaves when the call ends.
 *
 * The CONTROL is a progress answer of `idle`, which must not move the notice: a follower that stepped on every answer
 * would show work as done that has not begun.
 */
describe('withWorkProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeMain(answers: { kind: 'idle' } | { kind: 'running'; done: number; total: number }): {
    client: ContractClient;
    sent: { id: string; params: unknown }[];
  } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'work.progress') return Promise.resolve(ok(answers));
      if (id === 'work.cancel') return Promise.resolve(ok({ cancelled: true }));
      throw new Error(`this fixture has no answer for ${id}`);
    });
    return { client, sent };
  }

  it('shows the work, steps it from main’s answers under the work’s name, and ends it when the call ends', async () => {
    const shown: (RunningTask | undefined)[] = [];
    const track = trackerOver((task) => shown.push(task));
    const { client, sent } = fakeMain({ kind: 'running', done: 3, total: 12 });
    let finish: (value: string) => void = () => undefined;
    let named = '';
    const running = withWorkProgress({ client, track }, CSV_CONVERTING, (work) => {
      named = work;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    await vi.advanceTimersByTimeAsync(WORK_PROGRESS_INTERVAL_MS);
    expect(sent.at(-1)).toStrictEqual({ id: 'work.progress', params: { work: named } });
    expect(shown.at(-1)).toMatchObject({ label: CSV_CONVERTING, done: 3, total: 12 });
    finish('done');
    expect(await running).toBe('done');
    expect(shown.at(-1)).toBeUndefined();
    // NO ASKING AFTER THE END.
    const asked = sent.length;
    await vi.advanceTimersByTimeAsync(WORK_PROGRESS_INTERVAL_MS * 3);
    expect(sent).toHaveLength(asked);
  });

  it('CONTROL: an idle answer does not move the notice from its start', async () => {
    const shown: (RunningTask | undefined)[] = [];
    const track = trackerOver((task) => shown.push(task));
    const { client } = fakeMain({ kind: 'idle' });
    let finish: () => void = () => undefined;
    const running = withWorkProgress({ client, track }, CSV_CONVERTING, () => new Promise<void>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(WORK_PROGRESS_INTERVAL_MS * 2);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ done: 0, total: 0 });
    finish();
    await running;
  });

  it('Cancel asks main to stop the work by its name', async () => {
    const shown: (RunningTask | undefined)[] = [];
    const track = trackerOver((task) => shown.push(task));
    const { client, sent } = fakeMain({ kind: 'running', done: 1, total: 4 });
    let finish: () => void = () => undefined;
    let named = '';
    const running = withWorkProgress({ client, track }, CSV_CONVERTING, (work) => {
      named = work;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    shown.at(-1)?.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toContainEqual({ id: 'work.cancel', params: { work: named } });
    finish();
    await running;
  });
});
