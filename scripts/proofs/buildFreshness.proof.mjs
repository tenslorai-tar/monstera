// @ts-check
/**
 * Proves the staleness guard can tell a current build from an old one, and
 * cannot be satisfied by having looked at nothing.
 *
 * ## It had no proof at all until now, and that is the finding behind this file
 *
 * `refuseStaleBuild` lived inside `rendererPolicy.proof.mjs` as a private
 * function with no cases. It was load-bearing there — every runtime case in that
 * file reads an artefact, and a stale one answers every probe confidently and
 * correctly about the previous version of the shell — and it became load-bearing
 * for a second proof when `canvasPixels.proof.mjs` began reading pixels out of
 * the same bundle. A helper two proofs trust before believing anything else is
 * the last place to have no coverage of its own.
 *
 * ## The direction the cases run
 *
 * Every failure mode here produces **"the build is fine"**:
 *
 * - a source newer than its artefact, missed;
 * - a directory walk that reads nothing and returns `0`, which never exceeds a
 *   timestamp;
 * - a pair list quietly shorter than the proof needs.
 *
 * So each case has a partner asserting the guard also says **yes** when it
 * should. A guard that refused everything would satisfy the first half of this
 * file perfectly and be deleted within a week.
 *
 * Usage: node scripts/proofs/buildFreshness.proof.mjs
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARTEFACT_EDGES, newestMtime, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {string[]} */
const failures = [];

const CASES = [
  'a source NEWER than its artefact is refused',
  'CONTROL: and the same pair with the artefact newer is accepted',
  'EQUAL timestamps pass, because a tick is not evidence of staleness',
  'a directory source is dated by the newest file BENEATH it',
  'a test file is not an input, so touching one does not refuse',
  'a source directory the walk can date NOTHING in throws rather than reading as fresh',
  'CONTROL: and a directory holding one ordinary file is dated, not refused',
  'a missing artefact is reported as missing rather than as fresh',
  'a pair count that disagrees with the call site is refused',
  'a TSC pair whose source is newer is ACCEPTED when the compiler says it is current',
  'CONTROL: and REFUSED when the compiler says a build is owed',
  'CONTROL: a BUNDLER pair with the same shape is refused without asking anybody',
  'every proof that CALLS the guard has an ARTEFACT_EDGES entry, so the sweep can order it',
  'CONTROL: and the scan found the callers it is known to be able to find',
  'every script that IMPORTS a build takes the guard, or is named as owing none',
  'CONTROL: and that scan sees the importers, and its allowlist has no dead entry',
];

const roster = createRoster(failures, { cases: CASES.length });

/** @type {string[]} */
const recorded = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  recorded.push(label);
  roster.record(mark, label);
}

/**
 * Whether `refuseStaleBuild` refused, and what it said.
 *
 * @param {string} root
 * @param {import('../lib/buildFreshness.mjs').BuildEdge[]} pairs
 * @param {number} expected
 * @returns {{ refused: boolean, message: string }}
 */
function refusal(root, pairs, expected, options = {}) {
  try {
    refuseStaleBuild(root, pairs, expected, options);
    return { refused: false, message: '' };
  } catch (error) {
    return { refused: true, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Writes a file and stamps its mtime.
 *
 * TIMESTAMPS ARE SET, not produced by writing in order. Two writes can land
 * inside one filesystem tick — the guard passes ties deliberately — so a fixture
 * that relied on write order would be a fixture whose outcome depends on how
 * fast the disk is, which is the flake that gets a bound raised.
 *
 * @param {string} path
 * @param {string} body
 * @param {number} atSeconds
 */
function writeAt(path, body, atSeconds) {
  writeFileSync(path, body, 'utf8');
  utimesSync(path, atSeconds, atSeconds);
}

/** @type {string[]} */
const roots = [];

/** @returns {string} a fresh temporary root */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-freshness-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  return root;
}

const OLD = 1_700_000_000;
const NEW = 1_800_000_000;

try {
  // -------------------------------------------------------------------------
  // The plain comparison, both ways.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', NEW);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', OLD);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js', 'bundler']], 1);
    check(
      'a source NEWER than its artefact is refused',
      refused && message.includes('OLDER than'),
      `the guard ${refused ? `refused with: ${message}` : 'accepted a build older than its own ' +
        'source'}. This is the whole mechanism: a stale artefact answers every probe in the ` +
        `proofs downstream, correctly, about the previous version of the shell.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', NEW);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js', 'bundler']], 1);
    check(
      'CONTROL: and the same pair with the artefact newer is accepted',
      !refused,
      `a current build was refused: ${message}\n      Without this line the case above passes ` +
        `for a guard that refuses everything — which would make every proof depending on it ` +
        `permanently red, and therefore make this guard the thing somebody deletes.`,
    );
  }

  // -------------------------------------------------------------------------
  // The tie. Finding LLLLL-2: the rule was in the header and in no case.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', OLD);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js', 'bundler']], 1);
    check(
      'EQUAL timestamps pass, because a tick is not evidence of staleness',
      !refused,
      `a build whose artefact carries its source's exact timestamp was refused: ${message}\n` +
        `      The resolver's header states this rule and, until this case, nothing asserted it — ` +
        `so changing the comparison to \`>=\` reddened NOTHING while producing exactly the ` +
        `failure that sentence predicts: a guard refusing a build somebody just made, on a fast ` +
        `filesystem, intermittently. That is the shape of a check people delete.\n      ` +
        `The timestamps are SET rather than produced by writing in order, so this case is a tie ` +
        `by construction and not by how fast the disk happens to be.`,
    );
  }

  // -------------------------------------------------------------------------
  // A directory source, and what counts as being in it.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    mkdirSync(join(root, 'src', 'nested'), { recursive: true });
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'src', 'nested', 'b.ts'), 'sibling\n', NEW);
    writeAt(join(root, 'dist', 'bundle.js'), 'built\n', OLD + 1);
    const { refused } = refusal(root, [['src', 'dist/bundle.js', 'bundler']], 1);
    check(
      'a directory source is dated by the newest file BENEATH it',
      refused,
      `an edit to src/nested/b.ts did not refuse a bundle built before it. The Vite bundle's ` +
        `inputs are every module reachable from its entry, so naming one file would be a guard ` +
        `that passes whenever the edit landed in a sibling — which is what a nested fixture is ` +
        `here to separate from a flat one.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'src', 'a.test.ts'), 'a test\n', NEW);
    writeAt(join(root, 'dist', 'bundle.js'), 'built\n', OLD + 1);
    const { refused, message } = refusal(root, [['src', 'dist/bundle.js', 'bundler']], 1);
    check(
      'a test file is not an input, so touching one does not refuse',
      !refused,
      `touching a test refused the build: ${message}\n      A test cannot change the artefact, ` +
        `so this would be the guard crying wolf on an edit that could not have staled anything ` +
        `— and a guard that cries wolf is one somebody turns off, which costs the real ` +
        `staleness it exists for.`,
    );
  }

  // -------------------------------------------------------------------------
  // Finding KKKKK-2: an empty walk is a broken lookup, not a fresh build.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    mkdirSync(join(root, 'src', 'node_modules'), { recursive: true });
    writeAt(join(root, 'src', 'node_modules', 'x.ts'), 'not source\n', NEW);
    writeAt(join(root, 'src', 'only.test.ts'), 'a test\n', NEW);
    writeAt(join(root, 'dist', 'bundle.js'), 'built\n', OLD);
    let threw = false;
    try {
      newestMtime(join(root, 'src'));
    } catch {
      threw = true;
    }
    check(
      'a source directory the walk can date NOTHING in throws rather than reading as fresh',
      threw,
      `a directory whose every entry is skipped returned a timestamp instead of refusing. It ` +
        `used to return 0, and 0 never exceeds an artefact's mtime — so the pair passed and the ` +
        `guard reported a current build having looked at nothing.\n      ` +
        `THE FIXTURE IS BUILT FROM THINGS THE SKIP LIST EATS, not from an empty directory: an ` +
        `empty one is the case nobody creates, and the one that actually happens is a skip list ` +
        `that grew until it covered everything real.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    let dated = 0;
    let threw = false;
    try {
      dated = newestMtime(join(root, 'src'));
    } catch {
      threw = true;
    }
    check(
      'CONTROL: and a directory holding one ordinary file is dated, not refused',
      !threw && dated > 0,
      `a directory with one ordinary source file ${threw ? 'threw' : `dated to ${String(dated)}`}. ` +
        `Without this the case above passes for a walk that refuses every directory, which is ` +
        `the same reading as a walk that can see none of them.`,
    );
  }

  // -------------------------------------------------------------------------
  // The two refusals that are about the call rather than the tree.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/never-built.js', 'bundler']], 1);
    check(
      'a missing artefact is reported as missing rather than as fresh',
      refused && message.includes('does not exist'),
      `an artefact that was never built ${refused ? `refused with: ${message}` : 'was accepted'}. ` +
        `"Could not compare" must not read as "compared and agreed" — the two are the same ` +
        `observation to everything downstream, and one of them means no build has happened.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', NEW);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js', 'bundler']], 2);
    check(
      'a pair count that disagrees with the call site is refused',
      refused && message.includes('declares'),
      `one pair passed against a call site declaring two: ${refused ? message : '(accepted)'}\n` +
        `      The literal is the anchor, and the danger runs toward the list being SHORT — ` +
        `GGGGG-1 was two cases that began reading the Vite bundle with no row following them. ` +
        `A count derived from the list agrees with any list, including the one missing an entry.`,
    );
  }

  // -------------------------------------------------------------------------
  // THE ESCAPE HATCH, BOTH DIRECTIONS AND THE KIND THAT DOES NOT GET ONE.
  //
  // `tsc --build` does not rewrite an output whose content did not change, so a
  // source that is merely NEWER proves nothing: a checkout, a `git stash pop`
  // and a formatter rewriting a file identically all move the timestamp. The
  // documented answer used to be `--force`, which is a rebuild performed to
  // satisfy a check rather than to fix anything — and it fired for real on
  // 2026-08-31, blocking two role scripts on a tree tsc called up to date.
  //
  // The compiler is injected because a fixture tree is not a TypeScript
  // solution: the real one answers *no* there for a reason that has nothing to
  // do with the case, which would leave the hatch untested rather than tested.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', NEW);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', OLD);

    const current = refusal(root, [['src/a.ts', 'dist/a.js', 'tsc']], 1, {
      compilerSaysCurrent: () => true,
    });
    check(
      'a TSC pair whose source is newer is ACCEPTED when the compiler says it is current',
      !current.refused,
      `refused with: ${current.message}\n      The timestamps say stale and the authority on ` +
        `whether tsc's own output is current is tsc. Refusing here is the false positive that ` +
        `made \`--force\` a documented step.`,
    );

    const owed = refusal(root, [['src/a.ts', 'dist/a.js', 'tsc']], 1, {
      compilerSaysCurrent: () => false,
    });
    check(
      'CONTROL: and REFUSED when the compiler says a build is owed',
      owed.refused && owed.message.includes('tsc was asked directly'),
      `accepted, or refused without saying it asked: ${owed.refused ? owed.message : '(accepted)'}\n` +
        `      Without this, "asks the compiler" is satisfied by a guard that stopped checking ` +
        `— every stale tsc build would pass, which is the whole thing this module exists for.`,
    );

    const bundled = refusal(root, [['src/a.ts', 'dist/a.js', 'bundler']], 1, {
      compilerSaysCurrent: () => true,
    });
    check(
      'CONTROL: a BUNDLER pair with the same shape is refused without asking anybody',
      bundled.refused && !bundled.message.includes('tsc was asked'),
      `${bundled.refused ? bundled.message : '(accepted)'}\n      esbuild and Vite rewrite ` +
        `their outputs on every build, so for a bundled artefact the timestamps are the whole ` +
        `truth and tsc's answer is about a different build. A hatch that applied to both would ` +
        `let a stale preload through on a tree whose TypeScript happened to be current.`,
    );
  }

  // THE ANCHOR, and it is the whole point of these last two cases.
  //
  // `stepOrder.mjs` derives the sweep's ordering from `ARTEFACT_EDGES`, so the
  // ordering is stable for whatever is in that map — and the map is hand-kept
  // while the failure it exists to prevent is an OMISSION from it. That is
  // audit item 4c in the direction the rule warns about: derive from a set only
  // when the failure you fear makes it BIGGER. Here it makes it smaller, and a
  // number computed from a collection cannot disagree with the collection.
  //
  // So the extent comes from somewhere the omission cannot reach: the set of
  // proof scripts that IMPORT `refuseStaleBuild`. A proof that calls the guard
  // is by definition one whose output depends on a build, and adding the call
  // is what a person does first — the entry is the step they forget. Measured
  // 2026-09-06: `renderGeometry.proof.mjs` had called it since it was written
  // and appeared in no entry, so it ran at 1.2s against a build that finished
  // at 34.0s and refused as stale, in a sweep that then sealed failed.
  //
  // The FILE-to-SCRIPT mapping is read from `package.json` rather than derived
  // from the filename, because npm's script table is the authority on what a
  // script is called and `renderGeometry.proof.mjs` → `proof:rendergeometry`
  // is a convention nothing enforces. `annotateCoverage.mjs` reads the same
  // table for the same reason.
  {
    const proofsDir = join(REPO_ROOT, 'scripts', 'proofs');
    /** @type {Record<string, string>} */
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    /** @type {Map<string, string>} */
    const scriptByFile = new Map();
    for (const [name, command] of Object.entries(scripts)) {
      const named = /scripts\/proofs\/([\w.-]+\.mjs)/u.exec(command);
      if (named?.[1] !== undefined) scriptByFile.set(named[1], name);
    }

    // THE ONE EXCLUSION, and a classifier needs a control for what it must
    // EXCLUDE as much as for what it must find. This file drives the guard
    // against temporary fixture roots it creates and deletes — it reads no
    // build and depends on no artefact, so an `ARTEFACT_EDGES` entry for it
    // would name sources it never looks at and the sweep would order it after a
    // build it does not need.
    //
    // Excluded BY NAME because the distinction is which root it passes, and a
    // scan that tried to tell `REPO_ROOT` from a `mkdtemp` path by reading the
    // source would be a parser where a sentence will do. The cost of a name is
    // that a rename makes it stale silently, which the control below refuses.
    const GUARD_OWN_PROOF = 'buildFreshness.proof.mjs';

    /** @type {string[]} */
    const callers = [];
    for (const file of readdirSync(proofsDir)) {
      if (!file.endsWith('.mjs') || file === GUARD_OWN_PROOF) continue;
      // THE IMPORT, not the call: a proof that imports the guard and forgets to
      // invoke it is a different defect, and this scan must not be the thing
      // that decides which. An import is also what a one-line grep can see
      // without parsing, and it is present in every file that uses it.
      if (!/\brefuseStaleBuild\b/u.test(readFileSync(join(proofsDir, file), 'utf8'))) continue;
      const script = scriptByFile.get(file);
      if (script !== undefined) callers.push(script);
    }

    // THIS IS A SEARCH, so it must locate something known-present or its silence
    // is worthless (item 4b). The control runs FIRST in spirit and is asserted
    // below: without it, a regex that matched nothing — a renamed helper, a
    // moved directory, a `scripts` table this failed to parse — would report an
    // empty caller list, and an empty list satisfies "every caller has an entry"
    // perfectly. That is the reassuring answer, and it is the one being hoped
    // for here.
    const found = callers.filter((script) => ARTEFACT_EDGES[script] === undefined);
    check(
      'every proof that CALLS the guard has an ARTEFACT_EDGES entry, so the sweep can order it',
      found.length === 0,
      `${found.length} proof(s) call refuseStaleBuild and are named by no ARTEFACT_EDGES ` +
        `entry: ${found.length > 0 ? found.join(', ') : '(none)'}. stepOrder.mjs cannot place ` +
        `them after the build they read, so they run against whatever is on disk — and refuse ` +
        `as stale rather than pass, which turns a whole sweep red. Add the edges each proof ` +
        `already declares at its refuseStaleBuild call.`,
    );
    // TWO CLAIMS IN ONE CONTROL, because the scan has two ways to go quiet and
    // only one of them is about the pattern. It can fail to FIND — a renamed
    // helper, a moved directory, a `scripts` table it could not parse — and it
    // can over-EXCLUDE, if the file it skips by name is renamed and the skip
    // silently starts matching nothing while the real caller it used to protect
    // is gone. Both produce a caller list this case's partner is happy with.
    const excluded = readdirSync(proofsDir).includes(GUARD_OWN_PROOF);
    check(
      'CONTROL: and the scan found the callers it is known to be able to find',
      callers.includes('proof:rendererpolicy') && callers.includes('proof:canvaspixels') && excluded,
      `the scan of scripts/proofs found [${callers.join(', ')}] and ${excluded ? 'did' : 'did NOT'} ` +
        `find ${GUARD_OWN_PROOF} to exclude. Those two proofs are known to call ` +
        `refuseStaleBuild, so their absence means this scan is blind — and a blind scan reports ` +
        `an empty caller list, which passes the case above for the wrong reason. A missing ` +
        `exclusion file means that name went stale in a rename.`,
    );
  }

  // THE OTHER DIRECTION, AND THE CASE ABOVE IS STRUCTURALLY BLIND TO IT
  // (finding CCCCCC-4, 2026-09-09).
  //
  // The anchor above derives its extent from the scripts that IMPORT the guard,
  // and says so as a strength: an omission from `ARTEFACT_EDGES` cannot reach
  // that set. True, and it leaves the larger danger unwatched — **a script that
  // reads a build and never imports the guard at all is not in the set the
  // anchor derives from**, so it can never be missed. That is item 4c in the
  // direction it warns about, one layer up from the map: derive from a set only
  // when the failure you fear makes it BIGGER, and a forgotten guard makes this
  // one smaller.
  //
  // Measured when this case was written: `textLayerBounds.mjs` (a CI step),
  // `textFrames.mjs` and `textLayerAgreement.mjs` all imported
  // `packages/kernel/dist/textStructure.js` unguarded, and the third had
  // reimplemented the mtime comparison privately — a second opinion about an
  // authority `buildFreshness.mjs` owns (B3a), missing the half that asks the
  // compiler. One of the three was named in a COMMENT in `buildFreshness.mjs`
  // for a whole range, which is a note rather than a mechanism.
  //
  // The extent here comes from the import graph, which no forgotten call can
  // shrink. The allowlist is hand-kept and that is the right direction for it:
  // the failure feared is a NEW dist-reader arriving, which makes the set
  // bigger, and a hand-kept list fails loudly on exactly that.
  {
    /**
     * Imports a build and owes no edge, with the reason. Not an exemption list.
     *
     * **Empty, and it was written with one entry.** `electronImports.proof.mjs`
     * was put here because it names `dist/` paths — and the control below
     * reported the entry as dead, because those paths are DATA in an allowance
     * table and the pattern correctly does not match them. A list built for a
     * member the classifier never had is furniture on its first run.
     *
     * It stays as an empty declared route rather than an absolute rule, because
     * a check with no way to say *this one genuinely reads no artefact* is a
     * check the first honest exception gets weakened.
     *
     * @type {Map<string, string>}
     */
    const READS_NO_BUILD = new Map();

    /** @type {string[]} */
    const files = [];
    /** @param {string} directory */
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.mjs')) files.push(path);
      }
    };
    walk(join(REPO_ROOT, 'scripts'));

    // A STATIC OR DYNAMIC IMPORT, not a mention. `\s` spans the newline that
    // `editFidelity.proof.mjs` puts between `await import(` and its specifier,
    // which a line-scoped pattern would miss — a line is not a unit of meaning.
    const IMPORTS_A_BUILD = /(?:\bfrom\s*|\bimport\s*\(\s*)['"][^'"]*\/dist\/[^'"]*['"]/u;

    /** @type {string[]} */
    const importers = [];
    /** @type {string[]} */
    const unguarded = [];
    for (const path of files) {
      const name = relative(REPO_ROOT, path).split('\\').join('/');
      // This file drives the guard against fixture trees and imports no build,
      // so it is not in the set by construction rather than by exclusion.
      const source = readFileSync(path, 'utf8');
      if (!IMPORTS_A_BUILD.test(source)) continue;
      importers.push(name);
      // THE IMPORT CLAUSE, not the identifier anywhere in the file. A bare
      // `\brefuseStaleBuild\b` was tried and **survived its own mutation**:
      // renaming the import binding left the call site's spelling in the text,
      // so the file still read as guarded. A word in a comment would satisfy it
      // too, which is the version that would have shipped unnoticed.
      if (/import\s*\{[^}]*\brefuseStaleBuild\b[^}]*\}\s*from/u.test(source)) continue;
      if (READS_NO_BUILD.has(name)) continue;
      unguarded.push(name);
    }

    check(
      'every script that IMPORTS a build takes the guard, or is named as owing none',
      unguarded.length === 0,
      `${String(unguarded.length)} script(s) import a module under a package's dist/ and never ` +
        `import refuseStaleBuild: ${unguarded.length > 0 ? unguarded.join(', ') : '(none)'}. ` +
        `Such a script measures whatever was last built and prints the answer under this ` +
        `build's name. Take the guard with the edges it reads, or add it to READS_NO_BUILD ` +
        `with the reason it depends on no artefact.`,
    );

    // TWO WAYS TO GO QUIET, and both produce an empty `unguarded`. The walk can
    // fail to find — a moved directory, a pattern that stopped matching the
    // import forms in use — and the allowlist can hold an entry whose file no
    // longer imports a build, which the loop above cannot report because it
    // walks the importers that exist (ZZZZZ-3's shape, in a second list).
    const dead = [...READS_NO_BUILD.keys()].filter((name) => !importers.includes(name));
    check(
      'CONTROL: and that scan sees the importers, and its allowlist has no dead entry',
      importers.includes('scripts/proofs/editFidelity.proof.mjs') &&
        importers.includes('scripts/research/lineAgreement.mjs') &&
        importers.length >= 5 &&
        dead.length === 0,
      `the walk found ${String(importers.length)} importer(s): ${importers.join(', ')}. ` +
        `editFidelity.proof.mjs imports a build through a MULTI-LINE await import( and ` +
        `lineAgreement.mjs through a plain from — both must be seen, or the pattern has ` +
        `stopped matching the forms in use and an empty result reads as a clean tree. ` +
        `${String(dead.length)} allowlist entry(ies) name a script that imports no build: ` +
        `${dead.length > 0 ? dead.join(', ') : '(none)'}.`,
    );
  }

  if (recorded.length !== CASES.length || recorded.some((label, at) => label !== CASES[at])) {
    throw new Error(
      `CASES does not describe what ran.\n  declared:\n    ${CASES.join('\n    ')}\n  ran:\n    ` +
        `${recorded.join('\n    ')}`,
    );
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} build-freshness failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('build-freshness case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
if (failures.length > 0) process.exitCode = 1;
