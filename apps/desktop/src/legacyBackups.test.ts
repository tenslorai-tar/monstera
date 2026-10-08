import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listStoredBackups, readFileIdentity } from '@monstera/kernel';
import { afterEach, describe, expect, it } from 'vitest';

import { createBackupProvenance } from './backupLedger.js';
import { moveLegacyBackups, scanLegacyBackups } from './legacyBackups.js';
import { createEphemeralSettings } from './settingsFile.js';

/**
 * ADR-0198 Decision 5: the old `.bak` files beside a file are moved only when Monstera can PROVE it made them, and a file
 * it did not make is the person's. Real files and the product's own provenance over a record in memory, so the proof
 * is the ledger's and the volume's, not a fake's.
 */

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scene(): { readonly folder: string; readonly root: string; readonly target: string } {
  const folder = mkdtempSync(join(tmpdir(), 'monstera-legacy-'));
  const root = mkdtempSync(join(tmpdir(), 'monstera-legacy-root-'));
  made.push(folder, root);
  const target = join(folder, 'report.pdf');
  writeFileSync(target, 'current');
  return { folder, root, target };
}

const provenance = () =>
  createBackupProvenance(createEphemeralSettings(), {
    identity: readFileIdentity,
    remove: (path) => rm(path, { force: true }),
    wait: () => Promise.resolve(),
  });

describe('the old .bak files beside a file', () => {
  it('moves the ones Monstera MADE into its folder, keeps their time, and leaves a file it did not make exactly where it is', async () => {
    const { folder, root, target } = scene();
    const ledger = provenance();
    // `.bak` WAS MADE BY MONSTERA (the ledger saw it made); `.bak2` is a file somebody else put there under a backup's name.
    writeFileSync(`${target}.bak`, 'version two');
    utimesSync(`${target}.bak`, new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T10:00:00Z'));
    await ledger.made(`${target}.bak`);
    writeFileSync(`${target}.bak2`, 'a file another editor wrote');

    const scan = await scanLegacyBackups(target, ledger);
    expect(scan.proven).toStrictEqual([`${target}.bak`]);
    expect(scan.unproven).toStrictEqual([`${target}.bak2`]);

    const answer = await moveLegacyBackups(root, target, scan, ledger);
    expect(answer).toStrictEqual({ moved: 1, kept: 0 });
    // THE PERSON'S FOLDER NOW: the document and the file Monstera could not prove, nothing else.
    expect(readdirSync(folder).sort()).toStrictEqual(['report.pdf', 'report.pdf.bak2']);
    expect(readFileSync(`${target}.bak2`, 'utf8')).toBe('a file another editor wrote');
    // THE MOVED VERSION IS IN THE DATA FOLDER, with the bytes and the time it had.
    const kept = await listStoredBackups(root, target);
    expect(kept.map((backup) => backup.id)).toStrictEqual(['1.pdf']);
    expect(kept[0]?.bytes).toBe('version two'.length);
    expect(kept[0]?.savedAt.toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('CONTROL: a backup edited since Monstera made it is no longer proven, so nothing is moved or deleted', async () => {
    const { folder, root, target } = scene();
    const ledger = provenance();
    writeFileSync(`${target}.bak`, 'version two');
    await ledger.made(`${target}.bak`);
    // EDITED SINCE: another size, so the file is no longer the one the ledger recorded.
    writeFileSync(`${target}.bak`, 'version two, edited by a person afterwards');

    const scan = await scanLegacyBackups(target, ledger);
    expect(scan.proven).toStrictEqual([]);
    expect(scan.unproven).toStrictEqual([`${target}.bak`]);
    expect(await moveLegacyBackups(root, target, scan, ledger)).toStrictEqual({ moved: 0, kept: 0 });
    expect(readdirSync(folder).sort()).toStrictEqual(['report.pdf', 'report.pdf.bak']);
    expect(await listStoredBackups(root, target)).toStrictEqual([]);
  });

  it('puts the moved versions in the names the rotation uses, the newer `.bak` first', async () => {
    const { root, target } = scene();
    const ledger = provenance();
    writeFileSync(`${target}.bak`, 'older one');
    writeFileSync(`${target}.bak2`, 'older two');
    await ledger.made(`${target}.bak`);
    await ledger.made(`${target}.bak2`);
    // TWO PROVEN BACKUPS MOVED IN ONE ANSWER: `.bak` is the newer, so it takes the first free slot.
    const first = await moveLegacyBackups(root, target, await scanLegacyBackups(target, ledger), ledger);
    expect(first).toStrictEqual({ moved: 2, kept: 0 });
    expect((await listStoredBackups(root, target)).map((backup) => backup.id).sort()).toStrictEqual(['1.pdf', '2.pdf']);
    expect(readFileSync(join(root, readdirSync(root)[0] ?? '', '1.pdf'), 'utf8')).toBe('older one');
    expect(readFileSync(join(root, readdirSync(root)[0] ?? '', '2.pdf'), 'utf8')).toBe('older two');
  });
});
