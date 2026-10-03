import { type FileIdentity, RENAME_BACKOFF_MS } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { MAX_LEDGER_ENTRIES, createBackupProvenance } from './backupLedger.js';
import { createEphemeralSettings } from './settingsFile.js';

/** A volume described by hand: each path's identity, and what was removed. */
function volume(files: Map<string, Omit<FileIdentity, 'canonicalPath' | 'changedMs'>>): {
  readonly identity: (path: string) => Promise<FileIdentity | null>;
  readonly remove: (path: string) => Promise<void>;
  readonly wait: (ms: number) => Promise<void>;
  readonly removed: string[];
} {
  const removed: string[] = [];
  return {
    identity: (path) => {
      const file = files.get(path);
      return Promise.resolve(
        file === undefined ? null : ({ ...file, canonicalPath: path, changedMs: null } as unknown as FileIdentity),
      );
    },
    remove: (path) => {
      removed.push(path);
      files.delete(path);
      return Promise.resolve();
    },
    wait: () => Promise.resolve(),
    removed,
  };
}

/** A file another program holds: Windows answers a delete of it with `EBUSY` until that program lets go. */
function busy(): Error {
  return Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
}

const NO_WAIT = (): Promise<void> => Promise.resolve();

describe('a copy Monstera made and could NOT delete (CR-DOC-10)', () => {
  it('is HELD, not thrown: the save it belongs to succeeded, and the copy is owed a deletion', async () => {
    const files = new Map([['a.pdf.bak', { dev: 1, ino: 10, size: 100, modifiedMs: 5 }]]);
    const disk = volume(files);
    let attempts = 0;
    const provenance = createBackupProvenance(createEphemeralSettings(), {
      ...disk,
      remove: () => {
        attempts += 1;
        return Promise.reject(busy());
      },
      wait: NO_WAIT,
    });
    await provenance.made('a.pdf.bak');
    expect(await provenance.deleteIfMade('a.pdf.bak')).toBe('held');
    // THE KERNEL'S LADDER, the one a held rename climbs: every step was tried before it was called held.
    expect(attempts).toBe(RENAME_BACKOFF_MS.length);
    expect(provenance.owed()).toStrictEqual(['a.pdf.bak']);
  });

  it('is retried, and deleted once the other program lets go; the debt survives a restart', async () => {
    const files = new Map([['a.pdf.bak', { dev: 1, ino: 10, size: 100, modifiedMs: 5 }]]);
    const disk = volume(files);
    let held = true;
    const store = createEphemeralSettings();
    const deps = {
      ...disk,
      remove: (path: string) => (held ? Promise.reject(busy()) : disk.remove(path)),
      wait: NO_WAIT,
    };
    const first = createBackupProvenance(store, deps);
    await first.made('a.pdf.bak');
    expect(await first.deleteIfMade('a.pdf.bak')).toBe('held');

    // A RESTART: a new ledger over the same record still owes it.
    const later = createBackupProvenance(store, deps);
    expect(later.owed()).toStrictEqual(['a.pdf.bak']);
    expect(await later.retryOwed(['a.pdf.bak'])).toStrictEqual(['a.pdf.bak']);
    held = false;
    expect(await later.retryOwed(['a.pdf.bak'])).toStrictEqual([]);
    expect(disk.removed).toStrictEqual(['a.pdf.bak']);
    expect(later.owed()).toStrictEqual([]);
  });

  it('CONTROL: a retry never deletes a file CHANGED since it was owed — the debt is dropped and the file kept', async () => {
    const files = new Map([['a.pdf.bak', { dev: 1, ino: 10, size: 100, modifiedMs: 5 }]]);
    const disk = volume(files);
    let held = true;
    const provenance = createBackupProvenance(createEphemeralSettings(), {
      ...disk,
      remove: (path) => (held ? Promise.reject(busy()) : disk.remove(path)),
      wait: NO_WAIT,
    });
    await provenance.made('a.pdf.bak');
    expect(await provenance.deleteIfMade('a.pdf.bak')).toBe('held');
    files.set('a.pdf.bak', { dev: 1, ino: 10, size: 120, modifiedMs: 9 });
    held = false;
    expect(await provenance.retryOwed(['a.pdf.bak'])).toStrictEqual([]);
    expect(disk.removed).toStrictEqual([]);
    expect(provenance.owed()).toStrictEqual([]);
  });

  it('a failure waiting cannot fix (a read-only volume) is held at once, without climbing the ladder', async () => {
    const files = new Map([['a.pdf.bak', { dev: 1, ino: 10, size: 100, modifiedMs: 5 }]]);
    let attempts = 0;
    const provenance = createBackupProvenance(createEphemeralSettings(), {
      ...volume(files),
      remove: () => {
        attempts += 1;
        return Promise.reject(Object.assign(new Error('read-only file system'), { code: 'EROFS' }));
      },
      wait: NO_WAIT,
    });
    await provenance.made('a.pdf.bak');
    expect(await provenance.deleteIfMade('a.pdf.bak')).toBe('held');
    expect(attempts).toBe(1);
  });
});

describe('which backups Monstera made (ADR-0139)', () => {
  it('deletes a backup it recorded, unchanged; CONTROL: one it never recorded is not-made and stays', async () => {
    const disk = volume(
      new Map([
        ['a.pdf.bak', { dev: 1, ino: 10, size: 100, modifiedMs: 5 }],
        ['b.pdf.bak', { dev: 1, ino: 11, size: 100, modifiedMs: 5 }],
      ]),
    );
    const provenance = createBackupProvenance(createEphemeralSettings(), disk);
    await provenance.made('a.pdf.bak');
    expect(await provenance.deleteIfMade('b.pdf.bak')).toBe('not-made');
    expect(await provenance.deleteIfMade('a.pdf.bak')).toBe('deleted');
    expect(disk.removed).toStrictEqual(['a.pdf.bak']);
    expect(await provenance.deleteIfMade('a.pdf.bak')).toBe('absent');
  });

  it('a file CHANGED since (another size or time) is not the file it made', async () => {
    const files = new Map([['a.pdf.bak', { dev: 1, ino: 10, size: 100, modifiedMs: 5 }]]);
    const disk = volume(files);
    const provenance = createBackupProvenance(createEphemeralSettings(), disk);
    await provenance.made('a.pdf.bak');
    files.set('a.pdf.bak', { dev: 1, ino: 10, size: 100, modifiedMs: 6 });
    expect(await provenance.deleteIfMade('a.pdf.bak')).toBe('not-made');
    expect(disk.removed).toStrictEqual([]);
  });

  it('a volume with NO FILE INDEX records nothing, so nothing on it is ever deleted', async () => {
    const disk = volume(new Map([['a.pdf.bak', { dev: null, ino: null, size: 100, modifiedMs: 5 }]]));
    const file = createEphemeralSettings();
    const provenance = createBackupProvenance(file, disk);
    await provenance.made('a.pdf.bak');
    expect(file.read()).toStrictEqual({});
    expect(await provenance.deleteIfMade('a.pdf.bak')).toBe('not-made');
  });

  it('the record SURVIVES a restart, and past the bound the OLDEST entry goes first', async () => {
    const files = new Map<string, { dev: number; ino: number; size: number; modifiedMs: number }>();
    for (let at = 0; at <= MAX_LEDGER_ENTRIES; at += 1) files.set(`f${String(at)}.bak`, { dev: 1, ino: at, size: 1, modifiedMs: 1 });
    const disk = volume(files);
    const file = createEphemeralSettings();
    const first = createBackupProvenance(file, disk);
    for (let at = 0; at <= MAX_LEDGER_ENTRIES; at += 1) await first.made(`f${String(at)}.bak`);

    // A NEW PROVENANCE over the same document: the next launch.
    const next = createBackupProvenance(file, disk);
    expect(await next.deleteIfMade('f0.bak')).toBe('not-made');
    expect(await next.deleteIfMade('f1.bak')).toBe('deleted');
    expect(await next.deleteIfMade(`f${String(MAX_LEDGER_ENTRIES)}.bak`)).toBe('deleted');
  });
});
