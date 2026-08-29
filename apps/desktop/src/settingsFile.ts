import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Where the user's settings live, and how they get there intact.
 *
 * ## The renderer cannot reach any of this, which is the point
 *
 * A setting has to survive a restart, and surviving a restart means a file.
 * The renderer holds no filesystem path (invariant 2), so persistence is main's
 * work by construction rather than by convention — `settings.load` and
 * `settings.save` carry values and nothing else, and there is no shape in which
 * the renderer could name where they went.
 *
 * ## Injected as a surface, for the reason `PickDocument` is
 *
 * `composition.ts` may not import Electron, and *where the user's data lives* is
 * Electron's question — `app.getPath('userData')`. So the directory arrives as a
 * string and this module does the file work, which leaves every decision about
 * persistence testable in milliseconds against a temporary directory.
 */

/** What the handlers need in order to persist. Two functions, no path. */
export interface SettingsSurface {
  /** Everything the last run stored. `{}` for a first launch. */
  read(): Readonly<Record<string, unknown>>;
  /** Replaces the stored document. */
  write(values: Readonly<Record<string, unknown>>): void;
}

/** The file's name inside whatever directory it is given. */
export const SETTINGS_FILE = 'settings.json';

/**
 * A settings surface backed by one JSON file under `directory`.
 *
 * ## Every read failure answers `{}`, and none of them is reported
 *
 * A missing file is a first launch. A file holding invalid JSON, or valid JSON
 * that is not an object, is a file this build cannot use — and there is nothing
 * a user can do about either, because they did not write it. All of them mean
 * *no stored settings*, which is exactly what the registry's fallbacks are for.
 *
 * **Refusing a non-object is not the same as refusing a value.** An array or a
 * string at the top level is a corrupt document; a *value* this build does not
 * recognise is last build's data and belongs to the registry's `migrate`, which
 * is why nothing here validates one. Deciding here what a stored value means
 * would be a second opinion about a question `SettingsRegistry.read` owns
 * (B3a).
 *
 * ## Written through a temporary file and renamed
 *
 * A settings file is rewritten whole on every change, so a crash midway through
 * `writeFileSync` truncates it — and the failure is silent until the next
 * launch, when the user's preferences are simply gone. `rename` is atomic
 * within a filesystem: the reader sees either the old document or the new one,
 * never a half of either.
 *
 * The temporary file sits **beside** the target rather than in the OS temp
 * directory, because a rename across filesystems is not atomic and `userData`
 * and `temp` are routinely on different volumes.
 */
export function createSettingsFile(directory: string): SettingsSurface {
  const path = join(directory, SETTINGS_FILE);

  return {
    read(): Readonly<Record<string, unknown>> {
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        return {};
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {};
      }
      // `typeof null === 'object'` and an array is an object, so both are
      // excluded by name. A settings document that is an array would otherwise
      // hydrate as settings named "0" and "1", which the registry drops one at a
      // time while nothing says the file was wrong.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return parsed as Record<string, unknown>;
    },

    write(values: Readonly<Record<string, unknown>>): void {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.writing`;
      writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
      replaceWithRetry(temporary, path);
    },
  };
}

/**
 * How many times a rename onto an existing file is retried, and how long a wait
 * separates the attempts.
 *
 * Small on purpose. This runs on main during a settings change, so the whole
 * budget is a fifth of a second — long enough to outlast a scanner's handle,
 * short enough that nobody notices, and bounded so a genuinely locked file fails
 * rather than hanging.
 */
const REPLACE_ATTEMPTS = 5;
const REPLACE_BACKOFF_MS = 40;

/**
 * Blocks for `ms`, synchronously.
 *
 * `Atomics.wait` on a buffer nothing else can reach, because this function is
 * synchronous by requirement rather than by accident: the surface is called from
 * a handler that answers `stored: true` only once the document is on disk, and
 * making it asynchronous would mean the answer preceded the write.
 */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * `rename`, retried for the one failure Windows produces that is not ours.
 *
 * ## The mechanism, and why this is not the banned retry reflex
 *
 * `MoveFileExW` fails with `ERROR_ACCESS_DENIED` — Node reports `EPERM` — when
 * another process holds a handle on the destination, and on Windows something
 * routinely does for a few milliseconds after a file is closed: the search
 * indexer and the antimalware scanner both wake on a close. Node performs no
 * retry, so the call surfaces a transient condition as a hard error.
 *
 * **The root cause is proven to lie outside this repository, and it is proven by
 * being TRANSIENT rather than argued from plausibility.** Measured 2026-08-29 on
 * Windows 11: one failure, in one vitest run, on the second write of a test —
 * then 0 failures in 10 consecutive renames onto an existing destination in a
 * standalone probe, and 3 clean runs of the same test file afterwards. A
 * semantic error would be deterministic; this is not one. That is the whole
 * basis for retrying, and without it the honest response would have been to find
 * out what this code does wrong.
 *
 * ## What it deliberately does not do
 *
 * It does not widen to every error: a missing temporary file or a
 * cross-filesystem rename is ours and fails on the first attempt. It does not
 * loop unbounded. It does not swallow — the final failure rethrows carrying the
 * original error as its cause and the attempt count, so a genuinely locked
 * settings file reads as one and not as a mystery.
 *
 * It also removes the temporary on the way out. A failed write that left
 * `settings.json.writing` behind would accumulate one per failure, in the
 * directory whose whole job is to hold exactly one document.
 *
 * ## `rename` is injectable, and that is what makes the retry provable
 *
 * The condition this exists for is transient by definition — it happened once,
 * has not reproduced, and cannot be summoned. A test that waited for it would be
 * a test that never runs, and the retry would be an untested branch guarding the
 * only failure it will ever see. So the foreign call arrives as a parameter,
 * exactly as `PickDocument` and `SettingsSurface` do, and a case can hand one
 * that fails twice and then succeeds.
 *
 * The default is the real call, so no production path passes anything.
 *
 * @param rename the foreign call. Only a test passes this.
 */
export function replaceWithRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync,
): void {
  // The codes a transiently-held destination produces. `EBUSY` and `EACCES`
  // accompany `EPERM` here on different Windows versions and filesystems, and
  // all three mean the same thing to this caller.
  const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

  for (let attempt = 1; attempt <= REPLACE_ATTEMPTS; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === undefined || !TRANSIENT.has(code) || attempt === REPLACE_ATTEMPTS) {
        try {
          rmSync(from, { force: true });
        } catch {
          // The cleanup's own failure must not replace the diagnosis. Whatever
          // is holding the destination is plausibly holding this too, and the
          // error worth reporting is the one about the settings file.
        }
        throw new Error(
          `Could not replace ${to} after ${String(attempt)} attempt(s) (${code ?? 'no code'}). ` +
            `The settings change was not stored.`,
          { cause },
        );
      }
      pause(REPLACE_BACKOFF_MS);
    }
  }
}

/**
 * A settings surface that forgets everything when the process ends.
 *
 * ## For harnesses and tests, and named so that using it in the app is visible
 *
 * `createShellDependencies` takes the surface as a **required** parameter
 * precisely so that nothing gets non-persistent settings by saying nothing.
 * This is the answer for callers that genuinely want them: a proof harness
 * driving the shipped shell should not write into the developer's real
 * `userData`, and a unit test should not touch a filesystem at all.
 *
 * It is a real surface rather than `null`, so the handlers have no absent case
 * to carry — `settings.load` answering from an empty map and answering from an
 * empty file are the same code path, which is one behaviour rather than two.
 *
 * The name is the whole safety mechanism. `createSettingsFile` and
 * `createEphemeralSettings` at a call site are two names a reader picks between;
 * an optional parameter with a quiet default is a paragraph somebody has to read
 * and reject (B5, and QQQ-3's shape).
 */
export function createEphemeralSettings(): SettingsSurface {
  let held: Readonly<Record<string, unknown>> = {};
  return {
    read: () => held,
    write: (values) => {
      held = { ...values };
    },
  };
}
