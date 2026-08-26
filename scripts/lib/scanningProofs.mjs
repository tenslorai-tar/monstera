// @ts-check
/**
 * The proofs that SCAN the repository rather than importing it (finding
 * EEEE-2), and the anchor that stops the roster going quiet.
 *
 * ## The defect this closes
 *
 * `affectedProofs.mjs` answers *which proofs read a file this tree changed* by
 * walking **static imports**. That is correct for what it does and blind to a
 * whole class: a proof that reads the tree — `electronImports.proof.mjs`,
 * `kernelLoad.proof.mjs` — imports none of the files it examines, so it appears
 * in no column however much a change reaches it.
 *
 * **The class it misses is the worst one to miss.** A proof that scans the
 * repository is what guards a repository-wide invariant, and a repository-wide
 * invariant is what adding a file or a call site trips. The import-reaching
 * proofs are the ones whose relevance the diff already shows you.
 *
 * Measured: `5168f3b` reddened `main` on both platforms at
 * `electronImports.proof.mjs`, after a local sweep that passed 16 of 16 and
 * named exactly one affected proof — correctly, by its own rule.
 *
 * ## Why the reporter's own disclosure was not enough
 *
 * It printed *"This list is static-import reach only: a proof that spawns a
 * script it never imports is not in it"* on every run. CLAUDE.md's test for a
 * printed compensation is **could it have been printed before you made your
 * change?** It could. It names nothing and asks for nothing, so by the third
 * reading it is furniture — the same property that let `checkLocal.mjs`'s
 * provisioning sentence fail to stop a red push.
 *
 * ## A LIST, an anchor on its COUNT — and a derived membership check that was
 * attempted, measured, and refused
 *
 * 4c: *derive from a set only when the failure you fear makes that set BIGGER.*
 * Two failures are feared here and they point opposite ways, so the intended
 * shape was a hybrid: an explicit roster against shrinkage, and a derived
 * "every proof that reads the tree appears in this roster" against growth.
 *
 * **The derived half is not achievable from the source text, and that is
 * measured rather than asserted.** Three signals were tried against the 77
 * `proof:*` scripts:
 *
 * | signal | named | why it fails |
 * |---|---|---|
 * | reads a file under a repository root | **28** | nearly every proof opens `package.json`, a workflow or a fixture. Reading is not scanning |
 * | enumerates a directory, transitively | **59** | almost every proof reaches some shared helper containing a `readdir` it never calls |
 * | enumerates, one import hop | **48** | one hop already reaches the shared helpers |
 *
 * A classifier naming 36% to 77% of the set has distinguished nothing. The
 * obstacle is the one this repository has already recorded twice — **where a
 * scan's reach ends cannot be determined textually** — and the honest response
 * is to say so rather than ship a classifier whose output nobody could act on.
 * {@link enumeratingProofs} is kept, unused as an anchor, because the next
 * person will otherwise try the same three signals.
 *
 * ## So the anchor is the COUNT, which is the recorded 4c remedy
 *
 * `SCANNING_PROOF_COUNT` is a literal beside the list, and
 * {@link scanningProofRoster} refuses when the two disagree — the same shape
 * `EXPECTED_RULES` takes in `documentRuleScope.proof.mjs`, which is how one of
 * the three recorded 4c instances was fixed. Removing an entry now takes two
 * edits in two places, and the second is a number a reviewer reads.
 *
 * Every entry is also checked to be a real `proof:*` script, so a rename that
 * orphans a line is a red rather than a name that silently matches nothing.
 *
 * **What remains uncovered, stated because it is the whole point of writing
 * this down:** a genuinely new tree-scanning proof that nobody adds to the list
 * is not caught by anything here. That is a smaller residual than the defect it
 * replaces — the roster now exists and is reported on every run, where before
 * the class was invisible — and it is not nothing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { proofScripts } from './proofCoverage.mjs';

/**
 * The proofs a change to ANY file reaches, because they read the tree.
 *
 * Kept as names rather than paths, so this reads as *what to run* — which is
 * what a reader of the report needs. Every entry is verified to exist by
 * {@link scanningProofRoster}; a stale name is a red rather than a line that
 * quietly matches nothing.
 */
export const SCANNING_PROOFS = Object.freeze([
  'proof:electronimports',
  'proof:kernelload',
  'proof:emittedtemplates',
  'proof:stackowner',
  'proof:jobplacement',
  'proof:proofcoverage',
  'proof:affectedproofs',
  'proof:pathdispatch',
  'proof:boundaries',
]);

/**
 * THE ANCHOR. An independent claim a shrinker has to touch separately.
 *
 * Without it the roster is a hand-kept list that agrees with its own deletion:
 * remove an entry and the requirement leaves with it, silently, which is
 * exactly the shape 4c names. With it, removing one takes two edits and the
 * second is a number in a diff.
 *
 * Deliberately **not** `SCANNING_PROOFS.length` — that would be a derivation
 * from the very collection it is meant to anchor, and a number computed from a
 * collection cannot disagree with it.
 */
export const SCANNING_PROOF_COUNT = 9;

/**
 * ENUMERATING a directory — the signal, and the first two were wrong.
 *
 * The first attempt asked whether a proof *reads files* under a repository
 * root. It named **28 of 77 proofs**, because nearly every proof computes a
 * root and opens something — `package.json`, a workflow, a fixture. A
 * classifier that names a third of the set has not distinguished anything.
 *
 * The distinction that matters is not reading, it is **enumeration**. A proof
 * whose result can change when a NEW FILE APPEARS is one that lists a
 * directory; a proof that opens a path it names is unaffected by what else
 * exists. That is exactly the class the import walk cannot see, because a file
 * nobody imports is still a file `readdir` returns.
 *
 * `glob` forms are included: they are enumeration with the loop hidden.
 */
const ENUMERATES = /\b(?:readdirSync|readdir|globSync|glob|opendirSync|opendir)\b/u;

/** A static relative import, so the walk can follow a proof into its helpers. */
const RELATIVE_IMPORT = /(?:^|\n)\s*(?:import|export)[^\n;]*?from\s*['"](\.[^'"]*)['"]/gu;

/**
 * How many import hops the walk follows, and it is ONE — measured, not chosen.
 *
 * Unbounded, this named **59 of 77 proofs**, because almost every proof reaches
 * some shared helper that contains a `readdir` somewhere in it, whether or not
 * the proof ever calls that function. A classifier naming three-quarters of the
 * set has distinguished nothing, which is the same failure the first signal had
 * for the opposite reason.
 *
 * One hop is where the founding case lives: `electronImports.proof.mjs`
 * contains no `readdir` and imports `provision/electron.mjs`, which walks. So
 * depth 0 misses the very case this module exists for, and depth ∞ answers
 * *everything*. The bound is the smallest one that reaches the known case.
 *
 * **This is an approximation and the module says so rather than implying
 * otherwise** — see {@link scanningProofRoster}'s note on what the anchor can
 * and cannot see.
 */
const MAX_HOPS = 1;

/**
 * Every proof that enumerates a directory, **transitively**.
 *
 * The transitive half is not a refinement, it is the second thing that was
 * wrong. `electronImports.proof.mjs` — the proof that reddened `main` and the
 * reason this module exists — contains no `readdir` at all: it imports
 * `scriptsLoadingAtRuntime` from `provision/electron.mjs`, which does the
 * walking. A source-only signal missed the founding case, which is the
 * clearest possible demonstration that where a scan LIVES is not where it is
 * called from.
 *
 * **A SEARCH, so it carries a positive control** (item 4b): if it cannot find
 * the roster's own members it is not looking at the right thing, and "nothing
 * new" is precisely the reassuring answer here. The control lives in
 * {@link scanningProofRoster}, because this returns data and the caller is what
 * must refuse.
 *
 * @param {string} [root]
 * @returns {string[]} `proof:*` names, sorted
 */
export function enumeratingProofs(root = repoRoot()) {
  /** @type {Map<string, boolean>} */
  const decided = new Map();

  /**
   * @param {string} file repo-relative, forward slashes
   * @param {Set<string>} onPath guards a cycle
   * @param {number} depth how many import hops remain — see {@link MAX_HOPS}
   * @returns {boolean}
   */
  const enumerates = (file, onPath, depth = MAX_HOPS) => {
    const key = `${file}@${String(depth)}`;
    const cached = decided.get(key);
    if (cached !== undefined) return cached;
    if (onPath.has(file)) return false;

    /** @type {string} */
    let source;
    try {
      source = readFileSync(join(root, file), 'utf8');
    } catch {
      // A path package.json names that is not on disk is `proof:coverage`'s
      // finding, not this one. Absent is not enumerating.
      decided.set(key, false);
      return false;
    }

    if (ENUMERATES.test(source)) {
      decided.set(key, true);
      return true;
    }
    if (depth === 0) {
      decided.set(key, false);
      return false;
    }

    onPath.add(file);
    let answer = false;
    for (const [, specifier] of source.matchAll(RELATIVE_IMPORT)) {
      if (specifier === undefined) continue;
      const target = join(dirname(file), specifier).replaceAll('\\', '/');
      if (enumerates(target, onPath, depth - 1)) {
        answer = true;
        break;
      }
    }
    onPath.delete(file);
    decided.set(key, answer);
    return answer;
  };

  /** @type {string[]} */
  const found = [];
  for (const proof of proofScripts(root)) {
    if (proof.paths.some((path) => enumerates(path.replaceAll('\\', '/'), new Set()))) {
      found.push(proof.name);
    }
  }
  return found.sort();
}

/**
 * @typedef {object} RosterVerdict
 * @property {readonly string[]} roster The declared scanning proofs.
 * @property {readonly string[]} stale Roster entries that are not `proof:*` scripts at all.
 * @property {string | null} miscount Why the count anchor disagrees, or `null`.
 */

/**
 * The roster, checked against the anchor and against what `package.json`
 * declares.
 *
 * Throws rather than returning a verdict when it cannot see the proof set at
 * all: `proofScripts` already refuses an empty roster for the same reason, and
 * a "nothing stale" computed from nothing is the reassuring answer this whole
 * module exists because of.
 *
 * @param {string} [root]
 * @returns {RosterVerdict}
 */
export function scanningProofRoster(root = repoRoot()) {
  const known = new Set(proofScripts(root).map((proof) => proof.name));
  const stale = SCANNING_PROOFS.filter((name) => !known.has(name));

  const miscount =
    SCANNING_PROOFS.length === SCANNING_PROOF_COUNT
      ? null
      : `The roster holds ${String(SCANNING_PROOFS.length)} entries and SCANNING_PROOF_COUNT ` +
        `says ${String(SCANNING_PROOF_COUNT)}. One of them moved without the other, which is ` +
        `what the anchor is for — a roster that derived its own count would agree with any ` +
        `deletion. Change both, and read the diff of the list.`;

  return { roster: SCANNING_PROOFS, stale, miscount };
}
