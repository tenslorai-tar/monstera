import { type Result, err, ok } from '@monstera/shared';

/**
 * `ARCHITECTURE.md` §4's atomic write: **temp, fsync, rename, `.bak`, and the
 * Windows `EPERM`/`EBUSY` retry ladder** — the step invariant 18 rests on.
 *
 * ## The property, and it is one sentence
 *
 * > **The original file is intact until the rename.**
 *
 * Everything here exists to keep that true. Bytes go to a temp file beside the
 * target — beside, because a rename across volumes is a copy, and a copy has a
 * window where neither file is whole. They are flushed to the device before the
 * rename, because a rename is durable long before the data it points at is: an
 * unsynced temp promoted by a rename can be a file of the right length full of
 * zeroes, which is worse than a failed save because it looks like a successful
 * one.
 *
 * ## What the sync covers, and what it does NOT
 *
 * It flushes the temp file's **data**. It does not flush the **directory entry**
 * the rename then writes, so the ordering above is durable for the contents and
 * unstated for the rename itself. That gap is named rather than closed, and here
 * is the reason.
 *
 * On POSIX the close is an `fsync` on the directory's own descriptor. On
 * Windows, measured 2026-08-28 on Windows 11 with Node v24.12.0, by opening a
 * `mkdtemp` directory and calling `FileHandle.sync()`:
 *
 * - `open(dir, 'r')` succeeds and `sync()` throws `EPERM`;
 * - `open(dir, 'r+')` succeeds and `sync()` **returns**.
 *
 * A call that returns is not a flush that happened. `FlushFileBuffers` is
 * documented for file and volume handles; what it does for a directory handle is
 * not, so adding this step would put a call in the ordering whose effect on the
 * only platform this ships to is unverified — durability theatre, which is worse
 * than the stated gap because it stops anyone asking. The rename's durability on
 * NTFS rests on the journal, and **that has not been measured here either**.
 *
 * **The trigger, because this is a claim with a dependency** (invariant: a claim
 * true today needs the condition that expires it): `packages/kernel` is
 * platform-neutral by boundary and only the shipping platform makes the argument
 * above hold. The day this ordering runs against a POSIX target for real —
 * rather than against an injected fake, as every case here does — the directory
 * sync stops being optional and joins the surface.
 *
 * ## Why the surface is injected
 *
 * Every case below has to drive `EPERM` and `EBUSY` on demand, and neither can
 * be produced reliably on a real filesystem — `EBUSY` needs another process
 * holding the file with a share mode nothing here can arrange. A retry ladder
 * whose only test is "it worked once on a machine where nothing interfered" is
 * a ladder nobody has climbed.
 *
 * ## What this deliberately does NOT do
 *
 * It does not decide **whether** to write. That is `checkWriteTarget`'s, and
 * the two are separate because they refuse for unrelated reasons: this one
 * fails on the filesystem, that one on the document index. Folding them would
 * make "another document owns this file" and "the disk is full" one outcome.
 */

/** The filesystem calls this ordering makes, as it needs to see them. */
export interface AtomicWriteSurface {
  /** Writes `bytes` to `path`, creating or truncating. */
  readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
  /**
   * Flushes `path`'s data to the device.
   *
   * Separated from {@link write} rather than folded into it, because it is the
   * step whose absence is invisible: a save that skips it succeeds, and the
   * loss appears only after a power failure, in a file that is the right size.
   */
  readonly sync: (path: string) => Promise<void>;
  /** Renames `from` over `to`, replacing it. */
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Copies `from` to `to`, replacing it. Used for the backup. */
  readonly copy: (from: string, to: string) => Promise<void>;
  /** Removes `path`. Must not throw when it is already gone. */
  readonly remove: (path: string) => Promise<void>;
  /** Whether anything is at `path`. */
  readonly exists: (path: string) => Promise<boolean>;
}

/** Why a save could not be written. Every one leaves the original in place. */
export interface AtomicWriteFailure {
  /**
   * Which step failed, so a caller can say something true about what happened.
   *
   * **There is no `cleanup` stage and there must not be one.** Every removal
   * here is `remove(...).catch(() => undefined)` — deliberately, because a
   * cleanup failure arrives *after* the failure the caller needs to hear about
   * and would replace it. A stage nothing can return is worse than a missing
   * one: a reader takes this union as the list of things that can go wrong and
   * concludes a cleanup failure is reported somewhere.
   */
  readonly stage: 'temp-write' | 'sync' | 'backup' | 'rename';
  readonly detail: string;
  /** How many rename attempts were made, when the ladder ran. */
  readonly attempts?: number;
}

/**
 * How long to wait before each rename retry, in milliseconds.
 *
 * ## These are a LADDER and not a loop, and the shape is the argument
 *
 * `EPERM` and `EBUSY` on Windows mean *somebody else has this file open*, and
 * the somebody is usually a virus scanner or a search indexer that opened it
 * because it just changed. Those hold for a moment. A fixed short retry loop
 * spends its attempts inside that moment; a fixed long one makes every save
 * feel broken when the first attempt would have worked on the second.
 *
 * **The figures are not measured and this comment says so** (B6). They are a
 * standard back-off, and the honest statement is that nobody here has measured
 * how long a scanner holds a file on this machine or any other. What the shape
 * buys regardless is that the total wait is bounded and stated: 1.5 s across
 * five attempts, after which the save fails with the original intact rather
 * than retrying into a hang. Replace them with measurements when someone has
 * them; do not tune them by feel.
 */
export const RENAME_BACKOFF_MS: readonly number[] = [0, 50, 150, 400, 900];

/**
 * @param surface the filesystem calls
 * @param target the file to end up holding `bytes`
 * @param bytes the new contents
 * @param names where the temp and backup files go — supplied rather than
 *   derived, because *what a sibling file may be called* is a question about
 *   the destination directory rather than about this ordering, and a caller
 *   writing into a granted directory has rules this module cannot know.
 * @param wait how a delay is taken. Injected so the ladder's cases do not spend
 *   1.5 s of real time proving they waited.
 */
export async function atomicWrite(
  surface: AtomicWriteSurface,
  target: string,
  bytes: Uint8Array,
  names: { readonly temp: string; readonly backup: string },
  wait: (ms: number) => Promise<void>,
): Promise<Result<{ readonly backedUp: boolean }, AtomicWriteFailure>> {
  try {
    await surface.write(names.temp, bytes);
  } catch (cause) {
    // NOTHING TO UNDO. The original has not been touched and the temp may or
    // may not exist; removing it is best-effort and its failure must not
    // replace the failure the caller needs to hear about.
    await surface.remove(names.temp).catch(() => undefined);
    return err({ stage: 'temp-write', detail: describe(cause) });
  }

  try {
    await surface.sync(names.temp);
  } catch (cause) {
    await surface.remove(names.temp).catch(() => undefined);
    return err({ stage: 'sync', detail: describe(cause) });
  }

  // THE BACKUP IS TAKEN ONLY WHEN THERE IS SOMETHING TO BACK UP, and its
  // absence is an outcome rather than a failure: a save that creates a file has
  // no prior contents to preserve, and treating that as an error would refuse
  // the one case where nothing can be lost.
  const hadOriginal = await surface.exists(target);
  if (hadOriginal) {
    try {
      await surface.copy(target, names.backup);
    } catch (cause) {
      // REFUSED, not continued — and NOT because the rename needs something to
      // roll back to. Nothing here reads the backup, no case asserts a recovery
      // from it, and a rename that fails has not touched the original, so there
      // is nothing to recover. The `.bak` is §4's own deliverable: the user's
      // PREVIOUS version, surviving a SUCCESSFUL save, which is why the success
      // path removes the temp and leaves this file alone. Continuing without it
      // would replace the user's document and report success while silently
      // dropping the one thing that save promised to leave behind.
      await surface.remove(names.temp).catch(() => undefined);
      return err({ stage: 'backup', detail: describe(cause) });
    }
  }

  let attempts = 0;
  let last: unknown = null;
  for (const delay of RENAME_BACKOFF_MS) {
    if (delay > 0) await wait(delay);
    attempts += 1;
    try {
      await surface.rename(names.temp, target);
      return ok({ backedUp: hadOriginal });
    } catch (cause) {
      last = cause;
      // ONLY THE HOLDING ERRORS ARE RETRIED. `ENOENT` means the temp is gone
      // and no amount of waiting brings it back; `ENOSPC` means the disk is
      // full. Retrying either burns the ladder and reports the wrong story —
      // and a ladder that retries everything is one that turns a permanent
      // failure into a slow permanent failure.
      if (!isTransient(cause)) break;
    }
  }

  await surface.remove(names.temp).catch(() => undefined);
  return err({
    stage: 'rename',
    detail: describe(last),
    attempts,
  });
}

/**
 * Whether a rename failure is one waiting can fix.
 *
 * Windows reports a file held open by another process as `EPERM` or `EBUSY`
 * depending on how it was opened; both are the same situation to this ladder.
 * Anything else — a missing temp, a full disk, a read-only volume — is not.
 */
function isTransient(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  return code === 'EPERM' || code === 'EBUSY';
}

/** A message, never the value. A thrown filesystem error carries paths. */
function describe(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return cause instanceof Error ? cause.name : 'unknown';
}
