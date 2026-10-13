// @ts-check
/**
 * The owner's O2 with real recognition (ADR-0233): a printed scan of a clean ruled table, read by Tesseract on this
 * computer and written into the page's text layer by the shipped writer, is read back as that table, every cell holding
 * its words. The kernel's `scanTables.test.ts` proves the table read over a layer placed at the words' true places; this
 * is the same question asked of what Tesseract actually answers, which is the half a placed layer cannot vouch for.
 *
 * The CONTROL is the page before recognition: the grid is found, with no word in any cell, so a pass below is about
 * the recognised words and not about the fixture carrying text of its own.
 *
 *   node scripts/proofs/scanTable.proof.mjs
 *
 * Needs the English model (`node scripts/provision/tessdata.mjs --only=eng`) and a current build of the kernel.
 */

import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import { recognisePage } from '../../packages/kernel/dist/ocrRecognise.js';
import { applyOcrPage } from '../../packages/kernel/dist/ocrTextLayer.js';
import { SCAN_TABLE_ROWS, buildScannedTablePdf } from '../../packages/kernel/dist/scanTableFixture.js';
import { readScanTables } from '../../packages/kernel/dist/scanTables.js';
import { SCAN_TABLE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { tessdataDirectory } from '../provision/tessdata.mjs';

const ROOT = repoRoot();
bindNativeEngine(ROOT);
refuseStaleBuild(ROOT, SCAN_TABLE, 6);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 3 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * The page's tables as the host reads them, each cell's words as one string.
 * @param {Uint8Array} bytes
 */
async function tablesOf(bytes) {
  const session = await mupdfWriter.open(bytes);
  try {
    const tables = await readScanTables(session, 0);
    return tables.map((table) => table.rows.map((row) => row.map((lines) => lines.map((line) => line.text).join(' '))));
  } finally {
    await mupdfWriter.close(session);
  }
}

try {
  const scan = await buildScannedTablePdf();

  const before = await tablesOf(scan);
  check(
    'CONTROL: the scan before recognition has its grid and no word in any cell',
    before.length === 1 && before[0]?.flat().every((text) => text === '') === true,
    `read ${JSON.stringify(before)}`,
  );

  const session = await mupdfWriter.open(scan);
  let recognised;
  try {
    recognised = await recognisePage(session, { page: 0, languages: ['eng'], modelDirectory: tessdataDirectory(ROOT) });
  } finally {
    await mupdfWriter.close(session);
  }
  const layered = await applyOcrPage(scan, { kind: 'ocrPage', page: 0, languages: ['eng'], engine: 'tesseract' }, recognised);
  const after = await tablesOf(layered);
  check('the recognised scan is read as ONE table', after.length === 1, `read ${String(after.length)} tables`);
  const expected = SCAN_TABLE_ROWS.map((row) => [...row]);
  check(
    'every cell holds the words printed in it, read by Tesseract',
    JSON.stringify(after[0]) === JSON.stringify(expected),
    `read ${JSON.stringify(after[0])}, expected ${JSON.stringify(expected)}`,
  );

  if (failures.length > 0) {
    process.stderr.write(`\nScanned table — ${String(failures.length)} failure(s):\n\n${failures.map((failure) => `  - ${failure}`).join('\n\n')}\n\n`);
    process.exit(1);
  }
  process.stdout.write(`\n${roster.format('scanned-table case')}`);
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
