import { describe, expect, it } from 'vitest';

import { BATCH, DAY_MS, GRACE_MS, type StatCall, createHistoryCheck, placeOf } from './historyCheck.js';
import type { HistoryGuard, HistorySection } from './historyStore.js';

/**
 * The 24-hour check (ADR-0279 Decision 6, as the owner corrected it on 2026-11-14: only a PDF that is really gone loses
 * its history). What each case asserts is the DECISION, which section was removed, not the state after it, since a
 * check that never removed anything leaves the same files as one that correctly waited.
 */

const HOUR = 60 * 60 * 1000;

/** What a path is on the fake disk: a file, a folder, or a `stat` that throws this code. */
type Entry = 'file' | 'folder' | { readonly refuses: string };

/** A file system `stat` over `disk`: an absent path throws ENOENT, as Node's does. */
function fakeStat(disk: Map<string, Entry>, stated: string[]): StatCall {
  return (path) => {
    stated.push(path);
    const entry = disk.get(path);
    if (entry === undefined) return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' }));
    if (typeof entry === 'object') return Promise.reject(Object.assign(new Error(`${entry.refuses}: ${path}`), { code: entry.refuses }));
    return Promise.resolve({ isDirectory: () => entry === 'folder' });
  };
}

function world(sections: readonly (HistorySection & { readonly placeKey: string })[]) {
  const state = {
    /** The folders C:/docs and C:/ are there from the start; a case adds and removes files. */
    disk: new Map<string, Entry>([
      ['C:/', 'folder'],
      ['C:/docs', 'folder'],
    ]),
    removed: [] as string[],
    stated: [] as string[],
    clock: 1_000_000,
    idle: true,
    ledger: null as unknown,
  };
  const live = [...sections];
  const check = createHistoryCheck({
    store: {
      files: () => [...new Set(live.map((each) => each.placeKey))],
      guards: (placeKey) => live.filter((each) => each.placeKey === placeKey),
      removeSection: (placeKey, section) => {
        state.removed.push(`${placeKey}/${section}`);
        const at = live.findIndex((each) => each.placeKey === placeKey && each.section === section);
        if (at >= 0) live.splice(at, 1);
        return Promise.resolve(true);
      },
      ledger: () => state.ledger,
      keepLedger: (value) => {
        state.ledger = JSON.parse(JSON.stringify(value));
      },
    },
    place: (path) => placeOf(path, fakeStat(state.disk, state.stated)),
    idle: () => state.idle,
    now: () => state.clock,
  });
  /** A whole pass, a day after the last, at `hours` past the start. */
  const passAt = async (hours: number): Promise<void> => {
    state.clock = 1_000_000 + hours * HOUR;
    for (let result = await check.step(); result === 'checked'; result = await check.step()) {
      // each batch
    }
  };
  return { state, check, passAt };
}

const byId = (id: string): HistoryGuard => ({ kind: 'id', id });
const section = (placeKey: string, name: string, place: string, guard: HistoryGuard = byId('aa')) => ({ placeKey, section: name, place, guard });

describe('the owner’s three cases (2026-11-14): only a PDF that is really gone loses its history', () => {
  it('CONTROL: a file deleted from a folder that is still there loses its history 24 hours after the first check that finds it so', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/docs/gone.pdf'), section('p2', 's2', 'C:/docs/here.pdf')]);
    state.disk.set('C:/docs/here.pdf', 'file');
    await passAt(0);
    expect(state.removed).toStrictEqual([]);
    await passAt(23.9);
    expect(state.removed, 'a pass only a day after the last, so this one is not due').toStrictEqual([]);
    await passAt(24);
    expect(state.removed).toStrictEqual(['p1/s1']);
  });

  it('a present file held open with a SHARE LOCK keeps its history across checks a day apart, whether its stat answers or refuses', async () => {
    const { state, passAt } = world([section('p1', 'answers', 'C:/docs/held.pdf'), section('p2', 'refuses', 'C:/docs/busy.pdf')]);
    // A LOCK THAT LEAVES stat ANSWERING (the file is there; only opening it is refused) and one whose stat is refused too.
    state.disk.set('C:/docs/held.pdf', 'file');
    state.disk.set('C:/docs/busy.pdf', { refuses: 'EBUSY' });
    for (const hours of [0, 24, 48]) await passAt(hours);
    expect(state.removed).toStrictEqual([]);
    // THE FOLDER WAS NEVER ASKED for the refused file: a refusal is not a not-found, so nothing is learnt of its absence.
    expect(state.stated.filter((path) => path === 'C:/docs')).toStrictEqual([]);
  });

  it('a file on a MISSING DRIVE or in a MISSING FOLDER keeps its history, pass after pass', async () => {
    const { state, passAt } = world([section('p1', 'drive', 'E:/report.pdf'), section('p2', 'folder', 'C:/moved-away/report.pdf')]);
    for (const hours of [0, 24, 48, 72]) await passAt(hours);
    expect(state.removed).toStrictEqual([]);
    // EACH ABSENCE WAS LOOKED AT and its folder asked, so the case reaches the folder rule rather than stopping short.
    expect(state.stated).toContain('E:/report.pdf');
    expect(state.stated).toContain('C:/moved-away');
  });
});

describe('a file at the place is there, whichever PDF it is', () => {
  it('a DIFFERENT PDF at the place keeps the old section, unshown (Decision 5 withdrawn, 2026-11-14)', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/docs/report.pdf', byId('aa'))]);
    state.disk.set('C:/docs/report.pdf', 'file');
    for (const hours of [0, 24, 48]) await passAt(hours);
    expect(state.removed).toStrictEqual([]);
  });

  it('a file guarded by size and time is there whatever its size and time now', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/docs/edited.pdf', { kind: 'stamp', size: 10, mtimeMs: 5 })]);
    state.disk.set('C:/docs/edited.pdf', 'file');
    for (const hours of [0, 24, 48]) await passAt(hours);
    expect(state.removed).toStrictEqual([]);
  });

  it('CONTROL: a PDF back at its place before the 24 hours starts the clock again', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/docs/away.pdf')]);
    await passAt(0);
    state.disk.set('C:/docs/away.pdf', 'file');
    await passAt(24);
    expect(state.removed).toStrictEqual([]);
    state.disk.delete('C:/docs/away.pdf');
    await passAt(48);
    expect(state.removed, 'gone again from 48 hours, so not yet').toStrictEqual([]);
    await passAt(72);
    expect(state.removed).toStrictEqual(['p1/s1']);
  });
});

describe('a place that cannot be reached decides nothing', () => {
  it('the clock a gone file started is neither stopped nor started while its drive is away, and runs on once it is back', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/docs/gone.pdf')]);
    await passAt(0);
    // THE FOLDER UNREACHABLE for a day: nothing learnt, so neither removed nor reset.
    state.disk.delete('C:/docs');
    await passAt(24);
    expect(state.removed).toStrictEqual([]);
    state.disk.set('C:/docs', 'folder');
    await passAt(48);
    expect(state.removed, 'gone since the first pass, seen gone again').toStrictEqual(['p1/s1']);
  });

  it('a ledger kept before 2026-11-14 is read as empty, which starts every clock again and removes nothing', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/docs/gone.pdf')]);
    state.ledger = { lastPass: null, sections: { 'p1/s1': { seen: null, missingSince: 0 } } };
    await passAt(0);
    expect(state.removed, 'missing since long ago by the old ledger, and removed by nothing').toStrictEqual([]);
    await passAt(24);
    expect(state.removed).toStrictEqual(['p1/s1']);
  });
});

describe('placeOf, the one rule', () => {
  const disk = new Map<string, Entry>([
    ['C:/docs', 'folder'],
    ['C:/docs/here.pdf', 'file'],
    ['C:/docs/locked.pdf', { refuses: 'EBUSY' }],
    ['C:/docs/denied.pdf', { refuses: 'EACCES' }],
    ['C:/docs/held.pdf', { refuses: 'EPERM' }],
    ['C:/a-file', 'file'],
  ]);
  const at = (path: string, stated: string[] = []) => placeOf(path, fakeStat(disk, stated));

  it('a file that answers is found, and its folder is not asked', async () => {
    const stated: string[] = [];
    expect(await at('C:/docs/here.pdf', stated)).toBe('found');
    expect(stated).toStrictEqual(['C:/docs/here.pdf']);
  });

  it('CONTROL: not found in a folder that is there is gone', async () => {
    expect(await at('C:/docs/deleted.pdf')).toBe('gone');
  });

  it('not found where the folder or drive is not there, or is a file, is unreachable', async () => {
    expect(await at('C:/away/deleted.pdf')).toBe('unreachable');
    expect(await at('E:/deleted.pdf')).toBe('unreachable');
    expect(await at('C:/a-file/deleted.pdf')).toBe('unreachable');
  });

  it('a stat refused (EBUSY, EACCES, EPERM) is unreachable, never gone', async () => {
    expect(await at('C:/docs/locked.pdf')).toBe('unreachable');
    expect(await at('C:/docs/denied.pdf')).toBe('unreachable');
    expect(await at('C:/docs/held.pdf')).toBe('unreachable');
  });
});

describe('it runs only while the person is not working, in batches, at most once a day', () => {
  it('does nothing at all while the person is working: no file is even looked at', async () => {
    const { state, check } = world([section('p1', 's1', 'C:/docs/gone.pdf')]);
    state.idle = false;
    expect(await check.step()).toBe('busy');
    expect(state.stated).toStrictEqual([]);
  });

  it(`checks ${String(BATCH)} sections a step, and a pass is not due again within a day`, async () => {
    const many = Array.from({ length: BATCH * 2 + 20 }, (_unused, at) => section(`p${String(at)}`, 's', `C:/docs/${String(at)}.pdf`));
    const { state, check } = world(many);
    for (const each of many) state.disk.set(each.place, 'file');
    expect([await check.step(), await check.step(), await check.step()]).toStrictEqual(['checked', 'checked', 'done']);
    expect(state.stated).toHaveLength(many.length);
    state.clock += DAY_MS - 1;
    expect(await check.step()).toBe('not-due');
    state.clock += 1;
    expect(await check.step()).toBe('checked');
  });

  it('GRACE_MS is the owner’s 24 hours', () => {
    expect(GRACE_MS).toBe(24 * HOUR);
  });
});
