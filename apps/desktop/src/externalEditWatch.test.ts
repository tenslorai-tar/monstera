import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EDIT_QUIET_MS, type EditWatchSurface, watchEdits } from './externalEditWatch.js';

/**
 * The watch's RULE, on a fake surface — ADR-0062 Decision 3.
 *
 * `nodeEditWatch.test.ts` drives the real surface on a real directory; this file owns
 * the decision, which is where every case can be exact: how many looks a burst costs,
 * and which digests are an edit.
 */

const PATH = join('edits', 'page.pdf');
const WRITTEN = 'digest-of-the-page-main-wrote';

/** A surface whose events, digests and timers a case drives by hand. */
function fake(digests: readonly (string | null)[], refuse = false) {
  const queue = [...digests];
  let onEvent: ((name: string) => void) | null = null;
  let onError: (() => void) | null = null;
  let watchClosed = false;
  let looks = 0;
  const timers: { ms: number; run: () => void; live: boolean }[] = [];

  const surface: EditWatchSurface = {
    watchDirectory: (_directory, event, error) => {
      if (refuse) return null;
      onEvent = event;
      onError = error;
      return {
        close: () => {
          watchClosed = true;
        },
      };
    },
    digest: () => {
      looks += 1;
      return Promise.resolve(queue.shift() ?? null);
    },
    after: (ms, run) => {
      const timer = { ms, run, live: true };
      timers.push(timer);
      return {
        cancel: () => {
          timer.live = false;
        },
      };
    },
  };

  /** Lets a look's awaited digest settle. */
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  /** Runs the live timers of one duration, as that much time passing. */
  const pass = async (ms: number): Promise<void> => {
    for (const timer of timers) {
      if (timer.live && timer.ms === ms) {
        timer.live = false;
        timer.run();
      }
    }
    await flush();
  };

  return {
    surface,
    event: (name: string): void => {
      onEvent?.(name);
    },
    error: (): void => {
      onError?.();
    },
    quietSecond: () => pass(EDIT_QUIET_MS),
    bound: (ms: number) => pass(ms),
    liveQuietTimers: () => timers.filter((timer) => timer.live && timer.ms === EDIT_QUIET_MS).length,
    looks: () => looks,
    watchClosed: () => watchClosed,
  };
}

function started(driven: ReturnType<typeof fake>) {
  const watch = watchEdits(driven.surface, PATH, WRITTEN);
  if (watch === null) throw new Error('the fake refused the watch');
  return watch;
}

describe('watchEdits — an edit is a changed digest after a quiet second', () => {
  it('a BURST of events for the file costs ONE look, a quiet second after the last', async () => {
    const driven = fake(['a-real-edit']);
    const watch = started(driven);
    driven.event('page.pdf');
    driven.event('page.pdf');
    driven.event('page.pdf');
    // THE DECISION: three events, one live timer — each restarted the last.
    expect(driven.liveQuietTimers()).toBe(1);
    expect(driven.looks()).toBe(0);
    await driven.quietSecond();
    expect(driven.looks()).toBe(1);
    await expect(watch.wait(30_000)).resolves.toBe('changed');
    expect(watch.pending()).toBe('a-real-edit');
  });

  it('an event for ANOTHER name — an editor’s temporary file — schedules nothing', () => {
    const driven = fake([]);
    started(driven);
    driven.event('page.pdf~RF1a2b.TMP');
    expect(driven.liveQuietTimers()).toBe(0);
  });

  it('the file’s name in another case IS the file, on a case-insensitive file system', () => {
    const driven = fake([]);
    started(driven);
    driven.event('PAGE.PDF');
    expect(driven.liveQuietTimers()).toBe(1);
  });

  it('CONTROL: bytes identical to what main wrote are not an edit', async () => {
    const driven = fake([WRITTEN]);
    const watch = started(driven);
    const waiting = watch.wait(30_000);
    driven.event('page.pdf');
    await driven.quietSecond();
    expect(driven.looks()).toBe(1);
    await driven.bound(30_000);
    await expect(waiting).resolves.toBe('unchanged');
    expect(watch.pending()).toBeNull();
  });

  it('a file that cannot be read yet is not an edit, and the next event looks again', async () => {
    const driven = fake([null, 'saved-after-the-lock']);
    const watch = started(driven);
    driven.event('page.pdf');
    await driven.quietSecond();
    expect(watch.pending()).toBeNull();
    driven.event('page.pdf');
    await driven.quietSecond();
    expect(watch.pending()).toBe('saved-after-the-lock');
  });

  it('an ACCEPTED edit is not offered again for the same bytes', async () => {
    const driven = fake(['edited', 'edited']);
    const watch = started(driven);
    driven.event('page.pdf');
    await driven.quietSecond();
    expect(watch.pending()).toBe('edited');
    watch.accept();
    expect(watch.pending()).toBeNull();

    const waiting = watch.wait(30_000);
    driven.event('page.pdf');
    await driven.quietSecond();
    await driven.bound(30_000);
    await expect(waiting).resolves.toBe('unchanged');
  });

  it('an edit is ANNOUNCED ONCE: after `changed`, a wait holds until a NEWER save', async () => {
    // THE DISMISSAL CASE. The renderer asks the person on `changed`, and *not now* waits
    // again; if a pending edit answered `changed` to every wait, the question would reopen
    // at once, for ever.
    const driven = fake(['first-save', 'second-save']);
    const watch = started(driven);
    driven.event('page.pdf');
    await driven.quietSecond();
    await expect(watch.wait(30_000)).resolves.toBe('changed');

    const again = watch.wait(30_000);
    await driven.bound(30_000);
    await expect(again).resolves.toBe('unchanged');

    const next = watch.wait(30_000);
    driven.event('page.pdf');
    await driven.quietSecond();
    await expect(next).resolves.toBe('changed');
    expect(watch.pending()).toBe('second-save');
  });

  it('a NEWER save replaces an edit still pending', async () => {
    const driven = fake(['first-save', 'second-save']);
    const watch = started(driven);
    driven.event('page.pdf');
    await driven.quietSecond();
    driven.event('page.pdf');
    await driven.quietSecond();
    expect(watch.pending()).toBe('second-save');
  });

  it('closing answers a waiting wait with ENDED, stops the platform watch, and stays ended', async () => {
    const driven = fake([]);
    const watch = started(driven);
    const waiting = watch.wait(30_000);
    watch.close();
    await expect(waiting).resolves.toBe('ended');
    await expect(watch.wait(30_000)).resolves.toBe('ended');
    expect(driven.watchClosed()).toBe(true);
  });

  it('a watch the PLATFORM ends — an error — answers ENDED rather than waiting forever', async () => {
    const driven = fake([]);
    const watch = started(driven);
    const waiting = watch.wait(30_000);
    driven.error();
    await expect(waiting).resolves.toBe('ended');
  });

  it('a directory the platform will not watch is NULL, never a watch that sees nothing', () => {
    expect(watchEdits(fake([], true).surface, PATH, WRITTEN)).toBeNull();
  });
});
