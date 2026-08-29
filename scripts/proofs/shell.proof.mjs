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

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
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
];

// THE ANCHOR, BECAUSE THE LINE BELOW IS NOT ONE (finding EEEEE-1). `passRoster`
// throws when the recorded total disagrees with the declared one, so deleting a
// `check()` call alone is loud. It cannot see a case removed TOGETHER with its
// label — the same edit anybody deleting a case makes, in this file, seconds
// apart — because the declared count is computed from the list that names them.
// Every other proof in this repository declares a literal; this one derived, and
// the derivation is what removed the anchor. 4c's danger here runs toward
// shrinkage, and a derived count agrees with any shrink.
if (RUNTIME_CASES.length !== 6) {
  throw new Error(
    `This proof names ${String(RUNTIME_CASES.length)} runtime cases and the anchor says 6. ` +
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
 * Runs the harness under a display and returns what the renderer saw.
 *
 * `xvfb-run -a` on Linux for the reason `proof:rendererpolicy` records: without
 * a display Electron does not error, it HANGS, and a hang reads as a flake.
 *
 * @param {string} binary
 * @returns {{ appInfo: unknown, execute: unknown, bridgePresent: boolean, picker: unknown }}
 */
function readback(binary) {
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

  const [command, args] =
    wrapper === undefined ? [binary, [HARNESS]] : [wrapper, ['-a', binary, HARNESS]];
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
    process.stdout.write(
      `UNVERIFIABLE — ${String(RUNTIME_CASES.length)} case(s) could not be evaluated here:\n` +
        `${RUNTIME_CASES.map((label) => `  ??  ${label}\n`).join('')}\n` +
        `  ${existsSync(ELECTRON_BINARY) ? 'The harness' : 'The Electron runtime'} is missing.\n` +
        `  Run \`npm run provision:electron\` and \`npm run build\`.\n\n` +
        `  This is COULD NOT LOOK. These cases are the only evidence that the composition root ` +
        `has ever been executed, so a run without them proves that it compiles and nothing ` +
        `more.\n`,
    );
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
