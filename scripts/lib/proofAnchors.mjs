// @ts-check
/**
 * Every proof declares how many cases it has, or is named here as not doing so.
 *
 * ## The failure this exists for, and it is not hypothetical
 *
 * A proof that prints `${passed.length}` reports a total derived from the cases
 * that ran. A count computed from a collection cannot disagree with that
 * collection, so a case that stops being generated takes its line and the total
 * with it and the run stays green — item 4c's *"derive from a set only when the
 * failure you fear makes that set BIGGER"*, with the danger running the other
 * way.
 *
 * **Measured 2026-09-01 (finding YYYYY-1).** ADR-0033 withdrew a budget's
 * multiple; the skip written for it was a `continue` at the top of a five-case
 * loop, so the baseline pair and the absolute ceiling went too — for the one
 * process that parses hostile documents. `proof:perfbudget` went from 29 cases
 * to 26 and reported success, on both matrix legs, and would have gone on
 * reporting it.
 *
 * The audit that recorded YYYYY-1 said *"nothing can"* catch this. Something
 * can: `passRoster` throws when the recorded total disagrees with a declared
 * one, and 47 of 71 proofs already carry it. What was missing is any way to see
 * which proofs do not.
 *
 * ## An allowlist, and it is the RIGHT direction here
 *
 * The failure to fear is a **new** proof arriving with no anchor, which makes
 * the set bigger — so a hand-kept list fails loudly on exactly the change that
 * matters, and agreeing with a shrink is what it is supposed to do. That is the
 * inverse of the trap above, and it is why this is a list rather than a
 * derivation.
 *
 * **Every entry is a debt, not an exemption.** They are proofs written before
 * the anchor existed, and the list is expected to shrink; a proof that leaves it
 * never comes back, because removing an anchor makes this check red.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A file carries an anchor if it does one of these. */
const ANCHORS = [
  // `createRoster(failures, { cases: N })` — throws on a mismatch in `format`.
  /createRoster\s*\(/u,
  // A hand-written guard comparing a declared list's length against a literal,
  // which `shell.proof.mjs` uses and documents.
  /\.length\s*!==\s*\d+/u,
];

/**
 * Proofs with no anchor, each owing one. **Repo-relative paths since
 * 2026-09-09**, because the set stopped being one directory.
 *
 * Sorted, so an addition is a one-line diff and cannot hide in a reordering.
 * **Do not add to this list to make a new proof pass** — a proof written today
 * has `createRoster` available and no reason to be here.
 *
 * ## The fourteen that arrived without moving (finding CCCCCC-1, 2026-09-09)
 *
 * This list held 23 bare filenames, all of them in `scripts/proofs/`, because
 * the check walked that one directory. **Eleven `proof:*` npm scripts run
 * `scripts/research/…` and fourteen research instruments are `ci.yml` steps**,
 * and none of them was ever asked. Nor were `proof:guards`' four components,
 * `proof:escapeguard`, `proof:secretscan` or the six other proofs under
 * `scripts/hooks/` and `scripts/lib/`.
 *
 * ZZZZZ-4 named this axis on 2026-09-01 — *the anchor check's ROOT is
 * `scripts/proofs/`, and the class it guards lives in 32 `.test.ts` files as
 * well* — and enumerated one of the two excluded sets. The ruling it made about
 * `.test.ts` is right and stands: a vitest file's cases are `it()` blocks no
 * roster sees, so the honest anchor there is a pinned suite total, a different
 * mechanism. **None of that is true of the files below.** They are `.mjs` that
 * count their own cases, the remedy is `createRoster`, and the eight research
 * instruments not on this list already use it — by habit, in the one place the
 * check could not look.
 *
 * The load-bearing one was `blockEscapeResolvingWrites.proof.mjs`. It printed
 * `${passed.length} escape-guard cases passed` — a total derived from what ran
 * — and its cases are **generated from the rule table**, so a rule leaving that
 * table took its cases and the total with it. That is YYYYY-1's exact shape on
 * the guard `CLAUDE.md` calls the mechanism, and it was named here as the first
 * entry to pay.
 *
 * **PAID 2026-09-11.** It takes `createRoster` with a literal **304**, measured
 * by running it, and is off this list. Adding a rule is now a two-line diff and
 * removing one is a red check. The entries that remain are the ones nothing has
 * claimed yet; the list is shorter by the only one it called load-bearing.
 */
export const UNANCHORED = [
  'scripts/bootstrapHooks.proof.mjs',
  'scripts/hooks/guardFiles.proof.mjs',
  'scripts/hooks/preCommit.proof.mjs',
  'scripts/lib/hookIntegrity.proof.mjs',
  'scripts/lib/scannerCanary.proof.mjs',
  'scripts/lib/secretScan.proof.mjs',
  'scripts/lib/shimBinary.proof.mjs',
  'scripts/lib/verdict.proof.mjs',
  'scripts/lib/withdrawnPhrases.proof.mjs',
  'scripts/proofs/auditScope.proof.mjs',
  'scripts/proofs/boundaries.proof.mjs',
  'scripts/proofs/documentHandlers.proof.mjs',
  'scripts/proofs/documentScope.proof.mjs',
  'scripts/proofs/emittedTemplates.proof.mjs',
  'scripts/proofs/hookProbe.proof.mjs',
  'scripts/proofs/licenceProvenance.proof.mjs',
  'scripts/proofs/lintIgnores.proof.mjs',
  'scripts/proofs/lintRules.proof.mjs',
  'scripts/proofs/mainNeverCancels.proof.mjs',
  'scripts/proofs/memoryBudgets.proof.mjs',
  'scripts/proofs/nativeAddon.proof.mjs',
  'scripts/proofs/ocrDoors.proof.mjs',
  'scripts/proofs/pageGeometry.proof.mjs',
  'scripts/proofs/pathDispatch.proof.mjs',
  'scripts/proofs/peakRss.proof.mjs',
  'scripts/proofs/proseSweep.proof.mjs',
  'scripts/proofs/purgeCensus.proof.mjs',
  'scripts/proofs/shimReach.proof.mjs',
  'scripts/proofs/testResolution.proof.mjs',
  'scripts/proofs/threatModelTopics.proof.mjs',
  'scripts/proofs/toolchainPin.proof.mjs',
  'scripts/proofs/workflowPins.proof.mjs',
  'scripts/research/engineSurface.mjs',
  'scripts/research/lineAgreement.mjs',
  'scripts/research/textLayerBounds.mjs',
  'scripts/spike/engineSpike.mjs',
];

/**
 * Every file this repository calls a proof, as repo-relative paths.
 *
 * ## The authority is `package.json`, and the directory is the belt beside it
 *
 * A `proof:*` script is what makes a file a proof here — `proof:guards` names
 * four of them in one command, `proof:hostcontainment` names
 * `scripts/research/lowboxSpike.mjs`, and `proof:shim` names one under
 * `scripts/provision/`. Deriving from the script table is what makes the set
 * the class rather than a directory.
 *
 * The `scripts/proofs/` walk is **unioned in** rather than replaced, because
 * the two fail in opposite directions: a proof that loses its npm script would
 * leave a derived-from-scripts set silently, and a proof written outside that
 * directory is invisible to the walk. Neither alone can only grow.
 *
 * @param {string} repoRoot
 * @param {{ readdir?: typeof readdirSync, readFile?: typeof readFileSync }} [io]
 * @returns {string[]} sorted, `/`-separated
 */
export function proofFiles(repoRoot, io = {}) {
  const readdir = io.readdir ?? readdirSync;
  const readFile = io.readFile ?? readFileSync;

  /** @type {Record<string, string>} */
  const scripts = JSON.parse(readFile(join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};
  /** @type {Set<string>} */
  const named = new Set();
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('proof:')) continue;
    for (const path of command.match(/scripts\/[A-Za-z0-9/._-]+\.mjs/gu) ?? []) named.add(path);
  }

  for (const entry of readdir(join(repoRoot, 'scripts', 'proofs'))) {
    if (entry.endsWith('.proof.mjs')) named.add(`scripts/proofs/${entry}`);
  }

  // AN EMPTY SET IS A BROKEN WALK, not a repository with no proofs — and it
  // would report no missing anchors and no stale entries, which is this
  // check's own reassuring answer. `classifyProofs` refuses one too; this
  // refuses earlier, where the cause is legible.
  if (named.size === 0) {
    throw new Error(
      'No proof files were derived from package.json or scripts/proofs. An empty set answers ' +
        'every question this check asks with the result it is hoping for, so it is refused.',
    );
  }
  return [...named].sort();
}

/**
 * Whether one proof's source carries an anchor.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function hasAnchor(source) {
  return ANCHORS.some((pattern) => pattern.test(source));
}

/**
 * Which proofs are anchored, which are not, and which of the unanchored have
 * since gained one.
 *
 * **The third list is why this is not just a scan.** A proof that gains an
 * anchor and stays on the list leaves the list looking like a debt that never
 * shrinks, and the next reader has no way to tell a stale entry from a real
 * one — so a stale entry is reported, and removing it is the only way past.
 *
 * **And the fourth is the same argument in the direction the walk cannot see**
 * (finding ZZZZZ-3, 2026-09-01). An entry naming a file that no longer exists
 * matches nothing in the loop, because the loop walks the proofs that are
 * there — so it was neither `missing` nor `stale`, and persisted while the
 * printed total went on counting it. Latent when found: all 23 named files
 * existed. The shrink direction always needs the other set (item 4c).
 *
 * @param {ReadonlyArray<{ name: string, source: string }>} proofs
 * @returns {{ missing: string[], stale: string[], gone: string[], anchored: number }}
 */
export function classifyProofs(proofs) {
  if (proofs.length === 0) {
    // An empty input is a broken walk, not a clean repository. It would report
    // no missing anchors and no stale entries, which is this check's own
    // reassuring answer.
    throw new Error(
      'proofAnchors was given no proofs. An empty set reports a clean result for every ' +
        'question this asks, so it is refused rather than answered.',
    );
  }

  const known = new Set(UNANCHORED);
  const present = new Set(proofs.map((proof) => proof.name));
  const missing = [];
  const stale = [];
  let anchored = 0;

  for (const proof of proofs) {
    const has = hasAnchor(proof.source);
    if (has) anchored += 1;
    if (!has && !known.has(proof.name)) missing.push(proof.name);
    if (has && known.has(proof.name)) stale.push(proof.name);
  }

  // AN ENTRY WHOSE FILE IS GONE MATCHES NOTHING ABOVE, so without this it is
  // neither `missing` nor `stale` — it simply persists, and the printed total
  // keeps counting it. Finding ZZZZZ-3, and it is this list's own stated
  // failure one axis along: an entry kept after it is paid stops being a debt
  // and becomes furniture, and so does one kept after its subject is deleted.
  //
  // The loop above cannot see it, because it walks the proofs that EXIST. The
  // shrink direction always needs the other set (item 4c).
  const gone = [...known].filter((name) => !present.has(name));

  return { missing: missing.sort(), stale: stale.sort(), gone: gone.sort(), anchored };
}
