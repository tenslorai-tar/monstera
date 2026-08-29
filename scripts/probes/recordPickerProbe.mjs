// @ts-check
/**
 * Runs the picker probe and writes down what it saw.
 *
 * ## Why a person has to be here
 *
 * `documentPicker.ts` opens Electron's file dialog. There is no way to drive one
 * from a test, and substituting it is what `proof:canvaspixels` does — which is
 * precisely why the module itself had never executed. So this is run by hand,
 * once, and its result is recorded; `check:docs` then refuses the open row's
 * status without the record.
 *
 * ## It records the dismissal too, and that is not a courtesy
 *
 * A probe that only wrote a record on success would leave "nobody has run it"
 * and "somebody ran it and it did not work" as the same observation — absence,
 * the reassuring answer. Every run writes, `cancelled` is honest, and only
 * `opened` satisfies the gate.
 *
 * Usage: npm run probe:picker
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { formatError } from '../lib/reportError.mjs';
import {
  PROBE_COMMAND,
  RECORD_FILE,
  currentInputDigest,
  repoRoot,
  writeRecord,
} from '../lib/pickerProbe.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const HARNESS = join(ROOT, 'apps', 'desktop', 'dist', 'pickerProbeMain.js');
const MARKER = 'MONSTERA_PICKER_PROBE ';

/**
 * How long the whole run may take.
 *
 * This bounds a PERSON, not a machine, which is why it is minutes rather than
 * seconds: finding the window, reading the start screen, clicking Open and
 * navigating to a file is not something to hurry, and a probe that gave up
 * mid-choice would record `cancelled` for a working picker. The harness itself
 * carries no bound on the wait for a path, for the same reason — only this
 * process knows whether anyone is there.
 */
const SESSION_BOUND_MS = 10 * 60 * 1000;

try {
  const binary = electronBinaryPath(ROOT);
  if (!existsSync(binary)) {
    throw new Error(
      `The Electron runtime is missing:\n  ${binary}\nRun \`npm run provision:electron\`.`,
    );
  }
  if (!existsSync(HARNESS)) {
    throw new Error(
      `${HARNESS} does not exist. Run \`npm run build\` — this probe drives the SHIPPED shell, ` +
        `so it needs the preload bundle and the renderer bundle, and \`npm run typecheck\` ` +
        `produces neither.`,
    );
  }

  // The digest is taken BEFORE the run, so it describes the code the person is
  // about to drive. Taking it afterwards would let an edit made during the run
  // be certified by an observation that predates it.
  const verdict = currentInputDigest(ROOT);

  process.stdout.write(
    `Opening the shipped shell with the REAL file dialog.\n\n` +
      `  1. Click "Open a document" on the start screen.\n` +
      `  2. Choose any PDF.\n` +
      `  3. Wait for the page to appear, then leave the window alone.\n\n` +
      `Dismissing the dialog is recorded honestly and satisfies no gate.\n` +
      `The chosen path is never written down — the record carries only that one arrived.\n\n`,
  );

  const result = spawnSync(binary, [HARNESS], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: SESSION_BOUND_MS,
    maxBuffer: 16 * 1024 * 1024,
    // INHERITED, so the person watching sees the harness's own output as it
    // happens rather than after it exits — except stdout, which is piped because
    // the marker line is what this reads.
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run the probe via ${binary}`, { cause: result.error });
  }

  const line = `${result.stdout}`.split(/\r?\n/).find((entry) => entry.startsWith(MARKER));
  if (line === undefined) {
    throw new Error(
      `The probe produced no ${MARKER.trim()} line (exit ${String(result.status)}${
        result.signal === null ? '' : `, signal ${result.signal}`
      }).\n` +
        `Nothing is recorded. A run that was killed, or that closed the window before choosing, ` +
        `leaves the record untouched rather than writing an outcome nobody observed.\n` +
        `stdout: ${result.stdout.slice(0, 1200)}`,
    );
  }

  const observation = JSON.parse(line.slice(MARKER.length));

  // A RUN THAT SAW NOTHING IS NOT SILENTLY UPGRADED. The harness reports
  // `pathArrived` separately from `outcome` precisely so that this file cannot
  // decide a dismissal was really a success; it copies both across.
  writeRecord(
    {
      subject: 'apps/desktop/src/documentPicker.ts',
      outcome: observation.outcome,
      pathArrived: observation.pathArrived,
      painted: observation.painted,
      width: observation.width,
      height: observation.height,
      certifies:
        'That Electron’s open dialog ran, returned a path, and the document reached the ' +
        'screen. THE PROBE HOLDS NO PATH OF ITS OWN — the only path in the process is the ' +
        'one the dialog returned — so a recorded "opened" cannot have been produced without ' +
        'one. The chosen file is deliberately not recorded: this is a tracked file in a public ' +
        'repository and a user’s filesystem layout is not evidence anybody needs.',
      exercise: PROBE_COMMAND,
      recordedAt: new Date().toISOString(),
      verdict,
    },
    ROOT,
  );

  process.stdout.write(
    `\nRecorded "${String(observation.outcome)}" in ${RECORD_FILE}` +
      (observation.outcome === 'opened'
        ? `: ${String(observation.painted)} painted pixel(s) at ${String(observation.width)}x` +
          `${String(observation.height)}, through the real dialog.\n`
        : `. Only "opened" satisfies the gate; run it again when you can complete the choice.\n`),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
