import type { FileIdentity } from '@monstera/kernel';

import type { SettingsSurface } from './settingsFile.js';

/** The ledger's document inside `userData`. */
export const BACKUP_LEDGER_FILE = 'backups-made.json';

/**
 * How many backups the ledger remembers, newest kept. A dropped entry can only make a backup be KEPT where it could
 * have been deleted, never the other way, so the bound is a size and not a safety margin: one entry per save that made
 * a backup, and a person who saves this many times keeps the older backups beside their files.
 */
export const MAX_LEDGER_ENTRIES = 4096;

/**
 * Which backups beside a person's documents Monstera made
 * ([ADR-0139](../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md)), so a removal's
 * save can delete those and no other file. The owner's rule: *never delete a file Monstera did not make*.
 *
 * ## A file's identity, recorded when the save makes it
 *
 * A backup is a fresh file made by `copy`, and a later save renames it one name older; a rename keeps the file's
 * device, index, size and modification time. So those four, read by the kernel's one identity reader the moment the
 * save returns, name *this file, as Monstera left it*. Not the change time: a rename moves it.
 *
 * A file with a backup's name that a person, a sync client or another editor made has another index. One that was
 * edited since has another size or time. A volume that reports no file index gives no identity at all. All three are
 * kept, which is the direction the rule asks for.
 */
export interface BackupProvenance {
  /** Records the backup a save made at `path`. A path with no usable identity records nothing. */
  made(path: string): Promise<void>;
  /**
   * Deletes `path` permanently when Monstera made it and it is unchanged since: `deleted`; `not-made` when a file is
   * there that Monstera did not make, or changed; `absent` when nothing is there.
   */
  deleteIfMade(path: string): Promise<'deleted' | 'not-made' | 'absent'>;
}

/**
 * The provenance over a JSON document in `userData`.
 *
 * @param deps `identity` is the kernel's `readFileIdentity`, injected so a case can describe a volume; `remove`
 *   deletes a file permanently, never to the recycle bin, which would keep what was removed.
 */
export function createBackupProvenance(
  file: SettingsSurface,
  deps: {
    readonly identity: (path: string) => Promise<FileIdentity | null>;
    readonly remove: (path: string) => Promise<void>;
  },
): BackupProvenance {
  const stored = file.read()['made'];
  const made: string[] = Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];

  const persist = (): void => {
    file.write({ made: [...made] });
  };

  return {
    made: async (path) => {
      const key = keyOf(await deps.identity(path));
      if (key === null || made.includes(key)) return;
      made.push(key);
      // THE OLDEST GO FIRST, and only from the front: a dropped entry keeps a backup, which the rule allows.
      if (made.length > MAX_LEDGER_ENTRIES) made.splice(0, made.length - MAX_LEDGER_ENTRIES);
      persist();
    },
    deleteIfMade: async (path) => {
      const identity = await deps.identity(path);
      if (identity === null) return 'absent';
      const key = keyOf(identity);
      const at = key === null ? -1 : made.indexOf(key);
      if (at < 0) return 'not-made';
      await deps.remove(path);
      made.splice(at, 1);
      persist();
      return 'deleted';
    },
  };
}

/**
 * The one spelling of *this file as Monstera left it*: device, index, size, modification time. `null` where the volume
 * has no file index, because a size and a time alone are what two copies of one document share.
 */
function keyOf(identity: FileIdentity | null): string | null {
  if (identity?.dev == null || identity.ino === null) return null;
  return `${String(identity.dev)}:${String(identity.ino)}:${String(identity.size)}:${String(identity.modifiedMs)}`;
}
