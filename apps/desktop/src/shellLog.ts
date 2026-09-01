import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import type { IncidentSink } from '@monstera/contract';

import type { ShellFailure, ShellFailureSink } from './shellFailure.js';

/**
 * The rotating local log — where a failure goes when nobody is watching stderr.
 *
 * `shellFailure.ts` argues that a failure channel a runtime announces on with
 * nothing subscribed is not a channel. This is the next step of the same
 * argument: **a subscription whose destination is a console nobody has open is
 * not a destination.** A packaged Store application has no terminal attached, so
 * every diagnostic this repository has spent effort producing — the preload's
 * absolute path, a containment verdict, an engine host's termination code —
 * currently goes to a handle that discards it.
 *
 * ## Synchronous, and that is the point rather than a shortcut
 *
 * Every caller is already inside a failure, and two of them are inside a
 * *shutdown*: `shutdown-incomplete` is announced while the app is ending, and
 * `engine-host-gone` can arrive during teardown. An asynchronous write is one
 * the runtime discards when the process ends, which this repository has already
 * paid for once — the quit probe's markers vanished from `process.stdout` on
 * both CI platforms while the process exited 0. `appendFileSync` returns when
 * the bytes are with the OS.
 *
 * The cost is bounded by what it is used for. This is not a general logger and
 * must not become one: it takes lifecycle failures and incidents, both of which
 * are rare by construction, and neither is on a path that renders a page.
 *
 * ## A sink must not throw, so this one cannot
 *
 * {@link ShellFailureSink} and `IncidentSink` both carry that requirement,
 * for the reason stated where they are declared: they run while a failure is
 * already in progress, and a throwing sink replaces a diagnosable failure with
 * an undiagnosable one. A full disk, a revoked ACL and a deleted directory are
 * all ordinary here.
 *
 * So writes are wrapped, and **the fallback is stderr rather than silence.**
 * `catch {}` would be the banned reflex; what makes this not one is that the
 * mechanism is named — the log is best-effort *because the caller is already
 * failing* — and the diagnostic still has somewhere to go on a developer
 * machine, which is where anyone reading stderr is.
 */

/**
 * How much log is kept, and it is a **cap on the total** rather than on a file.
 *
 * Two numbers rather than one: a per-file size decides when to rotate, and a
 * file count decides how many rotations survive. A single "keep 5 MB" cap needs
 * to rewrite a file to enforce itself, which means reading it in, and a
 * mechanism that loads the whole log to trim it is one that fails on exactly the
 * log that grew unexpectedly.
 *
 * The product of the two is the guarantee: at most `MAX_FILES × MAX_BYTES`,
 * roughly 5 MB, in `userData/logs`. Chosen rather than derived — there is no
 * budget in this repository this could be computed from, and §9.17's memory
 * budgets are about resident bytes, not disk.
 */
export const MAX_BYTES = 1_048_576;
export const MAX_FILES = 5;

/** The live file. Rotations are `shell.1.log` … `shell.<MAX_FILES - 1>.log`. */
export const LOG_NAME = 'shell.log';

/** `shell.4.log` and friends, and nothing else this directory may hold. */
const ROTATED = /^shell\.(\d+)\.log$/u;

/**
 * Moves `shell.log` aside and drops whatever falls off the end.
 *
 * Renames from the oldest down, so no two files ever hold the same name and
 * nothing is copied. A rename cannot half-succeed the way a read-modify-write
 * can, which is what makes this safe to run while the process is failing.
 *
 * @param directory The `logs` directory, which must already exist.
 */
function rotate(directory: string): void {
  // OLDEST FIRST. Going the other way would overwrite `shell.2.log` with
  // `shell.1.log` before `shell.2.log` had been moved to `shell.3.log`.
  for (let index = MAX_FILES - 1; index >= 1; index -= 1) {
    const from =
      index === 1
        ? join(directory, LOG_NAME)
        : join(directory, `shell.${String(index - 1)}.log`);
    const to = join(directory, `shell.${String(index)}.log`);
    try {
      renameSync(from, to);
    } catch {
      // The source not existing is the ordinary case on an early rotation, and
      // it is indistinguishable here from a source that could not be moved.
      // Both leave the chain shorter than it could be and neither is worth
      // failing a rotation over — the next line still opens a writable file.
    }
  }

  // ANYTHING PAST THE CAP, including files a previous MAX_FILES left behind.
  // Deriving the set from the directory rather than from the constant is what
  // makes lowering MAX_FILES take effect instead of stranding the excess.
  for (const entry of readdirSync(directory)) {
    const matched = ROTATED.exec(entry);
    if (matched === null) continue;
    if (Number(matched[1]) < MAX_FILES) continue;
    try {
      unlinkSync(join(directory, entry));
    } catch {
      // A file we could not delete is one that stays; the cap is then exceeded
      // by that file alone, which is a better outcome than refusing to log.
    }
  }
}

/**
 * The bytes a log line costs, without reading the file.
 *
 * `statSync` rather than tracking a running total in memory: a running total is
 * wrong after any other process, or a previous run of this one, has written to
 * the same file, and this file's whole purpose is to survive across runs.
 */
function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** One line, timestamped, with the newlines taken out of the detail. */
function line(kind: string, at: Date, detail: string): string {
  // A DETAIL IS PEER-SUPPLIED TEXT in at least one case — `engine-host-gone`
  // carries a code the host composed — and a newline inside it is a peer
  // writing lines of its own into this file. Same rule `PROBE_CODE_PATTERN`
  // applies on the wire, applied where the text lands.
  return `${at.toISOString()} ${kind} ${detail.replace(/[\r\n]+/gu, ' ')}\n`;
}

/**
 * Showing a directory in the OS file manager — Electron's `shell`, injected.
 *
 * A function rather than the `shell` module, for the reason `pickDocument` is a
 * function rather than `dialog`: this module may not import Electron, and the
 * question *how does this operating system show a folder* is Electron's and
 * nobody else's.
 *
 * @returns whether the directory was shown. `false` for a directory that is not
 * there, which is the ordinary state of a launch that has had nothing to report.
 */
export type RevealDirectory = (directory: string) => Promise<boolean>;

export interface ShellLog {
  /**
   * Where the files are.
   *
   * Held so the shell can name it in a diagnostic, and **not** so a caller can
   * hand it to a renderer: a path in a renderer-facing type is a compile error,
   * and {@link ShellLog.reveal} is what exists instead.
   */
  readonly directory: string;
  readonly failures: ShellFailureSink;
  readonly incidents: IncidentSink;
  /** Shows the log directory, or answers `false` because there is nothing there. */
  readonly reveal: () => Promise<boolean>;
  /** Appends one already-formatted line. Exported for the proof, not for callers. */
  readonly write: (kind: string, detail: string) => void;
}

/**
 * Opens the log under `userData/logs` and returns the two sinks that write it.
 *
 * @param userData Electron's `app.getPath('userData')`. A string rather than an
 * `App`, so this module needs no runtime and its tests need no window — the same
 * separation `shellShutdown.ts` takes for the same reason.
 * @param revealDirectory How this platform shows a folder. **Required, not
 * defaulted**: a default that quietly answered `false` would make the reveal
 * command a control that renders and does nothing, which is a defect rather
 * than a placeholder, and one no test would ever notice.
 * @param now Injected so a rotation's boundary is testable without waiting for
 * one, and so the timestamps in a fixture are a fact rather than a moment.
 */
export function createShellLog(
  userData: string,
  revealDirectory: RevealDirectory,
  now: () => Date = () => new Date(),
): ShellLog {
  const directory = join(userData, 'logs');

  const write = (kind: string, detail: string): void => {
    const text = line(kind, now(), detail);
    try {
      mkdirSync(directory, { recursive: true });
      const path = join(directory, LOG_NAME);
      // ROTATE BEFORE THE WRITE THAT WOULD EXCEED THE CAP, not after. Rotating
      // afterwards leaves one file permanently over the limit — by the size of
      // whatever line crossed it — which is the off-by-one that makes a cap a
      // suggestion.
      if (sizeOf(path) + Buffer.byteLength(text) > MAX_BYTES) rotate(directory);
      appendFileSync(path, text);
    } catch (thrown) {
      // NOT SILENCE. See the module note: the caller is already failing, so
      // this must not throw, and a diagnostic that reached nowhere is the state
      // the sinks were made required to prevent.
      process.stderr.write(
        `MONSTERA_LOG_UNWRITABLE ${directory}: ${thrown instanceof Error ? thrown.message : String(thrown)}\n` +
          text,
      );
    }
  };

  return {
    directory,
    write,
    reveal: async (): Promise<boolean> => {
      // ASKED OF THE FILESYSTEM, not remembered. Nothing guarantees a log has
      // been written this run — a quiet launch reports nothing — and a reveal
      // that opened a file manager on a directory that is not there is worse
      // than answering that there is nothing to show.
      if (!existsSync(directory)) return false;
      return revealDirectory(directory);
    },
    failures: (failure: ShellFailure): void => {
      write(`FAILURE ${failure.event}`, failure.detail);
    },
    incidents: (incident): void => {
      write(`INCIDENT ${incident.id} ${incident.channel}`, JSON.stringify(incident.diagnostic));
    },
  };
}
