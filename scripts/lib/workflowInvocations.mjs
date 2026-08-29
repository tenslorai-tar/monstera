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

/** One repository script path, as it appears on a command line. */
const SCRIPT_PATH = String.raw`scripts\/[\w./-]+\.mjs`;

/**
 * `node` followed by a run of script paths and flags — the runner form.
 *
 * Every proof in `ci.yml` is invoked as `node scripts/ci/annotate.mjs
 * scripts/proofs/x.proof.mjs`, so the script that actually runs is an ARGUMENT
 * and {@link NODE_INVOCATION} captures only the wrapper. The trailing run stops
 * at the first token that is neither a script path nor a flag, which is what
 * keeps `node scripts/ci/annotate.mjs --always npm run x` from claiming `npm`.
 */
const NODE_RUN = new RegExp(
  String.raw`(?:^|[^\w-])node\s+(${SCRIPT_PATH}(?:\s+(?:${SCRIPT_PATH}|-{1,2}[\w-]+))*)`,
  'gu',
);

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
 * Every repository script a text RUNS — the wrapper and what it is given.
 *
 * ## Why this exists beside {@link invokedScriptPaths}
 *
 * That function answers *what did `node` start*, which is the question
 * `annotateCoverage.mjs` and the main-guard roster ask. This one answers *what
 * ends up running*, and the two differ for every proof in `ci.yml`, because the
 * proofs are invoked through `scripts/ci/annotate.mjs` and the proof's own path
 * is that wrapper's argument.
 *
 * ## What it is for, and the fail-open it closes (finding C1)
 *
 * `proofCoverage.mjs` asked whether a workflow runs each proof with
 * `workflows.includes(path)` — a raw substring test over the concatenated
 * workflow text. That is a **third opinion** about a question this module owns,
 * and it is the fail-open kind: `hashFiles('scripts/x.mjs')` names a script and
 * runs nothing, and two such lines already exist in `ci.yml`. A proof added to
 * a cache key — entirely plausible, since proofs read fixtures — would have
 * reported as covered while running nowhere, which is the exact defect
 * `proofCoverage.mjs` was written to catch, arriving through its own door.
 *
 * The rule is not *be careful with substring tests*; it is that a question with
 * an owner gets asked of the owner (B3a).
 *
 * @param {string} text a workflow file, or several joined
 * @returns {string[]} every script path that runs, wrappers included
 */
export function runScriptPaths(text) {
  const found = [...text.matchAll(NODE_RUN)].flatMap((match) =>
    (match[1] ?? '').split(/\s+/u).filter((token) => /^scripts\//u.test(token)),
  );
  return [...new Set(found)];
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
