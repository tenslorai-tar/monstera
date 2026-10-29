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

  /**
   * A READ ALREADY RUNNING FINISHES BEFORE A SAVE, by design (M2c, cloud run 25): no native call has a safe point to stop
   * at. What must hold is that nothing asked during it is lost, run twice or run out of order: the edit before the save is
   * in what it saves, each of two saves runs once, and a read that fails takes nothing with it.
   */
  it('loses no save asked for while a read runs, runs each save once, and keeps the edit before it first, the read failing or not', async () => {
    for (const fails of [false, true]) {
      const lane = new DocumentLane();
      const log: string[] = [];
      let release = (): void => undefined;
      const reading = lane.enter('read', async () => {
        log.push('start read');
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (fails) throw new Error('the read failed');
        return 'read';
      });
      const writes = ['edit', 'save', 'save again'].map((name) =>
        lane.enter('write', () => {
          log.push(name);
          return Promise.resolve(name);
        }),
      );
      await settle();
      // NOTHING RUNS BESIDE THE READ.
      expect(log).toStrictEqual(['start read']);
      release();
      if (fails) await expect(reading).rejects.toThrow('the read failed');
      else expect(await reading).toBe('read');
      expect(await Promise.all(writes)).toStrictEqual(['edit', 'save', 'save again']);
      expect(log).toStrictEqual(['start read', 'edit', 'save', 'save again']);
      await lane.drained();
    }
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

  it('is not drained while an accepted entry is still running, and is the moment that entry ends', async () => {
    const lane = new DocumentLane();
    const log: string[] = [];
    const held = entry(log, 'save');
    const saved = lane.enter('write', held.work);
    let drained = false;
    const draining = lane.drained().then(() => {
      drained = true;
    });
    await settle();
    // THE DECISION ITSELF, asked while the entry runs: a drain that settled at once would already say true here.
    expect(log).toStrictEqual(['start save']);
    expect(drained).toBe(false);
    held.release();
    await saved;
    await draining;
    expect(drained).toBe(true);
  });
});
