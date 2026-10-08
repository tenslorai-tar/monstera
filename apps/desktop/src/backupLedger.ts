import { type FileIdentity, RENAME_BACKOFF_MS, isTransient } from '@monstera/kernel';

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
 *
 * ## A copy Monstera made and could not delete is OWED, and the debt is kept
 *
 * A delete can fail where the save did not: another program — a viewer, a sync client, a scanner — may hold the copy
 * open. Thrown, that failure reached the person as a save that went wrong, when the save had written, and the copy was
 * tried again only at the next removal's save, which may never come (CR-DOC-10). So the delete climbs the kernel's
 * ladder for a held file, and a copy still held after it is **owed**: recorded with its path and identity, in this same
 * `userData` document, so the debt outlives the session. A retry deletes it only while its identity is still the one
 * owed, so a debt never licenses deleting a file somebody changed since.
 */
export interface BackupProvenance {
  /** Records the backup a save made at `path`. A path with no usable identity records nothing. */
  made(path: string): Promise<void>;
  /**
   * Deletes `path` permanently when Monstera made it and it is unchanged since: `deleted`; `not-made` when a file is
   * there that Monstera did not make, or changed; `absent` when nothing is there; `held` when Monstera made it and the
   * delete failed after the held-file ladder — the copy is then owed a deletion ({@link BackupProvenance.owed}).
   */
  deleteIfMade(path: string): Promise<'deleted' | 'not-made' | 'absent' | 'held'>;
  /**
   * Rewrites `path` in place when Monstera made it and it is unchanged since, and records the file `rewrite` left there
   * as Monstera's in place of the old one: a protect encrypting a backup (ADR-0171 Decision 8). `rewrite` answers whether
   * it rewrote; a file left as it was keeps its record. `not-made` and `absent` touch nothing.
   */
  rewriteIfMade(path: string, rewrite: (path: string) => Promise<boolean>): Promise<'rewritten' | 'left' | 'not-made' | 'absent'>;
  /**
   * Whether Monstera made the file at `path` and it is unchanged since — the proof, asked without touching it. The offer to
   * move the old backups beside a file (ADR-0198 Decision 5) counts and moves only the files this answers `true` for.
   */
  wasMade(path: string): Promise<boolean>;
  /** Every path owed a deletion, oldest first. */
  owed(): readonly string[];
  /**
   * Tries again to delete each of `paths` that is owed; answers those still held. A debt whose file is gone, or is no
   * longer the file owed, is dropped — the second kept rather than deleted, as the rule asks.
   */
  retryOwed(paths: readonly string[]): Promise<readonly string[]>;
}

/** One copy owed a deletion: where it is, and the identity that licenses deleting it. */
interface Owed {
  readonly path: string;
  readonly key: string;
}

/**
 * The provenance over a JSON document in `userData`.
 *
 * @param deps `identity` is the kernel's `readFileIdentity`, injected so a case can describe a volume; `remove`
 *   deletes a file permanently, never to the recycle bin, which would keep what was removed; `wait` takes the ladder's
 *   delays, injected so a case does not spend them.
 */
export function createBackupProvenance(
  file: SettingsSurface,
  deps: {
    readonly identity: (path: string) => Promise<FileIdentity | null>;
    readonly remove: (path: string) => Promise<void>;
    readonly wait: (ms: number) => Promise<void>;
  },
): BackupProvenance {
  const stored = file.read();
  const made: string[] = Array.isArray(stored['made'])
    ? stored['made'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  const owed: Owed[] = Array.isArray(stored['owed'])
    ? stored['owed'].filter(
        (entry): entry is Owed =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Record<string, unknown>)['path'] === 'string' &&
          typeof (entry as Record<string, unknown>)['key'] === 'string',
      )
    : [];

  const persist = (): void => {
    file.write({ made: [...made], owed: owed.map((entry) => ({ ...entry })) });
  };

  /** The delete, climbing the kernel's held-file ladder: `true` once it went, `false` while it is still held. */
  const removed = async (path: string): Promise<boolean> => {
    for (const delay of RENAME_BACKOFF_MS) {
      if (delay > 0) await deps.wait(delay);
      try {
        await deps.remove(path);
        return true;
      } catch (cause) {
        // ONLY A HOLDING ERROR IS WAITED ON, as for a held rename; a read-only volume or a denied permission is the
        // same answer on every attempt, so it is held at once rather than slowly.
        if (!isTransient(cause)) return false;
      }
    }
    return false;
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
      if (at < 0 || key === null) return 'not-made';
      if (await removed(path)) {
        made.splice(at, 1);
        persist();
        return 'deleted';
      }
      // OWED: still Monstera's and still held. It stays in `made` too, so a later removal's save finds it as well.
      if (!owed.some((entry) => entry.path === path)) owed.push({ path, key });
      persist();
      return 'held';
    },
    rewriteIfMade: async (path, rewrite) => {
      const identity = await deps.identity(path);
      if (identity === null) return 'absent';
      const key = keyOf(identity);
      const at = key === null ? -1 : made.indexOf(key);
      if (at < 0 || key === null) return 'not-made';
      if (!(await rewrite(path))) return 'left';
      // THE NEW FILE IS MONSTERA'S, and the old identity names nothing now: replaced in the one record.
      made.splice(at, 1);
      const next = keyOf(await deps.identity(path));
      if (next !== null && !made.includes(next)) made.push(next);
      persist();
      return 'rewritten';
    },
    wasMade: async (path) => {
      const key = keyOf(await deps.identity(path));
      return key !== null && made.includes(key);
    },
    owed: () => owed.map((entry) => entry.path),
    retryOwed: async (paths) => {
      const still: string[] = [];
      for (const path of paths) {
        const debt = owed.findIndex((entry) => entry.path === path);
        if (debt < 0) continue;
        const key = keyOf(await deps.identity(path));
        const owedKey = owed[debt]?.key;
        // GONE, OR NOT THE FILE OWED: the debt is dropped and nothing is deleted.
        if (key === null || key !== owedKey) {
          owed.splice(debt, 1);
          persist();
          continue;
        }
        if (await removed(path)) {
          owed.splice(debt, 1);
          const at = made.indexOf(key);
          if (at >= 0) made.splice(at, 1);
          persist();
        } else {
          still.push(path);
        }
      }
      return still;
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
