import { copyFile, open, rename, rm, stat, writeFile } from 'node:fs/promises';

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

/** Reads the filesystem, for the ordering §4 fixes. */
export const nodeFileSurface: AtomicWriteSurface = {
  write: (path, bytes) => writeFile(path, bytes),
  sync: syncFile,
  rename: (from, to) => rename(from, to),
  copy: (from, to) => copyFile(from, to),
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
 * `<target>.monstera-tmp` and `<target>.bak`, beside the target.
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
export const siblingNames: SaveFileNames = (target) => ({
  temp: `${target}.monstera-tmp`,
  backup: `${target}.bak`,
});
