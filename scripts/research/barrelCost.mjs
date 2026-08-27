// @ts-check
/**
 * What does importing the kernel BARREL cost a process, and does main pay it?
 *
 * ## The question, and why it is not answered by an existing check
 *
 * Invariant 20 is *no native engine code in main*, and `proof:kernelload`
 * guards one route to breaking it: `documentService.js` must not reach
 * `mupdfWriter.js`. Its **control** asserts the opposite for the barrel —
 * *"mupdfWriter.js IS reachable from index.js"* — because a walk that could not
 * see the adapter anywhere would be a walk whose silence meant nothing.
 *
 * So the barrel loading the native library is established and deliberate. What
 * no check asks is whether **main imports the barrel**, and four modules under
 * `apps/desktop/src/` do, as values: `composition.ts`, `commandHandlers.ts`,
 * `documentCommands.ts`, `engineHostConnection.ts`.
 *
 * This measures the cost rather than deducing it. The deduction was available
 * and is not the same thing: `perf:gate`'s baseline moved by ~35 MB on
 * 2026-08-26 when one module acquired an accidental side-effect import of the
 * barrel, which is suggestive and is a measurement of something else.
 *
 * ## Three cells, because two would not separate the answer
 *
 * A bare process and a barrel-importing one differ by *everything the barrel
 * pulls*, not by the native library alone. The third cell imports the same
 * kernel modules main would need **without** the barrel, so the figure this
 * reports is the marginal cost of the ADAPTER rather than of the kernel.
 *
 * Reports peak working set from the kernel — `peakRss.mjs` — rather than a
 * sampler, for the reason that module's own header gives.
 *
 * ## THE RUNTIME IS A VARIABLE AND WAS NOT ONE (SSSS-2)
 *
 * Every figure here is a delta between two cells, and a delta is only readable
 * when both cells ran under the same interpreter. That much was always true.
 * What was not stated is which interpreter, and the answer was *whichever one
 * started the harness* — system node, in practice, because `measurePeak`
 * defaulted to `process.execPath`.
 *
 * ADR-0025 then took the barrel figure from here as its `R` and added it to a
 * floor measured under the **pinned Electron binary in Node mode**. PPPP-1 put
 * roughly 9 MB between those two runtimes on a bare control — the same order as
 * `R` itself — so the ceiling was a subtraction across two runtimes, which is
 * the shape ADR-0025 had already withdrawn once for `0.78×`.
 *
 * `--runtime electron` runs every cell under the binary the host actually uses.
 * The delta is still within-runtime; what changes is which runtime, and the two
 * answers are what say whether a marginal cost is runtime-independent. That was
 * a plausible model and this project's rule is to measure it.
 *
 * Usage: node scripts/research/barrelCost.mjs [bare|barrel|modules]
 *        node scripts/research/barrelCost.mjs                  (runs all cells)
 *        node scripts/research/barrelCost.mjs --runtime electron
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { measurePeak, reportPeak } from '../perf/peakRss.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = fileURLToPath(import.meta.url);

const KERNEL_DIST = join(REPO_ROOT, 'packages', 'kernel', 'dist');

/** @param {string} mode */
async function cell(mode) {
  // `pathToFileURL`, because Windows absolute paths are not URLs and the ESM
  // loader refuses `c:` as a scheme.
  const load = (/** @type {string} */ file) =>
    import(pathToFileURL(join(KERNEL_DIST, file)).href);

  if (mode === 'barrel') {
    // What `composition.ts` reaches when it writes `from '@monstera/kernel'`.
    await load('index.js');
  } else if (mode !== 'bare') {
    // ONE MODULE PER CELL. The first version of this instrument loaded
    // `composition.ts`'s three named modules together and reported them as a
    // single figure — which was 41.1 MB over bare, indistinguishable from the
    // barrel, and therefore said nothing about which of them pays. A cell that
    // bundles three subjects cannot attribute a cost to any of them.
    await load(`${mode}.js`);
  }
  reportPeak({ role: `barrel-cost:${mode}` });
}

/**
 * The cells, in the order they are reported.
 *
 * `commandBus` and `mupdfWriter` are here because the first run showed the
 * three modules `composition.ts` names costing as much as the barrel — so the
 * question moved from *does the barrel cost extra* to *which module pays*, and
 * a bundled cell could not answer it. `mupdfWriter` is the known-present
 * anchor: it binds the native library by definition, so it is the figure every
 * other cell is read against.
 */
const CELLS = [
  'bare',
  'capabilityRegistry',
  'documentService',
  'commandBus',
  'mupdfWriter',
  'barrel',
];

/**
 * The interpreter every cell runs under, and the environment it needs.
 *
 * `node` is kept as the default rather than switched, because the figures this
 * file has already produced were taken that way and a silently changed default
 * would make the new numbers look like a continuation of the old ones.
 */
const argv = process.argv.slice(2);
const runtimeAt = argv.indexOf('--runtime');
const runtimeName = runtimeAt === -1 ? 'node' : (argv[runtimeAt + 1] ?? '');
if (runtimeName !== 'node' && runtimeName !== 'electron') {
  process.stderr.write(`--runtime takes \`node\` or \`electron\`, not ${JSON.stringify(runtimeName)}\n`);
  process.exit(2);
}
const wantsElectron = runtimeName === 'electron';
const runtime = wantsElectron ? electronBinaryPath() : process.execPath;
const runtimeEnv = wantsElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {};
if (wantsElectron && !existsSync(runtime)) {
  process.stderr.write(`${runtime} does not exist. Run \`npm run provision:electron\` first.\n`);
  process.exit(1);
}

// EVERY value-taking flag consumes its argument, derived from one list rather
// than named one flag at a time — the first version handled `--runtime` alone
// and `--runs 5` then reached the cell dispatch as the cell "5".
//
// The `=== -1` guard on each is load-bearing for the same reason in reverse:
// `at + 1` is 0 for an absent flag, which silently excludes the first
// positional and turns a single-cell invocation into a sweep that recurses into
// itself.
const VALUE_FLAGS = ['--runtime', '--runs'];
const consumed = new Set(
  VALUE_FLAGS.flatMap((flag) => {
    const at = argv.indexOf(flag);
    return at === -1 ? [] : [at, at + 1];
  }),
);
const mode = argv.find(
  (argument, index) => !consumed.has(index) && !argument.startsWith('--'),
);
if (mode !== undefined) {
  if (!CELLS.includes(mode)) {
    process.stderr.write(`unknown cell: ${mode}\n`);
    process.exit(2);
  }
  await cell(mode);
} else {
  if (!existsSync(join(KERNEL_DIST, 'index.js'))) {
    process.stderr.write(
      `The kernel is not built at ${KERNEL_DIST}. This measures COMPILED modules — the emit is ` +
        `the only thing that distinguishes a type-only import from one that runs — so without ` +
        `the build there is nothing to measure. Run \`npm run typecheck\`.\n`,
    );
    process.exit(1);
  }

  // ONE SWEEP IS ONE POINT, and `R` was derived from one. RRRR-3's finding was
  // that `main`'s baseline was settled with no spread measured at all; taking
  // this figure the same way and adding it to a budget would be that again, one
  // input along. Two sweeps under the same runtime an hour apart already
  // disagreed by 1.6 MB, which is a sixth of the number.
  const runsAt = argv.indexOf('--runs');
  const runs = runsAt === -1 ? 1 : Number(argv[runsAt + 1] ?? '');
  if (!Number.isInteger(runs) || runs < 1) {
    process.stderr.write(`--runs takes a positive integer, not ${JSON.stringify(argv[runsAt + 1])}\n`);
    process.exit(2);
  }

  process.stdout.write(`\n  runtime: ${runtimeName} — ${runtime}\n`);

  const mb = (/** @type {number} */ n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

  /** @type {number[]} */
  const regressions = [];
  /** @type {{ mode: string, bytes: number }[]} */
  let rows = [];

  for (let sweep = 0; sweep < runs; sweep += 1) {
    rows = [];
    for (const each of CELLS) {
      const { peakRssBytes } = await measurePeak(SELF, [each], { runtime, env: runtimeEnv });
      rows.push({ mode: each, bytes: peakRssBytes });
    }
    const bareOf = rows.find((row) => row.mode === 'bare')?.bytes ?? 0;
    const barrelOf = rows.find((row) => row.mode === 'barrel')?.bytes ?? 0;
    regressions.push(barrelOf - bareOf);
    if (runs > 1) {
      process.stdout.write(
        `  sweep ${String(sweep + 1).padStart(2)}: bare ${mb(bareOf)}  barrel ${mb(barrelOf)}  ` +
          `R ${mb(barrelOf - bareOf)}\n`,
      );
    }
  }

  process.stdout.write('\n');
  const at = (/** @type {string} */ name) => rows.find((row) => row.mode === name)?.bytes ?? 0;
  const bare = at('bare');
  for (const row of rows) {
    const over = row.mode === 'bare' ? '' : `  (+${mb(row.bytes - bare)} over bare)`;
    process.stdout.write(`  ${row.mode.padEnd(18)} ${mb(row.bytes)}${over}\n`);
  }
  if (runs > 1) process.stdout.write(`  (cells above are the LAST sweep; R below is all ${String(runs)})\n`);

  // THE ANCHOR. `mupdfWriter.js` binds the native library at module scope, so
  // its figure is what "this module loaded the parser" looks like on this
  // machine. Every other cell is read against it rather than against a
  // threshold somebody picked.
  const adapter = at('mupdfWriter') - bare;
  process.stdout.write(
    `\n  ANCHOR: mupdfWriter.js — which binds the native library at module scope — costs\n` +
      `  ${mb(adapter)} over bare. A cell within a megabyte or two of that has loaded it too.\n`,
  );

  // ADR-0025's `R` — the barrel-class regression its ceiling is derived from —
  // printed here rather than left as a subtraction for whoever cites it. A
  // figure a reader computes is one they can compute from the wrong two rows,
  // and this one is added to a floor measured under a named runtime, so the
  // runtime belongs on the same line as the number.
  const sorted = [...regressions].sort((left, right) => left - right);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  // Upper-middle rather than an interpolated median on an even count. It is
  // reported for shape only — the figure ADR-0025 consumes is `min`, and an
  // approximate middle cannot move it.
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  process.stdout.write(
    `\n  R (ADR-0025): barrel − bare, ${String(runs)} sweep(s) under ${runtimeName}\n` +
      `    min ${mb(min)}   median ${mb(median)}   max ${mb(max)}   spread ${mb(max - min)}\n` +
      `  Only comparable with a floor measured under the SAME runtime. ADR-0025's ceiling\n` +
      `  is min + R, so the figure that feeds it is the MINIMUM above and not the median:\n` +
      `  a ceiling built on a regression larger than the smallest one that can occur is a\n` +
      `  ceiling that lets that occurrence through.\n`,
  );

  // A POSITIVE CONTROL, because every number here is a peak and "it did not
  // move" is the reassuring answer. If the anchor itself is cheap, this
  // instrument cannot see the thing it exists to report and its silence is
  // worthless (item 4b).
  if (adapter < 4 * 1024 * 1024) {
    process.stderr.write(
      `\n  THE INSTRUMENT CANNOT SEE ITS SUBJECT. mupdfWriter.js costs under 4 MB over bare, so\n` +
        `  either it stopped binding the library at module scope or these cells are not measuring\n` +
        `  what they name. Nothing above may be concluded.\n`,
    );
    process.exit(1);
  }
}
