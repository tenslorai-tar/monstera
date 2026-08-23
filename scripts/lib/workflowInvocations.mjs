// @ts-check
/**
 * What counts as this repository invoking one of its own scripts with node
 * (finding AAAA-10).
 *
 * ## Why this exists
 *
 * Two modules each defined their own `NODE_INVOCATION`, and both were correct —
 * `annotateCoverage.mjs` captured the path with the `g` flag, and
 * `nodeModulesPlacement.mjs` merely tested with neither. That is B3a's shape in
 * its own words: **a partial reimplementation that agrees with the authority
 * most of the time.** A capture answers the test question for free, so there was
 * never a reason for two.
 *
 * The question has one owner now, and a third caller — the main-guard roster —
 * takes it rather than writing a third.
 *
 * ## FUNCTIONS, NOT THE PATTERN, and that is the substance
 *
 * A global regular expression carries `lastIndex` between calls, so
 * `pattern.test(line)` returns true and then false for the same input. The old
 * capturing copy already managed that by hand — `NODE_INVOCATION.lastIndex = 0`
 * before an `exec` — which is a hazard being remembered rather than removed.
 * Exporting predicates instead means no caller can hold the state, and the one
 * global form is built here from the one source.
 *
 * ## What is and is not an invocation
 *
 * `node scripts/x.mjs` is. `hashFiles('scripts/x.mjs')` is not — three lines in
 * `ci.yml` name a script in a cache key and run nothing. The leading
 * `(?:^|[^\w-])` is what keeps `some-node scripts/x.mjs` and `nodejs scripts/…`
 * out.
 *
 * Textual, deliberately: a YAML parser here would be a second opinion about a
 * structure three checks already read as text.
 */

/**
 * The one pattern. NOT exported — a caller holding it can hold `lastIndex` with
 * it, which is the defect the function API removes.
 */
const NODE_INVOCATION = /(?:^|[^\w-])node\s+(scripts\/[\w./-]+\.mjs)/u;

/**
 * Whether a line invokes a repository script with node.
 *
 * @param {string} text one line, or one npm command
 * @returns {boolean}
 */
export function invokesRepositoryScript(text) {
  return NODE_INVOCATION.test(text);
}

/**
 * Every repository script the text invokes with node, in order.
 *
 * The global form is built from {@link NODE_INVOCATION}'s own source rather than
 * written a second time, so the two cannot drift — which is the whole finding
 * one level down.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function invokedScriptPaths(text) {
  const all = new RegExp(NODE_INVOCATION.source, 'gu');
  return [...text.matchAll(all)].map((match) => match[1]).filter((path) => path !== undefined);
}

/**
 * The FIRST repository script the text invokes, or `null`.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function firstInvokedScriptPath(text) {
  return NODE_INVOCATION.exec(text)?.[1] ?? null;
}
