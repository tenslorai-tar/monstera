import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { atomicWrite } from './atomicWrite.js';
import {
  backupFolderKey,
  clearBackups,
  copyStoredBackup,
  dataFolderNames,
  findByIdentityHint,
  listStoredBackups,
  writeBackupNote,
} from './backupFolder.js';
import { nodeFileSurface, siblingNames } from './fileSurface.js';

/**
 * ADR-0198: a save writes NOTHING beside the person's file but the file, a restore returns the OLDER bytes, and the control
 * is the same save under `siblingNames`, which leaves a `.bak` beside it — so every case below fails if the move is undone.
 * Real files, because the property is the filesystem's.
 */

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scene(): { readonly folder: string; readonly root: string; readonly target: string } {
  const folder = mkdtempSync(join(tmpdir(), 'monstera-person-'));
  const root = mkdtempSync(join(tmpdir(), 'monstera-backups-'));
  made.push(folder, root);
  const target = join(folder, 'report.pdf');
  writeFileSync(target, 'version 1');
  return { folder, root, target };
}

const noWait = (): Promise<void> => Promise.resolve();

/** Saves `contents` over the target the way the pipeline does, with the names given. */
async function save(
  target: string,
  contents: string,
  names: ReturnType<ReturnType<typeof dataFolderNames>>,
): Promise<void> {
  const done = await atomicWrite(nodeFileSurface, target, (temp) => nodeFileSurface.write(temp, Buffer.from(contents)), names, noWait);
  expect(done.ok).toBe(true);
}

describe('backups in the data folder', () => {
  it('a SAVE WRITES NOTHING BESIDE THE FILE: the folder holds the file and nothing else, and the older version is kept elsewhere', async () => {
    const { folder, root, target } = scene();
    const names = dataFolderNames(root, 3, (path) => siblingNames(path, 0).temp);
    await save(target, 'version 2', names(target));
    await save(target, 'version 3', names(target));

    // THE PERSON'S FOLDER: the document and no other entry — no `.bak`, no copy-aside, no temp left over.
    expect(readdirSync(folder)).toStrictEqual(['report.pdf']);
    expect(readFileSync(target, 'utf8')).toBe('version 3');
    // THE OLDER VERSIONS ARE IN THE DATA FOLDER, newest first.
    const kept = await listStoredBackups(root, target);
    expect(kept.map((backup) => backup.id)).toStrictEqual(['1.pdf', '2.pdf']);
    expect(kept.map((backup) => backup.bytes)).toStrictEqual([9, 9]);
  });

  it('CONTROL: the same two saves under siblingNames leave the backups BESIDE the file — the case above fails if the move is undone', async () => {
    const { folder, target } = scene();
    const beside = (path: string): ReturnType<typeof siblingNames> => siblingNames(path, 3);
    await save(target, 'version 2', beside(target));
    await save(target, 'version 3', beside(target));
    expect(readdirSync(folder).sort()).toStrictEqual(['report.pdf', 'report.pdf.bak', 'report.pdf.bak2']);
  });

  it('a RESTORE returns the OLDER bytes, and writes a copy: the backup is left as it was and a file already there is never overwritten', async () => {
    const { folder, root, target } = scene();
    const names = dataFolderNames(root, 3, (path) => siblingNames(path, 0).temp);
    await save(target, 'version 2', names(target));
    await save(target, 'version 3', names(target));

    const [newest, older] = await listStoredBackups(root, target);
    expect(newest).toBeDefined();
    expect(older).toBeDefined();
    const restored = join(folder, 'restored.pdf');
    await copyStoredBackup(root, target, newest?.id ?? '', restored);
    expect(readFileSync(restored, 'utf8')).toBe('version 2');
    const oldest = join(folder, 'oldest.pdf');
    await copyStoredBackup(root, target, older?.id ?? '', oldest);
    expect(readFileSync(oldest, 'utf8')).toBe('version 1');
    // THE DOCUMENT AND THE BACKUPS ARE UNTOUCHED, and a destination that exists is refused rather than written over.
    expect(readFileSync(target, 'utf8')).toBe('version 3');
    await expect(copyStoredBackup(root, target, newest?.id ?? '', target)).rejects.toThrow();
    expect(readFileSync(target, 'utf8')).toBe('version 3');
    // AN ID THE FOLDER DOES NOT HOLD is refused, never read as a path.
    await expect(copyStoredBackup(root, target, '../../etc/passwd', join(folder, 'x.pdf'))).rejects.toThrow();
  });

  it('keeps the count the setting names: with one kept the older version is replaced, with none nothing is written anywhere', async () => {
    const one = scene();
    const keepOne = dataFolderNames(one.root, 1, (path) => siblingNames(path, 0).temp);
    await save(one.target, 'version 2', keepOne(one.target));
    await save(one.target, 'version 3', keepOne(one.target));
    expect((await listStoredBackups(one.root, one.target)).map((backup) => backup.id)).toStrictEqual(['1.pdf']);
    expect(readFileSync(join(one.root, backupFolderKey(one.target), '1.pdf'), 'utf8')).toBe('version 2');

    const none = scene();
    const keepNone = dataFolderNames(none.root, 0, (path) => siblingNames(path, 0).temp);
    await save(none.target, 'version 2', keepNone(none.target));
    expect(await listStoredBackups(none.root, none.target)).toStrictEqual([]);
    expect(readdirSync(none.root)).toStrictEqual([]);
  });

  it('keys the folder by the PATH, case-insensitively on Windows only, and never by anything that changes at a save', () => {
    expect(backupFolderKey('C:\\Docs\\Report.pdf', 'win32')).toBe(backupFolderKey('c:\\docs\\report.pdf', 'win32'));
    // CONTROL: on a case-sensitive platform two spellings are two files.
    expect(backupFolderKey('/docs/Report.pdf', 'linux')).not.toBe(backupFolderKey('/docs/report.pdf', 'linux'));
    // TWO FILES NAMED ALIKE IN TWO FOLDERS never share a folder, so restoring one cannot offer the other's bytes.
    expect(backupFolderKey('/a/report.pdf', 'linux')).not.toBe(backupFolderKey('/b/report.pdf', 'linux'));
    // A DIGEST, never the path.
    expect(backupFolderKey('/a/report.pdf', 'linux')).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('the identity HINT finds a folder for a file with none at its path — and answers nothing for an empty identity', async () => {
    const { root, target } = scene();
    const names = dataFolderNames(root, 1, (path) => siblingNames(path, 0).temp);
    await save(target, 'version 2', names(target));
    await writeBackupNote(root, target, { dev: 7, ino: 4242 });
    expect(await findByIdentityHint(root, 7, 4242)).toBe(target);
    expect(await findByIdentityHint(root, 7, 1)).toBeUndefined();
    // A volume that reports no index gives no hint at all, which is never read as a match.
    expect(await findByIdentityHint(root, null, null)).toBeUndefined();
  });

  it('CLEAR removes every folder and says how many backups went', async () => {
    const { root, target } = scene();
    const names = dataFolderNames(root, 2, (path) => siblingNames(path, 0).temp);
    await save(target, 'version 2', names(target));
    await save(target, 'version 3', names(target));
    expect(await clearBackups(root)).toBe(2);
    expect(readdirSync(root)).toStrictEqual([]);
    expect(await clearBackups(join(root, 'absent'))).toBe(0);
  });
});
