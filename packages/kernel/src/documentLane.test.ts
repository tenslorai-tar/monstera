import { describe, expect, it } from 'vitest';

import { DocumentLane } from './documentLane.js';

/** A lane entry that records when it starts and ends, and finishes when `release` is called. */
function entry(log: string[], name: string) {
  let release = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release: () => {
      release();
    },
    work: async () => {
      log.push(`start ${name}`);
      await done;
      log.push(`end ${name}`);
      return name;
    },
  };
}

/** Lets every queued microtask run, so the lane has picked whatever it will pick. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('DocumentLane (ADR-0274)', () => {
  it('runs a write queued behind reads before those reads, and after the read already running', async () => {
    const lane = new DocumentLane();
    const log: string[] = [];
    const running = entry(log, 'read A');
    const queued = [entry(log, 'read B'), entry(log, 'read C')];
    const save = entry(log, 'save');
    const answers = [lane.enter('read', running.work), ...queued.map((each) => lane.enter('read', each.work))];
    const saved = lane.enter('write', save.work);
    await settle();
    // THE RUNNING READ IS NOT INTERRUPTED.
    expect(log).toStrictEqual(['start read A']);
    running.release();
    await settle();
    // THE SAVE NEXT: zero queued reads ran ahead of it.
    expect(log).toStrictEqual(['start read A', 'end read A', 'start save']);
    save.release();
    await saved;
    for (const each of queued) {
      await settle();
      each.release();
    }
    expect(await Promise.all(answers)).toStrictEqual(['read A', 'read B', 'read C']);
    expect(log.filter((line) => line.startsWith('start'))).toStrictEqual(['start read A', 'start save', 'start read B', 'start read C']);
  });

  it('CONTROL: every entry queued as a write keeps first come first served, which is the order the reads above cost', async () => {
    const lane = new DocumentLane();
    const log: string[] = [];
    const all = ['read A', 'read B', 'read C', 'save'].map((name) => entry(log, name));
    const answers = all.map((each) => lane.enter('write', each.work));
    for (const each of all) {
      await settle();
      each.release();
    }
    await Promise.all(answers);
    // TWO QUEUED READS AHEAD OF THE SAVE, the count the order above makes zero.
    expect(log.filter((line) => line.startsWith('start'))).toStrictEqual(['start read A', 'start read B', 'start read C', 'start save']);
  });

  it('carries no failure forward, and drains only once everything accepted has run', async () => {
    const lane = new DocumentLane();
    const failed = lane.enter('write', () => Promise.reject(new Error('one bad command')));
    const after = lane.enter('read', () => Promise.resolve('read after'));
    let drained = false;
    const draining = lane.drained().then(() => {
      drained = true;
    });
    await expect(failed).rejects.toThrow('one bad command');
    expect(await after).toBe('read after');
    await draining;
    expect(drained).toBe(true);
    // AN IDLE LANE IS DRAINED AT ONCE.
    await expect(lane.drained()).resolves.toBeUndefined();
  });
});
