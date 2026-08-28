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

import { filesInCommit, repoRoot } from './gitScope.mjs';
import { proofScripts } from './proofCoverage.mjs';
import { SCANNING_PROOFS, rosterMiscount } from './scanningProofs.mjs';

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

/**
 * A DATA edge that must exist, for the reason {@link CONTROL_EDGE} exists — and
 * it is a separate control because it fails separately (finding KKKK-6).
 *
 * This instrument walked import specifiers only. A module that reads a
 * repository file by a computed path has a dependency no `import` records, and
 * the graph could not see it — so a change to that file reached nothing and the
 * report said so in the same words it uses for a change that genuinely reaches
 * nothing.
 *
 * Measured 2026-08-28, before the fix:
 *
 *     ["docs/security/engine-advisories.json"] -> 0 of 85 proofs
 *     ["scripts/hooks/prePush.mjs"]            -> 1 of 85: proof:guards
 *
 * The register is the file three checks take their extent from, and editing it
 * reddened `main` on the push that followed that reading.
 */
export const CONTROL_DATA_EDGE = {
  from: 'scripts/hooks/prePush.mjs',
  to: 'docs/security/engine-advisories.json',
};

/**
 * Extensions a script reads as DATA rather than imports as code.
 *
 * Deliberately not "every tracked file". A source file with the same basename
 * as another is common — `index.ts` — and an edge to all of them would be
 * noise; these extensions are the ones this repository's scripts open by path,
 * and a basename among them is close to unique.
 */
const DATA_EXTENSIONS = ['.json', '.toml', '.yml', '.yaml', '.md', '.css'];

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
 * Tracked data files, grouped by basename.
 *
 * From `filesInCommit` rather than a walk, so the set is the tree this commit
 * will leave — the same resolver every other check about repository state uses
 * (B3a). A basename shared by two tracked files maps to both: an edge too many
 * names an extra proof, and an edge too few names none.
 *
 * @param {string} root
 * @returns {Map<string, string[]>}
 */
function dataFilesByBasename(root) {
  /** @type {Map<string, string[]>} */
  const byName = new Map();
  for (const path of filesInCommit({ cwd: root })) {
    if (!DATA_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    const basename = path.slice(path.lastIndexOf('/') + 1);
    const existing = byName.get(basename);
    if (existing === undefined) byName.set(basename, [path]);
    else existing.push(path);
  }
  if (byName.size === 0) {
    throw new Error(
      'No tracked data files were found, so no data edge can exist. An empty set here is a ' +
        'broken read of the tree, and every query would report the reassuring answer for every ' +
        'file this instrument was fixed to be able to see.',
    );
  }
  return byName;
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
  /** Each module's source, kept for the data-edge pass below. */
  const texts = new Map();

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
    texts.set(file, text);
  }

  const control = graph.get(CONTROL_EDGE.from);
  if (control === undefined || !control.has(CONTROL_EDGE.to)) {
    throw new Error(
      `The import graph does not carry ${CONTROL_EDGE.from} -> ${CONTROL_EDGE.to}, so it cannot ` +
        `tell "nothing was affected" from "this stopped being able to read imports". Every query ` +
        `against it would report the reassuring answer.`,
    );
  }

  // DATA EDGES, IN A SECOND PASS, and the ordering is load-bearing.
  //
  // This pass needs the tracked-file list, which needs a git repository. The
  // import control above needs neither, and its own case drives a bare
  // directory of modules — so building data edges first would replace that
  // case's "does not carry" refusal with a git error, and a control that
  // refuses for the wrong reason has stopped testing what it names.
  //
  // The rule is the BASENAME as a QUOTED LITERAL.
  // `join(root, 'docs', 'security', 'engine-advisories.json')` is a path no
  // import records, and it is how every check here reaches a file it does not
  // import. The basename is the one segment that survives every spelling of
  // the join.
  //
  // FALSE POSITIVES ARE THE SAFE DIRECTION AND ARE ACCEPTED. `package.json`
  // appears in many scripts and will attach many proofs to it, which is roughly
  // true anyway. A miss is the dangerous direction: it produces "nothing
  // affected", which is the answer everybody wants and is why this was
  // invisible for as long as it was.
  //
  // WHAT IT CANNOT SEE, stated rather than left to be discovered: a path
  // assembled from pieces, and a file read through a variable. Those need a
  // different mechanism, and a rule that quietly claimed them would be worse
  // than one that names its edge.
  const dataByBasename = dataFilesByBasename(root);
  for (const [file, text] of texts) {
    const imports = graph.get(file);
    if (imports === undefined) continue;
    for (const [basename, paths] of dataByBasename) {
      if (!text.includes(`'${basename}'`) && !text.includes(`"${basename}"`)) continue;
      for (const path of paths) imports.add(path);
    }
  }

  // A SECOND CONTROL, because the two halves fail separately. The import
  // control passing says nothing about whether data edges are being built, and
  // that half was absent entirely until KKKK-6 — which is what an unwatched
  // half looks like from the outside: a graph that answers, correctly, about
  // less than it is asked.
  const dataControl = graph.get(CONTROL_DATA_EDGE.from);
  if (dataControl === undefined || !dataControl.has(CONTROL_DATA_EDGE.to)) {
    throw new Error(
      `The graph does not carry the DATA edge ${CONTROL_DATA_EDGE.from} -> ` +
        `${CONTROL_DATA_EDGE.to}. A script that reads a repository file by path depends on it ` +
        `as surely as on anything it imports, and without this edge a change to that file ` +
        `reports "nothing affected" — which is what reddened main on 2026-08-28.`,
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

/** The limit this report prints whenever it names anything. */
/**
 * WHAT THIS LIST CANNOT SEE, NAMED (finding EEEE-2).
 *
 * It used to read *"This list is static-import reach only: a proof that spawns
 * a script it never imports is not in it"* — true, printed on every run, and a
 * **disclaimer** by CLAUDE.md's own test: it could have been printed before the
 * change, it names nothing and it asks for nothing. It was on screen when
 * `5168f3b` reddened `main` at a proof it structurally could not list.
 *
 * The replacement names the proofs. A reader can act on a name.
 */
/**
 * @param {ReadonlySet<string>} executed
 * @returns {string}
 */
function reachLimit(executed) {
  // THE ANCHOR, READ BY THIS CALLER TOO. It imported the bare array and was
  // protected only by `checkLocal.mjs` aborting first — a coupling nothing
  // stated, and one that evaporates for any other consumer of this report
  // (WWWW-3). The roster shrinking is what this paragraph would then be silent
  // about, while sounding exactly as complete.
  const miscount = rosterMiscount();
  if (miscount !== null) return `      ${miscount}\n`;

  const ran = SCANNING_PROOFS.filter((name) => executed.has(name));
  const missed = SCANNING_PROOFS.filter((name) => !executed.has(name));

  // DERIVED FROM THIS RUN, because the fixed version was a disclaimer by the
  // same test that condemned its predecessor: it printed the same nine names
  // whether or not the sweep had just executed them, and once `npm run local`
  // began running the roster that made it false as well as generic.
  if (missed.length === 0) {
    return (
      `      Static-import reach only — and this run RAN all ${String(ran.length)} proofs that\n` +
      `      scan the tree, which no import walk can name:\n` +
      ran.map((name) => `        ${name}\n`).join('')
    );
  }
  return (
    `      Static-import reach only. These proofs SCAN the tree, so any change reaches\n` +
    `      them and no import walk can say so — run them too:\n` +
    missed.map((name) => `        npm run ${name}\n`).join('') +
    (ran.length === 0 ? '' : `      This run did reach ${ran.join(', ')}\n`)
  );
}

/**
 * What to print, and it is an instruction rather than a caveat.
 *
 * Returns null when there is nothing specific to say. **A general sentence is
 * the failure mode this exists to replace**, so the caller must not substitute
 * one: silence beats furniture.
 *
 * ## Why `ran` is required rather than optional
 *
 * The sentence this used to print — *THIS SWEEP DID NOT RUN THEM* — is a claim
 * about the caller's run, and nothing was passed in that could support it. So it
 * was false whenever the sweep HAD run one: `npm run local -- --only
 * proof:transportwrite` ran that proof, reported it passing, and then told the
 * reader it had not been run. A disclosure that is wrong about the thing it is
 * disclosing is worse than the general sentence AAAA-16 replaced, because it is
 * specific and therefore believed.
 *
 * An optional parameter would leave the old claim reachable by omission, which
 * is B5's whole argument: the fix is not to remember to pass it. A caller that
 * genuinely reached nothing passes an empty list, and that is a statement rather
 * than a default.
 *
 * @param {Affected} affected
 * @param {readonly string[]} ran script names this run produced a verdict for —
 *   a pass or a fail. A timeout, a spawn that never started and a non-node
 *   script are NOT verdicts and must not appear here: each of those is a run
 *   that reached no answer, which is the case this report exists to name.
 * @returns {string | null}
 */
export function affectedProofsReport(affected, ran) {
  if (!Array.isArray(ran)) {
    throw new TypeError(
      `affectedProofsReport needs the list of scripts this run produced a verdict for. Without ` +
        `it the report can only assert that nothing ran, which is the false claim it was ` +
        `changed to stop making.`,
    );
  }
  if (affected.changed.length === 0 || affected.proofs.length === 0) return null;

  const executed = new Set(ran);
  const covered = affected.proofs.filter((proof) => executed.has(proof.name));
  const missed = affected.proofs.filter((proof) => !executed.has(proof.name));

  if (missed.length === 0) {
    return (
      `\n  ok  this run reached every proof that reads a file this tree changed ` +
      `(${String(covered.length)} of ${String(affected.examined)} examined):\n` +
      covered.map((proof) => `        ${proof.name}\n`).join('') +
      reachLimit(executed)
    );
  }

  return (
    `\n  !!  ${String(missed.length)} proof(s) read a file this tree changed and THIS RUN DID ` +
    `NOT REACH THEM\n` +
    `      (of ${String(affected.proofs.length)} affected, out of ${String(affected.examined)} ` +
    `examined):\n` +
    missed.map((proof) => `        npm run ${proof.name}\n`).join('') +
    (covered.length === 0
      ? ''
      : `      It did reach ${String(covered.length)}: ${covered
          .map((proof) => proof.name)
          .join(', ')}\n`) +
    `      A green check set is not a green board.\n` +
    reachLimit(executed)
  );
}
