import { describe, expect, it } from 'vitest';

import { EngineOpenFailed } from '@monstera/kernel';

import { EngineCannotStartError } from './engineHostConnection.js';
import { BATCH, DAY_MS, GRACE_MS, PdfFileRefused, createHistoryCheck, idReadFailure } from './historyCheck.js';
import type { HistoryGuard, HistorySection } from './historyStore.js';

/**
 * The 24-hour check (ADR-0279 Decision 6, the correction of 2026-11-12). What each case asserts is the DECISION — which
 * section was removed, whether the host was asked to parse — not the state after it, since a check that never removed
 * anything leaves the same files as one that correctly waited.
 */

const HOUR = 60 * 60 * 1000;

interface World {
  /** What is at each place now: a size and time and an id, or nothing. */
  readonly disk: Map<string, { size: number; mtimeMs: number; id: string | null; locked?: true; unparsable?: true }>;
  /** Whether the host reads at all: `false` is a host that does not start, which says nothing about any PDF. */
  hostReads: boolean;
  readonly removed: string[];
  readonly parsed: string[];
  /** The history key each parse was asked under, which is all a failed parse is logged by (HHHHHHHHH-19). */
  readonly parsedUnder: string[];
  readonly stated: string[];
  clock: number;
  idle: boolean;
}

function world(sections: readonly (HistorySection & { readonly placeKey: string })[]) {
  const state: World = { disk: new Map(), removed: [], parsed: [], parsedUnder: [], stated: [], clock: 1_000_000, idle: true, hostReads: true };
  let ledger: unknown = null;
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
      ledger: () => ledger,
      keepLedger: (value) => {
        ledger = JSON.parse(JSON.stringify(value));
      },
    },
    stat: (path) => {
      state.stated.push(path);
      const found = state.disk.get(path);
      return Promise.resolve(found === undefined ? null : { size: found.size, mtimeMs: found.mtimeMs });
    },
    permanentIdOf: (path, placeKey) => {
      state.parsed.push(path);
      state.parsedUnder.push(placeKey);
      if (!state.hostReads) return Promise.resolve({ kind: 'not-read' } as const);
      const found = state.disk.get(path);
      if (found === undefined || found.unparsable === true) return Promise.resolve({ kind: 'failed' } as const);
      if (found.locked === true) return Promise.resolve({ kind: 'locked' } as const);
      return Promise.resolve({ kind: 'read', id: found.id } as const);
    },
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
const section = (placeKey: string, name: string, place: string, guard: HistoryGuard) => ({ placeKey, section: name, place, guard });

describe('a section whose PDF is gone is removed 24 hours after the first check that finds it so', () => {
  it('waits the 24 hours, then removes it by the store, and only it', async () => {
    const { state, passAt } = world([
      section('p1', 's1', 'C:/gone.pdf', byId('aa')),
      section('p2', 's2', 'C:/here.pdf', byId('bb')),
    ]);
    state.disk.set('C:/here.pdf', { size: 10, mtimeMs: 5, id: 'bb' });
    await passAt(0);
    expect(state.removed).toStrictEqual([]);
    await passAt(23.9);
    expect(state.removed, 'a pass only a day after the last, so this one is not due').toStrictEqual([]);
    await passAt(24);
    expect(state.removed).toStrictEqual(['p1/s1']);
  });

  it('CONTROL: a PDF back at its place with its id before the 24 hours starts the clock again', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/away.pdf', byId('aa'))]);
    await passAt(0);
    state.disk.set('C:/away.pdf', { size: 10, mtimeMs: 5, id: 'aa' });
    await passAt(24);
    expect(state.removed).toStrictEqual([]);
    state.disk.delete('C:/away.pdf');
    await passAt(48);
    expect(state.removed, 'missing again from 48 hours, so not yet').toStrictEqual([]);
    await passAt(72);
    expect(state.removed).toStrictEqual(['p1/s1']);
  });

  it('a DIFFERENT PDF at the place is not the section’s, and counts as gone', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/report.pdf', byId('aa'))]);
    state.disk.set('C:/report.pdf', { size: 10, mtimeMs: 5, id: 'cc' });
    await passAt(0);
    await passAt(24);
    expect(state.removed).toStrictEqual(['p1/s1']);
  });

  it('a guard by size and time is the PDF only at that size and time, and is never parsed', async () => {
    const { state, passAt } = world([
      section('p1', 'kept', 'C:/same.pdf', { kind: 'stamp', size: 10, mtimeMs: 5 }),
      section('p2', 'changed', 'C:/edited.pdf', { kind: 'stamp', size: 10, mtimeMs: 5 }),
    ]);
    state.disk.set('C:/same.pdf', { size: 10, mtimeMs: 5, id: null });
    state.disk.set('C:/edited.pdf', { size: 11, mtimeMs: 9, id: null });
    await passAt(0);
    await passAt(24);
    expect(state.removed).toStrictEqual(['p2/changed']);
    expect(state.parsed).toStrictEqual([]);
  });
});

describe('the host parses a PDF only when its size or write time moved', () => {
  it('parses once on the first pass, and not again while the PDF stays as it was found', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/report.pdf', byId('aa'))]);
    state.disk.set('C:/report.pdf', { size: 10, mtimeMs: 5, id: 'aa' });
    await passAt(0);
    await passAt(24);
    await passAt(48);
    expect(state.parsed).toStrictEqual(['C:/report.pdf']);
  });

  it('each parse is asked under ITS SECTION’S history key, the name its failure is logged by, never the path (HHHHHHHHH-19)', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/report.pdf', byId('aa')), section('p2', 's1', 'C:/letter.pdf', byId('bb'))]);
    state.disk.set('C:/report.pdf', { size: 10, mtimeMs: 5, id: 'aa' });
    state.disk.set('C:/letter.pdf', { size: 11, mtimeMs: 5, id: 'bb' });
    await passAt(0);
    expect(state.parsed).toStrictEqual(['C:/report.pdf', 'C:/letter.pdf']);
    expect(state.parsedUnder).toStrictEqual(['p1', 'p2']);
  });

  it('CONTROL: a PDF whose write time moved is parsed again, and kept where it keeps its id', async () => {
    const { state, passAt } = world([section('p1', 's1', 'C:/report.pdf', byId('aa'))]);
    state.disk.set('C:/report.pdf', { size: 10, mtimeMs: 5, id: 'aa' });
    await passAt(0);
    state.disk.set('C:/report.pdf', { size: 12, mtimeMs: 6, id: 'aa' });
    await passAt(24);
    await passAt(48);
    expect(state.parsed).toStrictEqual(['C:/report.pdf', 'C:/report.pdf']);
    expect(state.removed).toStrictEqual([]);
  });
});

describe('it runs only while the person is not working, in batches, at most once a day', () => {
  it('does nothing at all while the person is working: no file is even looked at', async () => {
    const { state, check } = world([section('p1', 's1', 'C:/gone.pdf', byId('aa'))]);
    state.idle = false;
    expect(await check.step()).toBe('busy');
    expect(state.stated).toStrictEqual([]);
  });

  it(`checks ${String(BATCH)} sections a step, and a pass is not due again within a day`, async () => {
    const many = Array.from({ length: BATCH * 2 + 20 }, (_unused, at) => section(`p${String(at)}`, 's', `C:/${String(at)}.pdf`, byId('aa')));
    const { state, check } = world(many);
    for (const each of many) state.disk.set(each.place, { size: 1, mtimeMs: 1, id: 'aa' });
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

describe('a PDF that needs a password is there, though its /ID cannot be read without one', () => {
  it('its section is NEVER removed, pass after pass; CONTROL: the same PDF unreadable is removed after 24 hours', async () => {
    const { state, passAt } = world([
      section('p1', 's1', 'C:/locked.pdf', byId('aa')),
      section('p2', 's2', 'C:/broken.pdf', byId('bb')),
    ]);
    state.disk.set('C:/locked.pdf', { size: 10, mtimeMs: 5, id: 'aa', locked: true });
    for (const hours of [0, 24, 48, 72]) await passAt(hours);
    // THE HOST WAS ASKED every pass, so the case reaches the locked answer rather than a stamp it had seen.
    expect(state.parsed.filter((path) => path === 'C:/locked.pdf')).toHaveLength(4);
    expect(state.removed).toStrictEqual(['p2/s2']);
  });
});

describe('whose failure a read that threw was', () => {
  it('the PDF’s own — its file refused, its bytes a document the engine will never open — is failed', () => {
    expect(idReadFailure(new PdfFileRefused(Object.assign(new Error('EACCES'), { code: 'EACCES' })))).toBe('failed');
    expect(idReadFailure(new EngineOpenFailed('malformed'))).toBe('failed');
  });

  it('CONTROL: the reading’s — a host that cannot start, any other error, a thrown non-error — is not-read', () => {
    expect(idReadFailure(new EngineCannotStartError('mupdf-shim','the shim did not load'))).toBe('not-read');
    expect(idReadFailure(new Error('the reader thread exited with code 1 without reporting'))).toBe('not-read');
    expect(idReadFailure('gone')).toBe('not-read');
  });
});

describe('a host that does not read says nothing about the PDF', () => {
  it('no section is removed while the host does not start, and the clock it had is kept; CONTROL: a PDF the host says will never open is removed after 24 hours', async () => {
    const { state, passAt } = world([
      section('p1', 's1', 'C:/here.pdf', byId('aa')),
      section('p2', 's2', 'C:/broken.pdf', byId('bb')),
      section('p3', 's3', 'C:/was-gone.pdf', byId('cc')),
    ]);
    // ON DISK, and written again before every pass, so each pass must parse it: the host's answer is what decides.
    const touched = (hours: number): void => {
      state.disk.set('C:/here.pdf', { size: 10, mtimeMs: 5 + hours, id: 'aa' });
    };
    state.disk.set('C:/broken.pdf', { size: 10, mtimeMs: 5, id: 'bb', unparsable: true });
    // MISSING at the first pass, so its clock starts; then a PDF arrives that only the host could judge.
    touched(0);
    await passAt(0);
    state.disk.set('C:/was-gone.pdf', { size: 10, mtimeMs: 5, id: 'zz' });
    state.hostReads = false;
    for (const hours of [24, 48, 72]) {
      touched(hours);
      await passAt(hours);
    }
    expect(state.removed, 'a host that does not start removes nothing').toStrictEqual([]);
    // THE HOST WAS ASKED, so the case reaches the not-read answer rather than a stamp it had seen.
    expect(state.parsed.filter((path) => path === 'C:/here.pdf')).toHaveLength(4);

    // THE HOST BACK: the PDF it says will never open is gone a day after it was first found so, and the PDF that
    // replaced the missing one is a different one, whose clock ran from the first pass and was never reset.
    state.hostReads = true;
    await passAt(96);
    expect(state.removed).toStrictEqual(['p2/s2', 'p3/s3']);
  });
});
