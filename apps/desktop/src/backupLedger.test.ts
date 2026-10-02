import type { FileIdentity } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { MAX_LEDGER_ENTRIES, createBackupProvenance } from './backupLedger.js';
import { createEphemeralSettings } from './settingsFile.js';

/** A volume described by hand: each path's identity, and what was removed. */
function volume(files: Map<string, Omit<FileIdentity, 'canonicalPath' | 'changedMs'>>): {
  readonly identity: (path: string) => Promise<FileIdentity | null>;
  readonly remove: (path: string) => Promise<void>;
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
    removed,
  };
}

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
