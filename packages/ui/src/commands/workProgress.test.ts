import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CSV_CONVERTING } from '../messages/en.js';
import { type RunningTask, trackerOver } from '../runningTask.js';
import { WORK_BEGIN_INTERVAL_MS, WORK_PROGRESS_INTERVAL_MS, withWorkProgress } from './workProgress.js';

/**
 * The one way a conversion in main is shown (ADR-0234, the owner's O9 and O10): the work is named, its progress is asked
 * for under that name while the call is in flight, the notice appears when main first says `running` — once the input is
 * chosen — Cancel shows only where main says the work stops, and the notice leaves when the call ends.
 */
describe('withWorkProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Answer = { kind: 'idle' } | { kind: 'running'; done: number; total: number; stoppable: boolean };

  function fakeMain(answer: () => Answer): { client: ContractClient; sent: { id: string; params: unknown }[] } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'work.progress') return Promise.resolve(ok(answer()));
      if (id === 'work.cancel') return Promise.resolve(ok({ cancelled: true }));
      throw new Error(`this fixture has no answer for ${id}`);
    });
    return { client, sent };
  }

  /** Runs a conversion that answers when `finish` is called, recording what the notice showed. */
  function converting(client: ContractClient): {
    readonly shown: (RunningTask | undefined)[];
    readonly running: Promise<string>;
    readonly finish: () => void;
    readonly named: () => string;
  } {
    const shown: (RunningTask | undefined)[] = [];
    const track = trackerOver((task) => shown.push(task));
    let finish: (value: string) => void = () => undefined;
    let named = '';
    const running = withWorkProgress({ client, track }, CSV_CONVERTING, (work) => {
      named = work;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    return {
      shown,
      running,
      finish: () => {
        finish('done');
      },
      named: () => named,
    };
  }

  it('shows NOTHING while main answers idle — the picker is open — and the work from main’s first running, under its name', async () => {
    let begun = false;
    const { client, sent } = fakeMain(() => (begun ? { kind: 'running', done: 3, total: 12, stoppable: true } : { kind: 'idle' }));
    const { shown, running, finish, named } = converting(client);
    // CONTROL: however long the picker stays open, an idle name shows no notice.
    await vi.advanceTimersByTimeAsync(WORK_PROGRESS_INTERVAL_MS * 3);
    expect(shown).toStrictEqual([]);
    // THE INPUT IS CHOSEN: main begins, and the notice appears within one short interval, with main's count.
    begun = true;
    await vi.advanceTimersByTimeAsync(WORK_BEGIN_INTERVAL_MS);
    expect(sent.at(-1)).toStrictEqual({ id: 'work.progress', params: { work: named() } });
    expect(shown.at(-1)).toMatchObject({ label: CSV_CONVERTING, done: 3, total: 12, stoppable: true });
    finish();
    expect(await running).toBe('done');
    expect(shown.at(-1)).toBeUndefined();
    // NO ASKING AFTER THE END.
    const asked = sent.length;
    await vi.advanceTimersByTimeAsync(WORK_PROGRESS_INTERVAL_MS * 3);
    expect(sent).toHaveLength(asked);
  });

  it('a call answered before main ever ran shows nothing at all — a dismissed picker is not announced', async () => {
    const { client } = fakeMain(() => ({ kind: 'idle' }));
    const { shown, running, finish } = converting(client);
    await vi.advanceTimersByTimeAsync(WORK_BEGIN_INTERVAL_MS * 2);
    finish();
    await running;
    expect(shown).toStrictEqual([]);
  });

  it('work that RUNS TO THE END is shown without a Cancel — CONTROL: the first case, which stops, has one', async () => {
    const { client } = fakeMain(() => ({ kind: 'running', done: 0, total: 0, stoppable: false }));
    const { shown, running, finish } = converting(client);
    await vi.advanceTimersByTimeAsync(WORK_BEGIN_INTERVAL_MS);
    expect(shown.at(-1)).toMatchObject({ stoppable: false, total: 0 });
    finish();
    await running;
  });

  it('Cancel asks main to stop the work by its name', async () => {
    const { client, sent } = fakeMain(() => ({ kind: 'running', done: 1, total: 4, stoppable: true }));
    const { shown, running, finish, named } = converting(client);
    await vi.advanceTimersByTimeAsync(WORK_BEGIN_INTERVAL_MS);
    shown.at(-1)?.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toContainEqual({ id: 'work.cancel', params: { work: named() } });
    finish();
    await running;
  });
});
