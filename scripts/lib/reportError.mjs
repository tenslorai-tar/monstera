// @ts-check
/**
 * The one way a script renders a thrown value for a human.
 *
 * ## Why this exists, measured rather than reasoned
 *
 * Every top-level handler under `scripts/` printed
 * `error instanceof Error ? error.stack : String(error)`. **`Error.prototype.stack`
 * does not include `cause`**, so a chain deliberately attached at the throw site
 * is discarded at the last step — the one place it was going to be read.
 *
 * That is not a cosmetic loss. This is what reached CI when the Windows
 * provisioning proof went red:
 *
 * ```
 * Error: Could not publish gitleaks to D:\a\monstera\monstera\.tools\gitleaks\8.30.1
 *     at publish (…/gitleaks.mjs:268:13)
 *     at async provisionGitleaks (…/gitleaks.mjs:363:5)
 * ```
 *
 * The throw at `gitleaks.mjs:268` passes `{ cause }` holding the `rename` error,
 * and the errno in it IS the diagnosis: `EPERM`, `EACCES`, `EBUSY` and
 * `ENOTEMPTY` point at four different mechanisms — a handle held open by a
 * virus scanner, a permissions difference, a mapped executable, a destination
 * that was recreated underneath. The text above distinguishes none of them, so
 * a red board produced an hour of argument instead of a measurement.
 *
 * An instrument that cannot tell apart the things it exists to tell apart is
 * audit item 4a, and a reporter is an instrument.
 *
 * ## Why the errno fields are printed even though the message usually has them
 *
 * Node's `fs` errors put the code in the message (`ENOTEMPTY: directory not
 * empty, rename 'a' -> 'b'`), so `stack` alone would normally carry it. Errors
 * from other sources set `code` and write a prose message, and the two cases
 * are indistinguishable at the point of printing. Emitting the fields whenever
 * they exist makes the omission unrepresentable rather than checked for, at the
 * cost of one duplicated token in the common case.
 *
 * `packages/shared`'s `toStructuredError` already walks `cause` for the
 * renderer-facing path. This is its counterpart for `scripts/`, which is plain
 * `.mjs` and cannot import TypeScript.
 */

/**
 * Depth cap. A chain this long is a bug in the thrower, and printing without a
 * bound turns one into a hang.
 */
const MAX_LINKS = 8;

/**
 * Diagnostic fields carried beside the message. `path` and `dest` are the two
 * operands of a failed `rename`, which is the syscall this module was written
 * for: knowing WHICH of the two was unavailable is half the mechanism.
 */
const ERRNO_FIELDS = /** @type {const} */ (['code', 'errno', 'syscall', 'path', 'dest']);

/**
 * @param {Error} error
 * @returns {string} The diagnostic fields present on this error, or `''`.
 */
function errnoDetails(error) {
  // Errors carry these off-interface; reading them through an index signature
  // says so rather than pretending the declaration has them.
  const carrier = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error));
  /** @type {string[]} */
  const present = [];
  for (const name of ERRNO_FIELDS) {
    const value = carrier[name];
    if (typeof value === 'string' || typeof value === 'number') {
      present.push(`${name}=${String(value)}`);
    }
  }
  return present.join(' ');
}

/**
 * Renders one link of the chain.
 *
 * A thrown value need not be an Error — a string, a number and `null` are all
 * legal throws — so the non-Error case is normalised rather than assumed away.
 * An Error with no `stack` is possible too (a cross-realm object, a subclass
 * that deletes it), which is why the name/message fallback is real.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (!(value instanceof Error)) return String(value);
  const base = value.stack ?? `${value.name}: ${value.message}`;
  const details = errnoDetails(value);
  return details === '' ? base : `${base}\n    ${details}`;
}

/**
 * Renders a thrown value and every `cause` beneath it.
 *
 * @param {unknown} thrown
 * @returns {string}
 */
export function formatError(thrown) {
  /** @type {string[]} */
  const links = [];
  /** @type {Set<unknown>} */
  const seen = new Set();
  /** @type {unknown} */
  let current = thrown;

  for (;;) {
    // A cycle is reachable — `error.cause = error` is legal — and an unbounded
    // walk over one never returns. Reporting it is better than the depth cap
    // catching it, because the two have different repairs.
    if (current instanceof Error && seen.has(current)) {
      links.push('Caused by: (cycle — an error in this chain is its own cause)');
      break;
    }
    if (current instanceof Error) seen.add(current);

    links.push(links.length === 0 ? describe(current) : `Caused by: ${describe(current)}`);

    if (!(current instanceof Error) || current.cause === undefined) break;
    if (links.length >= MAX_LINKS) {
      links.push(`Caused by: (chain truncated at ${MAX_LINKS} links)`);
      break;
    }
    current = current.cause;
  }

  return links.join('\n');
}
