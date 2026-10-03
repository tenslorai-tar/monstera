// @ts-check
/**
 * Does the memory sampler end a host whose private commit stays above its threshold, against a running process — and
 * does the application go on serving documents (CR-SEC-09; ADR-0023 §3, corrected 2026-10-03)?
 *
 * `engineHostConnection.test.ts` proves the connection starts the sampler at the limit less its headroom, stops it
 * before a terminate, and names a sampler's kill `memory-budget`, against fakes. What it cannot show is that the worker
 * thread reads a real host's commit and kills it at the threshold. This runs the shell with a real contained host
 * (`hostMemoryHost.mjs`, whose header says why it holds a LEVEL rather than catching a save's spike), in two cells one
 * value apart:
 *
 * - **CONTROL**, the shell's own threshold: a light document, then the 64 MiB heavy one beside it, both served — so the
 *   kill cell's ending is the sampler's. It MEASURES the host's commit at both levels, on this machine.
 * - **kill**, the threshold halfway between: a light document, open the whole time, then the heavy one. The log names
 *   `memory-budget`, the heavy document ends refused (`document-poisoned`, after Decision 9a's two endings of its own)
 *   rather than tried for ever, its file is untouched, and the light document — the cause of no ending — is served by a
 *   new host (P3, ADR-0023's correction of 2026-10-03).
 *
 * A first case requires at least 64 MiB between the two levels, so a machine where no threshold fits says so instead of
 * failing at a later case.
 *
 * Needs Windows, the pinned Electron runtime, the build, the MuPDF shim and the container grants, as
 * `hostDeadline.mjs` does; without them it reports UNVERIFIABLE, and `--require-containment` makes that a failure.
 *
 * Usage: node scripts/research/hostMemory.mjs [--require-containment]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { shimBuildState, shimEnvironment } from '../lib/shimBinary.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const CHILD = join(ROOT, 'scripts', 'research', 'hostMemoryHost.mjs');
const ELECTRON_BINARY = electronBinaryPath(ROOT);
const BUILT = [
  'apps/desktop/dist/composition.js',
  'apps/desktop/dist/engineHostPlatform.js',
  'apps/desktop/dist/harnessComposition.js',
  'apps/desktop/dist/memorySamplerSurface.js',
  'packages/nodemode/dist/memorySamplerWorker.js',
  'packages/kernel/dist/host/hostEntry.js',
];
const REQUIRE_CONTAINMENT = process.argv.includes('--require-containment');

/** The cases, named, so the count is a claim of its own and the unverifiable branch can list them (audit item 4c). */
const CASES = [
  'MEASURED here: the heavy document holds the host at least 64 MiB above the light one, so a threshold fits between',
  'the shell logged a host ending as memory-budget, and no ending under any other name',
  'the heavy document ended refused — document-poisoned — and was not tried for ever',
  'the heavy document’s file on disk is untouched',
  'P3: the light document, open the whole time and the cause of no ending, is served by a new host and its rotation reads back',
  'CONTROL: under the shell’s own threshold both documents are served and nothing is logged',
  'CONTROL: and both harness processes exited cleanly',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: CASES.length });
/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const missingBuilt = BUILT.filter((relative) => !existsSync(join(ROOT, relative)));
const ungranted =
  process.platform === 'win32' ? inspect({ root: ROOT }).filter((entry) => entry.present === false).map((entry) => entry.path) : [];
const shim = shimBuildState({ root: ROOT });
const runnable =
  process.platform === 'win32' && existsSync(ELECTRON_BINARY) && missingBuilt.length === 0 && shim.current && ungranted.length === 0;

if (!runnable) {
  const why =
    process.platform !== 'win32'
      ? `The engine host is a Win32 AppContainer process (ADR-0022), so there is no host to sample on ${process.platform}.`
      : !existsSync(ELECTRON_BINARY)
        ? 'The pinned Electron binary is absent. Run `npm run provision:electron`.'
        : missingBuilt.length > 0
          ? `Not built: ${missingBuilt.join(', ')}. Run \`npm run build\`.`
          : !shim.current
            ? `The MuPDF shim the hosts load is not usable: ${shim.reason}`
            : `The container cannot read ${String(ungranted.length)} granted path(s). Run \`npm run provision:grants\`.`;
  exitUnverifiable({
    required: REQUIRE_CONTAINMENT,
    subject: 'a host past its memory threshold',
    why: `${String(CASES.length)} case(s) could not be evaluated:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ${why}`,
    flag: '--require-containment',
  });
} else {
  /**
   * Runs one cell. The report comes back in a file and the child's stdio is inherited, for `hostRecovery.mjs`' reason:
   * a host holding an inherited pipe would make `spawnSync` wait on a grandchild.
   *
   * @param {'kill' | 'control'} cell
   * @param {string[]} [extra] the kill cell's threshold
   */
  const runCell = (cell, extra = []) => {
    const scratch = mkdtempSync(join(tmpdir(), `monstera-host-memory-${cell}-`));
    const reportPath = join(scratch, 'report.json');
    try {
      const result = spawnSync(ELECTRON_BINARY, [CHILD, cell, reportPath, ...extra], {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: 180_000,
        env: { ...process.env, ...shimEnvironment({ root: ROOT }), ELECTRON_RUN_AS_NODE: '1' },
      });
      if (result.error !== undefined) throw new Error(`could not run ${CHILD} under ${ELECTRON_BINARY}`, { cause: result.error });
      if (!existsSync(reportPath)) {
        throw new Error(`the ${cell} harness wrote no report (exit ${String(result.status)}); its stderr is above`);
      }
      return { report: JSON.parse(readFileSync(reportPath, 'utf8')), status: result.status, signal: result.signal };
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  };

  // THE CONTROL FIRST, because it measures: the kill cell's threshold is put halfway between the two levels, as
  // measured on THIS machine (the child's header has why levels and not a save's spike).
  const product = runCell('control');
  /** @type {{ first: number, peak: number, samples: number } | null} */
  const measured = product.report.measured ?? null;
  const MiB = 1024 * 1024;
  const window = measured === null ? 0 : measured.peak - measured.first;
  const killAt = measured === null ? 0 : Math.round(measured.first + window / 2);
  check(
    CASES[0] ?? '',
    measured !== null && measured.samples === 2 && measured.first > 0 && window >= 64 * MiB,
    `the control measured ${JSON.stringify(measured)} (read with the product's access: ${JSON.stringify(product.report.productRead)}): ` +
      `${(window / MiB).toFixed(0)} MiB between the two levels, where at least 64 MiB is needed to place a threshold with room either side`,
  );
  process.stdout.write(
    measured === null
      ? 'host-memory: the control measured nothing\n'
      : `host-memory: light document ${(measured.first / MiB).toFixed(0)} MiB, with the heavy one ${(measured.peak / MiB).toFixed(0)} MiB; ` +
          `kill threshold ${(killAt / MiB).toFixed(0)} MiB\n`,
  );
  const low = runCell('kill', [String(killAt > 0 ? killAt : 1)]);
  const seen = low.report;
  /** @param {string[]} lines */
  const endings = (lines) => lines.filter((line) => line.startsWith('engine-host-gone: code='));
  /** @type {string[]} */
  const heavyAnswers = seen.heavyAnswers ?? [];

  check(
    CASES[1] ?? '',
    endings(seen.logged).length > 0 && endings(seen.logged).every((line) => line.startsWith('engine-host-gone: code=memory-budget ')),
    `the log held ${JSON.stringify(seen.logged)}`,
  );
  check(CASES[2] ?? '', heavyAnswers.at(-1) === 'document-poisoned', `the heavy document answered ${JSON.stringify(heavyAnswers)}`);
  check(CASES[3] ?? '', seen.heavyUntouched === true, 'the heavy document’s file changed');
  // 0 before; 90 after: one rotation, made after the heavy document's endings, read back. The control is this case
  // before ADR-0023's correction of 2026-10-03, where every held document was counted and this one was poisoned too.
  check(
    CASES[4] ?? '',
    seen.lightBefore === 0 && seen.lightAfter === 'ok' && seen.lightRotationAfter === 90,
    `the light document read ${JSON.stringify(seen.lightBefore)} before, rotated ${JSON.stringify(seen.lightAfter)} and ` +
      `reads ${JSON.stringify(seen.lightRotationAfter)}`,
  );
  check(
    CASES[5] ?? '',
    product.report.lightRotated === 'ok' && product.report.heavyRotated === 'ok' && endings(product.report.logged).length === 0,
    `under the shell's own ${String(product.report.killAtBytes)}-byte threshold: light ${JSON.stringify(product.report.lightRotated)}, ` +
      `heavy ${JSON.stringify(product.report.heavyRotated)}, the log ${JSON.stringify(product.report.logged)} — something other than ` +
      `the sampler refuses these documents, so the kill cell proves nothing`,
  );
  check(
    CASES.at(-1) ?? '',
    low.status === 0 && low.signal === null && product.status === 0 && product.signal === null,
    `the harnesses exited ${String(low.status)} and ${String(product.status)}`,
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} host-memory case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('host-memory case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
