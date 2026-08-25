// @ts-check
/**
 * How an `&&`-composed `package.json` script is read.
 *
 * One module because it is one question, and two files now need the answer:
 * `typecheck.mjs` and `lintcheck.mjs` both take a manifest script as the
 * authority for what their gate IS, and both have to know how many things it
 * asked for. Two implementations of that would be a second opinion about a
 * question one manifest already answers, which is B3a's shape and the reason
 * `check:types` was written to read the script rather than restate its flags.
 *
 * It is deliberately not a shell parser. `&&` inside quotes would be split
 * wrongly, and that is acceptable here for a stated reason: the callers require
 * every segment to be understood as an invocation of their own tool and refuse
 * to report when one is not, so a mis-split arrives as a refusal rather than as
 * a shorter gate.
 */

/**
 * The `&&`-separated segments of a command line.
 *
 * The COUNT is the load-bearing part, not the strings. A caller compares the
 * number of invocations it produced against this number, so a segment silently
 * dropped in parsing shows up as a mismatch instead of as a smaller gate — which
 * is the failure mode a check that reads its own authority is otherwise open to.
 *
 * @param {string} command
 * @returns {string[]}
 */
export function segmentsOf(command) {
  return command
    .split('&&')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}
