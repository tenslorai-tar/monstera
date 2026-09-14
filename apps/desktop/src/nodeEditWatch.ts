import { createHash } from 'node:crypto';
import { realpathSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';

import type { EditWatchSurface } from './externalEditWatch.js';

/**
 * The real surface under `externalEditWatch.ts`: Node's `fs.watch` on the file's
 * directory, SHA-256 over its bytes, and `setTimeout`.
 *
 * ## The DIRECTORY, not the file
 *
 * ADR-0062 Decision 3, measured on Windows: a directory watch reports every save pattern
 * the table lists, and does not block a rename into that directory. A watch on the file
 * itself has no advantage in the table and would need re-establishing if a save replaced
 * the path in a way not measured.
 *
 * ## The directory is watched in its LONG form, and `.native` is what makes it long
 *
 * libuv's Windows watcher asserts that a changed file's full path begins with the watched
 * directory's path (`!_wcsnicmp(filename, dir, dirlen)`, `src/win/fs-event.c`). It builds
 * that full path in long form, so a directory named through an 8.3 short component —
 * `C:\Users\RUNNER~1\…` is `os.tmpdir()` on the windows-latest runner — can fail the
 * comparison, and a failed `assert` is `abort()`: the whole process, with no error to
 * catch. It went red at `785ba87` and `c963dfd` exactly that way, in the unit-test worker;
 * here it would be Electron's main process.
 *
 * `realpathSync.native` asks the operating system for the path and returns the long form
 * (measured 2026-09-14: given `…\C-54FA~1\…\A-DIRE~1` it answered the long path).
 * `realpathSync` without `.native` resolves in JavaScript and returned the SHORT path
 * unchanged, so it would not have removed the precondition. The abort itself did not
 * reproduce on this machine across two probes, which is stated in the journal; the CI run
 * after this change is the reading that confirms or refutes it.
 *
 * **The resolver is not injectable, deliberately.** Only `watch` is, so a test can record
 * the path it is handed; a test that could also supply the resolver would be testing its
 * own, and production's could be deleted under a green suite.
 *
 * ## Refusals are values
 *
 * A directory that cannot be resolved or watched answers `null`, a file that cannot be
 * read now answers `null`, and a watch that dies calls `onError`. None of them is thrown
 * past the rule, which is what decides what each one means.
 */
export function nodeEditWatchSurfaceWith(dependencies: {
  /** Only the shape this surface calls — a directory and a listener — never `fs.watch`'s overload set. */
  readonly watch: (directory: string, listener: (event: string, name: string | null) => void) => FSWatcher;
}): EditWatchSurface {
  return {
    watchDirectory: (directory, onEvent, onError) => {
      let watcher: FSWatcher;
      try {
        watcher = dependencies.watch(realpathSync.native(directory), (_event, name) => {
          // `null` WHERE THE PLATFORM NAMES NOTHING, which Node documents as possible; an
          // event with no name cannot be this file's, so it schedules nothing.
          if (typeof name === 'string') onEvent(name);
        });
      } catch {
        // THE PLATFORM REFUSED — a directory that is gone, one this process may not read,
        // or one whose real path cannot be resolved. `null` is that answer, and the
        // caller refuses to report an edit it could never see.
        return null;
      }
      watcher.on('error', onError);
      return {
        close: () => {
          watcher.close();
        },
      };
    },
    digest: async (path) => {
      let bytes: Uint8Array;
      try {
        bytes = await readFile(path);
      } catch {
        // NOT READABLE NOW — locked by the editor mid-save, or between a rename's two halves.
        // `null` is *no edit yet*, and the next event looks again (ADR-0062's stated limit).
        return null;
      }
      return createHash('sha256').update(bytes).digest('hex');
    },
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return {
        cancel: () => {
          clearTimeout(timer);
        },
      };
    },
  };
}

export const nodeEditWatchSurface: EditWatchSurface = nodeEditWatchSurfaceWith({
  watch: (directory, listener) => watch(directory, listener),
});
