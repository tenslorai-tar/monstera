import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, normalize, resolve } from 'node:path';

import { MAX_BACKUP_COPIES } from '@monstera/contract';

import type { SaveFileNames } from './savePipeline.js';

/**
 * Where a save keeps the versions it replaces: Monstera's own data folder, and never beside the person's file
 * ([ADR-0198](../../../docs/DECISIONS/0198-backups-live-in-monsteras-own-data-folder-keyed-by-the-files-canonical-path-and-nothing-is-written-beside-the-file.md)).
 *
 * ## The key is the PATH, because the identity does not survive a save
 *
 * A save writes a temp file and renames it over the target, so the file at a path after a save is a new file with a new
 * index, every time. A folder keyed by the file's identity would be orphaned by the very save that made its newest backup.
 * What stays put is the path a person opens the file by, so the folder is a digest of it — resolved, normalised and, on
 * Windows, lower-cased, whose file system does not tell `Report.pdf` from `report.pdf`. The identity is kept in a small
 * note as a HINT, so a file moved outside Monstera can be found again; nothing is decided by the hint alone.
 *
 * ## Both the backups AND the copy-aside live in the folder
 *
 * A save copies the file it replaces aside, replaces it, then renames the copy into the newest backup name. A rename
 * across volumes is a copy, so a copy-aside beside the file with the backups elsewhere would break the one ordering the
 * atomic write exists for. Both here, the rotation is a rename on one volume. The TEMP stays a sibling of the target:
 * an atomic rename needs its volume, and the save removes it however it ends.
 */

/** The folder's digest: 32 hex characters of SHA-256 over the canonical path. Never the path itself. */
export function backupFolderKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const canonical = normalize(resolve(path));
  const folded = platform === 'win32' ? canonical.toLowerCase() : canonical;
  return createHash('sha256').update(folded).digest('hex').slice(0, 32);
}

/** The folder one file's backups are kept in. */
export function backupFolderOf(root: string, target: string): string {
  return join(root, backupFolderKey(target));
}

/** A backup's file name: `1.pdf` is the newest, `2.pdf` the one before. */
const backupName = (index: number): string => `${String(index + 1)}.pdf`;

/** The note that says whose folder this is. */
const NOTE = 'source.json';

/**
 * The names a save uses, with the backups and the copy-aside in the data folder and the temp beside the target.
 * `temp` is supplied, so this module needs no randomness of its own and the sibling's rule stays `fileSurface`'s.
 */
export function dataFolderNames(root: string, copies: number, temp: (target: string) => string): SaveFileNames {
  return (target) => {
    const folder = backupFolderOf(root, target);
    const kept = Math.max(0, Math.min(copies, MAX_BACKUP_COPIES));
    return {
      temp: temp(target),
      previous: join(folder, 'previous.pdf'),
      backups: Array.from({ length: kept }, (_unused, index) => join(folder, backupName(index))),
      // A SHORTER CHOICE'S LEFTOVERS, up to the longest choice, as `siblingNames` retires them.
      retired: Array.from({ length: MAX_BACKUP_COPIES - kept }, (_unused, index) => join(folder, backupName(kept + index))),
    };
  };
}

/** One kept version, as the application names it: an opaque id, its time and its size. The path stays in main. */
export interface StoredBackup {
  /** The file's own name inside the folder: `1.pdf` for the newest. Opaque to a caller beyond being what to ask for. */
  readonly id: string;
  readonly savedAt: Date;
  readonly bytes: number;
}

/**
 * The versions kept for `target`, newest first: each rotated backup, then the copy-aside where a rotation was refused.
 * Empty where there is no folder, which is every file never saved over.
 */
export async function listStoredBackups(root: string, target: string): Promise<readonly StoredBackup[]> {
  const folder = backupFolderOf(root, target);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
  const found: StoredBackup[] = [];
  for (const name of names) {
    // ONLY THE NAMES THIS MODULE WRITES: a number and `.pdf`, or the copy-aside. Anything else in the folder is not ours to offer.
    if (!/^(?:[1-9]\d?\.pdf|previous\.pdf)$/u.test(name)) continue;
    const stats = await stat(join(folder, name)).catch(() => undefined);
    if (stats?.isFile() !== true) continue;
    found.push({ id: name, savedAt: stats.mtime, bytes: stats.size });
  }
  // NEWEST FIRST BY THE TIME EACH WAS MADE: a backup is a copy taken at the save that replaced the version it holds, and a
  // rename keeps a file's modification time, so the time shown is when that version was saved over — which is what a
  // person looks for.
  return found.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
}

/** The path of one listed backup, or `undefined` for an id this folder does not hold. Main only: it is a path. */
export async function storedBackupPath(root: string, target: string, id: string): Promise<string | undefined> {
  const listed = await listStoredBackups(root, target);
  return listed.some((backup) => backup.id === id) ? join(backupFolderOf(root, target), id) : undefined;
}

/** What the note records: the path the folder is for, and the file's identity as a HINT for finding it after a move. */
export interface BackupNote {
  readonly path: string;
  readonly dev: number | null;
  readonly ino: number | null;
}

/** Writes the note, best effort: a note that cannot be written loses a hint and never a backup. */
export async function writeBackupNote(root: string, target: string, note: Omit<BackupNote, 'path'>): Promise<void> {
  const folder = backupFolderOf(root, target);
  await mkdir(folder, { recursive: true });
  const staged = join(folder, `${NOTE}.${String(process.pid)}.tmp`);
  await writeFile(staged, JSON.stringify({ path: target, ...note }), 'utf8');
  await rename(staged, join(folder, NOTE));
}

/**
 * The folder whose note carries this identity — the hint — for a file with no folder at its own path. `undefined` when no
 * folder's note matches or the identity is empty. A hint is offered to the person and never trusted: two files on two
 * volumes can share an index.
 */
export async function findByIdentityHint(root: string, dev: number | null, ino: number | null): Promise<string | undefined> {
  if (dev === null || ino === null) return undefined;
  let folders: string[];
  try {
    folders = await readdir(root);
  } catch {
    return undefined;
  }
  for (const folder of folders) {
    try {
      const note = JSON.parse(await readFile(join(root, folder, NOTE), 'utf8')) as Partial<BackupNote>;
      if (note.dev === dev && note.ino === ino && typeof note.path === 'string') return note.path;
    } catch {
      // A folder with no readable note is not a candidate.
    }
  }
  return undefined;
}

/**
 * Copies a stored backup out to `destination`, refusing to write over anything there (`COPYFILE_EXCL`), so a restore is
 * never a way to overwrite a person's file. The backup itself is left where it is and never opened for writing.
 */
export async function copyStoredBackup(root: string, target: string, id: string, destination: string): Promise<void> {
  const source = await storedBackupPath(root, target, id);
  if (source === undefined) throw new Error(`no backup ${basename(id)} is kept for this file`);
  await copyFile(source, destination, constants.COPYFILE_EXCL);
}

/** Removes every backup folder under `root` (Settings › Privacy › Clear backups) and answers how many files went. */
export async function clearBackups(root: string): Promise<number> {
  let count = 0;
  let folders: string[];
  try {
    folders = await readdir(root);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw cause;
  }
  for (const folder of folders) {
    const inside = await readdir(join(root, folder)).catch(() => [] as string[]);
    count += inside.filter((name) => name.endsWith('.pdf')).length;
    await rm(join(root, folder), { recursive: true, force: true });
  }
  return count;
}
