import { type Brand, type Result, err, ok } from '@monstera/shared';

import { type ContainerSid, type UserSid, handedDirectoryDacl } from './hostDacl.js';

/**
 * The pair of directories one engine session is handed (ADR-0023 Decision 7).
 *
 * ## Two directories, and it is a measurement rather than a layout preference
 *
 * Decision 7 splits the grants by verb — read on the snapshot, modify only on
 * the output directory — and it reads as though both could sit inside one
 * handed area with a per-file exception. They cannot. Measured 2026-08-25:
 * grant `(OI)(CI)(M)` on a directory and then grant `(R)` explicitly on a file
 * inside it, and the file carries **both** ACEs. An access check unions allow
 * ACEs, so the explicit read restricts nothing and the inherited modify still
 * grants write — a snapshot placed in a modify-granted directory is writable by
 * the contained host however carefully it is granted read.
 *
 * So the split is structural: one directory, one grant, and the DACLs come from
 * `hostDacl.ts` where the pipe's does.
 *
 * ## This is the ORDERING, over an injected surface
 *
 * Exactly as `enginePipeFactory.ts` is the ordering for pipe creation and
 * `engineHostFactory.ts` for process creation. The calls themselves belong to
 * the adapter module that may carry an `any` under B7's native-boundary rule.
 *
 * ## Both directories or neither
 *
 * A half-created pair is a real outcome — the second create can be refused
 * while the first succeeded — and it is the case that leaks: a snapshot
 * directory left behind is a directory the host is granted read on, waiting for
 * a document. Failure here removes what it made, in one place, for the same
 * reason `createHostPipe` closes the instances it opened.
 *
 * ## The pair does not outlive the session, and that is why `remove` is here
 *
 * Once a canonical image is written into the snapshot directory, that directory
 * **is a copy of the user's document** sitting somewhere the contained host can
 * read. Its lifetime is the session's: created before the image is written,
 * removed when the session closes, on every path including a failed open.
 *
 * What this module cannot cover is a main process that dies without unwinding.
 * That is stated rather than absorbed: nothing here sweeps a root left by a
 * previous run, and a sweep is not a line of code but a decision about what a
 * second running instance of the app is allowed to delete. It is owed, and the
 * `docs/FEATURES.md` row carries it.
 */

/**
 * A directory path this module composed.
 *
 * Branded so the surface cannot be handed a path from anywhere else. The
 * failure it prevents is the one that matters here: `remove` deletes a
 * directory and everything under it, and a plain `string` parameter would let
 * any caller name any directory on the machine (B5).
 */
export type DirectoryPath = Brand<string, 'DirectoryPath'>;

/**
 * The name one session's directories sit under.
 *
 * Branded, and minted only by {@link sessionDirectoryName}, because it is
 * concatenated into a path. An unvalidated string here is a path traversal with
 * extra steps — and the value that reaches it is a session id, which under
 * Decision 10b is **minted by the host**, a process invariant 25 declares
 * hostile.
 */
export type SessionDirectoryName = Brand<string, 'SessionDirectoryName'>;

/** How long a session directory name may be. */
export const SESSION_DIRECTORY_NAME_MAX_CHARS = 64;

/**
 * Validates a session directory name.
 *
 * ## An allowlist, not a denylist, and the reason is invariant 23's
 *
 * The tempting shape is to reject `..` and the separators. That is a denylist
 * over a syntax with more spellings than anyone enumerates — `..`, `.`,
 * a trailing dot, a device name like `CON`, an alternate data stream after a
 * colon, a `~1` short name. Accepting only lower-case hex and hyphen makes
 * every one of them unrepresentable without naming any of them, which is the
 * same move invariant 23 makes for the banned symbol set.
 *
 * @param value A candidate name.
 * @returns The branded name, or why it was refused.
 */
export function sessionDirectoryName(value: string): Result<SessionDirectoryName, string> {
  if (value.length === 0 || value.length > SESSION_DIRECTORY_NAME_MAX_CHARS) {
    return err(
      `a session directory name must be 1 to ${String(SESSION_DIRECTORY_NAME_MAX_CHARS)} ` +
        `characters, received ${String(value.length)}`,
    );
  }
  if (!/^[0-9a-f-]+$/.test(value)) {
    return err(
      `a session directory name may contain only lower-case hex digits and hyphens, received ` +
        `${JSON.stringify(value)}. This value is concatenated into a path and is minted by the ` +
        'engine host, which invariant 25 declares hostile, so the accepted set is an allowlist.',
    );
  }
  return ok(value as SessionDirectoryName);
}

/** The two directories one session was handed. */
export interface SessionDirectories {
  /** Read-only to the host. Main writes the canonical image here. */
  readonly snapshot: DirectoryPath;
  /** Modify to the host. It writes serialised bytes here; main reads them. */
  readonly output: DirectoryPath;
}

/**
 * The platform calls this module makes.
 *
 * `create` reports its outcome as a value rather than throwing, for the reason
 * `PipeCreationSurface` does: these are foreign calls whose failure is an
 * outcome, and a surface that threw would put the cleanup for a half-created
 * pair in a `catch` block, which is where a leaked directory goes to live.
 */
export interface DirectoryCreationSurface {
  /**
   * `CreateDirectoryW` with a descriptor parsed from `sddl`.
   *
   * `exists` is separated from `refused` because only one of them is a
   * collision: a directory already at this path carries a DACL nobody in this
   * run wrote, so it must never be adopted.
   */
  readonly create: (path: DirectoryPath, sddl: string) => 'created' | 'exists' | 'refused';
  /** `RemoveDirectoryW`. Empty directories only — used to unwind a half-created pair. */
  readonly remove: (path: DirectoryPath) => boolean;
  /** Removes a directory and everything under it. */
  readonly removeTree: (path: DirectoryPath) => boolean;
  /**
   * The DIRECTORY names directly under a path, or `null` where it cannot look.
   *
   * `null` and the empty array are separated because they call for opposite
   * things: an empty root is a clean start, and a root that could not be read
   * is an unknown one — and a sweep that treated the second as the first would
   * report *nothing to remove* for the case it exists to catch.
   *
   * Names, not paths, so the caller composes with the same prefixes it creates
   * with and a listing cannot smuggle in a location.
   */
  readonly list: (path: string) => readonly string[] | null;
  /** `GetLastError`, read only to put a number in a diagnostic. */
  readonly lastError: () => number;
}

/** Why no pair was created. Every one of these leaves nothing behind. */
export interface SessionDirectoryFailure {
  readonly stage: 'snapshot' | 'output';
  readonly detail: string;
}

/**
 * The two fixed prefixes, so a caller cannot choose where the grant lands.
 *
 * They cannot collide: a name beginning `in-` is never one beginning `out-`,
 * whatever the session name is.
 */
const SNAPSHOT_PREFIX = 'in-';
const OUTPUT_PREFIX = 'out-';

/**
 * Where one session's directories sit, composed rather than supplied.
 *
 * ## FLAT, and it is the layout that was measured
 *
 * Both directories are siblings directly under `root`, with no granted
 * directory between them and it. That is the shape `lowboxSpike.mjs` read its
 * four verb-split rows against on 2026-08-25 — two `mkdtemp` siblings under
 * `%TEMP%`, each granted on its own — and it carries a fact worth stating,
 * because the obvious nested alternative would have depended on it silently:
 * the ancestors are granted **nothing**, and the contained host reads the
 * snapshot anyway. So traverse on the path above a handed directory is not
 * something this design has to buy.
 *
 * A nested `root\<name>\{in,out}` layout would have needed a grant on the
 * intermediate directory, and that grant is an inherited ACE arriving one level
 * above the two the whole split exists to keep apart.
 *
 * @param root The directory this app owns for engine sessions. It is granted
 *   nothing, exactly as `%TEMP%` was in the measurement.
 * @param name A validated session directory name.
 */
export function sessionDirectoryPaths(root: string, name: SessionDirectoryName): SessionDirectories {
  return {
    snapshot: `${root}\\${SNAPSHOT_PREFIX}${name}` as DirectoryPath,
    output: `${root}\\${OUTPUT_PREFIX}${name}` as DirectoryPath,
  };
}

/**
 * Creates one session's handed pair, each with its own protected DACL.
 *
 * `root` is not created here. It is this application's own session root, made
 * once at startup, and it is granted nothing — see {@link sessionDirectoryPaths}
 * for why that costs the host no access it needs.
 *
 * @param surface The platform calls, injected.
 * @param directories Where the pair goes — see {@link sessionDirectoryPaths}.
 * @param user This process's own user SID.
 * @param container The AppContainer's SID.
 * @returns The pair, or the stage that refused and why.
 */
export function createSessionDirectories(
  surface: DirectoryCreationSurface,
  directories: SessionDirectories,
  user: UserSid,
  container: ContainerSid,
): Result<SessionDirectories, SessionDirectoryFailure> {
  const snapshot = surface.create(directories.snapshot, handedDirectoryDacl(user, container, 'read'));
  if (snapshot !== 'created') {
    return err({
      stage: 'snapshot',
      detail: describe('snapshot', snapshot, surface.lastError()),
    });
  }

  const output = surface.create(directories.output, handedDirectoryDacl(user, container, 'modify'));
  if (output !== 'created') {
    // BOTH OR NEITHER. The snapshot directory is granted read to the host and
    // is about to receive the user's document; leaving it behind a failed
    // creation is the leak, not an untidiness.
    surface.remove(directories.snapshot);
    return err({ stage: 'output', detail: describe('output', output, surface.lastError()) });
  }

  return ok(directories);
}

function describe(which: string, outcome: 'exists' | 'refused', why: number): string {
  return outcome === 'exists'
    ? `the ${which} directory already exists, so it carries a DACL this run did not write. It is ` +
        'not adopted: a directory left by an earlier session may already be granted to a ' +
        'container, and reusing it would hand the host a grant nobody in this run made.'
    : `the ${which} directory could not be created (GetLastError ${String(why)}). Either the ` +
        'DACL did not parse — in which case nothing was created, because a descriptor that did ' +
        'not parse must not reach the create call — or the create itself was refused.';
}

/**
 * Removes one session's pair and the base directory above them.
 *
 * Called on close **and** on a failed open, because a snapshot directory that
 * outlives its session is a copy of the user's document sitting where the
 * contained host can read it.
 *
 * Recursive, and that is not laziness: the host holds modify on the output
 * directory and invariant 25 declares it hostile, so what it contains is not
 * limited to the one file this design asks for.
 *
 * @returns Which directories are gone. A caller that ignores a `false` is
 *   leaving a document behind, so the outcome is reported rather than thrown —
 *   a throw here would abort a close that has other work to finish.
 */
export function removeSessionDirectories(
  surface: DirectoryCreationSurface,
  directories: SessionDirectories,
): { readonly snapshot: boolean; readonly output: boolean } {
  const snapshot = surface.removeTree(directories.snapshot);
  const output = surface.removeTree(directories.output);
  return { snapshot, output };
}

/** What one sweep of the session root removed, and what it could not. */
export interface SessionSweep {
  /** Directory names removed. Empty when the root was clean. */
  readonly removed: readonly string[];
  /** Directory names that matched and survived `removeTree`. */
  readonly failed: readonly string[];
  /** Names left alone because this module could not have created them. */
  readonly skipped: readonly string[];
  /** `true` when the root could not be listed, which is not the same as clean. */
  readonly unreadable: boolean;
}

/**
 * Removes session directory pairs left behind by a previous run.
 *
 * ## What this is for
 *
 * A pair is removed on close and on every failure path out of an open, so the
 * only way one survives is a main process that died without unwinding — a
 * crash, a kill, a power loss. Nothing else ever swept them, so a machine
 * accumulated one granted pair per abnormal exit, each carrying a DACL naming
 * the AppContainer, for ever.
 *
 * ## Why this is safe HERE and was not safe where it would naturally have gone
 *
 * Deleting at startup is only sound while there is exactly one instance, and
 * `startShell` establishes that: it takes `requestSingleInstanceLock()` and
 * quits without one, so the holder owns every directory under the root. The
 * ordering is load-bearing rather than incidental — the platform used to be
 * built in `entry.ts` **before** `startShell` ran, so a second launch reached
 * this code inside the first instance's root before discovering it had to
 * quit. That is why `startShell` takes a factory: nothing that touches the
 * session root may be constructed before the lock.
 *
 * ## It can only delete what this module can create
 *
 * A name is swept only if it carries one of the two prefixes **and** the
 * remainder is a name {@link sessionDirectoryName} would mint. So a directory
 * this layout could not have produced is reported as skipped rather than
 * removed, and the negative-probe file in the same root is not a directory at
 * all. That is a shape restriction rather than a check someone has to
 * remember: widening what the sweep deletes means widening what a session may
 * be called.
 *
 * @param surface The platform calls, injected.
 * @param root The application's session root.
 */
export function sweepSessionDirectories(
  surface: DirectoryCreationSurface,
  root: string,
): SessionSweep {
  const entries = surface.list(root);
  if (entries === null) return { removed: [], failed: [], skipped: [], unreadable: true };

  const removed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    const prefix = entry.startsWith(SNAPSHOT_PREFIX)
      ? SNAPSHOT_PREFIX
      : entry.startsWith(OUTPUT_PREFIX)
        ? OUTPUT_PREFIX
        : null;
    if (prefix === null || !sessionDirectoryName(entry.slice(prefix.length)).ok) {
      skipped.push(entry);
      continue;
    }
    if (surface.removeTree(`${root}\\${entry}` as DirectoryPath)) removed.push(entry);
    else failed.push(entry);
  }

  return { removed, failed, skipped, unreadable: false };
}
