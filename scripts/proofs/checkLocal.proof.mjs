// @ts-check
/**
 * Proof that `scripts/checkLocal.mjs` can report a failure at all (finding
 * QQQ-2).
 *
 * ## Why a wrapper needs a proof
 *
 * Its reassuring answer is **"everything passed"**, and four different things
 * print it: a clean tree, a misread exit code, a mis-parse of `spawnSync`'s
 * result, and a selected set that came back empty. That is 4b's shape in a tool
 * whose whole job is to report failures.
 *
 * The direction matters. The first version of this harness **invented
 * failures** — noisy, and it announced itself within one run. The mirror,
 * **inventing passes**, is silent and is the one nothing watched. `annotate.mjs`
 * is also "just" a wrapper and carries `annotate.proof.mjs` for exactly this
 * reason.
 *
 * ## Two of these cases read the HARNESS, not the results
 *
 * Item 2's remedy rule: when a harness is corrected, the control asserts what
 * the harness *passes*, not what the run produces. Every assertion about
 * results stays green whether or not a shell is interposed and whether or not a
 * timeout stops the sweep — which is precisely how the first version shipped
 * with both wrong.
 *
 *   - **No shell.** The fixture root's path contains a SPACE. Spawned directly
 *     that is nothing; spawned through a shell the command line splits and the
 *     script is not found. So the input is built from something that only
 *     succeeds when the guard is present, which is the negative-probe rule
 *     inverted.
 *   - **A timeout stops the sweep.** The first script hangs, the second would
 *     write a marker. The marker's ABSENCE is the assertion, with a control run
 *     proving the second script writes it when nothing times out — without
 *     which "no marker" is satisfied by a sweep that ran nothing at all.
 *
 * Usage: node scripts/proofs/checkLocal.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { multiProofSweepRefusal } from '../lib/sweepScope.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'checkLocal.mjs');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 19 });

/**
 * Records, and prints nothing — `roster.format` emits the case list at the end.
 *
 * @param {string} name @param {boolean} condition @param {string} detail
 */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// A SPACE IN THE PATH, deliberately. See the header: it is what makes the
// no-shell case an observation rather than a reading of the source.
const scratch = mkdtempSync(join(tmpdir(), 'monstera check local '));

/**
 * Builds a fixture repository and runs the harness against it.
 *
 * @param {Record<string, string>} files script name -> body
 * @param {Record<string, string>} manifestScripts
 * @param {string[]} extraArgs
 */
function runFixture(files, manifestScripts, extraArgs = []) {
  const root = mkdtempSync(join(scratch, 'repo '));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'scripts', name), body, 'utf8');
  }
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: manifestScripts }, null, 2),
    'utf8',
  );
  const run = spawnSync(
    process.execPath,
    [HARNESS, '--root', root, '--floor', '1', ...extraArgs],
    { encoding: 'utf8' },
  );
  return { root, ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

const EXIT_ZERO = 'process.exit(0);\n';
const EXIT_ONE = "process.stderr.write('FAIL deliberate\\n');\nprocess.exit(1);\n";
const HANGS = 'setInterval(() => undefined, 1000);\n';

try {
  // -------------------------------------------------------------------------
  // 1 & 2. It can report a failure, and it does not report everything as one.
  // -------------------------------------------------------------------------
  const red = runFixture(
    { 'bad.mjs': EXIT_ONE, 'good.mjs': EXIT_ZERO },
    { 'proof:bad': 'node scripts/bad.mjs', 'proof:good': 'node scripts/good.mjs' },
  );
  check(
    'a script that exits non-zero is reported FAILED, and the sweep exits non-zero',
    !red.ok && /FAILED\s+proof:bad/u.test(red.output),
    `exit ok=${String(red.ok)}. Output:\n${red.output}`,
  );
  check(
    'CONTROL: and the passing script beside it is reported ok',
    /\bok\s+proof:good/u.test(red.output),
    `a harness that reports everything as failed satisfies the case above. Output:\n${red.output}`,
  );

  // -------------------------------------------------------------------------
  // 3. NO SHELL IS INTERPOSED. Reads the harness, not the results.
  // -------------------------------------------------------------------------
  const spaced = runFixture(
    { 'ok.mjs': EXIT_ZERO },
    { 'proof:spaced': 'node scripts/ok.mjs' },
  );
  check(
    'the interpreter is spawned directly, so a path containing a SPACE still runs',
    spaced.ok && /\bok\s+proof:spaced/u.test(spaced.output),
    `The fixture root's path contains a space. Run through a shell the command line splits ` +
      `and the script is not found; run directly it is nothing at all. This is the property ` +
      `that made the first version orphan its children on every timeout, and no assertion ` +
      `about RESULTS can see it. Output:\n${spaced.output}`,
  );

  // -------------------------------------------------------------------------
  // 4 & 5. A TIMEOUT STOPS THE SWEEP. Also a harness property.
  // -------------------------------------------------------------------------
  const marker = 'ran-second.txt';
  const writesMarker =
    `import { writeFileSync } from 'node:fs';\n` +
    `writeFileSync(new URL('../${marker}', import.meta.url), 'yes', 'utf8');\n`;
  const twoScripts = { 'a-hangs.mjs': HANGS, 'b-marks.mjs': writesMarker };
  // Named so the sort puts the hanging one FIRST — the sweep runs in sorted
  // order, and a fixture whose slow script sorts last would prove nothing.
  const twoNames = {
    'proof:a-hangs': 'node scripts/a-hangs.mjs',
    'proof:b-marks': 'node scripts/b-marks.mjs',
  };

  const stopped = runFixture(twoScripts, twoNames, ['--timeout', '2']);
  check(
    'a timeout STOPS the sweep, so the script after it never runs',
    /TIMED OUT\s+proof:a-hangs/u.test(stopped.output) &&
      !existsSync(join(stopped.root, marker)),
    `A timeout orphans the timed-out script's own children, so every result after one is ` +
      `measured against a machine carrying them — twenty invented failures, once. ` +
      `marker exists=${String(existsSync(join(stopped.root, marker)))}. Output:\n${stopped.output}`,
  );
  check(
    'CONTROL: and with nothing timing out, that second script DOES run',
    (() => {
      const clean = runFixture(
        { 'b-marks.mjs': writesMarker },
        { 'proof:b-marks': 'node scripts/b-marks.mjs' },
      );
      return clean.ok && existsSync(join(clean.root, marker));
    })(),
    'without this, "the marker is absent" is satisfied by a harness that runs nothing at all, ' +
      'or by a fixture whose second script never wrote a marker in the first place.',
  );

  // -------------------------------------------------------------------------
  // 6. The floor is a positive control and refuses a broken derivation.
  // -------------------------------------------------------------------------
  const belowFloor = spawnSync(
    process.execPath,
    [HARNESS, '--root', runFixture({ 'ok.mjs': EXIT_ZERO }, { 'proof:one': 'node scripts/ok.mjs' }).root, '--floor', '5'],
    { encoding: 'utf8' },
  );
  check(
    'a derivation below the declared floor is REFUSED, not reported as a quiet repository',
    belowFloor.status !== 0 && /under a floor/u.test(`${belowFloor.stdout}${belowFloor.stderr}`),
    `A renamed "scripts" key and a filter that stopped matching both derive zero scripts and ` +
      `then report zero failures. exit=${String(belowFloor.status)}`,
  );

  // -------------------------------------------------------------------------
  // 7 & 8. A script it cannot invoke is NOT a pass.
  // -------------------------------------------------------------------------
  const notNode = runFixture(
    { 'ok.mjs': EXIT_ZERO },
    { 'proof:shelled': 'npm run something-else', 'proof:fine': 'node scripts/ok.mjs' },
  );
  check(
    'a script that is not a bare node invocation is reported NOT RUN',
    /NOT RUN\s+proof:shelled/u.test(notNode.output),
    `A script this harness cannot invoke is a hole in the derivation, and a hole that prints ` +
      `nothing is the derivation lying about its own coverage. Output:\n${notNode.output}`,
  );
  check(
    'and NOT RUN makes the sweep exit non-zero, because it is not a pass',
    !notNode.ok,
    `exit ok=true. "Everything I could run passed" and "everything passed" are different ` +
      `claims, and an exit code that cannot tell them apart is the one this proof exists for.`,
  );

  // -------------------------------------------------------------------------
  // 9-12. ORDERING BY MEASURED COST (findings RRR-1, SSS-1). Harness properties:
  // the same scripts pass in any order, so no assertion about RESULTS can see
  // these. What they buy is that a stop strands the expensive TAIL rather than
  // an alphabetical remainder.
  // -------------------------------------------------------------------------
  {
    /** @param {Record<string, number>} table @param {string[]} names */
    const withTable = (table, names) => {
      /** @type {Record<string, string>} */
      const files = {};
      /** @type {Record<string, string>} */
      const manifest = {};
      for (const name of names) {
        files[`${name}.mjs`] = EXIT_ZERO;
        manifest[`proof:${name}`] = `node scripts/${name}.mjs`;
      }
      const root = mkdtempSync(join(scratch, 'ordered '));
      mkdirSync(join(root, 'scripts'), { recursive: true });
      mkdirSync(join(root, '.cache'), { recursive: true });
      for (const [file, body] of Object.entries(files)) {
        writeFileSync(join(root, 'scripts', file), body, 'utf8');
      }
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'fixture', scripts: manifest }, null, 2),
        'utf8',
      );
      writeFileSync(
        join(root, '.cache', 'checkLocal-durations.json'),
        JSON.stringify(table, null, 2),
        'utf8',
      );
      const run = spawnSync(process.execPath, [HARNESS, '--root', root, '--floor', '1'], {
        encoding: 'utf8',
      });
      const order = `${run.stdout ?? ''}`
        .split('\n')
        .map((line) => /^ {2}ok {2}(proof:[\w-]+)/u.exec(line)?.[1])
        .filter((name) => name !== undefined);
      return { root, order, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
    };

    // Alphabetical order is a-slow, b-mid, c-fast. Cost order is the reverse, so
    // a run that happens to be alphabetical cannot pass this by luck.
    const ordered = withTable(
      { 'proof:a-slow': 90, 'proof:b-mid': 10, 'proof:c-fast': 1 },
      ['a-slow', 'b-mid', 'c-fast'],
    );
    check(
      'the sweep runs cheapest-measured FIRST, not alphabetically',
      ordered.order.join(',') === 'proof:c-fast,proof:b-mid,proof:a-slow',
      `ran ${ordered.order.join(', ')}. The fixture's alphabetical order is the exact reverse ` +
        `of its cost order, so an unsorted run reads as a-slow first. Output:\n${ordered.output}`,
    );

    // `a-unknown` sorts FIRST alphabetically and is absent from the table.
    const unmeasured = withTable(
      { 'proof:b-known': 5 },
      ['a-unknown', 'b-known'],
    );
    check(
      'a never-measured script runs after every measured one that fits the budget',
      unmeasured.order.join(',') === 'proof:b-known,proof:a-unknown',
      `ran ${unmeasured.order.join(', ')}. Sorting an unknown cost as cheap lets one new ` +
        `expensive script strand the whole queue again, which is the failure the ordering ` +
        `exists to prevent. Output:\n${unmeasured.output}`,
    );

    // The middle bucket (finding SSS-1). Sorting the unknown behind EVERYTHING
    // stranded new scripts permanently: it sat behind a script that times out on
    // every run, was reported "never measured", and so sorted last again next
    // time — "will never be measured" printed as "not yet measured".
    //
    // Alphabetical order here is a-doomed, b-unknown, c-cheap, which is neither
    // the expected order nor a rotation of it, so neither an unsorted run nor
    // the old two-bucket sort (c-cheap, a-doomed, b-unknown) can pass by luck.
    const bucketed = withTable(
      { 'proof:a-doomed': 400, 'proof:c-cheap': 1 },
      ['a-doomed', 'b-unknown', 'c-cheap'],
    );
    check(
      'a never-measured script runs BEFORE one whose last cost hit the budget',
      bucketed.order.join(',') === 'proof:c-cheap,proof:b-unknown,proof:a-doomed',
      `ran ${bucketed.order.join(', ')}, expected proof:c-cheap, proof:b-unknown, ` +
        `proof:a-doomed. A script already measured at or over the bound is one this sweep ` +
        `knows it cannot finish, so putting the unknown behind it too is what made "never ` +
        `measured" permanent. The unknown belongs after the cheap work and ahead of the ` +
        `portion that was going to strand anyway. Output:\n${bucketed.output}`,
    );

    // The table is written BEFORE the summary, so a run that stopped early still
    // improves the next one's ordering — which is precisely the run that needs
    // it most.
    const partial = runFixture(
      { 'a-hangs.mjs': HANGS, 'b-marks.mjs': EXIT_ZERO },
      { 'proof:a-hangs': 'node scripts/a-hangs.mjs', 'proof:b-marks': 'node scripts/b-marks.mjs' },
      ['--timeout', '2'],
    );
    // -----------------------------------------------------------------------
    // 13 & 14. THE TREE MOVED (finding WWW-1). A harness property, and the one
    // that cost a tracked document: this sweep KILLS a script at the bound, a
    // killed process does not run its `finally`, and a proof that removes a
    // tracked file to make a point leaves it removed. Measured — a 90-second
    // sweep deleted `docs/ENGINE-SPIKE.md` and printed a clean summary.
    //
    // The fixture is a real git repository, because the witness asks git. The
    // script under test deletes a tracked file and exits 0, so nothing else in
    // the run has anything to complain about — which is the point: without the
    // witness this sweep reports "1 passed" over a damaged tree.
    // -----------------------------------------------------------------------
    {
      const root = mkdtempSync(join(scratch, 'moved '));
      mkdirSync(join(root, 'scripts'), { recursive: true });
      const git = (/** @type {string[]} */ args) =>
        spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      git(['init', '--quiet']);
      git(['config', 'user.email', 'proof@example.invalid']);
      git(['config', 'user.name', 'proof']);
      writeFileSync(join(root, 'tracked.txt'), 'content\n', 'utf8');
      writeFileSync(
        join(root, 'scripts', 'deletes.mjs'),
        "import { rmSync } from 'node:fs';\n" +
          "rmSync(new URL('../tracked.txt', import.meta.url), { force: true });\n" +
          'process.exit(0);\n',
        'utf8',
      );
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
          { name: 'fixture', scripts: { 'check:deletes': 'node scripts/deletes.mjs' } },
          null,
          2,
        ),
        'utf8',
      );
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', 'base']);

      const moved = spawnSync(
        process.execPath,
        [HARNESS, '--root', root, '--floor', '1'],
        { encoding: 'utf8' },
      );
      const output = `${moved.stdout ?? ''}${moved.stderr ?? ''}`;
      check(
        'a script that damages the tree makes the sweep report THE TREE MOVED',
        moved.status !== 0 && /THE TREE MOVED/u.test(output),
        `Every script PASSED, so nothing else in this run has a complaint — which is exactly ` +
          `the shape that deleted a tracked document and printed a clean summary. ` +
          `exit=${String(moved.status)}. Output:\n${output}`,
      );
      check(
        'CONTROL: and a sweep that damages nothing says the tree is as it found it',
        (() => {
          const clean = runFixture(
            { 'ok.mjs': EXIT_ZERO },
            { 'check:ok': 'node scripts/ok.mjs' },
          );
          // The fixture repositories runFixture builds are not git repos, so
          // this asserts the OTHER honest state rather than a clean witness —
          // "nobody looked" and "nothing moved" are different answers and this
          // file must not let them merge.
          return clean.ok && /not witnessed: this root is not a git repository/u.test(clean.output);
        })(),
        'without this, "THE TREE MOVED" is satisfied by a harness that says it every time, and ' +
          'a third state that always fires is one people learn to ignore.',
      );
    }

    check(
      'a run that STOPPED early still records what it measured',
      (() => {
        try {
          const table = JSON.parse(
            readFileSync(join(partial.root, '.cache', 'checkLocal-durations.json'), 'utf8'),
          );
          return typeof table['proof:a-hangs'] === 'number';
        } catch {
          return false;
        }
      })(),
      'the timed-out script has no recorded cost, so the next run sorts it first again and ' +
        'strands the queue in exactly the same place. A partial sweep is the one whose ' +
        'ordering most needs the measurement it just took.',
    );
  }

  // -------------------------------------------------------------------------
  // 15-19. THE MULTI-PROOF SWEEP IS REFUSED (finding WWW-2).
  //
  // Four of these drive the judgement directly and one drives the harness,
  // because the BOUNDARY has a side the harness cannot exercise cheaply: the
  // refusing side costs nothing, and the permitted side costs whatever the
  // selected scripts cost. Testing only the refusing side would leave the
  // question *does this guard block the pre-push sweep* answered by nobody —
  // and a guard that blocks ordinary work is the one that gets turned off,
  // which this project has already paid for in the escape hook.
  // -------------------------------------------------------------------------
  check(
    'two proofs selected in THIS repository is refused, and the message names the finding',
    (() => {
      const refusal = multiProofSweepRefusal({
        rootDir: REPO,
        repoRoot: REPO,
        selected: ['check:docs', 'proof:one', 'proof:two'],
      });
      return refusal !== null && refusal.includes('WWW-2') && refusal.includes('job object');
    })(),
    'a refusal that does not name the finding or what would unblock it is read as a bug in ' +
      'the tool, and the pressure lands on adding an override.',
  );
  check(
    'CONTROL: ONE proof is permitted — the boundary is where contamination cannot occur',
    multiProofSweepRefusal({
      rootDir: REPO,
      repoRoot: REPO,
      selected: ['proof:hostcontainment'],
    }) === null,
    'a single proof has no earlier script in the same run to be contaminated by. A guard ' +
      'that refuses it is refusing the ordinary way to run one proof.',
  );
  check(
    'CONTROL: `--only check:` selects no proofs and is permitted',
    multiProofSweepRefusal({
      rootDir: REPO,
      repoRoot: REPO,
      selected: ['check:docs', 'check:lockfile', 'check:emittedtemplates'],
    }) === null,
    'this is the habitual pre-push sweep. If it ever refuses, the guard has widened past ' +
      'the measurement behind it.',
  );
  check(
    'CONTROL: a FIXTURE repository is exempt, whatever it declares',
    multiProofSweepRefusal({
      rootDir: join(scratch, 'somewhere-else'),
      repoRoot: REPO,
      selected: ['proof:a', 'proof:b', 'proof:c', 'proof:d'],
    }) === null,
    'every case above this line builds a fixture repository declaring several proofs. A ' +
      'guard scoped to the tree rather than to this one would make the harness untestable ' +
      'by its own proof (QQQ-2).',
  );
  {
    const swept = spawnSync(process.execPath, [HARNESS], { encoding: 'utf8' });
    const output = `${swept.stdout ?? ''}${swept.stderr ?? ''}`;
    check(
      'the harness itself refuses the real sweep, and refuses it BEFORE running anything',
      swept.status === 78 && /WWW-2/u.test(output) && !/declared check\/proof script/u.test(output),
      `exit=${String(swept.status)}. The second half is the vacuity guard: a harness that ` +
        `refused only after sweeping would satisfy the exit code while still costing twenty ` +
        `minutes and inventing the failures. Output:\n${output}`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} checkLocal case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('checkLocal case'),
);
// `process.exitCode`, NOT `process.exit()`. Measured: with `process.exit()` this
// file printed all eight case lines TWICE and the summary once — Node tears the
// process down with writes still in flight and the pending stdout buffer is
// re-emitted. Every case still ran exactly once, which is what makes it nasty:
// the roster counted eight while the output claimed sixteen, so the duplication
// is invisible to every assertion in the file and shows up only to a reader.
//
// This file spawns more child processes than its siblings, which is why it met
// the condition first rather than why it is special.
process.exitCode = failures.length === 0 ? 0 : 1;
