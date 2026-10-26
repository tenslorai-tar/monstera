// @ts-check
/**
 * Today's Edit text writer on the catalogue of difficult pages (`editCatalogue.mjs`): each page's edit sent to the
 * operator writer as `main` routes it, and judged by the check every later test of the rebuilt editor runs
 * (`editExpectations.mjs`). A MEASUREMENT, not a gate: it is the baseline the writer changes of ADR-0271 (cloud run 22,
 * Part 2b) are measured against, and it prints what fails and why.
 *
 * ## How an edit is sent
 *
 * PDFium reads the page as the editor does (`textRuns`, grouped by `groupIntoBlocks`); the block the manifest edits is
 * the grouped block whose box most overlaps the manifest's; its new text is that block's text as read, with the words the
 * manifest's edit removes replaced by the words it inserts; and it goes to `applyEditTextOperators`, the
 * one Edit text writer (ADR-0266), with NO blocks pushed below it — the behaviour ADR-0271 keeps, so a disturbance this
 * prints below a growing block is the push it retires, not the measurement's.
 *
 * Not sent: a block inside a form, whose route needs `main`'s form assembly, which no shared function holds yet (the
 * stage audit's XXXXXXXX-3). It is printed as not measured, never as passed.
 *
 * ## The control
 *
 * Before any page is judged, the check is run on the catalogue's own correct edit of the first page, which must pass, and
 * on that page unchanged, which must fail as unseen: an instrument that cannot tell the two apart reports nothing.
 *
 * Usage: node scripts/research/editCatalogueWriter.mjs [--shape <id>]
 */
import { existsSync } from 'node:fs';

import { EDIT_TEXT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { expectEdit } from '../lib/editExpectations.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { SHAPES } from './editCatalogue.mjs';

const ROOT = repoRoot();
const ONLY = process.argv.includes('--shape') ? process.argv[process.argv.indexOf('--shape') + 1] : undefined;

const library = pdfiumLibrary(ROOT);
if (!existsSync(library) || bindNativeEngine(ROOT) === null || !existsSync(fontsDirectory(ROOT))) {
  throw new Error('This measurement needs PDFium, the MuPDF shim and the bundled fonts provisioned.');
}
refuseStaleBuild(ROOT, EDIT_TEXT, 5);
// LITERAL SPECIFIERS, so the freshness scan can read what this loads.
const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
pdfium.openPdfium(library);
const { blockEditOf, readsUnpacked } = await import('../../packages/contract/dist/commands.js');
const { groupIntoBlocks, isEditedInPlace, blockableOf } = await import('../../packages/kernel/dist/textLines.js');
const { paragraphsOfLines, lineText, asDocVersion } = await import('../../packages/shared/dist/index.js');
const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
const { applyEditTextOperators } = await import('../../packages/kernel/dist/textOperatorEdit.js');
const { bindEditFolders, loadEditFaces } = await import('../../packages/kernel/dist/editFaces.js');
const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');
bindEditFolders(fontsDirectory(ROOT), null, readCatalogueApart);
await loadEditFaces();
const engines = { kernel: { mupdf }, pdfium };

/** @param {import('./editCatalogue.mjs').Line} line */
const textOf = (line) => (typeof line === 'string' ? line : line.map((segment) => segment.text).join(''));

// THE CONTROL: the check passes the catalogue's correct edit and fails an unchanged page.
{
  const shape = /** @type {import('./editCatalogue.mjs').Shape} */ (SHAPES[0]);
  const base = await shape.build({});
  const correct = await shape.build({ edit: { block: shape.edit.block, lines: shape.edit.lines } });
  const block = /** @type {import('./editCatalogue.mjs').Block} */ (base.blocks.find((each) => each.id === shape.edit.block));
  const expected = /** @type {string} */ (correct.blocks.find((each) => each.id === block.id)?.text);
  const passes = await expectEdit(engines, { before: base.bytes, after: correct.bytes, page: base.page, block, expected });
  const fails = await expectEdit(engines, { before: base.bytes, after: base.bytes, page: base.page, block, expected });
  if (passes.length > 0 || !fails.some((each) => each.startsWith('UNSEEN:'))) {
    throw new Error(`the check cannot tell a correct edit from none: ${JSON.stringify({ passes, fails })}`);
  }
  process.stdout.write('  control: the check passes the correct edit and fails an unchanged page\n\n');
}

/** @type {{ id: string, verdict: string }[]} */
const results = [];
for (const shape of SHAPES.filter((each) => ONLY === undefined || each.id === ONLY)) {
  const base = await shape.build({});
  const correct = await shape.build({ edit: { block: shape.edit.block, lines: shape.edit.lines } });
  const block = /** @type {import('./editCatalogue.mjs').Block} */ (base.blocks.find((each) => each.id === shape.edit.block));
  const expected = /** @type {string} */ (correct.blocks.find((each) => each.id === block.id)?.text);
  if (block.form !== undefined) {
    results.push({ id: shape.id, verdict: 'NOT MEASURED: a block inside a form (see the header)' });
    continue;
  }
  const session = await pdfium.pdfiumWriter.open(base.bytes);
  /** @type {any} */
  let read;
  /** @type {any} */
  let runs;
  try {
    const plain = await pdfium.textRuns(session, base.page);
    const unpacked = readsUnpacked(plain.unaddressable, 'operators');
    if (unpacked) await pdfium.unpackedIfAsked(session, base.page, true);
    read = unpacked ? await pdfium.textRuns(session, base.page) : plain;
    runs = await pdfium.pageRuns(session, base.page);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const grouped = groupIntoBlocks(read.runs.filter((/** @type {any} */ run) => isEditedInPlace(run.style)).map((/** @type {any} */ run) => blockableOf(run)));
  // THE MANIFEST'S BLOCK, as the grouping read it: the grouped block whose box holds the most of the manifest's box.
  const overlap = (/** @type {any} */ each) =>
    Math.max(0, Math.min(each.box.x1, block.box.right) - Math.max(each.box.x0, block.box.left)) *
    Math.max(0, Math.min(each.box.y1, block.box.top) - Math.max(each.box.y0, block.box.bottom));
  const near = [...grouped].filter((each) => overlap(each) > 0).sort((a, b) => overlap(b) - overlap(a));
  if (near.length === 0) {
    results.push({ id: shape.id, verdict: 'NOT SENT: the grouping offers no block where the manifest’s is' });
    continue;
  }
  /** A grouped block's text as the editor reads it. @param {any} each */
  const textRead = (each) => paragraphsOfLines(each.lines.map((/** @type {any} */ line) => ({ text: lineText(line.runs), soft: line.soft })));
  // THE EDIT'S OWN CHANGE, applied to the block as the grouping reads it: the words the manifest's edit removes and
  // inserts, found by their shared start and end. Rebuilding the text from the manifest's lines instead dropped what the
  // grouping joins to the block — a numbered list's numbers — and failed wherever it splits lines otherwise.
  const was = block.text.split(/\s+/u);
  const becomes = shape.edit.lines.map(textOf).join('\n').split(/\s+/u);
  let start = 0;
  while (start < was.length && was[start] === becomes[start]) start += 1;
  let end = 0;
  while (end < was.length - start && was[was.length - 1 - end] === becomes[becomes.length - 1 - end]) end += 1;
  const removed = was.slice(start, was.length - end).join(' ');
  const inserted = becomes.slice(start, becomes.length - end).join(' ');
  // OF THE BLOCKS WHERE THE MANIFEST'S IS, the one holding the words the edit changes: a code block groups a line to a
  // block, and the widest line is not the edited one.
  const chosen = near.find((each) => removed !== '' && textRead(each).includes(removed)) ?? /** @type {any} */ (near[0]);
  const asRead = textRead(chosen);
  if (removed === '' || !asRead.includes(removed)) {
    results.push({ id: shape.id, verdict: `NOT SENT: the block as the grouping reads it does not hold “${removed}”` });
    continue;
  }
  const text = asRead.replace(removed, inserted);
  const entry = {
    lines: chosen.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)),
    soft: chosen.lines.map((/** @type {any} */ line) => line.soft),
    text,
  };
  const copy = await mupdfWriter.open(base.bytes);
  /** @type {Uint8Array | null} */
  let after = null;
  /** @type {import('../lib/editExpectations.mjs').Outcome} */
  let outcome;
  try {
    const { noted } = await applyEditTextOperators(copy, { kind: 'editTextOperators', page: base.page, ...blockEditOf([entry]), fit: 'reflow', version: asDocVersion(1) }, runs);
    after = await mupdfWriter.serialise(copy);
    outcome = { noted };
  } catch (error) {
    outcome = { refused: error };
  } finally {
    await mupdfWriter.close(copy);
  }
  const failures = await expectEdit(engines, { before: base.bytes, after, page: base.page, block, expected, outcome });
  results.push({ id: shape.id, verdict: failures.length === 0 ? 'held' : failures.join('\n      ') });
}

for (const { id, verdict } of results) process.stdout.write(`  ${id}: ${verdict}\n`);
const held = results.filter((each) => each.verdict === 'held').length;
process.stdout.write(`\n  ${String(held)} of ${String(results.length)} page(s) held every expectation.\n`);
