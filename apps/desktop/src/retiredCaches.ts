import type { Dirent } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Directories under `userData` that an earlier build wrote and nothing reads any more.
 *
 * ## Why main deletes one at start
 *
 * `handwriting` held the local TrOCR engine's downloaded models — hundreds of
 * megabytes in a reader's profile. The engine was removed
 * ([ADR-0085](../../../docs/DECISIONS/0085-handwriting-is-read-by-a-service-and-the-local-engine-is-removed.md)),
 * and with it the control that cleared the cache, so a profile that downloaded
 * the models would keep them for ever with nothing able to reach them.
 *
 * **Once, in effect, and not by a flag.** The directory is gone after the first
 * start that finds it, so every later start finds nothing and says nothing. A
 * stored *already done* marker would be a second fact that can disagree with the
 * disk; the disk is the fact.
 */
export const RETIRED_CACHES = ['handwriting'] as const;

/** What one start removed, for the shell log. */
export interface RetiredCacheRemoval {
  readonly name: (typeof RETIRED_CACHES)[number];
  readonly files: number;
  readonly bytes: number;
}

/**
 * Counts what a directory holds, then removes it.
 *
 * WHAT IS ON DISK is what gets reported, not what a manifest once named: a
 * profile may hold files from several builds, and the line in the log is the
 * reader's only record of what was taken.
 *
 * @returns `null` when there was no directory — the ordinary state, and the one
 *   every start after the first is in.
 */
async function removeOne(
  userData: string,
  name: (typeof RETIRED_CACHES)[number],
): Promise<RetiredCacheRemoval | null> {
  const directory = join(userData, name);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true, recursive: true });
  } catch (cause) {
    // ABSENT IS THE ANSWER, and only absent: any other refusal is a directory
    // that exists and could not be read, which the log must name rather than
    // report as nothing to do.
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
    throw cause;
  }
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += (await stat(join(entry.parentPath, entry.name))).size;
  }
  await rm(directory, { recursive: true, force: true });
  return { name, files, bytes };
}

/**
 * Removes every retired directory under `userData`, telling `note` about each one found.
 *
 * @param note called once per directory removed, and once per directory that could
 *   not be — a failure here is reported and does not stop the application starting,
 *   because nothing the application does depends on the directory being gone.
 */
export async function removeRetiredCaches(
  userData: string,
  note: (detail: string) => void,
): Promise<void> {
  for (const name of RETIRED_CACHES) {
    try {
      const removed = await removeOne(userData, name);
      if (removed === null) continue;
      note(
        `removed ${name}/ (${String(removed.files)} files, ${String(removed.bytes)} bytes): ` +
          'the local handwriting engine was removed by ADR-0085 and nothing reads it',
      );
    } catch (cause) {
      note(`could not remove ${name}/: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}
