// @ts-check
/**
 * What an in-place text edit does with each font kind — and what every PDFium command does to the text it did NOT
 * touch on a page that carries a Type 3 font.
 *
 * ## Why this exists
 *
 * A person's document printed by Chromium (its fonts Type 3, one CIDFontType2) refused every "edit text" with
 * *Something went wrong*, on 0.1.10.0 and on main (2026-10-04). The host's `failed(code, _cause)` keeps no cause by
 * design, so the reason was found by running the same edit in this process. Measured that day, PDFium 155.0.8044.0:
 *
 * - **The step that throws is the READ-BACK, not the edit.** `applyEditTextBlock` writes, generates and saves, then
 *   reopens the saved bytes to read each write back — and `drawnTexts` refuses: *page 0 has 56 objects, so index 100
 *   names none*. The page held 1,573 objects before the save and 56 after.
 * - **Why: `FPDFPage_GenerateContent` drops every Type 3 text object it regenerates.** PDFium's
 *   `CPDF_PageContentGenerator::ProcessText` writes `q`, the colours, `BT` and `Tm`, then names the font only for
 *   Type 1, TrueType and CID fonts — `else { return; }` — so a Type 3 object is saved with no `Tf`, no text and no
 *   `ET`. Counted on that page: 1,518 text-showing operators before, 1 after (the edited line, in its standard-font
 *   twin). The same branch is on PDFium's main branch (read 2026-10-04 at
 *   pdfium.googlesource.com, `core/fpdfapi/edit/cpdf_pagecontentgenerator.cpp`), so it is outside this repository.
 * - **And it is silent wherever the edit WROTE nothing.** The read-back reads only what was written. Deleting a
 *   one-character run in that page's only CIDFontType2 font answered *ok* through the shell and saved the page with
 *   **no** text objects: 2,168 before, 0 after. On this script's Chromium fixture, deleting the heading's full stop —
 *   its own run, so the edit only removes — saves a page holding the body line alone: both Type 3 headings gone,
 *   reported as done.
 *
 * ## Findings, 2026-10-04, PDFium 155.0.8044.0, Electron 43.4.1 in Node mode
 *
 * Every kind but Type 3 edits and keeps the page (both edits, every kind): Type 1 standard, embedded, subset and
 * compact; TrueType embedded, subset, not embedded and symbolic; Type0 over CIDFontType2 and over CIDFontType0. Type 3
 * never: the hand-built Type 3 page refuses with *the page's font cannot carry the text* — the wrong sentence, since
 * the same words are carried by Helvetica on the standard-14 page and the save is what lost them; the Chromium page
 * erases or fails; and replace-text, recolour, move and delete, each applied to the Helvetica line
 * alone, erase the Type 3 lines beside it. `promoteFormObjects` regenerates through the same call and needs a form
 * XObject this script's pages do not have, so it is not run here.
 *
 * ## Findings, 2026-10-05, after ADR-0169, PDFium 155.0.8044.0's Linux build, Electron 43.7.7 in Node mode
 *
 * The adapter's `serialise` now reads every regenerated page back against the page as edited. Every kind but Type 3
 * still edits and keeps the page, both edits, so the read-back refused nothing it should have kept. Every Type 3 row
 * now refuses at step `read-back` and saves nothing: the hand-built page (3 text objects edited, 1 saved), both
 * Chromium rows, and replace-text, recolour, move and delete on the Helvetica line. The hand-built page's refusal is
 * the read-back's and no longer *the font cannot carry the text*.
 *
 * ## What it runs
 *
 * `fontKindFixtures.mjs`' pages — one per font kind, each with line A (edited), line B (the same font, untouched) and
 * line C (Helvetica, untouched) — then the committed Chromium print (`chromiumType3Fixture.mjs`; `--chromium` names
 * another), and any file named on the command line.
 * For each: the edit main would send for line A (grouped the way `composition.ts` groups it), applied through
 * `applyEditTextBlock` — the function the PDFium host's `engine/apply` calls — and classified the way
 * `pdfiumHandlers.ts` classifies it: `TextNotWritableError` is the person's sentence, anything else is *Something went
 * wrong*. A save that succeeded is then reopened and lines B and C are looked for: an edit that saved without them
 * destroyed text nobody asked it to touch, which is the outcome no read-back of the writes can see.
 *
 * Then THE CLASS: on the Type 3 fixture, four other PDFium commands each applied to line C alone, and lines A and B
 * looked for.
 *
 * ## Its controls, on every run
 *
 * - Every fixture's three lines must read back exactly BEFORE anything is edited, or that fixture is reported as
 *   unreadable and not counted — a fixture PDFium cannot read would otherwise pass as a refusal.
 * - The loss detector must find a loss it is shown: line B removed on purpose from the Helvetica fixture with
 *   `removeObjects`. Without that, *nothing was lost* would be the answer for every row.
 *
 * ## In the host's runtime
 *
 * Under the pinned Electron in Node mode, as the PDFium host runs (`ELECTRON_RUN_AS_NODE=1`). Run from plain Node it
 * starts itself there. It prints font kinds, outcomes and this codebase's own messages — never a document's text,
 * which is why a file named on the command line has its rows reported without the lines it found.
 *
 * Usage: node scripts/research/fontKindEdits.mjs [--chromium <print.pdf>] [file.pdf ...]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { electronBinaryPath } from '../provision/electron.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { CHROMIUM_FIXTURE, CHROMIUM_LINES } from './chromiumType3Fixture.mjs';
import { FONT_KINDS, LINES, buildFixture } from './fontKindFixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

if (!('electron' in process.versions)) {
  // THE HOST'S RUNTIME, started by name: plain Node never loads Electron (invariant 26).
  const run = spawnSync(electronBinaryPath(ROOT), [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(run.status ?? 1);
}

/** @param {string} relative @returns {Promise<any>} */
const built = (relative) => import(pathToFileURL(join(ROOT, relative)).href);
const pdfium = await built('packages/kernel/dist/pdfiumFfi.js');
const { applyEditTextBlock } = await built('packages/kernel/dist/pdfiumTextEdit.js');
const { EditRefusedError, TextNotWritableError } = await built('packages/kernel/dist/textEditRefusals.js');
const { groupIntoBlocks, settingOf } = await built('packages/kernel/dist/textLines.js');
const { blockEditOf } = await built('packages/contract/dist/commands.js');
pdfium.openPdfium(pdfiumLibrary(ROOT));

/** @typedef {{ index: number, last: number, text: string, style: any }} Run */

/** Page 0's runs as the editor reads them. @param {Uint8Array} bytes @returns {Promise<Run[]>} */
async function runsOf(bytes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    return (await pdfium.textRuns(session, 0)).runs;
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/** Page 0's text objects, counted. @param {Uint8Array} bytes */
async function textObjects(bytes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    return (await pdfium.pageObjects(session, 0)).filter((/** @type {any} */ object) => object.kind === 'text').length;
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/**
 * The blocks `composition.ts` would answer, upright runs only.
 *
 * @param {Run[]} runs
 * @returns {any[]} `groupIntoBlocks`' answer, imported from the build by a computed path, which types as nothing
 */
function blocksOf(runs) {
  return groupIntoBlocks(runs.filter((run) => run.style.upright).map((run) => ({ ...run, setting: settingOf(run.style) })));
}

/** @param {any} block */
const textOfBlock = (block) => block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {Run} */ run) => run.text).join('')).join('\n');

/** Whether `wanted` is one of the page's lines, read as the editor reads them. @param {Run[]} runs @param {string} wanted */
const hasLine = (runs, wanted) => blocksOf(runs).some((block) => textOfBlock(block).trimEnd() === wanted);

/**
 * A refusal, classified as the shell classifies it: `TextNotWritableError` and a refusal at a named step
 * (`EditRefusedError`, ADR-0169) are sentences a person reads; anything else is *Something went wrong*.
 *
 * @param {unknown} error
 * @returns {{ outcome: string, detail: string }}
 */
function refusal(error) {
  // THE CLASSES COME FROM A COMPUTED IMPORT, which types as nothing, so `instanceof` narrows nothing and each refusal
  // is named by the shape its class declares.
  if (error instanceof TextNotWritableError) {
    const { characters } = /** @type {{ characters: string }} */ (error);
    return { outcome: 'refused: font cannot carry', detail: `characters named: ${String(characters.length > 0)}` };
  }
  if (error instanceof EditRefusedError) {
    const { step, message } = /** @type {{ step: string, message: string }} */ (error);
    return { outcome: `refused at ${step}`, detail: message };
  }
  return { outcome: 'INTERNAL ERROR', detail: error instanceof Error ? error.message : String(error) };
}

/**
 * One edit of the block reading `line` (or of the first block, for a file whose words are not ours), classified.
 *
 * @param {Uint8Array} bytes
 * @param {(text: string) => string} change
 * @param {string | null} line
 * @param {readonly string[]} keep the lines that must survive
 */
async function edit(bytes, change, line, keep) {
  const runs = await runsOf(bytes);
  const objectsBefore = await textObjects(bytes);
  const blocks = blocksOf(runs);
  const block = line === null ? blocks[0] : blocks.find((b) => textOfBlock(b).trimEnd() === line);
  if (block === undefined) return { outcome: 'NO BLOCK', detail: 'the line to edit was not offered as a block' };
  const command = {
    kind: 'editTextBlock',
    page: 0,
    ...blockEditOf([{ lines: block.lines.map((/** @type {any} */ l) => l.runs.map((/** @type {Run} */ r) => r.index)), text: change(textOfBlock(block).trimEnd()) }]),
    fit: 'reflow',
    version: 1,
  };
  let saved;
  try {
    // NO PASSWORD: a generated document (ADR-0171's addendum, the session is the bytes and their key).
    saved = await applyEditTextBlock({ bytes, opensWith: undefined }, command);
  } catch (error) {
    return refusal(error);
  }
  const after = await runsOf(saved);
  const lost = keep.filter((wanted) => !hasLine(after, wanted));
  const objectsAfter = await textObjects(saved);
  const counts = `text objects ${String(objectsBefore)} -> ${String(objectsAfter)}`;
  // THE EDIT ITSELF IS IN THE FILE, read the way a person is shown it — for a line of ours; a file that is not ours is
  // judged by what was kept, and its words are never compared.
  const edited = line === null || hasLine(after, change(line));
  if (lost.length > 0) {
    return {
      outcome: 'SAVED, BUT ERASED UNTOUCHED TEXT',
      detail: `lost ${lost.length === keep.length ? 'every untouched line' : `${String(lost.length)} of ${String(keep.length)} untouched lines`}${edited ? '' : ', and the edit is not in it either'}; ${counts}`,
    };
  }
  return edited ? { outcome: 'works', detail: counts } : { outcome: 'SAVED, BUT THE EDIT IS NOT IN IT', detail: counts };
}

const EDITS = /** @type {const} */ ([
  ['delete the last character', (/** @type {string} */ text) => text.slice(0, -1)],
  ['append a word', (/** @type {string} */ text) => `${text} edited`],
]);

const failures = [];

// CONTROL 1 — the loss detector finds a loss it is shown.
{
  const bytes = await buildFixture('type1-standard14');
  const runs = await runsOf(bytes);
  const b = blocksOf(runs).find((block) => textOfBlock(block).trimEnd() === LINES.b);
  const session = await pdfium.pdfiumWriter.open(bytes);
  let damaged;
  try {
    await pdfium.removeObjects(session, 0, b.lines.flatMap((/** @type {any} */ l) => l.runs.map((/** @type {Run} */ r) => r.index)));
    damaged = await pdfium.pdfiumWriter.serialise(session);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const before = await runsOf(bytes);
  const after = await runsOf(damaged);
  if (!(hasLine(before, LINES.b) && !hasLine(after, LINES.b) && hasLine(after, LINES.c))) {
    failures.push('CONTROL: the loss detector did not see line B removed on purpose, so a "works" below would mean nothing');
  }
}

/** @type {string[][]} */
const rows = [];
for (const { id, kind } of FONT_KINDS) {
  const bytes = await buildFixture(id);
  const runs = await runsOf(bytes);
  const lines = id === 'type0-cidfonttype0' ? null : LINES;
  // CONTROL 2 — the fixture reads as written before anything is edited. The CID-keyed font that is not embedded
  // carries Japanese, so for it the check is that three lines are offered.
  const readable = lines === null ? blocksOf(runs).length >= 3 : [LINES.a, LINES.b, LINES.c].every((line) => hasLine(runs, line));
  if (!readable) {
    rows.push([kind, 'FIXTURE UNREADABLE', `${String(blocksOf(runs).length)} block(s) read; not counted`, '']);
    continue;
  }
  for (const [label, change] of EDITS) {
    const result =
      lines === null
        ? await edit(bytes, change, null, [])
        : await edit(bytes, change, LINES.a, [LINES.b, LINES.c]);
    rows.push([kind, label, result.outcome, result.detail]);
  }
}

const chromiumAt = process.argv.indexOf('--chromium');
const outside = process.argv.slice(2).filter((arg, i, all) => arg !== '--chromium' && all[i - 1] !== '--chromium');
// THE COMMITTED PRINT unless another is named: it is what proves the defect without anybody's document.
const chromium = chromiumAt === -1 ? CHROMIUM_FIXTURE : process.argv[chromiumAt + 1];
if (chromium === undefined || !existsSync(chromium)) {
  rows.push(['Chromium print (Type 3 + CIDFontType2)', 'NO FIXTURE', `nothing at ${String(chromium)}`, '']);
} else {
  const bytes = new Uint8Array(readFileSync(chromium));
  const runs = await runsOf(bytes);
  if (![CHROMIUM_LINES.heading, CHROMIUM_LINES.second, CHROMIUM_LINES.body].every((line) => hasLine(runs, line))) {
    rows.push(['Chromium print (Type 3 + CIDFontType2)', 'FIXTURE UNREADABLE', 'not counted', '']);
  } else {
    for (const [label, change] of EDITS) {
      // THE TYPE 3 HEADING, then the CIDFontType2 body beside it. Deleting the heading's full stop is the silent case:
      // the stop is a run of its own, so the edit only removes, and there is no write for the read-back to read.
      const heading = await edit(bytes, change, CHROMIUM_LINES.heading, [CHROMIUM_LINES.second, CHROMIUM_LINES.body]);
      rows.push(['Chromium print: the Type 3 heading', label, heading.outcome, heading.detail]);
      const body = await edit(bytes, change, CHROMIUM_LINES.body, [CHROMIUM_LINES.heading, CHROMIUM_LINES.second]);
      rows.push(['Chromium print: the TrueType (CID) body', label, body.outcome, body.detail]);
    }
  }
}
for (const [n, path] of outside.entries()) {
  const bytes = new Uint8Array(readFileSync(path));
  for (const [label, change] of EDITS) {
    // A FILE THAT IS NOT OURS: its first block, and no line named — its words are not ours to print or to compare.
    const result = await edit(bytes, change, null, []);
    rows.push([`file ${String(n + 1)} (first block of page 1)`, label, result.outcome, result.detail]);
  }
}

// THE CLASS, on the Type 3 fixture: every other PDFium command, applied to line C (Helvetica) alone.
{
  const bytes = await buildFixture('type3');
  const runs = await runsOf(bytes);
  const c = blocksOf(runs).find((block) => textOfBlock(block).trimEnd() === LINES.c);
  const cIndex = c.lines[0].runs[0].index;
  /** @type {[string, (session: unknown) => Promise<unknown>][]} */
  const commands = [
    ['replaceTextObject (line C)', (session) => pdfium.replaceTextObjects(session, 0, [{ index: cIndex, text: 'Control line changed.' }], 'as-written')],
    ['recolorPageObjects (line C)', (session) => pdfium.setObjectFills(session, 0, [{ index: cIndex, red: 200, green: 0, blue: 0, alpha: 255 }])],
    ['placePageObject (line C)', (session) => pdfium.placeObject(session, 0, cIndex, { moveBy: { x: 0, y: -20 }, scaleBy: { x: 1, y: 1 } })],
    ['deletePageObjects (line C)', (session) => pdfium.removeObjects(session, 0, [cIndex])],
  ];
  for (const [label, run] of commands) {
    const session = await pdfium.pdfiumWriter.open(bytes);
    let saved;
    try {
      await run(session);
      saved = await pdfium.pdfiumWriter.serialise(session);
    } catch (error) {
      const { outcome, detail } = refusal(error);
      rows.push(['Type 3 page, another command', label, outcome, detail]);
      continue;
    } finally {
      await pdfium.pdfiumWriter.close(session);
    }
    const after = await runsOf(saved);
    const kept = hasLine(after, LINES.a) && hasLine(after, LINES.b);
    rows.push(['Type 3 page, another command', label, kept ? 'kept the Type 3 lines' : 'ERASED THE TYPE 3 LINES', `text objects ${String(await textObjects(bytes))} -> ${String(await textObjects(saved))}`]);
  }
}

const widths = [0, 1, 2].map((col) => Math.max(...rows.map((row) => (row[col] ?? '').length)));
for (const row of rows) {
  process.stdout.write(`${row.slice(0, 3).map((cell, col) => cell.padEnd(widths[col] ?? 0)).join(' | ')} | ${row[3] ?? ''}\n`);
}
if (failures.length > 0) {
  process.stderr.write(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`\n${String(rows.length)} rows; both controls held.\n`);
