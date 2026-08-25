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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CONTROL_EDGE, affectedProofs, affectedProofsReport, importGraph } from '../lib/affectedProofs.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { proofScripts } from '../lib/proofCoverage.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 15 });

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
  const none = affectedProofs(['docs/JOURNAL.md'], { root: ROOT });
  check(
    'CONTROL: a file no proof imports names no proofs',
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
      !reachedAll.includes('npm run') &&
      every.every((name) => reachedAll.includes(name)),
    `reported ${JSON.stringify(reachedAll.slice(0, 80))}. Silence here would be indistinguishable ` +
      `from "no proof reads a changed file", which is a different fact and the caller prints its ` +
      `own line for it.`,
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

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} affectedProofs case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('affectedProofs case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
