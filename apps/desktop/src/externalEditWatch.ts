import { basename, dirname } from 'node:path';

/**
 * Whether the page sent to another application has been saved there — ADR-0062
 * Decision 3.
 *
 * ## An edit is a changed DIGEST, never an event
 *
 * Measured on Windows (the ADR's table): every event arrives twice, a directory watch
 * also reports an editor's temporary names, and a save through a temporary file is a
 * rename rather than a change. So an event only schedules a look. After a quiet second
 * with no further event for the file, its SHA-256 is read, and an edit is a digest
 * different from the last one `main` wrote or accepted. The duplicates, the temporary
 * names and a save that rewrites identical bytes therefore change nothing.
 *
 * ## An edit is ANNOUNCED ONCE
 *
 * The renderer asks the person when a wait answers `changed`, and a person may say *not
 * now*. If a pending edit answered `changed` to every wait, that dismissal would reopen the
 * question at once, for ever. So each edit is answered `changed` to one wait; a later wait
 * holds until a newer save. The stated limit this costs: to put back an edit a person
 * dismissed, they save it again.
 *
 * ## No platform call is made here
 *
 * The directory watch, the hash and the timer are a surface, so this rule is exercised
 * in milliseconds with no directory. `nodeEditWatch.ts` is the real surface, and its own
 * test drives it on a real directory through every save pattern the ADR measured.
 */

/** How long a file must be quiet before it is looked at. Policy, per ADR-0062. */
export const EDIT_QUIET_MS = 1_000;

/** How long one wait lasts before it answers `unchanged`. Policy, per ADR-0062 Decision 4. */
export const EXTERNAL_EDIT_WAIT_MS = 30_000;

/** The platform calls a watch makes, as values rather than throws. */
export interface EditWatchSurface {
  /**
   * Watches a directory, calling `onEvent` with each changed name and `onError` once if
   * the watch dies. Answers `null` where the platform refused the watch — an outcome,
   * so a caller cannot mistake a watch that never started for one that saw nothing.
   */
  readonly watchDirectory: (
    directory: string,
    onEvent: (name: string) => void,
    onError: () => void,
  ) => { readonly close: () => void } | null;
  /**
   * The file's SHA-256 as hex, or `null` where it cannot be read now — an editor holding
   * it locked mid-save, or a rename not yet complete. `null` is *no edit yet*, never an
   * edit, and the next event looks again.
   */
  readonly digest: (path: string) => Promise<string | null>;
  /** A timer, injected so a case drives the quiet period without waiting. */
  readonly after: (ms: number, run: () => void) => { readonly cancel: () => void };
}

/** What a bounded wait answers (ADR-0062 Decision 4). */
export type EditWait = 'changed' | 'unchanged' | 'ended';

/** One page out, watched. */
export interface EditWatch {
  /**
   * Resolves `changed` for an edit not yet announced (at once if one is pending),
   * `unchanged` after `ms` with none, and `ended` if the watch closes. Each edit is
   * announced to one wait only; see the module header.
   */
  readonly wait: (ms: number) => Promise<EditWait>;
  /** The digest of the edit found and not yet accepted, or `null`. */
  readonly pending: () => string | null;
  /**
   * Records the pending edit as accepted, so the same bytes are never offered again.
   * `main` calls it after a reimport lands.
   */
  readonly accept: () => void;
  /** Stops watching. Idempotent; a waiting `wait` answers `ended`. */
  readonly close: () => void;
}

/**
 * Starts watching `path` for saves, given the digest of the bytes `main` wrote there.
 *
 * @returns `null` where the platform refused to watch the file's directory.
 */
export function watchEdits(
  surface: EditWatchSurface,
  path: string,
  writtenDigest: string,
): EditWatch | null {
  // CASE-INSENSITIVE, because the file system it runs on is: an editor that saves
  // `Page.PDF` over `page.pdf` has saved this file.
  const name = basename(path).toLowerCase();
  let known = writtenDigest;
  let pending: string | null = null;
  let announced: string | null = null;
  let closed = false;
  let quiet: { readonly cancel: () => void } | null = null;
  const waiters = new Set<(state: EditWait) => void>();

  const settle = (state: EditWait): void => {
    const listening = [...waiters];
    waiters.clear();
    for (const waiter of listening) waiter(state);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    quiet?.cancel();
    handle?.close();
    settle('ended');
  };

  const look = async (): Promise<void> => {
    quiet = null;
    const digest = await surface.digest(path);
    if (closed || digest === null) return;
    if (digest === known) {
      // BACK TO THE BYTES MAIN WROTE OR ACCEPTED: the edit is gone. Leaving it pending would
      // offer a reimport that reads what the file no longer holds (audit HHHHHH-1).
      pending = null;
      announced = null;
      return;
    }
    // ONE LOOK IS ONE SAVE, because the quiet second folds a save's duplicate events into a
    // single look. So the announced edit found again is the person saving it again — the
    // header's way back from *not now* — and it is offered again. An edit found and not yet
    // announced stays as it is: the next wait tells it (audit HHHHHH-1).
    if (digest === pending && pending !== announced) return;
    announced = null;
    pending = digest;
    // ANNOUNCED ONLY TO SOMEONE LISTENING: an edit found while no wait is open stays
    // unannounced, so the next wait is told of it.
    if (waiters.size > 0) {
      announced = digest;
      settle('changed');
    }
  };

  const handle = surface.watchDirectory(
    dirname(path),
    (changed) => {
      if (closed || changed.toLowerCase() !== name) return;
      // RESTARTED ON EVERY EVENT, so a burst — the duplicates and a rename's two halves —
      // schedules one look a quiet second after the last of it.
      quiet?.cancel();
      quiet = surface.after(EDIT_QUIET_MS, () => {
        void look();
      });
    },
    close,
  );
  if (handle === null) return null;

  return {
    wait: (ms) => {
      if (closed) return Promise.resolve('ended');
      if (pending !== null && pending !== announced) {
        announced = pending;
        return Promise.resolve('changed');
      }
      return new Promise<EditWait>((resolve) => {
        const answer = (state: EditWait): void => {
          bound.cancel();
          resolve(state);
        };
        const bound = surface.after(ms, () => {
          waiters.delete(answer);
          resolve('unchanged');
        });
        waiters.add(answer);
      });
    },
    pending: () => pending,
    accept: () => {
      if (pending === null) return;
      known = pending;
      pending = null;
    },
    close,
  };
}
