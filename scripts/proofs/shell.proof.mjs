// @ts-check
/**
 * Proves the composition root RUNS: the renderer uses the contract end to end.
 *
 * ## Why a typecheck is not evidence here
 *
 * A composition root that is only known to compile is one nobody has run, and
 * this repository has found that exact defect twice in a week — a preload that
 * had never executed, and a failure channel nobody subscribed to. Both passed
 * every static check written about them, correctly, because the defect was not
 * in the file being read.
 *
 * So this spawns Electron on a harness that calls the same two functions
 * `entry.ts` calls, and then makes the **page** invoke `app.info` across the
 * real `contextBridge`, through the real `ipcMain` registration, into the real
 * handler. Nothing is rebuilt for the test: a rebuilt graph proves a copy works.
 *
 * ## The unhappy channel is asserted too, and it is the interesting one
 *
 * `document.execute` must return a **declared** failure rather than `internal`.
 * The case here executes against a `DocId` the service never issued, so it
 * stops at `document-not-open` — the refusal that comes before any session is
 * looked up.
 *
 * **That is narrower than it used to claim, and the difference is finding
 * KKKK-3.** This paragraph read *"opening a document is not a channel, so every
 * input the renderer can construct stops at `document-not-open` first"*, and it
 * was true when written. `document.open` landed at `584362b` and it stopped
 * being true in that commit — after which a renderer could open a document,
 * execute against it, and reach a session lookup that missed, which
 * `documentCommands.ts` defines as a **defect** and answers with `internal`.
 *
 * **This proof passed throughout, correctly.** Its case cannot reach that state:
 * a `DocId` that was never opened is refused before the lookup, so the
 * assertion stayed true while the sentence explaining it became false. A
 * fixture that cannot reach the state its own prose calls unreachable separates
 * nothing, and no mutation of the code under test finds it — which is why the
 * case that does live at the composition root (`composition.test.ts`), where an
 * open really happens and the document ends **poisoned** rather than sessionless.
 *
 * ## UNVERIFIABLE, never passed, when the runtime is absent
 *
 * Same rule as `proof:rendererpolicy`: *could not look* is not *looked and found
 * nothing*, and this proof's entire content needs the process.
 *
 * Usage: node scripts/proofs/shell.proof.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'shellHarness.js');
const MARKER = 'MONSTERA_SHELL_READBACK ';

const ELECTRON_BINARY = electronBinaryPath(REPO_ROOT);
const RUNTIME_PRESENT = existsSync(ELECTRON_BINARY) && existsSync(HARNESS);

/** The cases that need the runtime, named once so the count derives from them. */
const RUNTIME_CASES = [
  'the page can see the bridge, so it could call anything at all',
  'app.info answers OVER THE REAL CONTRACT, with the value the shell supplied',
  'document.execute returns a DECLARED failure, not internal',
  "Electron still carries `dialog.showOpenDialog`, read before it is replaced",
  'the picker asks for ONE file and no recent-documents entry',
  'a dismissal and an empty selection are BOTH null, and a real path comes back',
  'the SHIPPED app.quit() is DEFERRED until the teardown settles',
  'the process exits 0 with the teardown having run, not merely exits',
  'CONTROL: the app ended on its own rather than being killed at the bound',
  'CONTROL: a launch that WINS the single-instance lock builds the graph',
  'a launch that LOSES the lock never calls the dependency factory',
  'the losing launch started at all, so the absence above is a decision',
  'the losing launch ended itself rather than being killed at the bound',
];

// THE ANCHOR, BECAUSE THE LINE BELOW IS NOT ONE (finding EEEEE-1). `passRoster`
// throws when the recorded total disagrees with the declared one, so deleting a
// `check()` call alone is loud. It cannot see a case removed TOGETHER with its
// label — the same edit anybody deleting a case makes, in this file, seconds
// apart — because the declared count is computed from the list that names them.
// Every other proof in this repository declares a literal; this one derived, and
// the derivation is what removed the anchor. 4c's danger here runs toward
// shrinkage, and a derived count agrees with any shrink.
if (RUNTIME_CASES.length !== 13) {
  throw new Error(
    `This proof names ${String(RUNTIME_CASES.length)} runtime cases and the anchor says 13. ` +
      `Raise or lower the literal in the same commit and say why: a case that leaves takes its ` +
      `label and the total with it, and nothing else here would notice.`,
  );
}

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: RUNTIME_PRESENT ? RUNTIME_CASES.length : 0 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * How to launch the harness on this platform.
 *
 * `xvfb-run -a` on Linux for the reason `proof:rendererpolicy` records: without
 * a display Electron does not error, it HANGS, and a hang reads as a flake.
 *
 * Extracted rather than repeated when the quit probe below needed it too. How
 * Electron is started is one question, and two callers answering it separately
 * is how they come to disagree — the second one would have been written from
 * the first by eye, and the hang this guards against is silent.
 *
 * @param {string} binary
 * @param {string[]} extraArgs
 * @returns {[command: string, args: string[]]}
 */
function launch(binary, extraArgs) {
  const needsDisplay = process.platform === 'linux' && process.env['DISPLAY'] === undefined;
  const XVFB = ['/usr/bin/xvfb-run', '/bin/xvfb-run', '/usr/local/bin/xvfb-run'];
  let wrapper;
  if (needsDisplay) {
    wrapper = XVFB.find((path) => existsSync(path));
    if (wrapper === undefined) {
      throw new Error(
        `Electron needs an X display on Linux and no xvfb-run was found. Tried:\n  ` +
          `${XVFB.join('\n  ')}\nRunning without one does not error — it HANGS.`,
      );
    }
  }
  return wrapper === undefined
    ? [binary, [HARNESS, ...extraArgs]]
    : [wrapper, ['-a', binary, HARNESS, ...extraArgs]];
}

/**
 * The single-instance ordering, driven as two real processes over one lock.
 *
 * ## Why this is not a unit test, stated rather than implied
 *
 * The property is *`startShell` does not call `build()` when the lock is lost*.
 * `startShell` lives in `main.ts`, which imports Electron, so nothing under
 * vitest can load it — and the ordering is exactly the kind of claim a type
 * makes and no compiler checks, since both call sites would still compile if the
 * factory were invoked one line earlier.
 *
 * ## Both processes share a PRIVATE userData, and that is load-bearing twice
 *
 * `requestSingleInstanceLock` is keyed on the userData directory. A temporary
 * one makes the two runs contend with each other and with nothing else: without
 * it a developer's own Monstera would decide the result, and this proof would
 * pass or fail on what happened to be open.
 *
 * ## The winner is waited FOR, never slept after
 *
 * The loser may only start once the lock is genuinely held, and the marker file
 * is the event that says so. A sleep would encode a guess about how long
 * Electron takes to reach the factory, and would silently become a race on a
 * slower runner.
 *
 * @param {string} binary
 * @returns {Promise<{ winner: string[], loser: string[], status: number | null,
 *   signal: NodeJS.Signals | null }>}
 */
async function singleInstanceRun(binary) {
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-instance-'));
  const userData = join(scratch, 'userData');
  const winnerFile = join(scratch, 'winner.txt');
  const loserFile = join(scratch, 'loser.txt');
  writeFileSync(winnerFile, '');
  writeFileSync(loserFile, '');

  const [command, args] = launch(binary, [
    `--user-data-dir=${userData}`,
    '--instance-marker',
    winnerFile,
  ]);
  const winner = spawn(command, args, { cwd: REPO_ROOT, stdio: 'ignore' });

  try {
    // WAIT FOR THE EVENT. `FACTORY_RAN` in the winner's file means the lock was
    // taken and the graph built, which is the precondition the loser needs.
    const until = Date.now() + 120_000;
    for (;;) {
      const seen = readFileSync(winnerFile, 'utf8');
      if (seen.includes('MONSTERA_FACTORY_RAN')) break;
      if (winner.exitCode !== null) {
        throw new Error(
          `The winning launch exited ${String(winner.exitCode)} before building the graph, so ` +
            `there was never a lock for the second launch to lose.`,
        );
      }
      if (Date.now() > until) {
        throw new Error('The winning launch never reached the dependency factory.');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const [loserCommand, loserArgs] = launch(binary, [
      `--user-data-dir=${userData}`,
      '--instance-marker',
      loserFile,
    ]);
    const result = spawnSync(loserCommand, loserArgs, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      // A BOUND THAT DECIDES NOTHING WHILE THE MECHANISM WORKS. A losing launch
      // quits in the same turn it starts; only a broken one reaches this, and
      // the signal it produces is asserted rather than tolerated.
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });

    /** @param {string} path @returns {string[]} */
    const lines = (path) =>
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('MONSTERA_'));

    return {
      winner: lines(winnerFile),
      loser: lines(loserFile),
      status: result.status,
      signal: result.signal,
    };
  } finally {
    // KILL WHAT YOU OPEN. The winner has no reason to stop on its own — it is
    // holding a lock and a window — so a run that threw above would otherwise
    // leave an Electron process behind holding this userData.
    winner.kill();
  }
}

/**
 * Runs the harness to a real quit and returns the lifecycle markers in order.
 *
 * ORDER IS THE CLAIM, so the lines are kept as a sequence rather than a set.
 * `shellShutdown.test.ts` proves the decision against injected surfaces; what
 * no unit test can reach is whether the SHIPPED Electron honours the
 * `preventDefault` this shell issues. If it does not, the process carries on
 * quitting and ends before the harness's 250ms teardown prints its second
 * line — so a missing DONE is the defect, and its position relative to
 * `will-quit` is the proof it was deferred rather than merely fast.
 *
 * @param {string} binary
 * @returns {{ status: number | null, signal: NodeJS.Signals | null, markers: string[], output: string }}
 */
function quitRun(binary) {
  // A FILE, NOT STDOUT, and CI is why. The markers used to be written to the
  // harness's stdout and the last two vanished on both platforms: the process
  // exited 0, so the quit sequence completed and DONE and `will-quit` were
  // written — but `process.stdout` to a pipe is asynchronous and nothing
  // flushes it when Electron ends the process.
  //
  // The instrument was sharing its subject's failure. What is measured here is
  // a process shutting down, so a channel that shutdown tears down loses the
  // reading exactly when it becomes interesting, and the loss reads as *it
  // never happened*.
  const markerFile = join(
    mkdtempSync(join(tmpdir(), 'monstera-quit-')),
    'markers.txt',
  );
  writeFileSync(markerFile, '');

  const [command, args] = launch(binary, ['--quit-when-ready', markerFile]);
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run the quit probe via ${command}`, { cause: result.error });
  }
  const markers = readFileSync(markerFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('MONSTERA_QUIT_'));
  // The harness's own words still come from stdio, because a harness that died
  // before writing a marker has nothing in the file and everything in stderr.
  const output = `${result.stdout}${result.stderr}`;
  // `signal` IS THE CONTROL, and `will-quit` used to be. A harness killed at
  // the 120s bound carries a signal; one that ended on its own does not. That
  // is the question the control actually asks — *did this hang* — asked
  // directly instead of through an Electron event that headless CI does not
  // reliably emit.
  return { status: result.status, signal: result.signal, markers, output };
}

/**
 * Runs the harness and returns what the renderer saw.
 *
 * @param {string} binary
 * @returns {{ appInfo: unknown, execute: unknown, bridgePresent: boolean, picker: unknown }}
 */
function readback(binary) {
  const [command, args] = launch(binary, []);
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run the shell harness via ${command}`, { cause: result.error });
  }

  const line = `${result.stdout}`.split(/\r?\n/).find((entry) => entry.startsWith(MARKER));
  if (line === undefined) {
    const spoke = `${result.stderr}`
      .split(/\r?\n/)
      .filter((entry) => entry.startsWith('MONSTERA_SHELL_HARNESS_FAILED'))
      .join('\n');
    throw new Error(
      `The shell harness produced no ${MARKER.trim()} line (exit ${String(result.status)}).\n` +
        (spoke === ''
          ? `It reported no failure of its own either, so it was killed or never started.\n`
          : `${spoke}\n`) +
        `stderr: ${result.stderr.slice(-2400)}`,
    );
  }
  return JSON.parse(line.slice(MARKER.length));
}

try {
  if (!RUNTIME_PRESENT) {
    // THE BLANK MARKER, NOT THE PARTIAL ONE, and the difference is a fact about
    // this file rather than a judgement: `createRoster` above takes
    // `RUNTIME_PRESENT ? RUNTIME_CASES.length : 0`, so with no runtime there are
    // no cases at all and every `check()` sits inside the branch below. This run
    // measures NOTHING, which is exactly what `UNVERIFIABLE_MARKER` says.
    //
    // Its neighbours `rendererPolicy` and `canvasPixels` assert string cases
    // first and are partial; grouping this one with them would have said *some
    // of it ran* about a run in which none did.
    exitUnverifiable({
      required: false,
      subject: 'the composition root running',
      why:
        `${String(RUNTIME_CASES.length)} case(s) could not be evaluated:\n` +
        `${RUNTIME_CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
        `${existsSync(ELECTRON_BINARY) ? 'The harness' : 'The Electron runtime'} is missing. ` +
        `Run \`npm run provision:electron\` and \`npm run build\`. These cases are the only ` +
        `evidence that the composition root has ever been executed, so a run without them ` +
        `proves that it compiles and nothing more.`,
      flag: '--require-runtime',
    });
  } else {
    const seen = readback(ELECTRON_BINARY);

    check(
      'the page can see the bridge, so it could call anything at all',
      seen.bridgePresent,
      `the renderer found no bridge, so both readings below are absences produced by a page ` +
        `that could not call rather than by a contract that did not answer.`,
    );

    const info = /** @type {{ ok?: unknown, value?: { installChannel?: unknown } }} */ (
      seen.appInfo
    );
    check(
      'app.info answers OVER THE REAL CONTRACT, with the value the shell supplied',
      info?.ok === true && info.value?.installChannel === 'development',
      `app.info returned ${JSON.stringify(seen.appInfo)}. ` +
        `\`installChannel\` is asserted rather than \`version\` because it comes from THIS ` +
        `repository's code, so it proves the composition root's AppInfo reached the page — ` +
        `whereas \`app.getVersion()\` reports whatever package.json Electron was started from, ` +
        `and this harness is spawned as a file rather than as the app directory.`,
    );

    const executed = /** @type {{ ok?: unknown, error?: { code?: unknown } }} */ (seen.execute);
    check(
      'document.execute returns a DECLARED failure, not internal',
      executed?.ok === false && executed.error?.code === 'document-not-open',
      `document.execute returned ${JSON.stringify(seen.execute)}. There is no engine host, so ` +
        `the session lookup misses by design — but opening a document is NOT a channel, so the ` +
        `renderer cannot construct an input that reaches the miss and every input it can ` +
        `construct stops at document-not-open first. An \`internal\` here would mean that ` +
        `reasoning is wrong and the channel is answering with a defect.`,
    );

    // THE PICKER, WHICH HAD NEVER RUN ANYWHERE (finding B4). `entry.ts` calls
    // its factory, so the module loads in production; the function that factory
    // returns — where every claim the module's comments make actually lives —
    // had never been invoked by anything.
    const picker = /** @type {{ apiPresent?: unknown, options?: unknown, answers?: unknown }} */ (
      seen.picker
    );
    check(
      "Electron still carries `dialog.showOpenDialog`, read before it is replaced",
      picker?.apiPresent === true,
      `the real dialog object does not carry showOpenDialog as a function. Read from the ` +
        `runtime rather than assumed, because everything below runs against a REPLACEMENT — ` +
        `and a stub is happy to be called by a name Electron no longer has, which is the ` +
        `available:true shape wearing a passing test.`,
    );

    const options = /** @type {{ properties?: unknown[] }} */ (picker?.options);
    check(
      'the picker asks for ONE file and no recent-documents entry',
      Array.isArray(options?.properties) &&
        options.properties.includes('openFile') &&
        options.properties.includes('dontAddToRecent') &&
        !options.properties.includes('multiSelections') &&
        !options.properties.includes('openDirectory'),
      `the picker passed ${JSON.stringify(picker?.options)}. Both halves are asserted and the ` +
        `absences are the load-bearing ones: DocumentService opens one document from one path, ` +
        `so a picker that could return three offers a shape nothing downstream can take — and ` +
        `the recent-documents list is one this application did not ask for and cannot clear.`,
    );

    check(
      'a dismissal and an empty selection are BOTH null, and a real path comes back',
      Array.isArray(picker?.answers) &&
        picker.answers.length === 3 &&
        picker.answers[0] === null &&
        picker.answers[1] === null &&
        picker.answers[2] === '/tmp/one.pdf',
      `the picker answered ${JSON.stringify(picker?.answers)}. The third is the control: the ` +
        `first two are satisfied by a picker that returns null for everything, which is a ` +
        `document nobody can ever open — and it would pass an assertion about cancellation ` +
        `alone with nothing red.`,
    );

    // ---------------------------------------------------------------------
    // THE LIFECYCLE, against the shipped runtime. A separate launch because it
    // ends the process deliberately, and the readback above needs one that
    // stays up.
    // ---------------------------------------------------------------------
    const quit = quitRun(ELECTRON_BINARY);
    const order = quit.markers.join(' ');
    const startAt = quit.markers.indexOf('MONSTERA_QUIT_TEARDOWN_START');
    const doneAt = quit.markers.indexOf('MONSTERA_QUIT_TEARDOWN_DONE');

    check(
      'the SHIPPED app.quit() is DEFERRED until the teardown settles',
      startAt !== -1 && doneAt > startAt,
      `markers were [${order}]. The teardown sleeps 250ms between START and DONE, so an ` +
        `Electron that ignored this shell's preventDefault ends the process with no DONE line ` +
        `at all — which is exactly what removing preventDefault produces. This is the ` +
        `measurement that was carried as "not established".`,
    );

    check(
      'the process exits 0 with the teardown having run, not merely exits',
      quit.status === 0 && startAt !== -1,
      `exit ${String(quit.status)}, markers [${order}]. An exit code alone is not the claim: a ` +
        `handler that does nothing also exits 0, so the START marker is what separates a ` +
        `teardown that ran from a quit that was never deferred.\n${quit.output.slice(-1200)}`,
    );

    // THE CONTROL, ASKED DIRECTLY. This was `will-quit` must have fired, which
    // is a PROXY for *the app did not hang* — and CI showed the proxy failing
    // while the thing it stood for held: DONE written, exit 0, no `will-quit`.
    // Electron does not reliably emit it with no window on a headless runner,
    // so the proxy reported a defect that was not there.
    //
    // `signal` is the question itself: a harness killed at the 120s bound
    // carries one, a harness that ended on its own does not. It also cannot be
    // satisfied by the failure it guards, which is what the proxy could not say.
    check(
      'CONTROL: the app ended on its own rather than being killed at the bound',
      quit.signal === null && quit.markers.includes('MONSTERA_QUIT_REQUESTED'),
      `signal ${String(quit.signal)}, markers [${order}]. A hang is killed at 120s and the ` +
        `ordering above would then be satisfied by a run that never finished quitting.`,
    );

    const instance = await singleInstanceRun(ELECTRON_BINARY);
    const winnerSaw = `[${instance.winner.join(', ')}]`;
    const loserSaw = `[${instance.loser.join(', ')}]`;

    // THE CONTROL FIRST, AND IT IS THE ONE THAT MAKES THE ABSENCE BELOW MEAN
    // ANYTHING. "The factory did not run" is also what a marker nobody writes
    // produces, and what a harness that crashed on load produces. This asserts
    // the same flag, on the same binary, writes the same line when the lock IS
    // won — so the negative case's input is one the absent guard would let
    // through.
    check(
      'CONTROL: a launch that WINS the single-instance lock builds the graph',
      instance.winner.includes('MONSTERA_FACTORY_RAN'),
      `the winning launch wrote ${winnerSaw}. Without this line the case below is satisfied ` +
        `by a marker that never works, on either launch.`,
    );

    check(
      'a launch that LOSES the lock never calls the dependency factory',
      !instance.loser.includes('MONSTERA_FACTORY_RAN'),
      `the losing launch wrote ${loserSaw}. \`startShell\` takes a factory precisely so a ` +
        `launch that must quit constructs nothing: \`createEngineHostPlatform\` creates the ` +
        `session root and now SWEEPS it, so a second launch running it would delete the pairs ` +
        `of the running instance's open documents.`,
    );

    check(
      'the losing launch started at all, so the absence above is a decision',
      instance.loser.includes('MONSTERA_SHELL_STARTED'),
      `the losing launch wrote ${loserSaw}. A harness that failed to load writes nothing and ` +
        `satisfies the case above perfectly, which is the reading this line rules out.`,
    );

    check(
      'the losing launch ended itself rather than being killed at the bound',
      instance.signal === null && instance.status === 0,
      `exit ${String(instance.status)}, signal ${String(instance.signal)}. A launch that took ` +
        `the lock branch quits in the turn it starts; one that fell through builds a graph and ` +
        `opens a window, and is killed at the bound — which would otherwise satisfy the ` +
        `absence above by never getting far enough to write the marker.`,
    );

    process.stdout.write(
      failures.length > 0
        ? `${failures.length} shell failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
        : roster.format('shell case'),
    );
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
