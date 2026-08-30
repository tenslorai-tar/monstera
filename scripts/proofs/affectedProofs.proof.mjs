// @ts-check
/**
 * Proof that the sweep's proof list can see, refuse, and stay quiet (AAAA-16).
 *
 * The instrument replaces a true sentence that failed as a compensation: *this
 * set cannot see a proof registered only in a workflow*, printed at the point of
 * use, on every run, naming nothing. What replaces it must be **specific**, and
 * a specific list is worthless if it can be wrong in the reassuring direction —
 * so most of these cases are about the empty answer.
 *
 * The load-bearing one is the resolution test, and it is not hypothetical: run
 * against the exact change that reddened `main` at `3a903fd`, the first version
 * of this instrument named three proofs and **not** the one that had failed,
 * because a compound `proof:*` command was represented by its first script only.
 * The report read identically either way.
 *
 * Usage: node scripts/proofs/affectedProofs.proof.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import {
  CONTROL_BUILD_EDGE,
  CONTROL_EDGE,
  affectedProofs,
  affectedProofsReport,
  importGraph,
} from '../lib/affectedProofs.mjs';
import { builtSourcesFor } from '../lib/buildFreshness.mjs';
import { filesInCommit, repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { proofScripts } from '../lib/proofCoverage.mjs';
import { SCANNING_PROOFS, scanningProofRoster } from '../lib/scanningProofs.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 26 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// ---------------------------------------------------------------------------
// It can see: the graph carries an edge it is known to be able to find.
// ---------------------------------------------------------------------------
{
  const graph = importGraph(ROOT);
  check(
    'the import graph carries the edge it declares as its control',
    graph.get(CONTROL_EDGE.from)?.has(CONTROL_EDGE.to) === true,
    `${CONTROL_EDGE.from} -> ${CONTROL_EDGE.to} is missing. Every query would report the ` +
      `reassuring answer.`,
  );
  check(
    'and it reaches more than a handful of modules, so the walk is not truncated',
    graph.size > 50,
    `${String(graph.size)} module(s). A walk that stopped early reports "nothing affected" for ` +
      `everything it never reached.`,
  );
}

// ---------------------------------------------------------------------------
// A WRAPPED IMPORT IS AN IMPORT, and this is the case none of the 25 had.
// ---------------------------------------------------------------------------
{
  // FOUND IN THE REAL TREE RATHER THAN INVENTED, for two reasons. `importGraph`
  // refuses any tree missing its control edges, so a temporary fixture would be
  // testing the refusal; and a wrapped import written here would only prove the
  // pattern against a shape I chose. This asks the repository for one.
  //
  // The specifier list this repository's formatter produces for anything over
  // one line. The pattern was bounded by `[^\n;]`, so an edge written this way
  // was in no graph at all — 32 of them, in 29 files, 22 of which are proofs.
  const WRAPPED = /(?:^|\n)\s*import\s*\{[^}]*\n[^}]*\}\s*from\s*['"](\.[^'"]*)['"]/gu;
  const graph = importGraph(ROOT);

  /** @type {{ from: string, to: string } | null} */
  let wrapped = null;
  for (const [file] of graph) {
    const match = WRAPPED.exec(readFileSync(join(ROOT, file), 'utf8'));
    WRAPPED.lastIndex = 0;
    const specifier = match?.[1];
    if (specifier === undefined) continue;
    const to = relative(ROOT, resolve(join(ROOT, dirname(file)), specifier)).replaceAll('\\', '/');
    if (!graph.has(to)) continue;
    wrapped = { from: file, to };
    break;
  }

  check(
    'an import whose specifier list is WRAPPED is an edge, which the line-bounded pattern missed',
    wrapped !== null && graph.get(wrapped.from)?.has(wrapped.to) === true,
    wrapped === null
      ? 'no module under scripts/ writes a relative import across more than one line, so this ' +
        'case has nothing to test and its silence means nothing. If that is genuinely true now, ' +
        'this case must be deleted rather than left passing.'
      : `${wrapped.from} -> ${wrapped.to} is written across lines and is NOT in the graph. A ` +
        `miss here produces "no proof affected", which is what everyone asking this wants to hear.`,
  );
}

// ---------------------------------------------------------------------------
// THE RESOLUTION TEST, against the change that actually reddened main.
// ---------------------------------------------------------------------------
{
  const result = affectedProofs(['scripts/lib/registeredHooks.mjs'], { root: ROOT });
  const named = result.proofs.map((proof) => proof.name);
  check(
    'RESOLUTION: the file that reddened main names proof:guards',
    named.includes('proof:guards'),
    `named ${named.join(' ') || '(nothing)'}. proof:guards is the entry that failed at 3a903fd, ` +
      `and the head-only version of this instrument left preCommit.proof.mjs in no entry's path ` +
      `set at all — so it named three proofs, none of them the one that mattered.`,
  );

  const guards = proofScripts(ROOT).find((proof) => proof.name === 'proof:guards');
  check(
    '  ...because a compound proof records EVERY script it chains, not the first',
    (guards?.paths.length ?? 0) > 1 && guards?.paths.includes('scripts/hooks/preCommit.proof.mjs') === true,
    `proof:guards records ${JSON.stringify(guards?.paths)}. There is no way to run one member of ` +
      `a chained command, so naming the head under-reports and naming none of the tail hides them.`,
  );

  check(
    'and a proof script that IS the changed file names its own entry',
    affectedProofs(['scripts/hooks/prePush.proof.mjs'], { root: ROOT })
      .proofs.map((proof) => proof.name)
      .includes('proof:guards'),
    'editing a proof is the plainest reason to run it, and the head-only version reported none',
  );
}

// ---------------------------------------------------------------------------
// The empty answer is reachable, and means what it says.
// ---------------------------------------------------------------------------
{
  // THE FIXTURE MOVED, AND WHY IT HAD TO IS THE INTERESTING PART. This was
  // `docs/JOURNAL.md`, chosen as "a file no proof reads". That was true only
  // while the graph read imports alone: `auditScope.proof.mjs` reaches the
  // journal by path — the watermark rule reads it — so the journal was always a
  // dependency and the old fixture was asserting the instrument's blindness
  // rather than the empty answer (finding KKKK-6).
  //
  // A source module under a package no `scripts/` module imports, and whose
  // basename appears in no script as a literal, is what an unreached file
  // actually looks like here.
  //
  // **AND IT MOVED A SECOND TIME, for the third kind of edge (PPPPP-2).** It was
  // `packages/ui/src/primitives/iconSize.ts`, which stopped being unreached the
  // day build edges landed: `proof:canvaspixels` and `proof:rendererpolicy` read
  // a Vite bundle whose inputs are every module under `packages/ui/src`, so that
  // file is genuinely a dependency of both and the case was again asserting a
  // blindness rather than an empty answer.
  //
  // Twice now, the same way: **a fixture chosen as "nothing reads this" is only
  // as true as the edges the instrument knows about.** Each time the instrument
  // learnt a new kind of edge the fixture became a false negative, and each time
  // it did so silently, because the case kept passing. The tracked-file control
  // below is what stops the replacement being wrong in the other direction; what
  // stops it being wrong in this one is re-asking the question whenever an edge
  // kind is added, which is written here rather than remembered.
  const UNREACHED = 'packages/shared/src/geometry.ts';
  check(
    'CONTROL: the unreached fixture is a tracked file, so its emptiness means something',
    filesInCommit({ cwd: ROOT }).includes(UNREACHED),
    `${UNREACHED} is not tracked. A path that does not exist reaches no proof either, and this ` +
      `case would then pass by naming nothing about nothing — the vacuity the case below is ` +
      `supposed to be immune to.`,
  );
  const none = affectedProofs([UNREACHED], { root: ROOT });
  check(
    'CONTROL: a file no proof reads names no proofs',
    none.proofs.length === 0 && none.examined > 10,
    `named ${String(none.proofs.length)} of ${String(none.examined)} examined. If everything ` +
      `matched, the list would be as useless as the sentence it replaces — a caller would learn ` +
      `to skip it, which is exactly how the disclaimer failed.`,
  );
  check(
    '  ...and the report says NOTHING rather than something general',
    affectedProofsReport(none, []) === null,
    'a general sentence is the failure mode this exists to replace. Silence beats furniture.',
  );
  check(
    'while a real hit produces a runnable instruction',
    (
      affectedProofsReport(affectedProofs(['scripts/lib/registeredHooks.mjs'], { root: ROOT }), []) ??
      ''
    ).includes('npm run proof:guards'),
    'three proof names is an instruction; a caveat is not. The reader must be able to act on it ' +
      'without deciding anything.',
  );
}

// ---------------------------------------------------------------------------
// WHAT THE RUN REACHED IS SUBTRACTED (finding DDDD-1).
//
// The report used to end `THIS SWEEP DID NOT RUN THEM` with nothing passed in
// that could support the claim, so `npm run local -- --only
// proof:transportwrite` ran that proof, reported it passing, and then told the
// reader it had not been run. These four cases hold the affected set constant
// and vary only what the run reached, because that is the axis the bug was
// blind to — a case that varies the changed paths instead separates nothing.
// ---------------------------------------------------------------------------
{
  const affected = affectedProofs(['scripts/lib/registeredHooks.mjs'], { root: ROOT });
  const every = affected.proofs.map((proof) => proof.name);

  const reachedNone = affectedProofsReport(affected, []) ?? '';
  check(
    'a run that reached nothing names every affected proof',
    every.length > 0 && every.every((name) => reachedNone.includes(`npm run ${name}`)),
    `named ${String(every.filter((name) => reachedNone.includes(name)).length)} of ` +
      `${String(every.length)}. This is the state the old report asserted unconditionally, and ` +
      `it must still be reachable — otherwise the subtraction has replaced the warning rather ` +
      `than qualifying it.`,
  );

  const reachedOne = affectedProofsReport(affected, ['proof:guards']) ?? '';
  check(
    'a proof the run DID reach is not listed as unreached',
    !reachedOne.includes('npm run proof:guards') && reachedOne.includes('It did reach'),
    `the report still says "npm run proof:guards" after the run produced a verdict for it. That ` +
      `is the false claim: specific, and therefore believed.`,
  );

  const reachedAll = affectedProofsReport(affected, every) ?? '';
  check(
    'and a run that reached them all says so, by name, rather than falling silent',
    reachedAll.startsWith('\n  ok  ') &&
      !reachedAll.includes('DID NOT REACH') &&
      every.every((name) => reachedAll.includes(name)),
    `reported ${JSON.stringify(reachedAll.slice(0, 80))}. Silence here would be indistinguishable ` +
      `from "no proof reads a changed file", which is a different fact and the caller prints its ` +
      `own line for it.`,
  );

  // THE MIDDLE CLAUSE CHANGED AND IT IS A CORRECTION, NOT A LOOSENING (EEEE-2).
  //
  // It read `!reachedAll.includes('npm run')`, using that substring as a proxy
  // for "nothing is listed as unreached". The proxy stopped separating those
  // two the moment the report gained a SECOND, legitimate `npm run` section:
  // the scanning-proof roster, which is printed on every run precisely because
  // no import walk can reach it. So the old clause would now fail against a
  // correct report.
  //
  // `DID NOT REACH` is the unreached section's own header, which is what the
  // clause meant all along. The case below is what stops that being a
  // weakening: it requires the substitution to still separate the two reports.
  check(
    'CONTROL: the header the case now keys on is what actually distinguishes the two reports',
    (affectedProofsReport(affected, []) ?? '').includes('DID NOT REACH') &&
      !reachedAll.includes('DID NOT REACH'),
    `a report where NOTHING was reached does not carry "DID NOT REACH", or the all-reached one ` +
      `does. Then the clause above is satisfied by both shapes and separates nothing — which is ` +
      `exactly what the 'npm run' proxy had quietly become.`,
  );

  let refusedWithoutRan = false;
  try {
    // @ts-expect-error the omission is the defect under test; a caller that
    // forgets the argument must not fall back to asserting nothing ran.
    affectedProofsReport(affected);
  } catch (error) {
    refusedWithoutRan = /verdict/u.test(String(error));
  }
  check(
    'CONTROL: omitting what the run reached is refused, not defaulted',
    refusedWithoutRan,
    `an optional parameter leaves the old false claim one omission away, which is B5's argument ` +
      `exactly — the fix cannot be "remember to pass it".`,
  );
}

// ---------------------------------------------------------------------------
// It refuses rather than reporting an empty graph.
// ---------------------------------------------------------------------------
{
  const empty = mkdtempSync(join(tmpdir(), 'monstera-affected-'));
  mkdirSync(join(empty, 'scripts'), { recursive: true });
  try {
    let refused = false;
    try {
      importGraph(empty);
    } catch (error) {
      refused = /broken walk/u.test(String(error));
    }
    check(
      'CONTROL: an empty scripts/ tree is a broken walk, not a clean answer',
      refused,
      'an empty file set produces "nothing affected" for every query ever made against it',
    );

    // A tree with modules but not the control edge: the walk works, the graph is
    // real, and it still must refuse — because "this repository has no such
    // edge" and "this stopped reading imports" are the same observation.
    const blinded = mkdtempSync(join(tmpdir(), 'monstera-affected-'));
    const decoy = join(blinded, 'scripts', 'lib', 'thing.mjs');
    mkdirSync(dirname(decoy), { recursive: true });
    writeFileSync(decoy, 'export const a = 1;\n', 'utf8');
    writeFileSync(
      join(blinded, 'scripts', 'lib', 'other.mjs'),
      "import { a } from './thing.mjs';\nexport const b = a;\n",
      'utf8',
    );
    let blindedRefused = false;
    try {
      importGraph(blinded);
    } catch (error) {
      blindedRefused = /does not carry/u.test(String(error));
    }
    check(
      'CONTROL: a graph that parses but lacks the control edge is refused too',
      blindedRefused,
      'a working parser pointed at the wrong tree answers every question with the reassuring one',
    );
    rmSync(blinded, { recursive: true, force: true });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// A cycle does not hang it. The graph is not known to be acyclic, and a
// recursive reachability walk over one runs forever — which looks like a hung
// sweep rather than a broken instrument.
// ---------------------------------------------------------------------------
{
  const answered = affectedProofs(['scripts/lib/gitScope.mjs'], { root: ROOT });
  check(
    'a query over the real graph terminates, so no cycle traps the walk',
    answered.examined > 10,
    'gitScope is imported by nearly everything; if a cycle hung the walk this case never returns',
  );
}

// ---------------------------------------------------------------------------
// THE BUILD EDGE (finding PPPPP-2). The other thing the import walk cannot see:
// a proof that spawns Electron and reads `apps/desktop/dist/` depends on a
// source tree through a BUILD, which is not an import specifier.
// ---------------------------------------------------------------------------
{
  // Measured before the fix: this returned an empty list, with the import
  // control passing and `examined` correct. The instrument could see; its root
  // was the wrong kind of edge, and the answer it produced was the reassuring
  // one.
  const renderer = affectedProofs(['packages/ui/src/App.tsx'], { root: ROOT });
  check(
    'a renderer source names the proofs that read the BUNDLE built from it',
    ['proof:rendererpolicy', 'proof:canvaspixels'].every((name) =>
      renderer.proofs.some((proof) => proof.name === name),
    ),
    `["packages/ui/src/App.tsx"] named ${renderer.proofs.map((proof) => proof.name).join(', ') || '(none)'}. ` +
      `Both of those proofs read pixels and policy out of a Vite bundle whose inputs are every ` +
      `module reachable from main.tsx, and neither imports this file.`,
  );

  // A FILE ONE PROOF READS AND THE OTHER DOES NOT, which is what separates
  // "the map is consulted" from "the map answers everything". A build edge
  // matching every query would satisfy the case above perfectly.
  const policy = affectedProofs(['apps/desktop/src/windowPolicy.ts'], { root: ROOT });
  check(
    'CONTROL: a source only ONE proof builds from names only that proof',
    policy.proofs.some((proof) => proof.name === 'proof:rendererpolicy') &&
      !policy.proofs.some((proof) => proof.name === 'proof:canvaspixels'),
    `["apps/desktop/src/windowPolicy.ts"] named ${policy.proofs.map((proof) => proof.name).join(', ') || '(none)'}. ` +
      `proof:rendererpolicy exists to compare that file against §9.27; proof:canvaspixels does ` +
      `not read it, and an edge that matched both would be an instrument answering every query ` +
      `the same way.`,
  );

  // THE BOUNDARY, because the edges name directories. A prefix test without one
  // makes a sibling directory a match, and the failure direction is a proof
  // named for a change it cannot see — which is noise that gets ignored.
  const sibling = affectedProofs(['packages/ui/srcExtra/thing.ts'], { root: ROOT });
  check(
    'a directory edge matches on a path boundary, not on a bare prefix',
    !sibling.proofs.some((proof) => proof.name === 'proof:canvaspixels'),
    `["packages/ui/srcExtra/thing.ts"] named proof:canvaspixels, so "packages/ui/src" matched a ` +
      `path that merely starts with it.`,
  );

  // THE MAP'S OWN CONTROL, asserted from outside it. `affectedProofs` refuses
  // to answer when the build-edge map has lost its anchor, for the reason the
  // import graph refuses: a map that came back empty answers every query with
  // "nothing affected".
  check(
    'the build-edge map carries its control, so its silence is worth something',
    builtSourcesFor(CONTROL_BUILD_EDGE.from).includes(CONTROL_BUILD_EDGE.to),
    `${CONTROL_BUILD_EDGE.from} does not declare ${CONTROL_BUILD_EDGE.to} as a built source. ` +
      `Every build-edge query would then report the reassuring answer.`,
  );
}

// ---------------------------------------------------------------------------
// THE SCANNING-PROOF ROSTER (finding EEEE-2). What the import walk cannot see.
// ---------------------------------------------------------------------------
{
  const verdict = scanningProofRoster();

  check(
    'every roster entry is a real proof:* script',
    verdict.stale.length === 0,
    `the roster names ${verdict.stale.join(', ')}, which package.json does not declare. A name ` +
      `that matches nothing is worse than a missing one: it reads as coverage on every run and ` +
      `sends whoever follows it to a script that is not there.`,
  );

  check(
    'the count anchor agrees with the list',
    verdict.miscount === null,
    verdict.miscount ??
      'unreachable — miscount is null exactly when the two agree, and this branch exists so a ' +
        'failure prints the module’s own sentence rather than a second opinion about it.',
  );

  // THE ANCHOR IS ANCHORING — the case that separates "the count agrees" from
  // "the count is computed from the list and therefore always agrees". Without
  // it, `SCANNING_PROOF_COUNT = SCANNING_PROOFS.length` satisfies the case
  // above forever, which is 4c's whole subject.
  //
  // IT READS THE SOURCE, and the first version did not — it compared the
  // imported value against `SCANNING_PROOFS.length` and against 9, both of
  // which hold whichever way the constant is written. That case survived the
  // mutation it existed to catch: **a control against "a number derived from
  // the collection it checks" was itself a number derived from the collection
  // it checked.** Only the definition distinguishes them, which is the same
  // reason `proof:kernelload` reads the emitted JavaScript and the CSP is read
  // off the response.
  const source = readFileSync(join(repoRoot(), 'scripts/lib/scanningProofs.mjs'), 'utf8');
  check(
    'CONTROL: the count is a literal in the source, so it CAN disagree',
    /export const SCANNING_PROOF_COUNT = \d+;/u.test(source),
    `SCANNING_PROOF_COUNT is not defined as a numeric literal. Derived from the roster it agrees ` +
      `with every deletion, and the case above becomes a check that a number equals itself.`,
  );

  // The report names them, which is the whole repair: a disclaimer became an
  // instruction. Asserted on the real report rather than on the constant, so a
  // wiring that forgot to include them is red here.
  const named = affectedProofsReport(affectedProofs(['scripts/lib/gitScope.mjs']), []) ?? '';
  check(
    'the report NAMES the scanning proofs rather than disclaiming them',
    SCANNING_PROOFS.every((name) => named.includes(name)),
    `the report omits at least one scanning proof. Its predecessor said "this list is ` +
      `static-import reach only" — true on every run, naming nothing, asking for nothing, and ` +
      `on screen when 5168f3b reddened main at a proof it structurally could not list.`,
  );
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} affectedProofs case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('affectedProofs case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
