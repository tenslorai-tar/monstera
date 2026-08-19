// @ts-check
/**
 * The toolchain versions CI runs on, declared once.
 *
 * ## Why this file exists, measured rather than reasoned
 *
 * Both workflows said `node-version: 24`, which resolves to the newest 24.x at
 * the moment a job starts. So **the npm that validates this project's lockfile
 * changed without any commit**, and on 2026-08-19 it had diverged far enough
 * from a developer machine that the two disagreed about whether the lockfile was
 * valid at all:
 *
 * | npm      | `npm ci --dry-run` on the then-current lockfile          |
 * |----------|---------------------------------------------------------|
 * | 11.6.2   | exit 0, and it printed "added 217 packages" — it resolved an ideal tree rather than validating the recorded one |
 * | 11.17.0  | exit 1, `Missing: @emnapi/runtime@1.11.3 from lock file` |
 *
 * Both run against the same clean `git archive` export with no `node_modules`.
 * 11.6.2 ships with Node 24.12.0; 11.17.0 ships with Node 24.19.0, which is what
 * `node-version: 24` resolved to. The lockfile had been broken since
 * 2026-08-17 and every CI run since had failed at install, while the guard built
 * for exactly that class passed locally on every commit.
 *
 * Pinning does not fix the guard — that is a separate finding with its own
 * repair, because a guard whose answer depends on which npm happens to be
 * installed is measuring the machine, not the lockfile. What pinning fixes is
 * the *silence*: a toolchain change is now a commit somebody reviews, instead of
 * a Tuesday.
 *
 * ## Bumping these
 *
 * Research the version, never recall it: `https://nodejs.org/dist/index.json`
 * lists every release with the npm it bundles. Change both values together —
 * they are one fact about one runtime, and a Node pin whose npm is written down
 * from memory is the same failure one level down.
 */

/**
 * The exact Node the workflows install.
 *
 * Exact, not a major. A floating major means the runtime under every proof in
 * this repository can change between two runs of the same commit.
 */
/** @type {string} */
export const NODE_VERSION = '24.19.0';

/**
 * The npm that Node bundles, recorded because it is the part that matters here.
 *
 * Nothing installs this directly — it arrives with Node. It is written down so
 * that a lockfile guard, a contributor, or a future reader can compare against
 * what they have, and so that bumping Node without noticing what npm came with
 * it is visible in a diff.
 */
export const NPM_VERSION = '11.17.0';

/**
 * The oldest Node this repository claims to support, and now the oldest it
 * TESTS.
 *
 * `package.json`'s `engines.node` promised `>=22.19.0` while every CI job ran
 * 24.19.0, so the claim was made by a manifest and exercised by nothing — the
 * shape this project calls a finding everywhere else. One job runs the JS-only
 * half here: install, typecheck, lint, tests. No native build, because the shim
 * is a Windows toolchain matter and not what the floor claim is about.
 *
 * **Not narrowed to what was already tested**, deliberately. Raising `engines`
 * to 24 would shut out a contributor on Node 22 for no measured reason; the
 * honest close is to test the claim, not to shrink it until it is trivially
 * true. If the row is ever judged too expensive, narrow the claim in the same
 * commit that deletes it — what must not survive is a manifest promising a
 * version nothing runs.
 *
 * Kept in step with `engines.node` by `proof:toolchain`, so the two cannot
 * drift.
 *
 * Typed `string` rather than left as a literal, like its neighbours: a checker
 * comparing two of these constants is asking a question about what they hold
 * TODAY, and TypeScript narrowing them to literals answers it statically and
 * calls the comparison unintentional. The check exists precisely for the day
 * someone makes them equal.
 */
/** @type {string} */
export const NODE_FLOOR = '22.19.0';
