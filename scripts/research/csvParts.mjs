// @ts-check
/**
 * What a CSV import costs when composed in parts and joined (the owner's O10: a CSV over 1 MiB was refused).
 *
 *   node scripts/research/csvParts.mjs <total MiB> <part MiB> [columns]
 *
 * Builds a CSV of short numeric and word columns (the register-file shape), splits it at record ends into parts of at
 * most `part MiB`, composes each part with the header record in front through the shipped composer, and joins the parts
 * through the shipped join. It prints each part's time and the totals; the PEAK resident set is the kernel's `ru_maxrss`
 * (`process.resourceUsage().maxRSS`), read once at the end, because a sampler in the process cannot fire while a
 * synchronous composition holds the event loop (CLAUDE.md item 4a, the first instrument on its list).
 *
 * RESOLUTION, checked before any reading was taken: 1 part against 2 parts of the same bytes must report a different
 * part count and join time, and a 2 MiB total against a 4 MiB one a different page count.
 */
import { COMPOSED_FAMILY_DEFAULT } from '@monstera/contract';

import { fontsDirectory } from '../provision/fonts.mjs';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
// THE BUILT MODULES THIS READS, fresh or refused: a stale one would print last build's reading under this build's name.
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/csvCompose.ts', 'packages/kernel/dist/csvCompose.js', 'tsc'],
    ['packages/kernel/src/fontCatalogue.ts', 'packages/kernel/dist/fontCatalogue.js', 'tsc'],
    ['packages/kernel/src/workbookParts.ts', 'packages/kernel/dist/workbookParts.js', 'tsc'],
  ],
  3,
);
// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads: none of it may reach Electron.
const { composeCsv } = await import('../../packages/kernel/dist/csvCompose.js');
const { faceSourceOf } = await import('../../packages/kernel/dist/fontCatalogue.js');
const { joinPdfs } = await import('../../packages/kernel/dist/workbookParts.js');

const totalMiB = Number(process.argv[2] ?? '4');
const partMiB = Number(process.argv[3] ?? '1');
const columns = Number(process.argv[4] ?? '6');
const FACES = faceSourceOf([{ path: fontsDirectory(ROOT), origin: 'bundled' }]);
const LETTER = { width: 612, height: 792 };
const encoder = new TextEncoder();

const header = Array.from({ length: columns }, (_unused, at) => `Column ${String(at + 1)}`).join(',');
const lines = [];
let size = 0;
for (let row = 0; size < totalMiB * 1024 * 1024; row += 1) {
  const line = Array.from({ length: columns }, (_unused, at) => (at % 2 === 0 ? String(row * 7 + at) : `item${String(row % 97)}`)).join(',');
  lines.push(line);
  size += line.length + 1;
}

/** @type {string[][]} */
const parts = [[]];
let partSize = 0;
for (const line of lines) {
  if (partSize + line.length + 1 > partMiB * 1024 * 1024 && (parts.at(-1)?.length ?? 0) > 0) {
    parts.push([]);
    partSize = 0;
  }
  parts.at(-1)?.push(line);
  partSize += line.length + 1;
}

const started = performance.now();
/** @type {Uint8Array[]} */
const pdfs = [];
for (const [index, part] of parts.entries()) {
  const before = performance.now();
  const composed = await composeCsv(encoder.encode(`${header}\n${part.join('\n')}\n`), LETTER, FACES, COMPOSED_FAMILY_DEFAULT);
  pdfs.push(composed.pdf);
  // WHAT IS HELD AFTER EACH PART, so a growth across parts is told apart from one part's own peak.
  const held = process.memoryUsage();
  process.stdout.write(
    `part ${String(index + 1)}/${String(parts.length)}: ${String(part.length)} rows, ${((performance.now() - before) / 1000).toFixed(1)} s, ${String(composed.pdf.length)} bytes, ` +
      `rss ${String(Math.round(held.rss / 1048576))} heap ${String(Math.round(held.heapUsed / 1048576))} external ${String(Math.round(held.external / 1048576))} MiB\n`,
  );
}
// THE PEAK BEFORE THE JOIN, so the composition's and the join's are told apart.
const peakBeforeJoin = Math.round(process.resourceUsage().maxRSS / 1024);
const joinStart = performance.now();
const joined = await joinPdfs(pdfs);
if (!('pdf' in joined)) throw new Error('a part could not be read');
const pages = /** @type {readonly number[]} */ (joined.pages).reduce((sum, count) => sum + count, 0);
process.stdout.write(
  `total ${String(totalMiB)} MiB, ${String(lines.length)} rows, ${String(parts.length)} parts: ` +
    `compose ${((joinStart - started) / 1000).toFixed(1)} s, join ${((performance.now() - joinStart) / 1000).toFixed(1)} s, ` +
    `${String(pages)} pages, ${String(joined.pdf.length)} bytes, ` +
    // THE KERNEL'S OWN PEAK (`ru_maxrss`), read once at the end: no sampler, so no spike between samples is missed.
    `peak before the join ${String(peakBeforeJoin)} MiB, peak ${String(Math.round(process.resourceUsage().maxRSS / 1024))} MiB\n`,
);
