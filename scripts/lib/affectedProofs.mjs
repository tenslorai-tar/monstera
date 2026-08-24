// @ts-check
/**
 * Which proofs read a file you just changed (finding AAAA-16).
 *
 * ## The disclaimer that failed
 *
 * `checkLocal.mjs` ends by saying that its set "cannot see a provisioning-keyed
 * branch or a proof registered only in a workflow". That sentence is true, it is
 * printed at the point of use, and on 2026-08-24 it did not stop me pushing a
 * change that reddened `main` — the break was in `preCommit.proof.mjs`, inside
 * `npm run proof:guards`, and thirteen green checks read as clearance.
 *
 * **So AA-1's dividing line is necessary and not sufficient.** *Printed at the
 * point of use* is not what makes a compensation a mechanism; the property that
 * separates them is whether it is **specific**. That sentence is true on every
 * run, names nothing and asks for nothing, so by the third reading it is
 * furniture. Three proof names is an instruction.
 *
 * ## What this does, and what it deliberately does not
 *
 * Given the paths a working tree changed, it reports the `proof:*` scripts that
 * transitively import any of them. **It names them; it does not run them** —
 * `npm run local` refuses more than one `proof:*` in a run while WWW-2's 0.0s
 * wreckage is unexplained, so running them is what closes this and naming them
 * is what is available while that refusal stands. The FEATURES row carries that
 * dependency, because a debt with a named consequence gets paid and one without
 * gets carried.
 *
 * ## The control, and why an empty answer is the dangerous one
 *
 * This is a search whose reassuring answer is "no proofs affected", and every
 * way of breaking it produces that: an unresolvable specifier, a root that finds
 * no files, a changed-path spelling the graph does not use. So the graph must
 * contain {@link CONTROL_EDGE} on every run or this refuses to answer, and an
 * empty module graph throws rather than returning an empty list.
 *
 * The graph is textual and reaches only static relative imports between
 * `scripts/**` modules. A proof that shells out to a script it never imports is
 * invisible here, which is a stated limit rather than a silent one — the report
 * prints it whenever it names anything.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { proofScripts } from './proofCoverage.mjs';

/**
 * An import edge that must exist, or this instrument has not looked.
 *
 * Chosen because both ends are load-bearing and neither is going anywhere: the
 * hook-probe proof cannot test the record without importing the module that
 * defines it.
 */
export const CONTROL_EDGE = {
  from: 'scripts/proofs/hookProbe.proof.mjs',
  to: 'scripts/lib/hookProbe.mjs',
};

/** A static relative import specifier. */
const RELATIVE_IMPORT = /(?:^|\n)\s*(?:import|export)[^\n;]*?from\s*['"](\.[^'"]*)['"]/gu;

/**
 * Every `scripts/**` module, repo-relative with forward slashes.
 *
 * @param {string} root
 * @returns {string[]}
 */
function moduleFiles(root) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.mjs')) found.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  walk(join(root, 'scripts'));
  if (found.length === 0) {
    throw new Error(
      'No .mjs modules found under scripts/. An empty file set is a broken walk, not an answer — ' +
        'every query against the resulting graph would report nothing affected.',
    );
  }
  return found;
}

/**
 * Who imports whom, as repo-relative paths.
 *
 * @param {string} [root]
 * @returns {Map<string, Set<string>>} importer -> imported
 */
export function importGraph(root = repoRoot()) {
  /** @type {Map<string, Set<string>>} */
  const graph = new Map();
  const files = moduleFiles(root);
  const known = new Set(files);

  for (const file of files) {
    /** @type {Set<string>} */
    const imports = new Set();
    const text = readFileSync(join(root, file), 'utf8');
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = relative(root, resolve(join(root, dirname(file)), specifier)).replaceAll('\\', '/');
      // Only edges to modules that exist. An unresolvable specifier is a
      // typo or a package import, and inventing a node for it would put
      // unreachable names in the graph.
      if (known.has(resolved)) imports.add(resolved);
    }
    graph.set(file, imports);
  }

  const control = graph.get(CONTROL_EDGE.from);
  if (control === undefined || !control.has(CONTROL_EDGE.to)) {
    throw new Error(
      `The import graph does not carry ${CONTROL_EDGE.from} -> ${CONTROL_EDGE.to}, so it cannot ` +
        `tell "nothing was affected" from "this stopped being able to read imports". Every query ` +
        `against it would report the reassuring answer.`,
    );
  }

  return graph;
}

/**
 * @typedef {object} Affected
 * @property {readonly { name: string, paths: string[] }[]} proofs the proofs that read a changed file
 * @property {number} examined how many proof scripts were considered
 * @property {readonly string[]} changed the paths this was asked about
 */

/**
 * The proofs that transitively read any of `changed`.
 *
 * @param {readonly string[]} changed repo-relative paths, forward slashes
 * @param {{ root?: string }} [options]
 * @returns {Affected}
 */
export function affectedProofs(changed, options = {}) {
  const root = options.root ?? repoRoot();
  const graph = importGraph(root);
  const proofs = proofScripts(root);
  const targets = new Set(changed.map((path) => path.replaceAll('\\', '/')));

  /** @type {Map<string, boolean>} */
  const reaches = new Map();
  /**
   * @param {string} file
   * @param {Set<string>} onPath guards a cycle; two modules importing each other
   *   would otherwise recurse forever, and the graph is not known to be acyclic.
   * @returns {boolean}
   */
  const reachesChanged = (file, onPath) => {
    if (targets.has(file)) return true;
    const cached = reaches.get(file);
    if (cached !== undefined) return cached;
    if (onPath.has(file)) return false;
    onPath.add(file);
    let answer = false;
    for (const imported of graph.get(file) ?? []) {
      if (reachesChanged(imported, onPath)) {
        answer = true;
        break;
      }
    }
    onPath.delete(file);
    reaches.set(file, answer);
    return answer;
  };

  return {
    // ANY of the chained scripts reaching a changed file names the whole entry,
    // because `npm run proof:guards` runs all four and there is no way to run
    // one. Asking only about the head is what made this instrument miss the
    // change it was built for.
    proofs: proofs.filter((proof) => proof.paths.some((path) => reachesChanged(path, new Set()))),
    examined: proofs.length,
    changed: [...targets],
  };
}

/**
 * What to print, and it is an instruction rather than a caveat.
 *
 * Returns null when there is nothing specific to say. **A general sentence is
 * the failure mode this exists to replace**, so the caller must not substitute
 * one: silence beats furniture.
 *
 * @param {Affected} affected
 * @returns {string | null}
 */
export function affectedProofsReport(affected) {
  if (affected.changed.length === 0 || affected.proofs.length === 0) return null;
  return (
    `\n  !!  ${String(affected.proofs.length)} of ${String(affected.examined)} proof(s) read a ` +
    `file this tree changed, and THIS SWEEP DID NOT RUN THEM:\n` +
    affected.proofs.map((proof) => `        npm run ${proof.name}\n`).join('') +
    `      A green check set is not a green board. This list is static-import reach only:\n` +
    `      a proof that spawns a script it never imports is not in it.\n`
  );
}
