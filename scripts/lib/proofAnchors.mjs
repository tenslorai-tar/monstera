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

/** A file carries an anchor if it does one of these. */
const ANCHORS = [
  // `createRoster(failures, { cases: N })` — throws on a mismatch in `format`.
  /createRoster\s*\(/u,
  // A hand-written guard comparing a declared list's length against a literal,
  // which `shell.proof.mjs` uses and documents.
  /\.length\s*!==\s*\d+/u,
];

/**
 * Proofs with no anchor as of 2026-09-01, each owing one.
 *
 * Sorted, so an addition is a one-line diff and cannot hide in a reordering.
 * **Do not add to this list to make a new proof pass** — a proof written today
 * has `createRoster` available and no reason to be here.
 */
export const UNANCHORED = [
  'auditScope.proof.mjs',
  'boundaries.proof.mjs',
  'documentHandlers.proof.mjs',
  'documentScope.proof.mjs',
  'emittedTemplates.proof.mjs',
  'hookProbe.proof.mjs',
  'licenceProvenance.proof.mjs',
  'lintIgnores.proof.mjs',
  'lintRules.proof.mjs',
  'mainNeverCancels.proof.mjs',
  'memoryBudgets.proof.mjs',
  'nativeAddon.proof.mjs',
  'ocrDoors.proof.mjs',
  'pageGeometry.proof.mjs',
  'pathDispatch.proof.mjs',
  'peakRss.proof.mjs',
  'proseSweep.proof.mjs',
  'purgeCensus.proof.mjs',
  'shimReach.proof.mjs',
  'testResolution.proof.mjs',
  'threatModelTopics.proof.mjs',
  'toolchainPin.proof.mjs',
  'workflowPins.proof.mjs',
];

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
 * @param {ReadonlyArray<{ name: string, source: string }>} proofs
 * @returns {{ missing: string[], stale: string[], anchored: number }}
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
  const missing = [];
  const stale = [];
  let anchored = 0;

  for (const proof of proofs) {
    const has = hasAnchor(proof.source);
    if (has) anchored += 1;
    if (!has && !known.has(proof.name)) missing.push(proof.name);
    if (has && known.has(proof.name)) stale.push(proof.name);
  }

  return { missing: missing.sort(), stale: stale.sort(), anchored };
}
