// @ts-check
/**
 * Does the memory sampler end a host whose private commit passes its threshold, against a running process — and does
 * the document come back usable (CR-SEC-09; ADR-0023 §3, corrected 2026-10-03)?
 *
 * `engineHostConnection.test.ts` proves the connection starts the sampler at the limit less its headroom, stops it
 * before a terminate, and names a sampler's kill `memory-budget`, against fakes. What it cannot show is that the worker
 * thread reads a real host's commit, kills it at the threshold, and that the shell then rebuilds and reopens. This runs
 * the shell with a real contained host and saves a document whose save raises the host's commit well above what the
 * open leaves it at (`hostMemoryHost.mjs`), in two cells one value apart:
 *
 * - **CONTROL**, the shell's own threshold: the save completes and the host lives — so the kill cell's ending is the
 *   sampler's. It also MEASURES the host's commit with the document open and its peak during the save, on this machine.
 * - **kill**, the threshold halfway between those two: the save fails, the log names `memory-budget`, the file on disk
 *   is untouched, a new host serves the document, and the rotation made before the save is still there.
 *
 * The threshold is measured in the run because a constant was not a margin: 320 MiB sat between ~255 and ~388 MiB on a
 * development machine and the save completed under it on CI's runner (run 37131970878). A first case requires at
 * least 64 MiB between the two readings, so a machine where no threshold fits says so instead of failing elsewhere.
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
  'MEASURED here: the save raises the host’s commit at least 64 MiB above the open document’s, so a threshold fits between',
  'the document opened and took a rotation under the low threshold, so the open stayed below it',
  'the save past the threshold FAILED',
  'the shell logged the host’s ending as memory-budget',
  'the file on disk is untouched',
  'the killed host stopped existing and a NEW one appeared',
  'the document answers again, with the rotation made before the save',
  'CONTROL: under the shell’s own threshold the same save completes, the host lives, and nothing is logged',
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

  // THE CONTROL FIRST, because it measures: the kill cell's threshold is put halfway between the commit with the
  // document open and the save's peak, as measured on THIS machine (the child's header has why).
  const product = runCell('control');
  /** @type {{ first: number, peak: number, samples: number } | null} */
  const measured = product.report.measured ?? null;
  const MiB = 1024 * 1024;
  const window = measured === null ? 0 : measured.peak - measured.first;
  const killAt = measured === null ? 0 : Math.round(measured.first + window / 2);
  check(
    CASES[0] ?? '',
    measured !== null && measured.samples > 1 && measured.first > 0 && window >= 64 * MiB,
    `the control measured ${JSON.stringify(measured)}: ${(window / MiB).toFixed(0)} MiB between the open document and the ` +
      `save's peak, where at least 64 MiB is needed to place a threshold with room either side`,
  );
  process.stdout.write(
    measured === null
      ? 'host-memory: the control measured nothing\n'
      : `host-memory: open ${(measured.first / MiB).toFixed(0)} MiB, save peak ${(measured.peak / MiB).toFixed(0)} MiB ` +
          `(${String(measured.samples)} samples); kill threshold ${(killAt / MiB).toFixed(0)} MiB\n`,
  );
  const low = runCell('kill', [String(killAt > 0 ? killAt : 1)]);
  const seen = low.report;
  /** @param {string[]} lines */
  const endings = (lines) => lines.filter((line) => line.startsWith('engine-host-gone: code='));

  check(CASES[1] ?? '', seen.rotated === true, `the rotation before the save answered ${JSON.stringify(seen.rotated)}`);
  check(CASES[2] ?? '', seen.saved?.ok === false, `the save answered ${JSON.stringify(seen.saved)} with a ${String(seen.killAtBytes)}-byte threshold`);
  check(
    CASES[3] ?? '',
    endings(seen.logged).length === 1 && endings(seen.logged)[0]?.startsWith('engine-host-gone: code=memory-budget ') === true,
    `the log held ${JSON.stringify(seen.logged)}`,
  );
  check(CASES[4] ?? '', seen.fileUntouched === true, 'the file on disk changed although its save failed');
  check(CASES[5] ?? '', seen.firstHostGone === true && seen.newHost > 0, `first host gone ${String(seen.firstHostGone)}, new host ${String(seen.newHost)}`);
  // 90: the rotation made before the save, replayed into the rebuilt session.
  check(CASES[6] ?? '', seen.rotationAfter === 90, `page 1 reads ${JSON.stringify(seen.rotationAfter)} after recovery, where 90 was expected`);
  check(
    CASES[7] ?? '',
    product.report.saved?.ok === true && product.report.firstHostGone === false && endings(product.report.logged).length === 0,
    `under the shell's own ${String(product.report.killAtBytes)}-byte threshold the save answered ` +
      `${JSON.stringify(product.report.saved)}, the host gone ${String(product.report.firstHostGone)}, the log ` +
      `${JSON.stringify(product.report.logged)} — something other than the sampler ends this save, so the first cell proves nothing`,
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
