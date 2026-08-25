// @ts-check
/**
 * Which MODE does a `worker_threads` Worker inside Electron's main process run
 * in?
 *
 * ## Why this is measured before a line of the reader is written
 *
 * CLAUDE.md's placement rule is *anything that runs in Node mode lives outside
 * `desktop`*, and it says why: `apps/desktop/src/` is exempted from the
 * Electron-import ban as a PROXY for "runs inside Electron", and that proxy has
 * already failed three times — a module vitest imports, and the engine host,
 * which runs the Electron binary under `ELECTRON_RUN_AS_NODE=1` and so *is*
 * Node. The rule's own instruction is to ask which mode a file runs in.
 *
 * The engine host's reader is a Worker inside main. Nobody here has asked that
 * question of a worker thread, and the answer decides where the shipped file
 * lives — which is the decision this project says it must not retrofit.
 *
 * So the premise is measured rather than cited. It also carries an expiry a
 * document cannot enforce: whether a worker thread sees Electron's module is a
 * property of the RUNTIME, and an Electron bump is exactly the event that would
 * change it in silence.
 *
 * ## What separates the cases
 *
 * The reassuring answer is *the worker could not import Electron*, and a harness
 * that could not import Electron ANYWHERE produces it too. So main takes the
 * same measurement first and must succeed — the negative-probe rule in item 4b:
 * build the input from something that would succeed if the property were absent.
 *
 * And *the import succeeded* is not the question either. Electron's package
 * exports a STRING PATH when the runtime is not Electron, which is the mechanism
 * behind invariant 26. The test is whether the imported value carries `app`.
 *
 * Usage: node scripts/research/workerMode.mjs [--require-electron]
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const MARKER = 'MONSTERA_WORKER_MODE ';
const HARNESS = join(ROOT, 'apps', 'desktop', 'dist', 'workerModeHarnessMain.js');
const WORKER = join(ROOT, 'apps', 'desktop', 'dist', 'workerModeHarnessWorker.js');

/** Passed by the jobs that provision Electron. See `scripts/lib/unverifiable.mjs`. */
const REQUIRE = process.argv.includes('--require-electron');
/** @param {string} why @returns {never} */
const unverifiable = (why) =>
  exitUnverifiable({
    required: REQUIRE,
    subject: "a worker thread's runtime mode",
    why,
    flag: '--require-electron',
  });

for (const built of [HARNESS, WORKER]) {
  if (!existsSync(built)) {
    unverifiable(`${built} is not built. Run \`npm run build\`.`);
  }
}

const binary = electronBinaryPath(ROOT);
if (!existsSync(binary)) {
  unverifiable(`the pinned Electron binary is not at ${binary}. Run the provisioning step.`);
}

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

// Linux needs a display for Electron and hangs without one rather than failing,
// which is why `rendererPolicy.proof.mjs` refuses up front instead of
// discovering it after a timeout. This probe measures a Windows placement
// question, so it declines rather than reaching for xvfb.
if (process.platform !== 'win32') {
  unverifiable(
    `this decides where a Windows reader thread's file lives, and Electron needs a display ` +
      `server on ${process.platform}, which it HANGS without rather than failing.`,
  );
}

const run = spawnSync(binary, [HARNESS], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 120_000,
  maxBuffer: 16 * 1024 * 1024,
});

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const line = output.split(/\r?\n/).find((entry) => entry.startsWith(MARKER));

check(
  'SETUP: the harness ran under Electron and reported',
  line !== undefined,
  `no ${MARKER.trim()} line in ${String(output.length)} bytes of output; exit ` +
    `${String(run.status)}, signal ${String(run.signal)}. A harness that never spoke and one that ` +
    `spoke a bad answer need different fixes, so this separates them before anything else is ` +
    `read.\n${output.slice(0, 2000)}`,
);

/** @type {Record<string, unknown>} */
let report = {};
let parseFailure = line === undefined ? 'there was no line to parse' : '';
if (line !== undefined) {
  try {
    report = JSON.parse(line.slice(MARKER.length));
  } catch (error) {
    parseFailure = `${String(error)} for ${JSON.stringify(line.slice(0, 400))}`;
  }
}

// UNCONDITIONAL, and it was inside the `if` first — where it ran only when
// parsing failed, so the roster declared six cases and recorded five. The
// hand-kept count caught it, which is the half of that anchor nobody exercises:
// a case that runs SOMETIMES is a case whose absence is the ordinary outcome.
check(
  'and its line parsed',
  parseFailure === '',
  parseFailure,
);
// THE MARKER IS REUSED FOR THE HARNESS'S OWN FAILURES, deliberately — that is
// what separates "it ran and reported a problem" from "it never spoke". Which
// means the SETUP case above passes on a failure line, and it did: the first run
// found a marker, and every field below was `undefined` because the payload was
// `{"harness":"rejected","detail":"__dirname is not defined"}`.
//
// So the failure shape gets its own case rather than being left to arrive as
// four confusing undefineds.
check(
  'and the line is a REPORT rather than the harness saying it broke',
  report['harness'] === undefined,
  `the harness said ${JSON.stringify(report['harness'])}: ${JSON.stringify(report['detail'])}. ` +
    `Every field below is read out of a payload that does not exist, so without this case a ` +
    `harness crash arrives as a measurement that says undefined.`,
);

const worker = /** @type {Record<string, unknown>} */ (report['worker'] ?? {});

check(
  'CONTROL: MAIN has a usable Electron module in the same run',
  report['mainHasApp'] === true,
  `main reported ${JSON.stringify(report['mainHasApp'])}. Without this, "the worker could not" ` +
    `is indistinguishable from "this harness cannot import Electron at all" — refusal and ` +
    `impossibility producing the same observation, which is the negative-probe rule.`,
);

check(
  'the worker reported rather than dying',
  worker['workerThrew'] === undefined && worker['workerExited'] === undefined,
  `the worker ended without a report: ${JSON.stringify(worker)}. A thread that died is not an ` +
    `answer about what a living one can see.`,
);

// THE MEASUREMENT ITSELF. Both outcomes are legitimate and the case asserts
// neither — it asserts that the answer was READABLE, and prints it. A case
// pinning one outcome would go red on the Electron bump that changes it, which
// is a finding to read rather than a build to break; the placement decision it
// feeds is recorded in ADR-0023.
check(
  'and it says which mode it is in, unambiguously',
  worker['importOutcome'] === 'module' ||
    worker['importOutcome'] === 'path' ||
    worker['importOutcome'] === 'failed',
  `importOutcome was ${JSON.stringify(worker['importOutcome'])}. The three outcomes are a usable ` +
    `module, the STRING PATH Electron's package exports when the runtime is not Electron, and a ` +
    `failure — and "the import succeeded" cannot tell the first two apart, which is the ` +
    `mechanism behind invariant 26.`,
);

process.stdout.write(
  `\n  main:   hasApp=${JSON.stringify(report['mainHasApp'])} ` +
    `type=${JSON.stringify(report['mainProcessType'])}\n` +
    `  worker: type=${JSON.stringify(worker['processType'])} ` +
    `electron=${JSON.stringify(worker['electronVersion'])}\n` +
    `          import=${JSON.stringify(worker['importOutcome'])} ` +
    `hasApp=${JSON.stringify(worker['hasApp'])}\n` +
    `          ${String(worker['detail'] ?? '').slice(0, 200)}\n\n`,
);

if (failures.length > 0) {
  process.stderr.write(
    `\nWorker mode — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

process.stdout.write(`${roster.format('worker-mode case')}`);
