// @ts-check
/**
 * Did a Win32 call that returns a HANDLE fail?
 *
 * ## Why this is a module and not four lines at each call site
 *
 * `INVALID_HANDLE_VALUE` is Win32's answer, not ours, and B3a says exactly one
 * module here implements an external authority's rule. Three research files had
 * each written their own version of it and **all three were wrong the same way**,
 * which is what a second opinion looks like when nobody has compared them
 * (finding TT-2).
 *
 * The measurement, taken against a path that certainly does not exist so that
 * `CreateFileW` can only return `INVALID_HANDLE_VALUE`:
 *
 * ```
 * handle typeof : bigint
 * address value : 18446744073709551615n
 * ```
 *
 * `koffi.address` returns a **BigInt**, and the failure is unsigned. So every
 * spelling those files used answers `false` for a handle that is invalid:
 *
 * | written as | why it misses |
 * |---|---|
 * | `address === -1n` | the value is unsigned; `18446744073709551615n !== -1n` |
 * | `address === -1` | a BigInt is never `===` a Number |
 * | `address === 0xffffffffffffffff` | same, and the literal is a Number that cannot hold it exactly |
 * | `!handle` | `18446744073709551615n` is truthy |
 *
 * **The branch was therefore unreachable, and its absence is invisible on the
 * success path** — which is the only path any of them had ever taken. The first
 * time a call was genuinely refused, the code carried on to `ReadFile` with an
 * invalid handle and reported `error 6` (`ERROR_INVALID_HANDLE`): a refusal
 * reported as the wrong call failing for the wrong reason, and indistinguishable
 * from a real `ERROR_INVALID_HANDLE`. The verdict happened to be right. The
 * evidence under it was not.
 *
 * ## The emitted copy is DERIVED, so it cannot drift
 *
 * Two of the three call sites live inside a `String.raw` template that runs in a
 * spawned child, which cannot import this module. {@link INVALID_HANDLE_SOURCE}
 * is `isInvalidHandle.toString()` — the same definition, rendered — rather than a
 * second copy maintained by hand. That is the whole point: a hand-kept duplicate
 * of an authority's rule is the shape this file exists to remove.
 *
 * **Consequence, and it is a constraint on the function below:** it must close
 * over nothing. No imports, no module constants, no helpers — anything it
 * referenced would be undefined in the child, where only its own text arrives.
 */

/**
 * True when `handle` is not a handle a caller may use.
 *
 * Both failure spellings are covered: `INVALID_HANDLE_VALUE` (all bits set, which
 * `BigInt.asIntN` reads back as -1) and NULL, which some Win32 calls return
 * instead — `CreateJobObjectW` and `OpenProcess` among them, so the two are not
 * interchangeable and the check takes both.
 *
 * MUST CLOSE OVER NOTHING: this function's source is emitted verbatim into
 * spawned children (see {@link INVALID_HANDLE_SOURCE}).
 *
 * @param {{ address: (handle: unknown) => unknown }} koffi the koffi module
 * @param {unknown} handle whatever the Win32 call returned
 * @returns {boolean}
 */
export function isInvalidHandle(koffi, handle) {
  if (handle === null || handle === undefined) return true;
  const address = koffi.address(handle);
  if (address === null || address === undefined) return true;
  const value = BigInt(/** @type {bigint | number | string} */ (address));
  return value === 0n || BigInt.asIntN(64, value) === -1n;
}

/**
 * The same definition as source, for embedding in a spawned child.
 *
 * Derived from the function rather than written out again, so the two cannot
 * disagree — there is only one of them.
 */
export const INVALID_HANDLE_SOURCE = isInvalidHandle.toString();
