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
 * Usage: node scripts/research/barrelCost.mjs [bare|barrel|modules]
 *        node scripts/research/barrelCost.mjs            (runs all three)
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { measurePeak, reportPeak } from '../perf/peakRss.mjs';

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

const mode = process.argv[2];
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

  /** @type {{ mode: string, bytes: number }[]} */
  const rows = [];
  for (const each of CELLS) {
    const { peakRssBytes } = await measurePeak(SELF, [each]);
    rows.push({ mode: each, bytes: peakRssBytes });
  }

  const mb = (/** @type {number} */ n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const at = (/** @type {string} */ name) => rows.find((row) => row.mode === name)?.bytes ?? 0;
  const bare = at('bare');
  for (const row of rows) {
    const over = row.mode === 'bare' ? '' : `  (+${mb(row.bytes - bare)} over bare)`;
    process.stdout.write(`  ${row.mode.padEnd(18)} ${mb(row.bytes)}${over}\n`);
  }

  // THE ANCHOR. `mupdfWriter.js` binds the native library at module scope, so
  // its figure is what "this module loaded the parser" looks like on this
  // machine. Every other cell is read against it rather than against a
  // threshold somebody picked.
  const adapter = at('mupdfWriter') - bare;
  process.stdout.write(
    `\n  ANCHOR: mupdfWriter.js — which binds the native library at module scope — costs\n` +
      `  ${mb(adapter)} over bare. A cell within a megabyte or two of that has loaded it too.\n`,
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
