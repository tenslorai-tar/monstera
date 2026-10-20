// @ts-check
/**
 * How many pages of the owner's corpus still refuse a text edit — the owner's answer to R13's Q3, 2026-10-20: *in the
 * rare case where neither writer can keep the rest of the page, keep the page as it was and say so in one plain line.
 * Report how many corpus pages still reach that case after the MuPDF route.*
 *
 * ## What it runs
 *
 * Every page of every PDF under `MONSTERA_CORPUS`: PDFium's reading of the page (`pageRuns`), grouped into blocks the
 * way the editor groups them, and the first block with words gets a word appended — what the owner did in R13's video.
 * The edit is routed as the application routes it: MuPDF's `readPageRewrite` sends a page showing Type 3 text to the
 * operator writer (`applyEditTextOperators`), every other page to PDFium's (`applyEditTextBlock`). The bundled fonts are
 * bound as the host binds them, so a word the page's own fonts cannot carry is set in the closest bundled face, not
 * refused. Each outcome is classified as the shell classifies it:
 *
 * - `written` — the edit was kept;
 * - `refused: read-back` — the writer could not keep the rest of the page, so the page is left as it was: Q3's case;
 * - `refused: font cannot carry` — no face could carry a character;
 * - `refused at <step>` — another named step;
 * - `INTERNAL` — anything else;
 * - `no text on the page` — PDFium reads no text (a scan, a page of pictures): not an edit, not counted as one;
 * - `text, but no upright block` — text the editor does not open in place (turned or vertical), likewise.
 *
 * ## Its control, on every run
 *
 * The committed Type 3 print, edited the same way, must be routed to the operator writer and written: a sweep whose
 * routing or binding were broken would report every Type 3 page as refused, which is the answer this exists to rule out.
 *
 * Prints counts and document numbers only — never a file's name or its text.
 *
 * Usage: MONSTERA_CORPUS=<folder> node scripts/research/editRefusalCorpus.mjs [--pages <max per document>]
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { TYPE3_EDIT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { formatError } from '../lib/reportError.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const CORPUS = process.env['MONSTERA_CORPUS'] ?? '';
const pagesAt = process.argv.indexOf('--pages');
const PAGE_CAP = pagesAt === -1 ? Infinity : Number(process.argv[pagesAt + 1]);
const CONTROL = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf');

if (CORPUS === '' || !existsSync(CORPUS)) {
  process.stderr.write('editRefusalCorpus: set MONSTERA_CORPUS to the corpus folder.\n');
  process.exit(69);
}
const library = pdfiumLibrary(ROOT);
if (!existsSync(library) || bindNativeEngine(ROOT) === null) {
  process.stderr.write('editRefusalCorpus: needs PDFium provisioned and the MuPDF shim built.\n');
  process.exit(69);
}

// THE BUILD IT READS IS THIS SOURCE'S, `type3Edit.proof.mjs`' edges: the kernel, the contract's commands and the shim.
refuseStaleBuild(ROOT, TYPE3_EDIT, 3);
// LITERAL SPECIFIERS, as the proofs load the built kernel.
const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
pdfium.openPdfium(library);
const { blockEditOf } = await import('../../packages/contract/dist/commands.js');
const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
const { readPageRewrite } = await import('../../packages/kernel/dist/pageRewrite.js');
const { applyEditTextOperators } = await import('../../packages/kernel/dist/textOperatorEdit.js');
const { applyEditTextBlock } = await import('../../packages/kernel/dist/pdfiumTextEdit.js');
const { EditRefusedError, TextNotWritableError } = await import('../../packages/kernel/dist/textEditRefusals.js');
const { groupIntoBlocks, isEditedInPlace, settingOf } = await import('../../packages/kernel/dist/textLines.js');
const { bindEditFolders } = await import('../../packages/kernel/dist/editFaces.js');
const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');

const fonts = fontsDirectory(ROOT);
if (!existsSync(fonts)) {
  process.stderr.write('editRefusalCorpus: the bundled fonts are not provisioned (scripts/provision/fonts.mjs).\n');
  process.exit(69);
}
bindEditFolders(fonts, null, readCatalogueApart);

/** @param {unknown} error */
function classify(error) {
  if (error instanceof TextNotWritableError) return 'refused: font cannot carry';
  if (error instanceof EditRefusedError) return error.step === 'read-back' ? 'refused: read-back' : `refused at ${error.step}`;
  return `INTERNAL: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`;
}

/**
 * One page's edit, routed and classified.
 *
 * @param {Uint8Array} bytes
 * @param {number} page
 * @returns {Promise<{ route: string, outcome: string }>}
 */
async function editPage(bytes, page) {
  // TWO READS, as the application makes them: the editor's runs (`textRuns`, each with its style, which the grouping
  // reads) and the operator writer's numbering of the page (`pageRuns`), which the operator edit is handed.
  const { styled, reading } = await (async () => {
    const session = await pdfium.pdfiumWriter.open(bytes);
    try {
      return { styled: (await pdfium.textRuns(session, page)).runs, reading: await pdfium.pageRuns(session, page) };
    } finally {
      await pdfium.pdfiumWriter.close(session);
    }
  })();
  const blocks = groupIntoBlocks(
    styled.filter((/** @type {any} */ run) => isEditedInPlace(run.style)).map((/** @type {any} */ run) => ({ ...run, setting: settingOf(run.style) })),
  );
  const textOf = (/** @type {any} */ block) =>
    block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.text).join('')).join('\n');
  const block = blocks.find((/** @type {any} */ each) => textOf(each).trim().length >= 3);
  if (block === undefined) return { route: '-', outcome: styled.length === 0 ? 'no text on the page' : 'text, but no upright block' };
  const edit = blockEditOf([
    {
      lines: block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)),
      soft: block.lines.map(() => false),
      text: `${textOf(block).trimEnd()} edited`,
    },
  ]);
  const session = await mupdfWriter.open(bytes);
  try {
    const rewrite = await readPageRewrite(session, page);
    if (rewrite === 'operators') {
      // THE VERSION IS A NUMBER on the wire and branded on arrival, so the command is handed over as the host receives it.
      const command = /** @type {any} */ ({ kind: 'editTextOperators', page, ...edit, fit: 'reflow', version: 1 });
      const outcome = await applyEditTextOperators(session, command, reading).then(() => 'written', classify);
      return { route: 'operators', outcome };
    }
    const command = /** @type {any} */ ({ kind: 'editTextBlock', page, ...edit, fit: 'reflow', version: 1 });
    const outcome = await applyEditTextBlock({ bytes, opensWith: undefined }, command).then(() => 'written', classify);
    return { route: 'objects', outcome };
  } finally {
    await mupdfWriter.close(session);
  }
}

try {
  // THE CONTROL FIRST: the Type 3 print, routed to the operator writer and written.
  const control = await editPage(new Uint8Array(readFileSync(CONTROL)), 0);
  const controlHolds = control.route === 'operators' && control.outcome === 'written';
  process.stdout.write(`CONTROL (the Type 3 print): ${control.route}, ${control.outcome} — ${controlHolds ? 'holds' : 'FAILED'}\n\n`);
  if (!controlHolds) process.exitCode = 2;

  const files = readdirSync(CORPUS).filter((name) => name.toLowerCase().endsWith('.pdf')).sort();
  /** @type {Map<string, number>} */
  const totals = new Map();
  /** @type {Map<string, number>} */
  const byRoute = new Map();
  for (const [number, name] of files.entries()) {
    const bytes = new Uint8Array(readFileSync(join(CORPUS, name)));
    const session = await pdfium.pdfiumWriter.open(bytes).catch(() => null);
    if (session === null) {
      process.stdout.write(`document ${String(number + 1)}: PDFium could not open it (password or damage); not counted\n`);
      continue;
    }
    const count = await pdfium.pageCount(session).finally(() => pdfium.pdfiumWriter.close(session));
    /** @type {Map<string, number>} */
    const mine = new Map();
    for (let page = 0; page < Math.min(count, PAGE_CAP); page += 1) {
      const { route, outcome } = await editPage(bytes, page).catch((error) => ({ route: '?', outcome: `INTERNAL: ${formatError(error).slice(0, 120)}` }));
      mine.set(outcome, (mine.get(outcome) ?? 0) + 1);
      totals.set(outcome, (totals.get(outcome) ?? 0) + 1);
      if (route !== '-') byRoute.set(`${route}: ${outcome}`, (byRoute.get(`${route}: ${outcome}`) ?? 0) + 1);
    }
    process.stdout.write(
      `document ${String(number + 1)}: ${String(Math.min(count, PAGE_CAP))} of ${String(count)} page(s) — ${[...mine].map(([key, value]) => `${key} ${String(value)}`).join(', ')}\n`,
    );
  }
  process.stdout.write(`\nTOTAL: ${[...totals].map(([key, value]) => `${key} ${String(value)}`).join(', ')}\n`);
  process.stdout.write(`BY ROUTE: ${[...byRoute].map(([key, value]) => `${key} ${String(value)}`).join(', ')}\n`);
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
