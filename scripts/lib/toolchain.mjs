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
