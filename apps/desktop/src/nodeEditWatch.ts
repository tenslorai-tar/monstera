import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
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
 * ## Refusals are values
 *
 * A directory that cannot be watched answers `null`, a file that cannot be read now
 * answers `null`, and a watch that dies calls `onError`. None of them is thrown past the
 * rule, which is what decides what each one means.
 */
export const nodeEditWatchSurface: EditWatchSurface = {
  watchDirectory: (directory, onEvent, onError) => {
    let watcher: ReturnType<typeof watch>;
    try {
      watcher = watch(directory, (_event, name) => {
        // `null` WHERE THE PLATFORM NAMES NOTHING, which Node documents as possible; an
        // event with no name cannot be this file's, so it schedules nothing.
        if (typeof name === 'string') onEvent(name);
      });
    } catch {
      // THE PLATFORM REFUSED THE WATCH — a directory that is gone, or one this process may
      // not read. `null` is that answer, and the caller refuses to report an edit it
      // could never see.
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
