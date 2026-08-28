import { describe, expect, it } from 'vitest';

import {
  type AtomicWriteSurface,
  RENAME_BACKOFF_MS,
  atomicWrite,
} from './atomicWrite.js';

/**
 * §4's atomic write, and the property is invariant 18's: **the original file is
 * intact until the rename**.
 *
 * ## Every case drives a REAL failure rather than asserting a happy path
 *
 * The surface is injected precisely because `EPERM` and `EBUSY` cannot be
 * produced on demand on a real filesystem — `EBUSY` needs another process
 * holding the file with a share mode nothing here can arrange. A retry ladder
 * whose only evidence is "it worked on a machine where nothing interfered" is a
 * ladder nobody has climbed, and that is what these cases exist to avoid.
 */

/** A file the fake surface holds, so a case can assert what survived. */
type Files = Map<string, string>;

interface FakeSurface {
  readonly surface: AtomicWriteSurface;
  readonly files: Files;
  readonly calls: string[];
  readonly waits: number[];
}

/**
 * A filesystem that can be told to fail one call, as many times as asked.
 *
 * `failures` is a map from step to how many times it should throw before
 * succeeding, so a case can express *fails twice then works* — which is the
 * shape the ladder exists for and the one a boolean cannot say.
 */
function fake(
  files: Files,
  failures: Partial<Record<'write' | 'sync' | 'copy' | 'rename', { times: number; code: string }>> = {},
): FakeSurface {
  const calls: string[] = [];
  const waits: number[] = [];
  const remaining = new Map<string, number>();
  for (const [step, spec] of Object.entries(failures)) remaining.set(step, spec.times);

  const maybeThrow = (step: 'write' | 'sync' | 'copy' | 'rename'): void => {
    const left = remaining.get(step) ?? 0;
    if (left <= 0) return;
    remaining.set(step, left - 1);
    const error: Error & { code?: string } = new Error(`${step} refused`);
    const code = failures[step]?.code;
    if (code !== undefined) error.code = code;
    throw error;
  };

  return {
    files,
    calls,
    waits,
    surface: {
      write: (path, bytes) => {
        calls.push(`write:${path}`);
        maybeThrow('write');
        files.set(path, new TextDecoder().decode(bytes));
        return Promise.resolve();
      },
      sync: (path) => {
        calls.push(`sync:${path}`);
        maybeThrow('sync');
        return Promise.resolve();
      },
      rename: (from, to) => {
        calls.push(`rename:${from}->${to}`);
        maybeThrow('rename');
        const held = files.get(from);
        if (held === undefined) throw new Error('rename: nothing at source');
        files.delete(from);
        files.set(to, held);
        return Promise.resolve();
      },
      copy: (from, to) => {
        calls.push(`copy:${from}->${to}`);
        maybeThrow('copy');
        const held = files.get(from);
        if (held !== undefined) files.set(to, held);
        return Promise.resolve();
      },
      remove: (path) => {
        calls.push(`remove:${path}`);
        files.delete(path);
        return Promise.resolve();
      },
      exists: (path) => Promise.resolve(files.has(path)),
    },
  };
}

const NAMES = { temp: '/doc.pdf.tmp', backup: '/doc.pdf.bak' };
const BYTES = new TextEncoder().encode('new contents');

describe('atomicWrite', () => {
  it('writes through a temp, syncs it, backs up the original, and renames', async () => {
    const files: Files = new Map([['/doc.pdf', 'original']]);
    const f = fake(files);

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.backedUp).toBe(true);
    expect(files.get('/doc.pdf')).toBe('new contents');
    expect(files.get('/doc.pdf.bak')).toBe('original');

    // THE ORDER IS THE PROPERTY. Sync must precede the rename, because a rename
    // is durable long before the data it points at is — an unsynced temp
    // promoted by a rename can be a file of the right length full of zeroes,
    // which looks like a successful save.
    const sync = f.calls.indexOf('sync:/doc.pdf.tmp');
    const rename = f.calls.findIndex((call) => call.startsWith('rename:'));
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(rename).toBeGreaterThanOrEqual(0);
    expect(sync).toBeLessThan(rename);
  });

  it('CONTROL: with no original there is no backup, and that is an outcome', async () => {
    // Without this, the case above is satisfied by an implementation that
    // demands a backup unconditionally — which would refuse the one save where
    // nothing can be lost.
    const files: Files = new Map();
    const f = fake(files);

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.backedUp).toBe(false);
    expect(files.has('/doc.pdf.bak')).toBe(false);
    expect(files.get('/doc.pdf')).toBe('new contents');
  });

  it('THE INVARIANT: a failed temp write leaves the original untouched', async () => {
    const files: Files = new Map([['/doc.pdf', 'original']]);
    const f = fake(files, { write: { times: 1, code: 'ENOSPC' } });

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.stage).toBe('temp-write');
    // The whole of invariant 18 at this step: the user's file is what it was.
    expect(files.get('/doc.pdf')).toBe('original');
    expect(files.has('/doc.pdf.tmp')).toBe(false);
  });

  it('THE INVARIANT: a failed sync leaves the original untouched and never renames', async () => {
    const files: Files = new Map([['/doc.pdf', 'original']]);
    const f = fake(files, { sync: { times: 1, code: 'EIO' } });

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.stage).toBe('sync');
    expect(files.get('/doc.pdf')).toBe('original');
    // ASSERT THE CALL THAT WAS NOT MADE. A sync failure that renamed anyway
    // produces a file of the right length whose contents may be zeroes, and the
    // resulting state — a `/doc.pdf` that exists — is indistinguishable from a
    // successful save by looking at the files alone.
    expect(f.calls.some((call) => call.startsWith('rename:'))).toBe(false);
  });

  it('REFUSES rather than renaming when the backup cannot be taken', async () => {
    const files: Files = new Map([['/doc.pdf', 'original']]);
    const f = fake(files, { copy: { times: 1, code: 'EACCES' } });

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.stage).toBe('backup');
    expect(files.get('/doc.pdf')).toBe('original');
    // NOT because the rename needs something to roll back to — a failed rename
    // has not touched the original. The `.bak` is §4's deliverable, the user's
    // previous version, and continuing without it would replace their document
    // and report success while silently dropping it.
    expect(f.calls.some((call) => call.startsWith('rename:'))).toBe(false);
  });

  it('CLIMBS THE LADDER: a rename held twice by EBUSY succeeds on the third attempt', async () => {
    const files: Files = new Map([['/doc.pdf', 'original']]);
    const f = fake(files, { rename: { times: 2, code: 'EBUSY' } });

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, (ms) => {
      f.waits.push(ms);
      return Promise.resolve();
    });

    expect(result.ok).toBe(true);
    expect(files.get('/doc.pdf')).toBe('new contents');
    // THREE ATTEMPTS AND TWO WAITS, asserted as counts. "It eventually worked"
    // is also what a ladder that ignored its own back-off produces.
    expect(f.calls.filter((call) => call.startsWith('rename:'))).toHaveLength(3);
    expect(f.waits).toEqual([RENAME_BACKOFF_MS[1], RENAME_BACKOFF_MS[2]]);
  });

  it('gives up after the ladder, with the original still there', async () => {
    const files: Files = new Map([['/doc.pdf', 'original']]);
    const f = fake(files, { rename: { times: 99, code: 'EPERM' } });

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.stage).toBe('rename');
      expect(result.error.attempts).toBe(RENAME_BACKOFF_MS.length);
    }
    expect(files.get('/doc.pdf')).toBe('original');
  });

  it('CONTROL: a NON-transient rename failure is not retried', async () => {
    // The ladder must separate *somebody is holding this file* from *this can
    // never work*. A ladder that retries everything turns a permanent failure
    // into a slow permanent failure and reports the wrong story — and it would
    // pass the case above, which is why this one exists.
    const files: Files = new Map([['/doc.pdf', 'original']]);
    const f = fake(files, { rename: { times: 99, code: 'ENOSPC' } });

    const result = await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.attempts).toBe(1);
    expect(f.calls.filter((call) => call.startsWith('rename:'))).toHaveLength(1);
    expect(files.get('/doc.pdf')).toBe('original');
  });

  it('holds the ladder to the bound its own comment states: 1.5 s over five attempts', () => {
    // THE FIGURES ARE LITERALS HERE ON PURPOSE. `RENAME_BACKOFF_MS`' comment
    // makes a checkable promise — bounded, and stated as a number — and a
    // check that summed the array against itself would agree with any edit,
    // which is the whole failure this guards. Anyone changing the ladder must
    // change this line, and changing this line means reading the sentence that
    // quotes the number.
    expect(RENAME_BACKOFF_MS.reduce((total, ms) => total + ms, 0)).toBe(1500);
    expect(RENAME_BACKOFF_MS).toHaveLength(5);
  });

  it('leaves no temp file behind on any failure path', async () => {
    // A temp left beside the user's document is a copy of their work in a
    // place nothing will ever clean up — and on the granted-directory paths
    // this ordering also serves, it is a copy in a directory a contained host
    // can read.
    for (const failure of [
      { sync: { times: 1, code: 'EIO' } },
      { copy: { times: 1, code: 'EACCES' } },
      { rename: { times: 99, code: 'EPERM' } },
    ]) {
      const files: Files = new Map([['/doc.pdf', 'original']]);
      const f = fake(files, failure);
      await atomicWrite(f.surface, '/doc.pdf', BYTES, NAMES, () => Promise.resolve());
      expect(files.has('/doc.pdf.tmp')).toBe(false);
    }
  });
});
