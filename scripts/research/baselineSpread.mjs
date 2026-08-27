// @ts-check
/**
 * How much does a role's measured baseline move between runs?
 *
 * ## Why this exists (finding RRRR-3)
 *
 * ADR-0025 derives a baseline budget from a window: above the largest honest
 * measurement, below the smallest plus the smallest regression it must catch.
 * Both ends are extremes over a SET of readings, and `main`'s number was settled
 * without that set ever being taken — the spread was quoted as *">4 MB on one
 * machine"* from two figures observed months apart in different conditions.
 *
 * `mupdf-host` got thirty readings and a 2.9 MB spread on two machines. `main`
 * got none. This closes that, and it is the last input before `main`'s
 * `base 80 MB` can be re-derived under the corrected `min + R` rule.
 *
 * ## It measures through the GATE's own function, not beside it
 *
 * `baselineFor` is imported from `budgetGate.mjs`. A `measurePeak(script,
 * [tiny])` written here would be a second opinion about what a role's baseline
 * is (B3a): correct today, and free to drift the moment either changes. The
 * fixture comes from `buildLargeFixture` for the same reason — the gate
 * establishes a fixed cost against a document small enough to be noise, and a
 * different tiny document would measure a different thing.
 *
 * ## The runtime is named, because a figure without one cannot be subtracted
 *
 * SSSS-2 measured a marginal cost differing by 2.8 MB between system node and
 * the pinned Electron binary in Node mode. `--runtime electron` runs the role
 * under the binary, which is what `main` actually is; the default is `node`,
 * which is what `perf:gate` uses today and therefore what `base 80 MB` was
 * derived against. Both are reported so the amendment does not have to guess
 * which set its number came from.
 *
 * ## Resolution test, built in (audit item 4a)
 *
 * The instrument compares two roles it knows differ — `main` and `main-service`,
 * separated by roughly 2.6 MB on the gate's own last run. If it reports them as
 * indistinguishable it cannot see what it exists to measure, and it says so
 * instead of printing a spread. That is cheaper and stricter than asserting the
 * readings vary: a genuinely stable baseline SHOULD vary little, so "the numbers
 * moved" is not evidence the instrument works.
 *
 * Usage: node scripts/research/baselineSpread.mjs [--runs 15]
 *                                                 [--role main-service]
 *                                                 [--runtime node|electron]
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { baselineFor } from '../perf/budgetGate.mjs';
import { buildLargeFixture } from '../perf/largeFixture.mjs';
import { formatBytes } from '../perf/peakRss.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PERF = join(ROOT, 'scripts', 'perf');

/** The roles the gate declares, by the script that measures each. */
const ROLES = {
  main: join(PERF, 'roleMain.mjs'),
  'main-service': join(PERF, 'roleMainService.mjs'),
  'mupdf-host': join(PERF, 'roleMupdfHost.mjs'),
};

const argv = process.argv.slice(2);
/** @param {string} flag @param {string} fallback */
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
};

const roleName = valueOf('--role', 'main-service');
const script = /** @type {Record<string, string>} */ (ROLES)[roleName];
if (script === undefined) {
  process.stderr.write(`--role takes one of ${Object.keys(ROLES).join(', ')}\n`);
  process.exit(2);
}

const runs = Number(valueOf('--runs', '15'));
if (!Number.isInteger(runs) || runs < 1) {
  process.stderr.write(`--runs takes a positive integer\n`);
  process.exit(2);
}

const runtimeName = valueOf('--runtime', 'node');
if (runtimeName !== 'node' && runtimeName !== 'electron') {
  process.stderr.write(`--runtime takes \`node\` or \`electron\`\n`);
  process.exit(2);
}
const wantsElectron = runtimeName === 'electron';
const runtime = wantsElectron ? electronBinaryPath() : process.execPath;
if (wantsElectron && !existsSync(runtime)) {
  process.stderr.write(`${runtime} does not exist. Run \`npm run provision:electron\` first.\n`);
  process.exit(1);
}
/** @type {{ runtime: string, env?: NodeJS.ProcessEnv }} */
const options = wantsElectron
  ? { runtime, env: { ELECTRON_RUN_AS_NODE: '1' } }
  : { runtime };

// The gate's own tiny document, built the same way for the same reason.
const tiny = buildLargeFixture({
  root: ROOT,
  targetBytes: 64 * 1024,
  pages: 1,
  name: 'perf-baseline.pdf',
});

process.stdout.write(
  `role:     ${roleName}\nruntime:  ${runtimeName} — ${runtime}\nfixture:  ${tiny.path}\n\n`,
);

// --- RESOLUTION TEST --------------------------------------------------------
// Two roles known to differ, one reading each, before anything is concluded.
const resolutionA = baselineFor(ROLES.main, tiny.path, options);
const resolutionB = baselineFor(ROLES['main-service'], tiny.path, options);
const separation = Math.abs(resolutionB - resolutionA);
process.stdout.write(
  `resolution: main ${formatBytes(resolutionA)} vs main-service ` +
    `${formatBytes(resolutionB)} — apart by ${formatBytes(separation)}\n`,
);
if (separation < 512 * 1024) {
  process.stderr.write(
    `\nTHE INSTRUMENT CANNOT SEPARATE TWO ROLES IT SHOULD. main and main-service differ by the\n` +
      `service layer and measured ~2.6 MB apart on the gate's own run; under half a megabyte\n` +
      `here means these readings are not distinguishing what they name. No spread is reported,\n` +
      `because a spread from an instrument that cannot resolve is a number with no subject.\n`,
  );
  process.exit(1);
}

// --- THE READINGS -----------------------------------------------------------
/** @type {number[]} */
const readings = [];
for (let run = 0; run < runs; run += 1) {
  const bytes = baselineFor(script, tiny.path, options);
  readings.push(bytes);
  process.stdout.write(`  ${String(run + 1).padStart(2)}  ${formatBytes(bytes)}\n`);
}

const sorted = [...readings].sort((left, right) => left - right);
const min = sorted[0] ?? 0;
const max = sorted[sorted.length - 1] ?? 0;
// Upper-middle on an even count. Reported for shape; ADR-0025's window is built
// from min and max, and an approximate middle cannot move either.
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

process.stdout.write(
  `\n${roleName} baseline over ${String(runs)} run(s) under ${runtimeName}\n` +
    `  min ${formatBytes(min)}   median ${formatBytes(median)}   max ${formatBytes(max)}\n` +
    `  spread ${formatBytes(max - min)}\n\n` +
    `ADR-0025's window for this role is (max, min + R): a floor above the largest honest\n` +
    `reading and a ceiling below the smallest plus the smallest regression it must catch.\n` +
    `Both ends come from THIS set, and both must come from the same runtime as R.\n`,
);
