// @ts-check
/**
 * The full walk of every tool (the owner's standing rule of 2026-11-02, ADR-0285): one step per command the registry
 * generates into `docs/manual-test-checklist.md`, run in the development app on Windows the way a person runs it, and
 * recorded with `covers` so the walk's record has a row for each.
 *
 *   node scripts/research/everyToolWalk.mjs [--app-root <checkout>] [--from <n>] [--only <id,id>]
 *
 * ## What one step does
 *
 * A fresh copy of the walk's form document (three pages, words, fields) is opened, and the command is run from the
 * command palette by its title: first as the document opened, then with words selected, since a command the registry
 * offers only with a selection is not offered without one. Any question the command asks is answered as a hand does,
 * by the dialog's own primary button (its danger button where the answer is destructive), and the platform's file
 * pickers are answered with paths in the walk's own folder. A dialog whose registry id is a `-problem` one, a problem
 * toast, or a page error is a failure.
 *
 * The step passes when the command shows what the registry declares for it (*Shows:* in the checklist): a done toast,
 * a dialog, or a change on screen. Where the document changed it is saved as a copy and the copy opened again, and it
 * must open whole: the wired-tools rule's *survives save and reopen*, at the depth one generic step can reach. The
 * feature walks (text, forms, AI, deep forms) assert exact effects and mark the commands they cover; this walk is the
 * floor every command stands on, and the report says which rows were checked to which depth.
 *
 * ## What it does not run, and says why
 *
 * Nothing here sends data off this computer, opens anything outside the app, or prints: every way main hands Windows
 * something to open (`shell.openExternal`, `shell.openPath`, `shell.showItemInFolder`) is recorded instead, and a
 * print where the window's `print` is; the walk's last step fails if an installed Monstera started during it. A command that
 * closes the window, or needs the owner's account or key, is not walked and its row says so, by name.
 */
import { execFileSync } from 'node:child_process';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { expect } from '@playwright/test';
import { zipSync } from 'fflate';

import { ADDED_FIRST, EFFECTS, FIELD_TYPED, LINK_TYPED, TYPED_WORD, outputsOf, readPdf, respondedWhy, scannedPageDocument } from './everyToolEffects.mjs';
import { WALK_WINDOW, appRootOption, root, startWalk, writesIdle } from './liveWalk.mjs';
import { editTextOpening } from './textWalkSteps.mjs';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

/** @typedef {{ title: string, group: string, id: string, shows: string }} ListedCommand */

/** Every command the checklist names, once each, in its order: the registry's own list (ADR-0285 Decision 4). */
function listedCommands() {
  const text = readFileSync(join(root, 'docs', 'manual-test-checklist.md'), 'utf8');
  /** @type {Map<string, ListedCommand>} */
  const byId = new Map();
  // " · Help:" FOLLOWS ONLY WHERE A COMMAND HAS A HELP TOPIC, so the answer ends at the next separator or the line's end:
  // a pattern that required it dropped every command with none, silently (the walk's first trial, 2026-11-03).
  // THE GROUP TOO IS THERE ONLY WHERE A COMMAND HAS ONE: a context menu's and a panel's lines read "**Title** · `id`".
  for (const match of text.matchAll(/^- \[ \] \*\*(.+?)\*\*(?: — (.+?))? · `([a-z0-9][a-z0-9.-]*)` · Shows: ([^·\n]+)/gmu)) {
    const [, title = '', group = '', id = '', shows = ''] = match;
    if (!byId.has(id)) byId.set(id, { title, group, id, shows: shows.trim() });
  }
  if (!byId.has('document.save')) throw new Error('the checklist read found no document.save: it cannot see, so it lists nothing');
  // EVERY COMMAND THE CHECKLIST NAMES, or none: the record counts the same file's ids, and a read that dropped some would
  // be a walk that never reached them reading as complete.
  const named = new Set([...text.matchAll(/ · `([a-z0-9][a-z0-9.-]*)` · /gu)].map((each) => each[1] ?? ''));
  if (named.size !== byId.size) throw new Error(`the checklist names ${String(named.size)} commands and this read parsed ${String(byId.size)}`);
  return [...byId.values()];
}

/**
 * What a state-setting command is run after, so its state does not hold already: each is the registered command a
 * person would have used to get somewhere else first.
 */
const AWAY_FROM = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
  'view.theme-system': ['view.theme-dark'],
  'view.theme-light': ['view.theme-dark'],
  'view.theme-dark': ['view.theme-light'],
  'view.layout-ribbon': ['view.layout-studio'],
  'view.page-layout-continuous': ['view.page-layout-facing'],
  // THE COVER PAGE APPLIES TO THE TWO FACING LAYOUTS AND NOTHING ELSE (ADR-0284 Decision 3), so it is walked in one.
  'view.cover-page': ['view.page-layout-facing'],
  'view.leave-focus': ['view.layout-focus'],
  // PAGE 2 ON SHOW, so there is a page above it to move it past.
  'document.move-page-earlier': ['view.page-next'],
  'view.actual-size': ['view.zoom-in'],
  'view.page-first': ['view.page-last'],
  'view.page-previous': ['view.page-last'],
  'view.go-back': ['view.page-last'],
  // THE OTHER TAB OF ITS PANEL ON SHOW: Properties is the panel's first tab, and the fourth full run of 2026-11-03 ran
  // it straight after a step that had shown it.
  'view.show-properties': ['ai.open-assistant'],
});


/**
 * Commands a hand reaches from a surface other than the palette, by the state that surface needs: the third full run
 * of 2026-11-03 "passed" 73 rows the palette did not offer, which is a row recorded and not walked. Each is run where it
 * is placed, after the state that draws it:
 * - `selection`: words selected, then the selection's own menu. The palette cannot offer these: focusing its field
 *   collapses the page's selection, and `TextSelectionStore` reads it again on every `selectionchange`;
 * - `annotation`: the walk document's comment selected with Select annotations, then the palette, else its menu;
 * - `field`: Edit fields on and the name field selected (both fields for an arrange), then the palette, else its menu;
 * - `page`: the page's own menu, after a comment was copied;
 * - `format`: a text block open in Edit text, then the Properties panel's button, since the palette would take the
 *   focus out of the editor and close it over the words (`keepsFocus`, ADR-0180);
 * - `tab`: a second document open, then the first tab's menu;
 * - `start`: no document open, then the start screen's card;
 * - `key`: words selected, then the command's own chord;
 * - `object`: Edit shapes on and one of page 1's overlapping shapes selected, then the palette, else its menu.
 */
const SELECTION_MENU = ['text.copy', 'text.highlight', 'text.underline', 'text.strikeout', 'text.comment', 'text.redact', 'text.search'];
const ON_A_COMMENT = ['annotate.copy-selection', 'annotate.delete-selection', 'annotate.edit-selection', 'annotate.properties', 'annotate.reply-selection', ...['down', 'left', 'right', 'up'].flatMap((way) => [`annotate.nudge-${way}`, `annotate.nudge-${way}-far`])];
const ARRANGE = ['align-left', 'align-right', 'align-top', 'align-bottom', 'centre-horizontally', 'centre-vertically', 'same-width', 'same-height', 'same-size', 'distribute-horizontally', 'distribute-vertically'].map((name) => `forms.arrange.${name}`);
const ON_A_FIELD = ['forms.field-properties', 'forms.copy-fields', 'forms.paste-fields', 'forms.duplicate-field', 'forms.copy-to-pages', ...ARRANGE];
const FORMATS = ['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'align-left', 'align-center', 'align-right', 'align-justify', 'bullets', 'numbering', 'indent-more', 'indent-less'].map((name) => `text.format.${name}`);
const START_CARDS = ['annotate', 'forms', 'ocr', 'split-merge', 'encrypt-sign', 'export'].map((name) => `start.${name}`);
const VIA = /** @type {Readonly<Record<string, 'selection' | 'annotation' | 'field' | 'page' | 'format' | 'tab' | 'start' | 'key' | 'object'>>} */ ({
  ...Object.fromEntries(SELECTION_MENU.map((id) => [id, 'selection'])),
  ...Object.fromEntries(ON_A_COMMENT.map((id) => [id, 'annotation'])),
  ...Object.fromEntries(ON_A_FIELD.map((id) => [id, 'field'])),
  ...Object.fromEntries(FORMATS.map((id) => [id, 'format'])),
  ...Object.fromEntries(START_CARDS.map((id) => [id, 'start'])),
  'annotate.paste': 'page',
  'document.open-side-by-side': 'tab',
  'document.close-others': 'tab',
  'edit.copy': 'key',
  'edit.cut': 'key',
  'edit.object-forward': 'object',
  'edit.object-backward': 'object',
});
/** The chord each `key` route presses, which is the command's own `shortcut` (Edit › Copy, Ctrl+C; Edit › Cut, Ctrl+X). */
const CHORD = /** @type {Readonly<Record<string, string>>} */ ({ 'edit.copy': 'Control+C', 'edit.cut': 'Control+X' });
/**
 * The state a `key` route presses its chord in, where it is not words selected: Cut takes a selected comment, since the
 * page's own words cannot be cut.
 */
const KEY_STATE = /** @type {Readonly<Record<string, 'annotation'>>} */ ({ 'edit.cut': 'annotation' });

/**
 * Commands whose dialog runs ANOTHER registered command, and the question that command asks when it runs: Convert a
 * scan's first row runs Make scanned pages searchable (`CONVERT_SCAN_TARGETS.searchable`), which answers with a result
 * dialog. The question is what ties the two: a walk that took this entry without seeing it would be judging a command
 * that never ran, so the step falls back to the hand-off's own declaration and fails as itself.
 */
const HANDS_OFF = /** @type {Readonly<Record<string, { to: string, question: string }>>} */ ({
  'document.convert-scan': { to: 'document.ocr', question: 'dialog.ocr' },
});

/**
 * Commands no generic step can walk here, each with the reason its row carries. Named, never left out: the record
 * refuses a row with no step and no reason, so a command missing from this list and from the walk is a refused pack.
 */
const NOT_HERE = /** @type {Readonly<Record<string, string>>} */ ({
  'app.exit': 'quits the application, which ends the walk; its close question is held by AppClose.test.tsx',
  'document.docusign-send': 'sends the document to DocuSign with the owner’s account, which leaves this computer and is the owner’s to approve',
  'document.docusign-retrieve': 'fetches a signed document from DocuSign with the owner’s account, which leaves this computer',
  'app.check-for-updates': 'asks the Microsoft Store, a request off this computer; the update check is dormant at launch by the owner’s decision',
  // MEASURED 2026-11-03: Print opens Windows' own print dialog through a native call, which is modal and holds main
  // until a person answers it, so the walk's first trial lost its window there.
  'document.print': 'opens Windows’ own print dialog, which holds the app until a person answers it and which this walk does not drive',
  // READ 2026-11-03 in documentCommands.ts' email(): the document is offered through Windows' share sheet.
  'document.email': 'offers the document through Windows’ own share sheet, from which it goes wherever the person picks, off this computer',
  // A PROVIDER'S KEY OR THE OWNER'S ACCOUNT: the walk's profile holds neither, and a key is the owner's to type
  // (aiKeyWalk.mjs and aiTranslateWalk.mjs walk the key's own rows).
  'ai.setup': 'checks and stores a provider’s key, which is the owner’s to type; the stored-key rows are aiKeyWalk.mjs’',
  'edit.translate-page': 'translates through a provider, which needs the owner’s key and sends the page off this computer',
  'ai.summarise-comments': 'asks a provider, which needs the owner’s key and sends the comments off this computer',
  ...Object.fromEntries(
    ['ai.ask-selection', 'ai.explain-selection', 'ai.summarise-selection', 'ai.translate-selection'].map((id) => [id, 'asks a provider about the selected words, which needs the owner’s key and sends them off this computer']),
  ),
  'ai.draft-reply': 'asks a provider to draft a reply to a comment, which needs the owner’s key and sends the comment off this computer',
  'annotate.claude-region': 'sends a box of the page to Claude to recognise, which needs the owner’s key and sends the picture off this computer',
  'tools.cloud-region': 'sends a box of the page to Azure to recognise, which needs the owner’s Azure account',
  // READ 2026-11-03: drawn only when the update check has found an update, and the check is dormant at launch.
  'app.update-available': 'is drawn only when the update check has found an update, and the check is dormant at launch by the owner’s decision',
  'cloud.save-back': 'saves to a cloud document, which needs the owner’s cloud account',
  'document.sign-document': 'signs with a certificate file and its password, which the walk’s profile holds none of',
});

const args = process.argv;
const at = (/** @type {string} */ flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const from = Number(at('--from') ?? '0');
const only = at('--only')?.split(',');

/** The walk document's comment on page 1, in PDF points from the page's bottom left: clear of the words, top right. */
const COMMENT_RECT = /** @type {const} */ ([520, 740, 540, 760]);
/** Page 1's two shapes, 120 by 60 points, each at its bottom left; the second is drawn over the first. */
const SHAPES = /** @type {const} */ ([
  [72, 380, rgb(0.8, 0.3, 0.3)],
  [140, 400, rgb(0.3, 0.4, 0.8)],
]);
/** A point of page 1 inside one shape and outside the other: the first's lower left, the second's upper right. */
const SHAPE_POINT = /** @type {const} */ ({ 'edit.object-forward': [90, 395], 'edit.object-backward': [240, 450] });

/**
 * The walk's own document: three pages of ordinary words in a standard font, a text field and a tick box, none of them
 * required, a ruled table on page 2 and a comment on page 1. A form with required fields answers a correct save with a
 * warning toast, and the walk's first trial read that as Save failing (2026-11-03).
 */
async function walkDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();
  for (let number = 1; number <= 3; number += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Page ${String(number)} of the walk's document`, { x: 72, y: 720, size: 18, font });
    ['Every tool is run on these words, the way a person runs it.', 'A second line, so a selection can run across a line end.', 'And a third, for a paragraph.'].forEach((line, at) =>
      page.drawText(line, { x: 72, y: 680 - at * 16, size: 12, font }),
    );
    if (number === 1) {
      // TWO SHAPES, THE SECOND OVER THE FIRST: Bring forward and Send backward are offered only where an object overlaps
      // the selected one on that side (`objectCommands.ts`), and the walk's first document had none.
      for (const [x, y, colour] of SHAPES) page.drawRectangle({ x, y, width: 120, height: 60, color: colour });
      page.drawText('Name:', { x: 72, y: 560, size: 12, font });
      form.createTextField('name').addToPage(page, { x: 120, y: 552, width: 200, height: 20 });
      form.createCheckBox('agreed').addToPage(page, { x: 72, y: 520, width: 14, height: 14 });
      // A THIRD FIELD, because the two that spread fields evenly are offered for three or more (`DISTRIBUTE_AT_LEAST`).
      form.createTextField('city').addToPage(page, { x: 360, y: 516, width: 120, height: 20 });
    }
    // A RULED TABLE on page 2, three rows of two: what Export tables to Excel looks for, and answered rightly that the
    // walk's first document had none (2026-11-03).
    if (number === 2) {
      const [left, top, columns, rows, width, height] = [72, 560, 2, 3, 150, 24];
      for (let row = 0; row <= rows; row += 1) page.drawLine({ start: { x: left, y: top - row * height }, end: { x: left + columns * width, y: top - row * height }, thickness: 1 });
      for (let column = 0; column <= columns; column += 1) page.drawLine({ start: { x: left + column * width, y: top }, end: { x: left + column * width, y: top - rows * height }, thickness: 1 });
      [['Item', 'Count'], ['Pens', '3'], ['Pages', '12']].forEach((cells, row) =>
        cells.forEach((cell, column) => page.drawText(cell, { x: left + column * width + 6, y: top - row * height - 17, size: 11, font })),
      );
    }
    // A COMMENT on page 1, clear of the words: what Export comments writes and Import comments takes back, and what
    // Select all selects on the page on show. With none, the export was empty and the import answered rightly that
    // there was nothing in it; on page 3, Select all had nothing to select on page 1 (2026-11-03).
    if (number === 1) {
      // WITH AN APPEARANCE OF ITS OWN, a filled square, as most documents' notes carry: the page raster draws a note's
      // appearance and nothing else (`'sticky-note': null` in `annotationTypes.tsx`), and without one the note was on no
      // pixel the walk could press (2026-11-03, recorded as a finding of its own).
      const look = document.context.register(
        document.context.flateStream('1 0.85 0.2 rg 0 0 20 20 re f 0.4 0.3 0 RG 1 w 0.5 0.5 19 19 re S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 20, 20] }),
      );
      const note = document.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [...COMMENT_RECT],
        Contents: PDFString.of("The walk's comment"),
        T: PDFString.of('Walk'),
        AP: { N: look },
      });
      page.node.addAnnot(document.context.register(note));
    }
  }
  return document.save({ useObjectStreams: false });
}

/**
 * The walk's document with two bookmarks, to pages 1 and 2: what Table of contents lists, and on the walk's own document
 * it answered rightly that there were no bookmarks to make a contents page from (the final walk of 2026-11-04). A
 * document of its own, so no other step starts from bookmarks it did not have.
 * @param {Uint8Array} bytes
 */
async function bookmarkedDocument(bytes) {
  const document = await PDFDocument.load(bytes);
  const outlines = document.context.nextRef();
  const items = [1, 2].map(() => document.context.nextRef());
  for (const [at, ref] of items.entries()) {
    const page = document.getPage(at);
    document.context.assign(
      ref,
      document.context.obj({
        Title: PDFString.of(`Part ${String(at + 1)} of the walk`),
        Parent: outlines,
        ...(at > 0 ? { Prev: items[at - 1] } : {}),
        ...(at < items.length - 1 ? { Next: items[at + 1] } : {}),
        Dest: [page.ref, 'XYZ', null, null, null],
      }),
    );
  }
  document.context.assign(outlines, document.context.obj({ Type: 'Outlines', First: items[0], Last: items.at(-1), Count: items.length }));
  document.catalog.set(PDFName.of('Outlines'), outlines);
  return document.save({ useObjectStreams: false });
}

/** How many processes of an INSTALLED Monstera run now: the executable a package puts under WindowsApps. */
function installedRunning() {
  const listed = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='Monstera.exe'\" | Measure-Object).Count"], { encoding: 'utf8' });
  return Number(listed.trim());
}
const installedAtStart = installedRunning();

const walk = await startWalk('every-tool', appRootOption(process.argv));
const { app, page, output, open, saveTo, step, finish, sizeWindow } = walk;

/**
 * EVERY SETTING AT ITS DEFAULT, from the registry's own list (`settings/all.ts`) of the built app this walk runs, never a
 * list kept here: a hand-kept list of what to put back agrees with any omission, and the four full runs of 2026-11-03
 * each tripped on the next thing a step had left (Show grid, the cover page's layout, the ribbon's section). The walk's
 * own one, the detailed request log, is the one value it sets.
 */
const walkedRoot = appRootOption(process.argv).appRoot ?? root;
refuseStaleBuild(walkedRoot, [['packages/ui/src/settings/all.ts', 'packages/ui/dist/settings/all.js', 'tsc']], 1);
/** @type {{ ALL_SETTINGS: readonly { id: string, fallback: unknown, secret?: boolean }[] }} */
const settingsList = await import(pathToFileURL(join(walkedRoot, 'packages/ui/dist/settings/all.js')).href);
const DEFAULTS = Object.fromEntries([...settingsList.ALL_SETTINGS.filter((setting) => setting.secret !== true).map((setting) => [setting.id, setting.fallback]), ['advanced.log-detail', 'detailed']]);
if (Object.keys(DEFAULTS).length < 10 || !('appearance.ribbon-section' in DEFAULTS)) throw new Error('the settings list read holds no ribbon section, so it cannot see');
const source = join(output, 'walk-document.pdf');
await writeFile(source, await walkDocument());
const bookmarked = join(output, 'walk-bookmarked.pdf');
await writeFile(bookmarked, await bookmarkedDocument(await readFile(source)));
/**
 * THE SCANNED DOCUMENT, for the commands that exist for a scan: the walk's document has words on every page, so a scan
 * conversion had nothing to change, and the step passed while the document did not change (the reviewer, 2026-11-03).
 * Its page is a picture of printed words drawn by PDFium in this process, from the kernel as built.
 */
refuseStaleBuild(root, [['packages/kernel/src/pdfiumFfi.ts', 'packages/kernel/dist/pdfiumFfi.js', 'tsc']], 1);
// A LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const pdfiumFfi = await import('../../packages/kernel/dist/pdfiumFfi.js');
// THE PALETTE'S ONE DRIVER, from its build, which `startWalk` has already found fresh (`PALETTE_DRIVER`).
/** @type {{ runCommandIfOffered: (page: import('playwright').Page, title: string, id: string) => Promise<boolean> }} */
const paletteDriver = await import('../../packages/testing/dist/palette.js');
pdfiumFfi.openPdfium(pdfiumLibrary(root));
bindNativeEngine(root);
const scanned = join(output, 'walk-scan.pdf');
await writeFile(
  scanned,
  await scannedPageDocument(async (pdf, width, height) => {
    const session = await pdfiumFfi.pdfiumWriter.open(pdf);
    try {
      return await pdfiumFfi.renderPageBitmap(session, 0, width, height);
    } finally {
      await pdfiumFfi.pdfiumWriter.close(session);
    }
  }),
);
/** The commands a scan is the input for, and so the document each starts from. */
const ON_A_SCAN = new Set(['document.convert-scan', 'document.ocr', 'document.straighten-scans', 'document.deskew-pages', 'document.enhance-scans']);
/** The command the step on show is walking, which its questions are answered for (`FIELD_TYPED`). */
let commandOnShow = '';
/** The commands walked on the bookmarked copy (`bookmarkedDocument`). */
const ON_BOOKMARKS = new Set(['document.generate-toc']);
/** The commands whose effect is judged against the state `prepare` made, which is saved and read before they run. */
const READ_PREPARED = new Set([...Object.keys(ADDED_FIRST), 'document.undo', 'document.redo']);
/** How many rows end at each depth: the report's two totals, beside failed and not walked. */
const depths = { effect: 0, responded: 0 };
const second = join(root, '_review', 'test-files', 'sample5.pdf');

// NOTHING LEAVES THIS COMPUTER: an external page and a print are recorded where main would ask for them.
await app.evaluate(({ shell, webContents }) => {
  const g = /** @type {any} */ (globalThis);
  g.__walkExternal = [];
  g.__walkPrinted = 0;
  // EVERY RENDERER ENDING, with Electron's own reason and exit code: a reload seen from the page says only that the page
  // was replaced, and main reloads it on this event (`main.ts`).
  g.__walkEndings = [];
  for (const contents of webContents.getAllWebContents()) {
    contents.on('render-process-gone', (/** @type {unknown} */ _event, /** @type {{ reason: string, exitCode: number }} */ details) => {
      g.__walkEndings.push({ reason: details.reason, exitCode: details.exitCode });
    });
  }
  shell.openExternal = async (/** @type {string} */ url) => {
    g.__walkExternal.push(url);
  };
  // AND EVERY OTHER WAY MAIN HANDS WINDOWS SOMETHING TO OPEN: a file or folder opened with its default program, and a
  // file shown in File Explorer. Only openExternal was recorded at first, and the first full run's "Edit page in another
  // app" handed its page to Windows, which opened it in the owner's installed Monstera (2026-11-03).
  shell.openPath = async (/** @type {string} */ path) => {
    g.__walkExternal.push(`open:${path}`);
    return '';
  };
  shell.showItemInFolder = (/** @type {string} */ path) => {
    g.__walkExternal.push(`folder:${path}`);
  };
  for (const contents of webContents.getAllWebContents()) {
    contents.print = (/** @type {unknown} */ _options, /** @type {((ok: boolean, why: string) => void) | undefined} */ done) => {
      g.__walkPrinted += 1;
      done?.(true, '');
    };
  }
});
const externals = () => app.evaluate(() => /** @type {any} */ (globalThis).__walkExternal.length);
const endings = () => app.evaluate(() => /** @type {any} */ (globalThis).__walkEndings);

/**
 * Why the window loaded again, from the two things that load it: main reloads it when its renderer ENDS (`main.ts`),
 * and gives its renderer back after a minute with no document open and no input (ADR-0252, `memoryRelease.ts`). The
 * second is designed, and in a walk it means a step sat idle on the start screen, which is the walk's to explain.
 */
async function whyReloaded() {
  const ended = await endings();
  return ended.length > 0
    ? `its renderer ended, ${JSON.stringify(ended)}`
    : 'no renderer ended, so the window gave its renderer back after a minute with no document open (ADR-0252): the step sat idle on the start screen';
}
const prints = () => app.evaluate(() => /** @type {any} */ (globalThis).__walkPrinted);

/**
 * EVERY DIALOG BY THE BOX BOTH BUILDS DRAW, never by `data-dialog`: that id was written on the popup on 2026-11-03
 * (235585f4), so 1.1.2610.0 carries none, and a walk keyed on it met no dialog there. It answered nothing, and the first
 * "Save changes?" left its backdrop over the window, so every click after it timed out (the release walk, 2026-11-03).
 * The palette is the same primitive and is the walk's own furniture.
 */
const DIALOG = '.m-dialog:not(.m-palette)';

/**
 * The open dialog's registry id, or `title:` and its title where the build names none. A `-problem` dialog is known by
 * its id alone, so on a build with no ids a problem dialog reads as a dialog met, not as a failure.
 */
const openDialog = async () => {
  const dialog = page.locator(DIALOG).last();
  // UP TO HALF A SECOND FOR ONE TO APPEAR: read 2 ms after a tab's close, "Save changes?" was not drawn yet, the close
  // loop pressed the tab again under its backdrop, and the click waited out its 30 s (the release trial, 2026-11-03).
  await dialog.waitFor({ state: 'attached', timeout: 500 }).catch(() => undefined);
  if ((await dialog.count()) === 0) return null;
  const id = await dialog.getAttribute('data-dialog', { timeout: 500 }).catch(() => null);
  if (id !== null) return id;
  const title = await dialog.locator('.m-dialog__title').first().innerText({ timeout: 500 }).catch(() => '');
  return `title:${title.trim()}`;
};

/** Every toast on screen, by kind and words. */
/**
 * EVERY TOAST AS IT APPEARS, in order, kept by an observer in the page: a done toast is timed, and one read at the end
 * of a step can already be gone. Export a searchable copy wrote its file and said so, and the walk, answering the
 * recognition's outcome dialog after it, read no toast (2026-11-03). Each toast ELEMENT is one entry, so two steps
 * whose toasts say the same words are two entries; its kind and words are read again on every change, since a toast's
 * words can arrive after its element.
 */
const recordToasts = () => {
  const g = /** @type {any} */ (globalThis);
  if (g.__walkToasts !== undefined) return;
  g.__walkToasts = [];
  const at = new WeakMap();
  const record = () => {
    for (const toast of g.document.querySelectorAll('.m-toast')) {
      const kind = toast.classList.contains('m-toast--problem') ? 'problem' : toast.classList.contains('m-toast--done') ? 'done' : 'other';
      const seen = `${kind}|${(toast.textContent ?? '').trim()}`;
      if (!at.has(toast)) at.set(toast, g.__walkToasts.push(seen) - 1);
      else g.__walkToasts[at.get(toast)] = seen;
    }
  };
  const watch = () => {
    record();
    new g.MutationObserver(record).observe(g.document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  };
  if (g.document.body === null) g.document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
};
// ON EVERY LOAD OF THE PAGE, and on this one: main reloads the window when its renderer ends (`main.ts`), and a
// recorder installed once was gone after one, so every step after it failed on the recorder (2026-11-03).
await page.addInitScript(recordToasts);
await page.evaluate(recordToasts);
/** How many times the page has loaded since the walk began: a step that sees it move saw the window reload. */
let loads = 0;
page.on('load', () => {
  loads += 1;
});

/** How many toasts the page has shown so far: a step's own are the ones after this count. */
const toastsNow = () => page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (globalThis).__walkToasts).length);

/**
 * The kind of toast this command put up, and its words, or none. ONLY THE TOASTS THAT CAME AFTER IT: a problem toast is
 * not timed and stays until it is dismissed, so one step's "Nothing is marked for redaction" failed every step after it
 * in the walk's first full run (2026-11-03).
 * @param {number} before
 */
const toastAfter = async (before) => {
  const added = (await page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (globalThis).__walkToasts))).slice(before);
  const problem = added.find((each) => each.startsWith('problem|'));
  if (problem !== undefined) return { kind: 'problem', text: problem.slice(8) };
  const done = added.find((each) => each.startsWith('done|'));
  if (done !== undefined) return { kind: 'done', text: done.slice(5) };
  return added.length > 0 ? { kind: 'other', text: (added[0] ?? '').replace(/^[a-z]+\|/u, '') } : null;
};

const unsaved = async () => (await page.getByText('Unsaved changes', { exact: true }).count()) > 0;

/**
 * Dismisses any modal left open, whether or not it is a registry dialog: the command palette is the Dialog primitive
 * with no id, and the step after Command palette could not reach Open PDF beneath it (2026-11-03).
 */
async function dismissModals() {
  for (let modal = 0; modal < 4 && (await page.locator('.m-dialog').count()) > 0; modal += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

/** Every tab closed, a close question answered "Don't save": the next step starts with nothing open. */
async function closeAll() {
  await dismissModals();
  for (let tab = 0; tab < 12; tab += 1) {
    // BY THE TABS, never the status bar: a tab whose document is not shown (a password question dismissed) names nothing
    // there, so the walk took the window for empty, kept that tab, and failed every step after it (2026-11-04).
    if ((await page.locator('.m-tab-close').count()) === 0 && (await page.locator('.m-status-name').count()) === 0) return;
    // THE TAB'S OWN CLOSE BUTTON, as a hand closes it: Ctrl+W pressed while Add comment's editor held the focus closed
    // nothing, and the next step opened its document beside the last one (2026-11-03).
    const close = page.locator('.m-tab-close').first();
    if ((await close.count()) > 0) await close.click();
    else await page.keyboard.press('Control+W');
    for (let asked = 0; asked < 3; asked += 1) {
      const id = await openDialog();
      if (id === null) break;
      // BY THE BUTTON A HAND PRESSES, which both builds draw; the release names no dialog (`DIALOG`).
      const dontSave = page.locator(DIALOG).last().getByRole('button', { name: 'Don’t save' });
      if ((await dontSave.count()) > 0) await dontSave.click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);
  }
}

/** Words selected on page 1 by a drag across its first text line, as a hand selects. */
async function selectWords() {
  const line = page.locator('[data-text-layer="0"]:visible [data-text-line]').first();
  await expect(line).toBeVisible({ timeout: 30_000 });
  const box = await line.boundingBox();
  if (box === null) return false;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 2, 160), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  return true;
}

/**
 * The command run from the palette by its exact title, or `false` where the palette offers no command of that title
 * in this state of the window, which is what a command whose `when` is false looks like there.
 * @param {string} title
 * @param {string} id
 */
async function ranFromPalette(title, id) {
  // THE ONE DRIVER (`palette.ts`, B3a), BY ITS ID: two commands share some titles (Translate), and a title alone picked
  // neither (the walk's first trial, 2026-11-03).
  return paletteDriver.runCommandIfOffered(page, title, id);
}

/**
 * What the window says, with the palette closed: the status bar's facts, every pressed button and selected tab, the
 * theme, the pages drawn and their sizes, the marks and fields on the page, the words selected and any dialog open.
 * Compared before and after a command, it says whether the command changed anything a person sees; a count of DOM
 * mutations cannot, since opening the palette and typing in it make hundreds (the walk's first trial, 2026-11-03).
 */
function fingerprint() {
  return page.evaluate((dialogs) => {
    const d = /** @type {any} */ (globalThis).document;
    const texts = (/** @type {string} */ selector) =>
      [...d.querySelectorAll(selector)].map((/** @type {any} */ each) => (each.getAttribute('aria-label') ?? each.textContent ?? '').trim()).sort();
    return JSON.stringify({
      status: (d.querySelector('.m-status-bar, footer')?.innerText ?? '').replaceAll(/\s+/gu, ' '),
      pressed: texts('[aria-pressed="true"]'),
      tabs: texts('[role="tab"][aria-selected="true"]'),
      theme: d.documentElement.getAttribute('data-theme'),
      pages: [...d.querySelectorAll('canvas.m-page')].map((/** @type {any} */ c) => `${String(Math.round(c.getBoundingClientRect().width))}x${String(Math.round(c.getBoundingClientRect().height))}`),
      marks: d.querySelectorAll('[data-annotation], [data-annotation-overlay] *').length,
      fields: d.querySelectorAll('[data-form-field], [data-field-box]').length,
      selected: String(/** @type {any} */ (globalThis).getSelection?.() ?? ''),
      dialogs: texts(dialogs),
      panels: texts('[role="tabpanel"]:not([hidden])').length,
      // WHICH PANE HOLDS THE FOCUS, by its own `data-pane`: F6 and Shift+F6 move nothing else (`paneCommands.ts`).
      pane: d.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? '',
      // WHAT IS DRAWN, by kind: every class of every element with a size, so a part that comes or goes with no button
      // pressed and no word changed (the rulers, a panel, a bar) is seen; the walk's second trial read Show rulers as
      // nothing shown. The palette, toasts and tooltips are a step's own furniture, and left out.
      drawn: [
        ...new Set(
          [...d.querySelectorAll('[class]')]
            .filter((/** @type {any} */ element) => {
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && element.closest('.m-palette, .m-toasts, [role="tooltip"]') === null;
            })
            .flatMap((/** @type {any} */ element) => [...element.classList].filter((name) => name.startsWith('m-'))),
        ),
      ].sort(),
    });
  }, DIALOG);
}

/**
 * Returns once no task is running, up to two minutes. A command that runs as a task says it is working and answers
 * when it ends, so its answer is waited for rather than read while it runs: PDF/A's export was read at "Exporting to
 * PDF/A…" (2026-11-03). One rule for the step and for the dialogs, so neither reads a running task as an answer.
 */
async function tasksEnded() {
  for (let waited = 0; waited < 120 && (await page.locator('.m-toast--task').count()) > 0; waited += 1) await page.waitForTimeout(1000);
}

/**
 * Answers what the command asks, as a hand does, until nothing more is asked: the primary button, else a danger one,
 * else the first row's button, else Escape. Records every dialog met, and a `-problem` one as the failure it is.
 * @param {string[]} met
 */
async function answerQuestions(met) {
  for (let round = 0; round < 6; round += 1) {
    await page.waitForTimeout(700);
    // A QUESTION ASKED AGAIN AFTER A TASK: Save a smaller copy measures, then asks once more with the size it measured.
    // Read while the measuring ran, no dialog was open and the walk stopped answering (2026-11-03).
    await tasksEnded();
    const id = await openDialog();
    if (id === null) return;
    met.push(id);
    if (/-problem$/u.test(id)) return;
    const dialog = page.locator(DIALOG).last();
    // WHAT A HAND TYPES FIRST: a question whose primary waits for a word or a choice (a password, a language) is
    // answered by filling it, with a test value of the walk's own; a field with a value is left as the dialog set it.
    const problems = dialog.locator('.m-dialog-row__problem, [role="alert"]');
    // THE QUESTION'S OWN LINES BEFORE ANYTHING IS TYPED (*A watermark needs some text*), which a word answers, and are
    // not a refusal of it.
    const asking = new Set(await problems.allInnerTexts().catch(() => []));
    /** @type {import('playwright').Locator[]} */
    const filled = [];
    const word = FIELD_TYPED[commandOnShow] ?? 'walk-test-1';
    for (const field of await dialog.locator('input[type="text"]:not([disabled]), input[type="password"]:not([disabled]), input:not([type]):not([disabled])').all()) {
      if ((await field.inputValue().catch(() => 'x')) === '') {
        await field.fill(word).catch(() => undefined);
        filled.push(field);
      }
    }
    // A WORD THE QUESTION REFUSES IS TAKEN BACK, as a hand deletes it: a field it says is wrong was one to leave empty, as
    // Merge's pages to take, where empty is every page. Retyping such a field as a number put a page 36 into a document
    // of 5, and retyped Password and permissions' two passwords, so its copy did not open with the walk's own value (the
    // final walk of 2026-11-04). A password is never taken back: an empty one is no answer. ONLY A LINE THE WORD BROUGHT:
    // read against the lines before it, Watermark's *needs some text* took back the very word that answered it.
    await page.waitForTimeout(300);
    const refused = (await problems.allInnerTexts().catch(() => [])).filter((text) => !asking.has(text));
    if (filled.length > 0 && refused.length > 0) {
      for (const field of filled) {
        if ((await field.getAttribute('type').catch(() => null)) !== 'password') await field.fill('').catch(() => undefined);
      }
    }
    for (const choice of await dialog.locator('select:not([disabled])').all()) {
      if ((await choice.inputValue().catch(() => 'x')) === '') {
        const value = await choice.locator('option').evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? '').find((each) => each !== '') ?? '');
        if (value !== '') await choice.selectOption(value).catch(() => undefined);
      }
    }
    const primary = dialog.locator('.m-button--primary:not([disabled])').last();
    const danger = dialog.locator('.m-button--danger:not([disabled])').last();
    // A CHOICE OF ROWS, each with its own button and no primary (Convert a scan, Restore a previous version): a hand
    // presses the first row's. With Escape there, both dismissed themselves and read as doing nothing (2026-11-03).
    const row = dialog.locator('.m-dialog__body .m-button:not([disabled])').first();
    if ((await primary.count()) > 0) await primary.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else if ((await danger.count()) > 0) await danger.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else if ((await row.count()) > 0) await row.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else await page.keyboard.press('Escape');
  }
}

/**
 * The fingerprint once the window has stopped changing: two readings half a second apart that agree, within 15 s. A
 * document just opened is still drawing its pages and its text layer, and a reading taken then changes by itself: the
 * walk's control failed so once in two runs after the restart of 2026-11-03, where it blamed the palette for the
 * document settling. A step's "before" read that early would let a command that did nothing pass as a change.
 */
async function settledFingerprint() {
  let last = await fingerprint();
  for (let tries = 0; tries < 30; tries += 1) {
    await page.waitForTimeout(500);
    const now = await fingerprint();
    if (now === last) return now;
    last = now;
  }
  throw new Error('the window did not stop changing within 15 s, so no change could be judged');
}

/** Which parts of two fingerprints differ, by name: what a failed step says it saw. @param {string} a @param {string} b */
function differing(a, b) {
  const [left, right] = [JSON.parse(a), JSON.parse(b)];
  const keys = Object.keys(left).filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
  return keys.length === 0 ? 'nothing' : keys.join(', ');
}

/** A one-pixel PNG, for a command that asks for a picture. */
const PICTURE = join(output, 'walk-picture.png');
await writeFile(PICTURE, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

/** The walk's own files of the other kinds a command opens: Markdown, a table as CSV, and a Word document. */
const MARKDOWN = join(output, 'walk-notes.md');
await writeFile(MARKDOWN, ['# The walk’s notes', '', 'A paragraph of **ordinary** words.', '', '- one', '- two', ''].join('\n'));
const TABLE = join(output, 'walk-table.csv');
await writeFile(TABLE, ['Item,Count', 'Pens,3', 'Pages,12', ''].join('\n'));
const WORD = join(output, 'walk-letter.docx');
{
  const encode = (/** @type {string} */ text) => new TextEncoder().encode(text);
  await writeFile(
    WORD,
    zipSync({
      '[Content_Types].xml': encode(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': encode(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': encode(
        '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A letter the walk wrote.</w:t></w:r></w:p></w:body></w:document>',
      ),
    }),
  );
}
/** The walk's file for each extension a picker names first. */
const FILE_OF = /** @type {Readonly<Record<string, string>>} */ ({ md: MARKDOWN, markdown: MARKDOWN, csv: TABLE, docx: WORD, doc: WORD, odt: WORD, rtf: WORD, xlsx: WORD, pptx: WORD });

/**
 * The platform's pickers answered from what each asks for, as a hand answers them: a folder where it asks for one, a
 * save named with the first extension its own filter lists, and an open of a file of that extension, the walk's picture
 * for pictures, the file the matching export wrote for an import, and the second document otherwise. One answer for
 * every picker made the walk's first full run hand a PDF to every import and a `.pdf` name to every export (2026-11-03).
 * @param {string} id
 */
async function answerPickers(id) {
  await app.evaluate(
    ({ dialog }, picked) => {
      const optionsOf = (/** @type {unknown[]} */ args) => /** @type {any} */ (args.find((each) => each !== null && typeof each === 'object' && ('filters' in each || 'properties' in each)) ?? {});
      const extensionOf = (/** @type {any} */ options) => String(options.filters?.[0]?.extensions?.[0] ?? 'pdf').replace('*', 'pdf');
      dialog.showOpenDialog = async (/** @type {unknown[]} */ ...args) => {
        const options = optionsOf(args);
        if ((options.properties ?? []).includes('openDirectory')) return { canceled: false, filePaths: [picked.folder] };
        const extension = extensionOf(options);
        if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'].includes(extension)) return { canceled: false, filePaths: [picked.picture] };
        if (extension === 'pdf') return { canceled: false, filePaths: [picked.second] };
        const own = picked.files[extension];
        if (own !== undefined) return { canceled: false, filePaths: [own] };
        return { canceled: false, filePaths: [`${picked.exported}.${extension}`] };
      };
      dialog.showSaveDialog = async (/** @type {unknown[]} */ ...args) => ({ canceled: false, filePath: `${picked.save}.${extensionOf(optionsOf(args))}` });
    },
    {
      folder: output,
      picture: PICTURE,
      second,
      exported: join(output, `out-${id.replace('.import-', '.export-')}`),
      save: join(output, `out-${id}`),
      files: FILE_OF,
    },
  );
}

const commandsById = new Map(listedCommands().map((command) => [command.id, command]));
/** An edit to undo, for Undo and Redo: a quarter turn of the page. */
const rotate = [...commandsById.values()].find((command) => /rotate-page/u.test(command.id) && !/180/u.test(command.id));

/** A command run by its id, and what it asks answered. @param {string} id */
async function run(id) {
  const listed = commandsById.get(id);
  if (listed === undefined) throw new Error(`no command ${id} in the checklist`);
  if (!(await ranFromPalette(listed.title, id))) throw new Error(`the palette did not offer ${id}`);
  await answerQuestions([]);
  await page.waitForTimeout(800);
}

/**
 * A press, left or right, at the middle of the walk document's comment where the page shows it.
 * @param {'left' | 'right'} button
 */
async function pressAtComment(button) {
  // FROM THE NOTE'S OWN RECT on page 1: the annotation layer draws an element only for a kind with a renderer of its own
  // (a pending redaction), so a note has no element to aim at.
  await pressAtPoint((COMMENT_RECT[0] + COMMENT_RECT[2]) / 2, (COMMENT_RECT[1] + COMMENT_RECT[3]) / 2, button);
}

/**
 * A press inside the one shape `id` selects ({@link SHAPE_POINT}).
 * @param {string} id
 * @param {'left' | 'right'} button
 */
async function pressOnPage(id, button) {
  const point = SHAPE_POINT[/** @type {keyof typeof SHAPE_POINT} */ (id)];
  await pressAtPoint(point[0], point[1], button);
}

/**
 * A press at a point of page 1 given in PDF points from its bottom left, through the page's drawn size.
 * @param {number} x
 * @param {number} y
 * @param {'left' | 'right'} button
 */
async function pressAtPoint(x, y, button) {
  const pageBox = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (pageBox === null) throw new Error('page 1 is not drawn');
  const scale = pageBox.width / 612;
  await page.mouse.click(pageBox.x + x * scale, pageBox.y + (792 - y) * scale, { button });
}

/**
 * A menu opened on `target` by a right press, and its item of `title` pressed: `false` where the menu holds no such item.
 * @param {import('playwright').Locator} target
 * @param {string} title
 */
async function fromMenu(target, title) {
  await target.click({ button: 'right' });
  return pickFromMenu(title);
}

/**
 * The open menu's item of `title` pressed, or `false` and the menu closed where it holds none.
 * @param {string} title
 */
async function pickFromMenu(title) {
  const item = page.getByRole('menu').getByRole('menuitem', { name: title, exact: true });
  await item.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if ((await item.count()) === 0) {
    await page.keyboard.press('Escape');
    return false;
  }
  await item.first().click();
  return true;
}

/**
 * The command run from the surface `VIA` names for it, in the state `prepare` made, or `false` where that surface does
 * not draw it. The palette is tried first for a comment and a field, whose selection is the shell's and outlives the
 * palette's focus; the others are not run from it (`VIA`'s note says why).
 * @param {{ id: string, title: string }} command
 */
async function ranFromSurface(command) {
  const via = VIA[command.id];
  if (via === undefined) return false;
  if ((via === 'annotation' || via === 'field' || via === 'object') && (await ranFromPalette(command.title, command.id))) return true;
  switch (via) {
    case 'selection': {
      const chosen = await fromMenu(page.locator('[data-text-layer="0"]:visible [data-text-line]').first(), command.title);
      // A CARD FOR WORDS, where the item opens one (Add comment): typed into as a hand types, as a tool's is.
      if (chosen && OPENS_WORDS.has(command.id)) await typeWhereOpened(command.id);
      return chosen;
    }
    case 'annotation': {
      await pressAtComment('right');
      return pickFromMenu(command.title);
    }
    case 'field':
      return fromMenu(page.locator('[data-field-box][aria-pressed="true"]:visible').first(), command.title);
    case 'page': {
      // AT A POINT OF THE PAGE, low and clear of its words, as a hand presses: the layers over the canvas take the press,
      // so a click aimed at the canvas element waited for an element nothing lets through.
      const pageBox = await page.locator('canvas.m-page:visible').first().boundingBox();
      if (pageBox === null) return false;
      await page.mouse.click(pageBox.x + 120, pageBox.y + 520, { button: 'right' });
      return pickFromMenu(command.title);
    }
    case 'tab':
      return fromMenu(page.locator('.m-tab').first(), command.title);
    case 'start': {
      const card = page.locator('.m-start-card', { hasText: command.title }).first();
      if ((await card.count()) === 0) return false;
      await card.click();
      return true;
    }
    case 'format': {
      const button = page.locator('[data-text-properties]').getByRole('button', { name: command.title, exact: true }).first();
      if ((await button.count()) === 0) return false;
      await button.click();
      return true;
    }
    case 'key':
      await page.keyboard.press(CHORD[command.id] ?? '');
      return true;
    case 'object':
      await pressOnPage(command.id, 'right');
      return pickFromMenu(command.title);
  }
}

/**
 * What a command needs before it has anything to do, made as a hand makes it. Without it the command answers rightly
 * that there is nothing to do, and the walk's first full run read those answers as failures (2026-11-03).
 * @param {string} id
 */
async function prepare(id) {
  // THE PAGES PANEL IS THE ONE THE KNOWN START SHOWS, so another is shown first, as a hand that wants the pages back has
  // one: shown over itself it rightly changed nothing (the final walk of 2026-11-04).
  if (id === 'view.show-pages') {
    await run('view.show-bookmarks');
    return;
  }
  if ((id === 'document.undo' || id === 'document.redo') && rotate !== undefined) {
    await run(rotate.id);
    if (id === 'document.redo') await run('document.undo');
    return;
  }
  // WHAT A REMOVAL TAKES AWAY, put there first by its own add (`ADDED_FIRST`).
  const added = ADDED_FIRST[id];
  if (added !== undefined) {
    await answerPickers(added);
    await run(added);
    await answerPickers(id);
    return;
  }
  // AN IMPORT TAKES THE FILE ITS OWN EXPORT WRITES, which the pickers then hand it (`answerPickers`).
  const exported = id.replace('.import-', '.export-');
  if (exported !== id && commandsById.has(exported)) {
    // THE EXPORT'S OWN PICKERS while it runs, so it writes the file under its own name: with the import's set, it
    // wrote `out-<import>.json` and the import was handed a file that did not exist (2026-11-03).
    await answerPickers(exported);
    await run(exported);
    await answerPickers(id);
    return;
  }
  if (id === 'document.apply-redactions') {
    // MARKED FROM THE SELECTION'S OWN MENU, where Mark for redaction lives; the palette does not offer it.
    await selectWords();
    const line = await page.locator('[data-text-layer="0"]:visible [data-text-line]').first().boundingBox();
    if (line !== null) await page.mouse.click(line.x + 40, line.y + line.height / 2, { button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Mark for redaction', exact: true }).click({ timeout: 10_000 });
    await page.waitForTimeout(800);
    return;
  }
  if (id === 'edit.paste') {
    await selectWords();
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(300);
    return;
  }
  if (id === 'view.go-forward') {
    await run('view.page-last');
    await run('view.go-back');
    return;
  }
  const via = KEY_STATE[id] ?? VIA[id];
  if (via === 'selection' || via === 'key') {
    await selectWords();
    return;
  }
  if (via === 'annotation' || via === 'page') {
    await run('annotate.select');
    // AT THE COMMENT'S PLACE ON THE PAGE, as a hand presses: the annotation layer draws it and takes no press
    // (`.m-annotation-layer { pointer-events: none }`), so a click on its element waited for an element that never takes one.
    await pressAtComment('left');
    await page.waitForTimeout(500);
    if (via === 'page') await run('annotate.copy-selection');
    return;
  }
  if (via === 'field') {
    await run('forms.edit-fields');
    const boxes = page.locator('[data-field-box]:visible');
    await expect(boxes.first()).toBeVisible({ timeout: 30_000 });
    await boxes.nth(0).click();
    // AN ARRANGE TAKES THE FIRST FIELD AND THE OTHERS, so a second is added to the selection as a hand adds it.
    if (ARRANGE.includes(id)) await boxes.nth(1).click({ modifiers: ['Shift'] });
    if (id.startsWith('forms.arrange.distribute-')) await boxes.nth(2).click({ modifiers: ['Shift'] });
    if (id === 'forms.paste-fields') await run('forms.copy-fields');
    await page.waitForTimeout(500);
    return;
  }
  if (via === 'format') {
    await run('text.edit');
    await editTextOpening(page).openWords(page.locator('[data-text-block]').first());
    // THE BLOCK'S WORDS CHOSEN, as a hand chooses them before it formats: with only a caret, a format has nothing of
    // the page's to apply to (the effect reading of 2026-11-04).
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(300);
    return;
  }
  if (via === 'tab') {
    await open(second);
    return;
  }
  if (via === 'object') {
    await run('edit.objects-shapes');
    await pressOnPage(id, 'left');
    await page.waitForTimeout(800);
    return;
  }
  if (via === 'start') {
    await closeAll();
    return;
  }
  // A COMMAND THAT SETS A STATE starts from another one, or it is run where its state already holds and rightly
  // changes nothing: the full run of 2026-11-03 asked for page 1 on page 1, the Ribbon in the Ribbon, 100% at 100%.
  const away = AWAY_FROM[id];
  if (away !== undefined) {
    for (const each of away) await run(each);
    return;
  }
  if (id === 'view.reset-float-bar') {
    // MOVED BY ITS GRIP, as a hand moves it, so there is a position to reset.
    const grip = await page.locator('.m-quick-toolbar__grip').first().boundingBox().catch(() => null);
    if (grip === null) throw new Error('no Float bar grip was drawn, so there was no position to move and reset');
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 300, grip.y + 120, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    return;
  }
  if (id === 'document.clear-recent') {
    // THE RECENT FILES ARE DRAWN ON THE START SCREEN, so that is where clearing them is seen.
    await closeAll();
    return;
  }
  if (id === 'document.restore-version') {
    // A VERSION IS KEPT EACH TIME A FILE IS SAVED OVER, so an edit is saved over the walk's copy first.
    if (rotate !== undefined) await run(rotate.id);
    await run('document.save');
    return;
  }
}

/**
 * A saved copy opened again as a hand opens it, its password typed where it asks for one: the walk's own test value,
 * which the walk typed when Password and permissions asked (`answerQuestions`). `open` waits for the copy's name in the
 * status bar and could not answer the password question that stands before it (2026-11-03).
 * @param {string} path
 */
async function reopen(path) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, path);
  await page.keyboard.press('Control+O');
  const name = path.split(/[\\/]/u).at(-1) ?? '';
  for (let tries = 0; tries < 60; tries += 1) {
    if ((await page.locator(`.m-status-name[title="${name}"]`).count()) > 0) return true;
    // A QUESTION WITH A PASSWORD FIELD, as a hand sees it: the release names no dialog (`DIALOG`).
    const asked = page.locator(DIALOG).last();
    if ((await asked.locator('input[type="password"]').count()) > 0) {
      await asked.locator('input[type="password"]').first().fill('walk-test-1');
      await asked.locator('.m-button--primary').last().click();
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/** Where the pointer rests after a command that draws under it, the loupe's own place: over the page's words. */
async function pointerOverPage() {
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box !== null) await page.mouse.move(box.x + box.width / 3, box.y + box.height / 5, { steps: 6 });
}

/**
 * How a hand uses each tool once it is on, on page 1's blank band right of the shapes and below the fields (in PDF
 * points: 330 to 540 across, 200 to 320 up), or across the first paragraph's words for a tool that marks words.
 * @type {Readonly<Record<string, 'drag' | 'click' | 'poly' | 'ink' | 'words' | 'note'>>}
 */
const GESTURES = {
  ...Object.fromEntries(
    // STAMP IS DRAWN AS A BOX (`stampTool.ts`, `MINIMUM_BOX`): a press placed nothing and opened no chooser (2026-11-04).
    ['rectangle', 'ellipse', 'line', 'arrow', 'highlight-area', 'redact', 'text-box', 'callout', 'measure-distance', 'link-address', 'link-page', 'stamp'].map((name) => [`annotate.${name}`, 'drag']),
  ),
  // A CLOUD IS DRAWN BY ITS CORNERS, as its own hint says (*Click each corner, then click the first one again*): dragged
  // as a box, it drew nothing (the final walk of 2026-11-04).
  'annotate.cloud': 'poly',
  ...Object.fromEntries(['text', 'checkbox', 'radio', 'dropdown', 'listbox', 'button', 'signature', 'date'].map((name) => [`forms.field-${name}`, 'drag'])),
  ...Object.fromEntries(['sticky-note', 'typewriter', 'caret'].map((name) => [`annotate.${name}`, 'click'])),
  ...Object.fromEntries(['polygon', 'polyline', 'measure-area', 'measure-perimeter'].map((name) => [`annotate.${name}`, 'poly'])),
  'annotate.ink': 'ink',
  // THE ERASER PRESSED ON THE WALK'S NOTE, which it takes away; a picture drawn as a box; added text placed by a press.
  'annotate.eraser': 'note',
  'annotate.image': 'drag',
  'text.add': 'click',
  ...Object.fromEntries(['highlight', 'underline', 'strikeout', 'redact-text'].map((name) => [`annotate.${name}`, 'words'])),
};

/** The tools whose gesture always opens words to type in. */
const OPENS_WORDS = new Set(['text.add', 'annotate.text-box', 'annotate.callout', 'annotate.typewriter', 'annotate.link-address', 'annotate.link-page', 'text.comment']);

/** A point of page 1 in the window, from PDF points. @param {number} x @param {number} y */
async function pagePoint(x, y) {
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box === null) throw new Error('page 1 is not drawn');
  const scale = box.width / 612;
  return { x: box.x + x * scale, y: box.y + (792 - y) * scale };
}

/**
 * The gesture a tool takes, made the way a hand makes it: pressed, moved in steps, released. A tool that opens words of
 * its own to type in is given one and ended with Escape, its own way out — except a link's line, which answers only an
 * address or a page its rule passes and is ended with Enter: the walk's word and Escape placed no link (2026-11-04).
 * @param {'drag' | 'click' | 'poly' | 'ink' | 'words' | 'note'} gesture
 * @param {string} id the command that switched the tool on
 */
async function useTool(gesture, id) {
  /** @param {readonly (readonly [number, number])[]} points */
  const stroke = async (points) => {
    const [first, ...rest] = points;
    if (first === undefined) return;
    const start = await pagePoint(first[0], first[1]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const [x, y] of rest) {
      const to = await pagePoint(x, y);
      await page.mouse.move(to.x, to.y, { steps: 8 });
    }
    await page.mouse.up();
  };
  // ADD TEXT'S SURFACE, which is what its press lands on, arrives after the tool is on: absent 1.5 s after a first Add
  // text, present 1.5 s after a later one (trial of 2026-11-04), and a press before it fell on Edit text's layer and
  // placed nothing. Waited for, as `textAdd.pw.ts` waits; the delay is a finding of its own, not the walk's to hide.
  if (id === 'text.add') await expect(page.locator('[data-text-add-surface]').first()).toBeVisible({ timeout: 30_000 });
  if (gesture === 'drag') await stroke([[340, 310], [500, 220]]);
  if (gesture === 'ink') await stroke([[340, 300], [380, 240], [430, 300], [480, 240], [520, 300]]);
  if (gesture === 'words') await stroke([[74, 684], [290, 684]]);
  if (gesture === 'note') {
    const at = await pagePoint((COMMENT_RECT[0] + COMMENT_RECT[2]) / 2, (COMMENT_RECT[1] + COMMENT_RECT[3]) / 2);
    await page.mouse.click(at.x, at.y);
  }
  if (gesture === 'click') {
    const at = await pagePoint(420, 260);
    await page.mouse.click(at.x, at.y);
  }
  if (gesture === 'poly') {
    for (const [x, y] of /** @type {const} */ ([[340, 300], [500, 300], [420, 220]])) {
      const at = await pagePoint(x, y);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(250);
    }
    const last = await pagePoint(420, 220);
    await page.mouse.dblclick(last.x, last.y);
  }
  await page.waitForTimeout(800);
  await typeWhereOpened(id);
}

/**
 * WORDS OF ITS OWN, where the command opened some: a text box, a typewriter line, a note's words, the card a selection's
 * Add comment opens (the final walk of 2026-11-04, where the menu's card was typed into by nothing and no comment made).
 * A command that always opens words is waited for, up to 5 s, as `textAdd.pw.ts` waits for its editor's focus: Add
 * text's first use prepares its faces first (1.7 s in the log of 2026-11-04), and read once at 800 ms it had opened
 * nothing yet, so nothing was typed.
 * @param {string} id
 */
async function typeWhereOpened(id) {
  const focused = () =>
    page.evaluate(() => {
      const active = /** @type {{ document: { activeElement: { tagName: string, isContentEditable: boolean } | null } }} */ (/** @type {unknown} */ (globalThis)).document.activeElement;
      return active !== null && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable);
    });
  let typing = await focused();
  for (let waited = 0; !typing && OPENS_WORDS.has(id) && waited < 5000; waited += 250) {
    await page.waitForTimeout(250);
    typing = await focused();
  }
  if (typing) {
    const typed = LINK_TYPED[id];
    await page.keyboard.type(typed ?? TYPED_WORD[id] ?? 'walk');
    await page.keyboard.press(typed === undefined ? 'Escape' : 'Enter');
    await page.waitForTimeout(800);
    // THE EDITOR CLOSED, which is when its words are written: Add text's finish embeds a face and took longer than the
    // walk's 800 ms, so the save that followed found nothing unsaved (2026-11-04). Waited as corpus 48's check waits.
    await expect(page.locator('[data-kit-surface]')).toHaveCount(0, { timeout: 60_000 });
  }
}

/**
 * THE ONE START EVERY STEP HAS, set BEFORE it rather than undone after it (the reviewer, 2026-11-03): every setting at
 * its default through the app's own `settings.save`, then the window loaded again, so the renderer reads those settings
 * and holds no palette, dialog, armed tool or panel a step left; then the window at the walk's size and no document
 * open. The step's fresh copy of the document is opened after this.
 */
async function knownStart() {
  // EVERY TAB CLOSED FIRST: main holds the documents, so a window loaded again shows the ones still open (the trial of
  // 2026-11-03 found the control's document on show after the reload). AFTER ANY WRITE STILL LANDING: the step before's
  // edit wrote after it was judged, and its tab's close button then waited 30 s (the final walk of 2026-11-04).
  await writesIdle(page);
  await dismissModals();
  await closeAll();
  const saved = await page.evaluate(
    (values) => /** @type {{ invoke: (channel: string, params: unknown) => Promise<{ ok?: boolean }> }} */ (Reflect.get(globalThis, 'monstera')).invoke('settings.save', { values }),
    DEFAULTS,
  );
  if (saved.ok !== true) throw new Error(`the settings could not be put at their defaults: ${JSON.stringify(saved).slice(0, 200)}`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await sizeWindow(WALK_WINDOW);
  // NOTHING OPEN, and the start screen drawn, which is what a fresh window shows.
  await expect(page.getByRole('button', { name: /^Open PDF/u }).first()).toBeVisible({ timeout: 30_000 });
  await closeAll();
}

const commands = listedCommands().filter((command, index) => index >= from && (only === undefined || only.includes(command.id)));
process.stdout.write(`${String(commands.length)} commands to walk from the registry's checklist\n`);

// THE FINGERPRINT'S TWO CONTROLS, before it judges anything: the palette opened and closed changes nothing it reads, and
// a command that changes the view (Zoom in) changes it. Either failing would make every "changed on screen" below a
// guess, so the walk stops there.
let controlled = false;
await step('CONTROL: the window fingerprint sees a change and sees none where there is none', async () => {
  const copy = join(output, 'doc-control.pdf');
  await copyFile(source, copy);
  await open(copy);
  const first = await settledFingerprint();
  // TYPED AND NOTHING RUN, as `palette.test.ts` allows a case about the palette's own field: keys, not the driver's fill.
  await page.keyboard.press('Control+K');
  await expect(page.locator('.m-palette-query')).toBeFocused();
  await page.keyboard.type('Zoom in');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const second = await settledFingerprint();
  if (second !== first) {
    const [a, b] = [JSON.parse(first), JSON.parse(second)];
    const moved = Object.keys(a).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    throw new Error(`the palette opened and closed changed the fingerprint's ${moved.join(', ')}: ${moved.map((key) => `${key} ${JSON.stringify(a[key])} then ${JSON.stringify(b[key])}`).join('; ').slice(0, 900)}`);
  }
  if (!(await ranFromPalette('Zoom in', 'view.zoom-in'))) throw new Error('the palette offered no Zoom in');
  await page.waitForTimeout(800);
  if ((await settledFingerprint()) === first) throw new Error('Zoom in left the fingerprint unchanged, so it cannot see a change');
  controlled = true;
  return { fingerprint: first.slice(0, 200) };
});
if (!controlled) {
  await finish();
  process.exit(1);
}

// THE KNOWN START'S CONTROL: a step that leaves a setting changed (the grid on, the ribbon on Organize) and the palette
// open does not change what the next step starts from. Its own control is the leak SEEN first, with no known start
// between, so the comparison is not two readings that agree because neither can see a grid.
let started = false;
await step('CONTROL: a step that leaves a setting changed and the palette open does not change the next step’s start', async () => {
  await knownStart();
  const copy = join(output, 'doc-start-control.pdf');
  await copyFile(source, copy);
  await open(copy);
  const clean = await settledFingerprint();
  await run('view.toggle-grid');
  await closeAll();
  await open(copy);
  const leaked = await settledFingerprint();
  if (leaked === clean) throw new Error('with the grid left on the next document opened the same, so the fingerprint cannot see a leak');
  // AND THE LEAK THAT COST 36 ROWS: the ribbon on Organize, whose page grid draws no page canvas, so the open after the
  // known start waits for one and times out if the section held. With the palette open over it.
  await page.locator('[data-ribbon-section="organize"]').click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.m-palette-query')).toBeVisible();
  await knownStart();
  await open(copy);
  const restarted = await settledFingerprint();
  if (restarted !== clean) throw new Error(`after the known start the document opened differently: ${differing(clean, restarted)}`);
  started = true;
  return { leakedIn: differing(clean, leaked) };
});
if (!started) {
  await finish();
  process.exit(1);
}

for (const command of commands) {
  const reason = NOT_HERE[command.id];
  if (reason !== undefined) {
    await step(`${command.id}: not walked here`, async () => ({ notWalked: { [command.id]: reason } }));
    continue;
  }
  await step(
    `${command.id}: ${command.title}`,
    async () => {
      // THE KNOWN START, and the load it makes counted before the step's own: a reload after it is the step's.
      await knownStart();
      commandOnShow = command.id;
      const loadsAtStart = loads;
      const copy = join(output, `doc-${command.id}.pdf`);
      await copyFile(ON_A_SCAN.has(command.id) ? scanned : ON_BOOKMARKS.has(command.id) ? bookmarked : source, copy);
      // THE DOCUMENT AS THE STEP BEGINS, read before the app has it: what an effect is compared against.
      const began = await readPdf(copy);
      if (began === null) throw new Error('the walk could not read its own fresh copy, so no effect can be judged');
      await open(copy);
      // THE TOOL IS THE WINDOW'S, NOT THE DOCUMENT'S, so a tool the step before armed is still armed in a fresh tab:
      // Add a date field's tool turned the redaction step's word selection into a new field (2026-11-03). Each step
      // starts from the one a person starts with; Select text's own step starts from another, so it has a change to make.
      await run(command.id === 'view.select-text' ? 'annotate.select' : 'view.select-text');
      await answerPickers(command.id);
      await prepare(command.id);
      // THE STATE `prepare` MADE, saved as a copy and read, for a command judged against it (`READ_PREPARED`): the tab
      // keeps its unsaved change, so the command then runs on exactly that state.
      let prepared = null;
      if (READ_PREPARED.has(command.id)) {
        const path = join(output, `prepared-${command.id}.pdf`);
        await saveTo(path);
        await ranFromPalette('Save a copy…', 'document.save-copy');
        await answerQuestions([]);
        await expect.poll(() => existsSync(path) && readFileSync(path).byteLength > 0, { timeout: 30_000 }).toBe(true);
        prepared = await readPdf(path);
        if (prepared === null) throw new Error('the state prepared for this command was saved and could not be read');
        await answerPickers(command.id);
      }
      const before = { externals: await externals(), prints: await prints(), toasts: await toastsNow() };
      /** @type {string[]} */
      const errors = [];
      const onError = (/** @type {Error} */ error) => errors.push(error.message.slice(0, 200));
      page.on('pageerror', onError);
      let context = 'as opened';
      let start = await settledFingerprint();
      let ran = VIA[command.id] === undefined ? await ranFromPalette(command.title, command.id) : await ranFromSurface(command);
      if (VIA[command.id] !== undefined && !ran) {
        throw new Error(`its ${String(VIA[command.id])} surface did not draw it, in the state that surface needs`);
      }
      if (!ran && (await selectWords())) {
        context = 'with words selected';
        start = await settledFingerprint();
        ran = await ranFromPalette(command.title, command.id);
      }
      // NOT OFFERED IS A FAILURE, never a row recorded as not walked: the third full run "passed" 73 rows this way.
      // A command a hand reaches elsewhere has its surface in `VIA`, and one the walk cannot reach has its reason in
      // `NOT_HERE`.
      if (!ran) throw new Error('the palette offered no command of this title, as the document opened or with words selected, and no other surface is named for it');
      /** @type {string[]} */
      const met = [];
      await answerQuestions(met);
      // A COMMAND THAT DRAWS UNDER THE POINTER (the loupe) shows nothing until the pointer is over the page, as a hand's is.
      if (command.id === 'view.toggle-loupe') await pointerOverPage();
      // A TOOL USED, as a hand uses it once it is on: a tool that is only switched on leaves nothing to read back.
      const gesture = GESTURES[command.id];
      if (gesture !== undefined) {
        await useTool(gesture, command.id);
        await answerQuestions(met);
      }
      // A FORMAT IS IN THE EDITOR UNTIL THE EDIT IS FINISHED, and Escape finishes it, one command carrying the words and
      // their format (`editTextHandWalk.pw.ts`): left open, nothing reached the document (the effect trial of 2026-11-04).
      if ((KEY_STATE[command.id] ?? VIA[command.id]) === 'format') {
        await page.keyboard.press('Escape');
        // THE EDITOR CLOSED AND ITS WRITE LANDED, never a fixed 800 ms: on a loaded machine the finish's write took 1.5 to
        // 3.7 s, the step was judged before it, and the next step's start found that tab unsaved (the final walk of
        // 2026-11-04: Align centre, Justify, Align right and Bullets in a row).
        await expect(page.locator('[data-kit-surface]')).toHaveCount(0, { timeout: 60_000 });
        await writesIdle(page);
      }
      await page.waitForTimeout(1500);
      await tasksEnded();
      // A QUESTION THAT OPENED LATE, after the answering had stopped looking: Convert text to curves' dialog, behind a
      // PDF/A export still finishing, opened after the first 700 ms and was judged as nothing shown (2026-11-03).
      for (let late = 0; late < 3 && (await openDialog()) !== null && !met.some((id) => /-problem$/u.test(id)); late += 1) {
        await answerQuestions(met);
        await page.waitForTimeout(1500);
        await tasksEnded();
      }
      // EVERY WRITE THE STEP MADE, LANDED, before anything is judged: a command's write is counted in flight until main
      // answers (`inFlight.ts`), and Bates numbering's took 3.4 to 4.2 s and Headers and footers' 6.2 s on their first use,
      // so a step judged at its fixed moment read the document unchanged and saved no copy (the clean build's walk of
      // 2026-11-04, failing in one run and passing in the next).
      await writesIdle(page);
      // THE ANSWER THE COMMAND DECLARES, waited for: a command that answers with a toast and runs no task notice is a
      // request in flight until it does, and read at a fixed moment Import comments from JSON's 4.5 s request was judged
      // as nothing shown while it was still running (the final walk of 2026-11-04). The toasts are recorded as they come
      // (`recordToasts`), so this waits on the answer, bounded, never on a longer pause.
      if (command.shows === 'a toast') {
        for (let waited = 0; waited < 60 && !['done', 'problem'].includes((await toastAfter(before.toasts))?.kind ?? ''); waited += 1) {
          await page.waitForTimeout(250);
        }
      }
      page.off('pageerror', onError);
      if (loads !== loadsAtStart) throw new Error(`the window reloaded during this step: ${await whyReloaded()}`);
      const toast = await toastAfter(before.toasts);
      const end = await settledFingerprint();
      const changed = end !== start;
      const opened = (await externals()) - before.externals;
      const printed = (await prints()) - before.prints;
      const problem = met.find((id) => /-problem$/u.test(id));
      if (problem !== undefined) {
        // THE DIALOG'S OWN WORDS, so the failure says what the app said rather than only which dialog said it.
        const said = await page.locator(DIALOG).last().innerText().catch(() => '');
        throw new Error(`${problem} was shown (${context}): ${said.replaceAll(/\s+/gu, ' ').slice(0, 240)}`);
      }
      if (toast?.kind === 'problem') throw new Error(`a problem toast was shown (${context}): ${toast.text.slice(0, 200)}`);
      if (errors.length > 0) throw new Error(`the page threw: ${errors.join(' | ')}`);
      // A HAND-OFF IS JUDGED BY THE COMMAND IT HANDS TO, once that command's own question is seen: the hand-off's
      // declaration names one of its routes, and the walk takes the first.
      const handOff = HANDS_OFF[command.id];
      const handed = handOff !== undefined && met.includes(handOff.question) ? commandsById.get(handOff.to) : undefined;
      const shows = handed?.shows ?? command.shows;
      const shown =
        shows === 'a toast'
          ? toast?.kind === 'done' || opened > 0 || printed > 0
          : shows === 'a result dialog'
            ? met.length > 0
            : met.length > 0 || toast !== null || changed || opened > 0 || printed > 0;
      if (!shown) {
        throw new Error(
          `it declares ${shows}${handed === undefined ? '' : ` (as ${handed.id}, which it handed to)`}, and nothing was shown (${context}; dialogs ${JSON.stringify(met)}, toast ${toast === null ? 'none' : `${toast.kind}: ${toast.text.slice(0, 80)}`}, changed: ${differing(start, end)})`,
        );
      }
      // SAVED AND OPENED AGAIN, where it changed the document.
      let reopened = 'unchanged';
      const kept = join(output, `kept-${command.id}.pdf`);
      if (await unsaved()) {
        await saveTo(kept);
        await ranFromPalette('Save a copy…', 'document.save-copy');
        // ITS QUESTIONS ANSWERED as every command's are: a copy of a document with unapplied redaction marks asks first,
        // and unanswered, nothing was written, the copy did not open, and the start screen sat idle until the window gave
        // its renderer back (ADR-0252), which read as a reload (2026-11-03).
        await answerQuestions([]);
        await expect.poll(async () => readFileSync(kept, { flag: 'r' }).byteLength > 0, { timeout: 30_000 }).toBe(true).catch(() => undefined);
        await closeAll();
        const back = await reopen(kept);
        await page.locator('canvas.m-page:visible').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
        reopened = back && (await page.locator('canvas.m-page:visible').count()) > 0 ? 'saved and opened again' : 'saved, and the copy did not open';
        if (loads !== loadsAtStart) throw new Error(`${reopened}; the window reloaded while the copy was saved and opened again: ${await whyReloaded()}`);
        if (reopened !== 'saved and opened again') throw new Error(reopened);
      }
      // THE EFFECT, read from the files the step left, where the command has a check (`everyToolEffects.mjs`): the saved
      // copy against the copy it began as, and what its export wrote.
      const check = EFFECTS[command.id];
      if (check === undefined) {
        depths.responded += 1;
        return { context, dialogs: met, toast, changed, opened, printed, reopened, depth: 'responded', why: respondedWhy(command.id) };
      }
      const after = reopened === 'saved and opened again' ? await readPdf(kept) : null;
      const wrong = await check({ before: began, prepared, after, outputs: outputsOf(output, command.id), read: readPdf });
      if (wrong !== null) throw new Error(`EFFECT: ${wrong} (${context})`);
      depths.effect += 1;
      return { context, dialogs: met, toast, changed, opened, printed, reopened, depth: 'effect' };
    },
    { covers: [command.id] },
  );
}

// THE WALK STARTED NOTHING OUTSIDE ITSELF: a route to Windows the recorders above miss would open a file in whatever
// program Windows chooses, and for a PDF on this computer that is the owner's installed Monstera (2026-11-03).
await step('the walk started no installed Monstera: every file it wrote stayed inside the walk', async () => {
  const now = installedRunning();
  if (now > installedAtStart) throw new Error(`${String(now - installedAtStart)} installed Monstera process(es) started during the walk`);
  return { installedAtStart, now };
});

// THE TWO DEPTHS, printed beside the verdict: a pass that is EFFECT read the command's result from its files, and one that
// is RESPONDED showed what it declares and left the document whole, which is all it shows.
process.stdout.write(`DEPTH effect checked ${String(depths.effect)}, responded only ${String(depths.responded)}\n`);

await closeAll();
await finish();
