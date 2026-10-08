import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { MAX_BACKUP_COPIES } from '@monstera/contract';

import type { AtomicWriteSurface } from './atomicWrite.js';
import type { SaveFileNames } from './savePipeline.js';

/**
 * The production {@link AtomicWriteSurface}, and the reason it is not in
 * `atomicWrite.ts`.
 *
 * That module is pure — it imports one type from `@monstera/shared` and nothing
 * else — which is what lets its cases drive `EPERM` and `EBUSY` on demand and
 * run in milliseconds. Putting `node:fs` beside the ordering would give the
 * module a runtime dependency that none of its cases use, and the ordering is
 * the part worth keeping testable without one.
 */

/**
 * `fsync` on the temp file, and it is the step whose absence is invisible.
 *
 * Opened `r+` rather than `r`: measured 2026-08-28 on Windows 11 with Node
 * v24.12.0, `FileHandle.sync()` on a handle opened `r` throws `EPERM`. A read
 * handle cannot flush, which is the kind of thing that would otherwise show up
 * as a save failing on the one platform this ships to.
 */
async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    // ALWAYS, including when the sync threw. A leaked handle on Windows is a
    // file nothing else can rename — which is precisely the `EPERM` the ladder
    // downstream would then spend 1.5 s retrying against a holder that is us.
    await handle.close();
  }
}

/**
 * A name beside `path` that nothing can have prepared: the save's sibling files are written into the person's
 * directory, which another account may also write to, and a name derived from the target alone is one that account
 * can create first.
 */
function unpredictableSibling(path: string): string {
  return `${path}.${randomBytes(8).toString('hex')}.monstera-tmp`;
}

/**
 * Reads the filesystem, for the ordering §4 fixes.
 *
 * ## Nothing is written THROUGH an object that was already at a path
 *
 * A file opened to be written, or copied onto, writes into whatever is at that path — a hard link to another file
 * included. Measured 2026-10-03 on Windows 11 with the save ordering as it stood: a hard link planted at the temp's old
 * fixed name received the new document and BECAME the saved document; one planted at `.bak` received the previous
 * version. So every write creates (`wx`, `COPYFILE_EXCL`) and refuses an existing object, and the backup — whose
 * name a person expects to stay `.bak` — is copied to an unpredictable sibling and renamed into place, since a rename
 * replaces a directory entry rather than writing into what it names. A directory or a junction at `.bak` refuses the
 * rename, and the save then refuses at `backup` with the original untouched.
 */
export const nodeFileSurface: AtomicWriteSurface = {
  write: (path, bytes) => writeFile(path, bytes, { flag: 'wx' }),
  // `writeFile` takes an async iterable and writes each chunk as it arrives, so a
  // fetched document is never assembled in memory.
  writeStream: (path, chunks) => writeFile(path, chunks, { flag: 'wx' }),
  sync: syncFile,
  rename: (from, to) => rename(from, to),
  copy: async (from, to) => {
    // THE DESTINATION'S FOLDER, made where it is not there: a backup's folder is Monstera's own and is made at the first
    // save that keeps one (ADR-0198). Where the destination sits beside the target, the folder exists and this does nothing.
    await mkdir(dirname(to), { recursive: true });
    const staged = unpredictableSibling(to);
    await copyFile(from, staged, constants.COPYFILE_EXCL);
    try {
      await rename(staged, to);
    } catch (cause) {
      await rm(staged, { force: true }).catch(() => undefined);
      throw cause;
    }
  },
  // `force` so a missing file is not an error — the surface's contract says
  // removal must not throw when the path is already gone, and every caller of
  // it in the ordering is a best-effort cleanup after something else failed.
  remove: (path) => rm(path, { force: true }),
  exists: (path) =>
    stat(path).then(
      () => true,
      () => false,
    ),
};

/**
 * `<target>.<random>.monstera-tmp` and the backups — `<target>.bak`, `.bak2` … as many as `copies` — beside the
 * target. The temp's name is new at every call, so nothing can be waiting at it (see {@link nodeFileSurface}).
 *
 * **Beside, because a rename across volumes is a copy**, and a copy has a
 * window in which neither file is whole — which is the one thing the atomic
 * ordering exists to remove. A system temp directory is on another volume as
 * often as not.
 *
 * The temp suffix is distinctive rather than `.tmp` so a leftover is
 * attributable: a file this application failed to clean up should say which
 * application it belonged to, in a directory that is the user's.
 */
export function siblingNames(target: string, copies: number): ReturnType<SaveFileNames> {
  // `.bak` FIRST, then `.bak2`, `.bak3`: the newest keeps the one name every save wrote before this was a choice.
  const backup = (index: number): string => `${target}.bak${index === 0 ? '' : String(index + 1)}`;
  const kept = Math.max(0, Math.min(copies, MAX_BACKUP_COPIES));
  return {
    temp: unpredictableSibling(target),
    previous: `${target}.monstera-previous`,
    backups: Array.from({ length: kept }, (_unused, index) => backup(index)),
    // THE ONES A SHORTER CHOICE NO LONGER KEEPS, up to the longest choice: a person who keeps three after keeping ten
    // is not left with seven copies nothing will ever update or remove.
    retired: Array.from({ length: MAX_BACKUP_COPIES - kept }, (_unused, index) => backup(kept + index)),
  };
}
