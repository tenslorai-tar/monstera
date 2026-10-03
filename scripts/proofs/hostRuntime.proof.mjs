// @ts-check
/**
 * Proof that the kernel's tests pass in the runtime the engine hosts run in, not only in plain Node (rule B2).
 *
 * ## The defect this exists for
 *
 * Deskew, Enhance scans, Straighten scans and Read barcodes killed the MuPDF host in the packaged application, and
 * after two deaths the document refused all work. `Pixmap.getPixels` answered `koffi.view` over the pixmap's native
 * samples: an external ArrayBuffer. Electron's runtime refuses those, and koffi's refusal there aborts the process
 * (`FATAL ERROR: Error::New napi_get_last_error_info`, stack `view` ← `getPixels`). Every kernel test that ran those
 * commands was green, because `npm test` runs in plain Node, which allows external buffers.
 *
 * So the gap is the RUNTIME, and it is wider than one method: anything at a native boundary that plain Node permits and
 * Electron does not passes the suite and kills the host. The remedy is to run the suite where the hosts run — the
 * pinned Electron binary with `ELECTRON_RUN_AS_NODE=1`, which is how every host process is started — so the class is
 * held by every case the kernel already has rather than by a list of the methods found so far.
 *
 * ## The controls, because a green suite is also what the wrong runtime produces
 *
 * - **The runtime refuses an external buffer.** A `koffi.view` under the same binary and variable must end the process
 *   without printing, and the same line under plain Node must print. Without the first, a runtime that stopped
 *   refusing would make this proof vacuous; without the second, a line that fails everywhere would make it look sound.
 * - **The workers ran in that runtime.** `hostRuntime.test.ts` asserts `process.versions.electron` when asked, and its
 *   case must be among the passed ones. A pool that fell back to plain Node passes everything else.
 * - **The commands that crashed are in the run.** Each named file must report passed cases and none skipped, so a
 *   filter that stopped matching cannot pass by running nothing.
 *
 * Usage: node scripts/proofs/hostRuntime.proof.mjs [--require-electron]
 *   --require-electron makes a missing Electron binary or engine library a failure. CI passes it on both legs, which
 *   provision both.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { shimLibraryPath } from '../provision/mupdf.mjs';

const ROOT = repoRoot();
const ELECTRON = electronBinaryPath(ROOT);
const REQUIRE = process.argv.includes('--require-electron');

/** The suites run under the hosts' runtime: the document engine, and the Node-mode code beside it. */
const SUITES = ['packages/kernel', 'packages/nodemode'];

/** The anchor case, by its full name as vitest reports it. */
const ANCHOR = 'the runtime this suite runs in is Electron in Node mode when the host-runtime proof asked for it';

/**
 * The test files of the four commands that killed the host, which must run and pass, and Export to WebP's: the fifth
 * caller of the same view (`rgbaOf` in `pageImages.ts`). With the view put back, its WebP cases end the worker under
 * this runtime and pass in plain Node (measured 2026-10-03, Electron 43.7.7).
 */
const CRASHED = [
  'packages/kernel/src/pageDeskew.test.ts',
  'packages/kernel/src/pageEnhance.test.ts',
  'packages/kernel/src/pageScan.test.ts',
  'packages/kernel/src/barcode.test.ts',
  'packages/kernel/src/pageImages.test.ts',
];

/** A view over sixteen bytes of native memory: what `getPixels` made, in one line. */
const VIEW_LINE =
  "const koffi = require('koffi'); const memory = koffi.alloc('uint8_t', 16); " +
  "new Uint8Array(koffi.view(memory, 16)); console.log('VIEWED');";

if (!existsSync(ELECTRON)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'the kernel under the engine hosts’ runtime',
    why: `the pinned Electron binary is not at ${ELECTRON} (npm run provision:electron)`,
    flag: '--require-electron',
  });
}
if (!existsSync(shimLibraryPath(ROOT))) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'the kernel under the engine hosts’ runtime',
    why: `the MuPDF engine library is not built at ${shimLibraryPath(ROOT)} (npm run provision:mupdf)`,
    flag: '--require-electron',
  });
}

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 + CRASHED.length });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** The environment a host process is started with, over this one's. */
function hostEnvironment() {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
}

try {
  const underElectron = spawnSync(ELECTRON, ['-e', VIEW_LINE], { cwd: ROOT, env: hostEnvironment(), encoding: 'utf8' });
  check(
    'CONTROL: the hosts’ runtime ends a process that makes a view over native memory',
    underElectron.status !== 0 && !underElectron.stdout.includes('VIEWED'),
    `status ${String(underElectron.status)}, signal ${String(underElectron.signal)}, stdout ${JSON.stringify(underElectron.stdout)}. ` +
      'If this runtime now allows external buffers, the suite below no longer separates the defect it exists for.',
  );
  const underNode = spawnSync(process.execPath, ['-e', VIEW_LINE], { cwd: ROOT, encoding: 'utf8' });
  check(
    'CONTROL: plain Node makes the same view, so the difference is the runtime and not the line',
    underNode.status === 0 && underNode.stdout.includes('VIEWED'),
    `status ${String(underNode.status)}, stderr ${JSON.stringify(underNode.stderr.slice(0, 400))}`,
  );

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-runtime-'));
  try {
    const report = join(scratch, 'report.json');
    const run = spawnSync(
      ELECTRON,
      [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...SUITES, '--reporter=json', `--outputFile=${report}`],
      { cwd: ROOT, env: { ...hostEnvironment(), MONSTERA_EXPECTED_RUNTIME: 'electron-as-node' }, encoding: 'utf8' },
    );
    /** @type {{ numFailedTests?: number, numPassedTests?: number, testResults?: { name: string, assertionResults: { fullName: string, status: string }[] }[] }} */
    const parsed = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : {};
    const results = parsed.testResults ?? [];
    check(
      `the ${SUITES.join(' and ')} suites pass under the hosts’ runtime`,
      run.status === 0 && parsed.numFailedTests === 0 && (parsed.numPassedTests ?? 0) > 0,
      `vitest exited ${String(run.status)} (signal ${String(run.signal)}) with ${String(parsed.numFailedTests)} failed and ` +
        `${String(parsed.numPassedTests)} passed. A worker that died is how a native-boundary abort reads here:\n` +
        `${(run.stderr + run.stdout).slice(-3000)}`,
    );
    const cases = results.flatMap((file) => file.assertionResults);
    check(
      'CONTROL: the workers ran in Electron’s Node mode, as the anchor case asserts',
      cases.some((one) => one.fullName === ANCHOR && one.status === 'passed'),
      `no passed case named "${ANCHOR}". Without it a pool that fell back to plain Node is indistinguishable from this one.`,
    );
    for (const file of CRASHED) {
      const found = results.find((result) => result.name.replaceAll('\\', '/').endsWith(file));
      const statuses = found?.assertionResults.map((one) => one.status) ?? [];
      check(
        `${file} ran and passed under the hosts’ runtime`,
        statuses.length > 0 && statuses.every((status) => status === 'passed'),
        found === undefined
          ? 'the file is not in the report, so the suite filter no longer reaches it'
          : `statuses: ${statuses.join(', ')}`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} host-runtime failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('host-runtime case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
