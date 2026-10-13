import { describe, expect, it } from 'vitest';

import { WorkInProgress } from './workInProgress.js';

/** The one registry of named work in main (ADR-0234): what `work.progress` and `work.cancel` answer. */
describe('WorkInProgress', () => {
  it('answers idle for a name before it begins, running with its counts while it runs, and idle once finished', () => {
    const work = new WorkInProgress();
    expect(work.progress('a')).toStrictEqual({ kind: 'idle' });
    const handle = work.begin('a', 'stops-between-parts');
    handle.step(2, 5);
    expect(work.progress('a')).toStrictEqual({ kind: 'running', done: 2, total: 5, stoppable: true });
    work.finish('a');
    expect(work.progress('a')).toStrictEqual({ kind: 'idle' });
  });

  it('a stop reaches work cut into parts, at its next check', () => {
    const work = new WorkInProgress();
    const handle = work.begin('a', 'stops-between-parts');
    expect(handle.stopped()).toBe(false);
    expect(work.cancel('a')).toBe(true);
    expect(handle.stopped()).toBe(true);
  });

  it('CONTROL: work that runs to the end says so, and a stop is refused rather than recorded and ignored', () => {
    const work = new WorkInProgress();
    const handle = work.begin('b', 'runs-to-the-end');
    expect(work.progress('b')).toStrictEqual({ kind: 'running', done: 0, total: 0, stoppable: false });
    expect(work.cancel('b')).toBe(false);
    expect(handle.stopped()).toBe(false);
  });

  it('CONTROL: a stop for a name nothing runs under is false, and two names are kept apart', () => {
    const work = new WorkInProgress();
    work.begin('a', 'stops-between-parts');
    expect(work.cancel('nothing')).toBe(false);
    work.begin('c', 'runs-to-the-end');
    work.finish('c');
    expect(work.progress('a')).toStrictEqual({ kind: 'running', done: 0, total: 0, stoppable: true });
  });
});
