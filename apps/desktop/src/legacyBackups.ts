import { copyFile, mkdir, stat, utimes } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

import { MAX_BACKUP_COPIES } from '@monstera/contract';
import { backupFolderKey, backupFolderOf, listStoredBackups, siblingNames } from '@monstera/kernel';

import type { BackupProvenance } from './backupLedger.js';

/**
 * The `.bak` files beside a document that earlier builds wrote, and the offer to move the ones Monstera made into its own
 * folder ([ADR-0198](../../../docs/DECISIONS/0198-backups-live-in-monsteras-own-data-folder-keyed-by-the-files-canonical-path-and-nothing-is-written-beside-the-file.md)
 * Decision 5).
 *
 * ## Nothing here deletes a file Monstera cannot prove it made
 *
 * A file named like a backup that a person, a sync client or another editor made is the person's (ADR-0139). So the scan
 * splits what it finds by the ledger's proof, `wasMade`, and only the proven ones are ever copied or removed; the rest are
 * COUNTED, so the offer can say how many stay where they are, and are otherwise left alone.
 *
 * ## A move is a copy that reads back, then the removal of exactly that file
 *
 * The copy keeps the original's modification time (the list is sorted by it) and is checked against the original's size
 * before the original is removed, through the ledger's own `deleteIfMade`, which re-proves the file at that moment and
 * deletes permanently. A copy that did not read back, or a removal held by another program, leaves the original where it
 * is: counted as kept, never lost.
 */

/** Which of the `.bak` files beside a path exist, split by whether Monstera can prove it made them. */
export interface LegacyScan {
  readonly proven: readonly string[];
  readonly unproven: readonly string[];
}

/** The names an earlier build wrote beside a file: `.bak`, `.bak2`, … up to the longest count anyone could keep. */
function legacyNames(path: string): readonly string[] {
  return siblingNames(path, MAX_BACKUP_COPIES).backups;
}

export async function scanLegacyBackups(path: string, provenance: Pick<BackupProvenance, 'wasMade'>): Promise<LegacyScan> {
  const proven: string[] = [];
  const unproven: string[] = [];
  for (const name of legacyNames(path)) {
    const there = await stat(name).then((stats) => stats.isFile(), () => false);
    if (!there) continue;
    (await provenance.wasMade(name) ? proven : unproven).push(name);
  }
  return { proven, unproven };
}

/** The folder this offer is remembered under: the DIRECTORY the document is in, since the offer is made once per folder. */
export function offerKeyOf(path: string): string {
  return backupFolderKey(dirname(path));
}

/**
 * Moves the proven backups into the document's own folder after the versions already kept, newest first.
 * @returns how many moved, and how many stayed where they were
 */
export async function moveLegacyBackups(
  root: string,
  path: string,
  scan: LegacyScan,
  provenance: Pick<BackupProvenance, 'deleteIfMade'>,
): Promise<{ readonly moved: number; readonly kept: number }> {
  const folder = backupFolderOf(root, path);
  await mkdir(folder, { recursive: true });
  // THE FREE SLOTS AFTER THE VERSIONS ALREADY KEPT, in the names the rotation uses, so a later save shifts them like any other.
  const existing = (await listStoredBackups(root, path)).filter((backup) => backup.id !== 'previous.pdf').length;
  let moved = 0;
  let kept = 0;
  for (const [offset, source] of scan.proven.entries()) {
    const slot = existing + offset + 1;
    if (slot > MAX_BACKUP_COPIES) {
      kept += 1;
      continue;
    }
    const destination = join(folder, `${String(slot)}.pdf`);
    try {
      const original = await stat(source);
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      // KEEPS THE TIME THE VERSION WAS SAVED OVER, since the list is sorted by it.
      await utimes(destination, original.atime, original.mtime);
      if ((await stat(destination)).size !== original.size) {
        kept += 1;
        continue;
      }
      if ((await provenance.deleteIfMade(source)) === 'deleted') moved += 1;
      else kept += 1;
    } catch {
      kept += 1;
    }
  }
  return { moved, kept };
}
