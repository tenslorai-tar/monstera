// @ts-check
/**
 * Which tracked files are git hooks, and the one mode git will run them at.
 *
 * Git consults a hook only when the file is executable. On Linux and macOS a
 * hook without the bit is skipped with `hint: The '.githooks/pre-push' hook was
 * ignored because it's not set as executable`, and the commit or push goes
 * ahead unchecked. Git for Windows does not consult the bit, so the same hook
 * runs there. Observed 2026-10-01 in a Linux cloud session pushing
 * `work/cloud-rate-us`: `.githooks/pre-push` was tracked as 100644 (read with
 * `git ls-files -s .githooks`), so the typecheck gate existed on Windows and
 * was absent everywhere else while reading as present on all.
 *
 * The mode that reaches a fresh checkout is the one the INDEX records, never the
 * one on whichever disk the hook was written from, so the rule is stated about
 * an index mode. A checkout writes 100755 entries executable; a 100644 entry
 * stays unexecutable however carefully a contributor's own copy was chmodded.
 *
 * Three callers take this rather than spelling it: `guardFiles.mjs` refuses a
 * staged or tracked hook at any other mode, `bootstrapHooks.mjs` refuses to
 * report hooks enabled when one on disk cannot be executed, and
 * `bootstrapHooks.proof.mjs` checks this repository's index against it.
 */

/** The directory `core.hooksPath` points at. */
export const HOOKS_DIRECTORY = '.githooks';

/** The only index mode at which a checkout produces a file git will run. */
export const EXECUTABLE_MODE = '100755';

/**
 * Whether a repository-relative path is a hook git would look up.
 *
 * Direct children only: git resolves `<hooksPath>/<hook-name>`, so a file in a
 * subdirectory is never run and holds it to no mode.
 *
 * @param {string} path Forward-slash, relative to the repository root.
 * @returns {boolean}
 */
export function isHookPath(path) {
  const prefix = `${HOOKS_DIRECTORY}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes('/');
}

/**
 * Why a tracked entry is a hook git will not run, or `null` when it will.
 *
 * @param {string} path
 * @param {string} mode The six-digit octal mode git records, e.g. `100644`.
 * @returns {string | null}
 */
export function hookModeViolation(path, mode) {
  if (!isHookPath(path) || mode === EXECUTABLE_MODE) return null;
  return (
    `is a git hook tracked with mode ${mode}, and git runs a hook only when it is executable ` +
    `(${EXECUTABLE_MODE}). On Linux and macOS git prints "hint: ... was ignored because it's not ` +
    `set as executable" and the commit or push proceeds with this hook not executed; Git for ` +
    `Windows does not consult the bit, so the hook runs there and the gap cannot be seen from ` +
    `Windows at all. Repair the index rather than the disk: ` +
    `git update-index --chmod=+x -- ${path}`
  );
}
