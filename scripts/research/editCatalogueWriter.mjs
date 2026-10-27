// @ts-check
/**
 * Today's Edit text writer on the catalogue of difficult pages (`editCatalogue.mjs`): each page's edit sent to the
 * operator writer as `main` routes it, and judged by the check every later test of the rebuilt editor runs
 * (`editExpectations.mjs`). A MEASUREMENT, not a gate: it is the baseline the writer changes of ADR-0271 (cloud run 22,
 * Part 2b) are measured against, and it prints what fails and why.
 *
 * ## How an edit is sent
 *
 * PDFium reads the page as the editor does (`textRuns`, grouped by `groupInFrames`); the block the manifest edits is
 * the grouped block whose box most overlaps the manifest's; its new text is that block's text as read, with the words the
 * manifest's edit removes replaced by the words it inserts; and it goes to `applyEditTextOperators`, the
 * one Edit text writer (ADR-0266), with NO blocks pushed below it — the behaviour ADR-0271 keeps, so a disturbance this
 * prints below a growing block is the push it retires, not the measurement's. That path is `writeCatalogueShape`
 * (`scripts/lib/catalogueWrite.mjs`), the one spelling `proof:editcatalogue` runs too.
 *
 * Not sent: a block inside a form, whose route needs `main`'s form assembly, which no shared function holds yet (the
 * stage audit's XXXXXXXX-3). It is printed as not measured, never as passed.
 *
 * ## The control
 *
 * Before any page is judged, the check is run on the catalogue's own correct edit of the first page, which must pass, and
 * on that page unchanged, which must fail as unseen: an instrument that cannot tell the two apart reports nothing.
 *
 * Usage: node scripts/research/editCatalogueWriter.mjs [--shape <id>] [--keep <folder>]
 *   --keep writes each page as the writer left it to the folder, named by its shape, for a person to open
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EDIT_TEXT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { writeCatalogueShape } from '../lib/catalogueWrite.mjs';
import { expectEdit } from '../lib/editExpectations.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { SHAPES } from './editCatalogue.mjs';

const ROOT = repoRoot();
const ONLY = process.argv.includes('--shape') ? process.argv[process.argv.indexOf('--shape') + 1] : undefined;
const KEEP = process.argv.includes('--keep') ? process.argv[process.argv.indexOf('--keep') + 1] : undefined;
if (KEEP !== undefined) mkdirSync(KEEP, { recursive: true });

const library = pdfiumLibrary(ROOT);
if (!existsSync(library) || bindNativeEngine(ROOT) === null || !existsSync(fontsDirectory(ROOT))) {
  throw new Error('This measurement needs PDFium, the MuPDF shim and the bundled fonts provisioned.');
}
refuseStaleBuild(ROOT, EDIT_TEXT, 5);
// LITERAL SPECIFIERS, so the freshness scan can read what this loads.
const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
pdfium.openPdfium(library);
const { blockEditOf, readsUnpacked } = await import('../../packages/contract/dist/commands.js');
const { groupInFrames, inItsFrame, blockableOf } = await import('../../packages/kernel/dist/textLines.js');
const { paragraphsOfLines, lineText, asDocVersion, fromTextFrame } = await import('../../packages/shared/dist/index.js');
const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
const { applyEditTextOperators } = await import('../../packages/kernel/dist/textOperatorEdit.js');
const { bindEditFolders, loadEditFaces } = await import('../../packages/kernel/dist/editFaces.js');
const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');
bindEditFolders(fontsDirectory(ROOT), null, readCatalogueApart);
await loadEditFaces();
const engines = { kernel: { mupdf }, pdfium };


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

const kit = { pdfium, mupdfWriter, applyEditTextOperators, blockEditOf, readsUnpacked, groupInFrames, inItsFrame, blockableOf, paragraphsOfLines, lineText, asDocVersion, fromTextFrame, expectEdit, engines };
/** @type {{ id: string, verdict: string }[]} */
const results = [];
for (const shape of SHAPES.filter((each) => ONLY === undefined || each.id === ONLY)) {
  const { verdict, after } = await writeCatalogueShape(kit, shape);
  if (KEEP !== undefined && after !== null) writeFileSync(join(KEEP, `${shape.id}.pdf`), after);
  results.push({ id: shape.id, verdict });
}

for (const { id, verdict } of results) process.stdout.write(`  ${id}: ${verdict}\n`);
const held = results.filter((each) => each.verdict === 'held').length;
process.stdout.write(`\n  ${String(held)} of ${String(results.length)} page(s) held every expectation.\n`);
