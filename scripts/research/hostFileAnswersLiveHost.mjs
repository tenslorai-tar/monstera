// @ts-check
/**
 * The child of `hostFileAnswersLive.mjs`: a real shell editing text through the real PDFium host on a page drawn one
 * text object per glyph, and reading a 5,000-field form's field list through the real MuPDF host, in parts.
 *
 * ## Why this exists
 *
 * The owner's install of 0.1.5.0 (2026-09-30) ended the PDFium host on Edit text for their own documents: the page's
 * `engine/text-runs` answer was 663,815 bytes against a 262,144-byte frame, because the page drew nearly every glyph as
 * its own text object ([ADR-0125](../../docs/DECISIONS/0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md)).
 * Nothing drove a real PDFium host through `main` before this: the adapter proofs run PDFium in this process and the
 * body cases stub the host, so the transport between them — where the failure lived — was crossed by neither.
 *
 * ## What it does
 *
 * The owner's sequence, on a page generated here so nothing of theirs is read: open, ask for the page's text blocks,
 * edit one block, save, close, reopen, and ask again. Through the shipped composition root and both real hosts —
 * MuPDF holds the session, PDFium answers the blocks and applies the edit.
 *
 * ## Its control is the input
 *
 * The case is worthless on a page the old build handled, so the child also measures, with the same reader the host
 * runs, how many bytes the page's text-runs answer is — and the driver requires it to be MORE than a frame carries.
 * A page that fitted would pass here and prove nothing about the route.
 *
 * Usage: not directly. `node scripts/research/hostFileAnswersLive.mjs`.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { ABOVE, BELOW, picturedPage } from '../lib/wordPictureFixture.mjs';

const ROOT = repoRoot();

/** Where the report goes, given by the driver — a FILE, for `hostRecoveryHost.mjs`' reason. */
const REPORT_PATH = process.argv[2] ?? '';

/**
 * A document to run the same sequence on instead of the generated page — read, COPIED into this run's scratch folder
 * and edited there, so the file named is never written. For a person's own file they have allowed to be opened; the
 * report carries outcomes and counts, never content.
 */
const DOCUMENT = process.argv[3];

/** How many glyphs the page draws, each its own text object: enough that the runs answer exceeds a frame. */
const GLYPHS = 1600;

/** What the edited block says afterwards: words the generated page does not contain. */
const EDITED = 'Edited through the real host';

/**
 * How many text fields the generated form has: enough that its field list exceeds a frame (3,000 fields measured
 * 531,355 B) AND one part of `document.formFields` (`FORM_FIELDS_PART`, 4,096), so the renderer's list crosses in two
 * parts cut by main's real handler (ADR-0130 Decision 2).
 */
const FORM_FIELDS = 5000;

/**
 * How many pages the rotated document has: enough that rotating every page captures a prior larger than a frame —
 * 398,937 B at this count, measured with the kernel's own capture (ADR-0125's addendum), and measured again each run.
 */
const ROTATED_PAGES = 10_000;

/** The inline picture's square on {@link inlinePicturePage}, in points on a 300-point page. */
const PICTURE_SQUARE = { x: 100, y: 100, size: 100 };

/**
 * A page of one text line and a solid red INLINE picture (`BI … EI`), written here byte for byte — the shape PDFium's
 * content generator drops when an edit regenerates the page (ADR-0126).
 *
 * @returns {Buffer}
 */
function inlinePicturePage() {
  const red = Buffer.alloc(16 * 16 * 3);
  for (let at = 0; at < red.length; at += 3) red[at] = 255;
  const place = `${String(PICTURE_SQUARE.size)} 0 0 ${String(PICTURE_SQUARE.size)} ${String(PICTURE_SQUARE.x)} ${String(PICTURE_SQUARE.y)} cm`;
  const content = Buffer.concat([
    Buffer.from(`BT /F1 18 Tf 40 250 Td (Hello world) Tj ET\nq ${place} BI /W 16 /H 16 /CS /RGB /BPC 8 ID `, 'latin1'),
    red,
    Buffer.from(' EI Q', 'latin1'),
  ]);
  const objects = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [`<< /Length ${String(content.length)} >>\nstream\n`, content, '\nendstream'],
  ];
  /** @type {Buffer[]} */
  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0]?.length ?? 0;
  /** @type {number[]} */
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(length);
    const piece = Buffer.concat([
      Buffer.from(`${String(index + 1)} 0 obj\n`, 'latin1'),
      ...body.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : part)),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(piece);
    length += piece.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(parts);
}

/**
 * Whether the picture's square is drawn red, read with the PDFium adapter from the bytes on disk.
 *
 * @param {any} pdfium @param {Uint8Array} bytes
 * @returns {Promise<boolean>}
 */
async function pictureDrawn(pdfium, bytes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    const bitmap = await pdfium.renderPageBitmap(session, 0, 300, 300);
    const x = PICTURE_SQUARE.x + PICTURE_SQUARE.size / 2;
    const y = 300 - (PICTURE_SQUARE.y + PICTURE_SQUARE.size / 2);
    const at = (y * bitmap.width + x) * 4;
    return (bitmap.bgra[at + 2] ?? 0) > 200 && (bitmap.bgra[at + 1] ?? 255) < 60 && (bitmap.bgra[at] ?? 255) < 60;
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/** @returns {Promise<Uint8Array>} a document of {@link ROTATED_PAGES} blank pages */
async function manyPages() {
  const document = await PDFDocument.create();
  for (let index = 0; index < ROTATED_PAGES; index += 1) document.addPage([200, 200]);
  return document.save();
}

/**
 * A form of {@link FORM_FIELDS} text fields over pages of forty — a long government form's size.
 *
 * @returns {Promise<Uint8Array>}
 */
async function manyFieldsForm() {
  const document = await PDFDocument.create();
  const form = document.getForm();
  let page = document.addPage([595, 842]);
  for (let index = 0; index < FORM_FIELDS; index += 1) {
    if (index > 0 && index % 40 === 0) page = document.addPage([595, 842]);
    const field = form.createTextField(`section.part${String(Math.floor(index / 40))}.line${String(index % 40)}.entry`);
    field.addToPage(page, { x: 40, y: 800 - (index % 40) * 19, width: 500, height: 16 });
  }
  return document.save();
}

/** How long the hosts have to exit once killed. `hostRecoveryHost.mjs`' bound. */
const DEATH_BUDGET_MS = 5_000;
const POLL_MS = 250;

/**
 * This process's child process ids — `composeHostLiveHost.mjs`' enumeration, for its cleanup.
 *
 * @returns {number[]}
 */
function childProcessIds() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(process.pid)}" | ` +
        `Where-Object { $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (result.error !== undefined) throw new Error('could not enumerate this process’s children', { cause: result.error });
  return `${result.stdout}`
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** @param {string} relative @returns {Promise<any>} */
function built(relative) {
  return import(pathToFileURL(join(ROOT, relative)).href);
}

/**
 * One call to a handler, with a throw recorded as an observation.
 *
 * @param {() => Promise<any>} call
 * @returns {Promise<any>}
 */
async function observed(call) {
  try {
    return await call();
  } catch (error) {
    return { threw: String(error?.constructor?.name ?? 'Error') };
  }
}

/**
 * A page drawing `glyphs` characters, each its own text object — the shape of the owner's failing file, made here.
 *
 * ## Each glyph in a colour other than its neighbour's, since the host joins runs (ADR-0130)
 *
 * The PDFium host joins abutting glyph objects set alike into one run before it answers, so this page drawn in one
 * colour now answers twenty runs, 8,196 bytes — measured 2026-10-01 — which a frame carries, and the case that the
 * answer crosses in a FILE would prove nothing. Alternating two colours keeps every glyph its own run, which is a page
 * the join leaves apart by its own rule, and the answer above a frame as the owner's file was.
 *
 * @returns {Promise<Uint8Array>}
 */
async function onePerGlyphPage() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < GLYPHS; index += 1) {
    const column = index % 80;
    const row = Math.floor(index / 80);
    const color = index % 2 === 0 ? rgb(0, 0, 0) : rgb(0.2, 0, 0);
    page.drawText(alphabet[index % alphabet.length] ?? 'a', { x: 20 + column * 7, y: 820 - row * 30, size: 9, font, color });
  }
  return document.save();
}

/** @param {any} answer @returns {string[]} every block's text, its lines joined by line breaks */
function blockTexts(answer) {
  if (answer?.ok !== true) return [];
  return answer.value.blocks.map((/** @type {any} */ block) =>
    block.lines
      .map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.text).join(''))
      .join('\n'),
  );
}

async function main() {
  if (REPORT_PATH === '') throw new Error('hostFileAnswersLiveHost.mjs takes the path to write its report to.');
  if (!('electron' in process.versions)) {
    throw new Error('hostFileAnswersLiveHost.mjs must run under the Electron binary in Node mode.');
  }

  /** @type {typeof import('../../apps/desktop/src/composition.js')} */
  const composition = await built('apps/desktop/dist/composition.js');
  /** @type {typeof import('../../apps/desktop/src/engineHostPlatform.js')} */
  const platformModule = await built('apps/desktop/dist/engineHostPlatform.js');
  /** @type {typeof import('../../apps/desktop/src/harnessComposition.js')} */
  const harnessModule = await built('apps/desktop/dist/harnessComposition.js');
  const { ENGINE_HOST_FRAME_MAX_BYTES } = await built('packages/contract/dist/hostProtocol.js');
  /** @type {typeof import('../../packages/contract/src/commands.js')} */
  const { blockEditOf } = await built('packages/contract/dist/commands.js');
  const pdfium = await built('packages/kernel/dist/pdfiumFfi.js');

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-file-answers-live-'));
  try {
    const bytes = DOCUMENT === undefined ? await onePerGlyphPage() : new Uint8Array(readFileSync(DOCUMENT));
    const path = join(scratch, 'document-under-test.pdf');
    writeFileSync(path, bytes);
    /** What the next `document.open` picks: the page first, then the form. */
    const picked = { path };

    // THE FORM'S CONTROL, measured with the reader the MuPDF host runs: its field list must exceed a frame.
    const formBytes = await manyFieldsForm();
    const formPath = join(scratch, 'many-fields-form.pdf');
    writeFileSync(formPath, formBytes);
    const { bindNativeEngine } = await import('../lib/nativeEngine.mjs');
    if (bindNativeEngine(ROOT) === null) throw new Error('the native MuPDF shim is not built here.');
    const { mupdfWriter } = await built('packages/kernel/dist/mupdfWriter.js');
    const { readFormFields } = await built('packages/kernel/dist/formFields.js');
    const formSession = await mupdfWriter.open(formBytes);
    let formAnswerBytes = 0;
    try {
      formAnswerBytes = Buffer.byteLength(JSON.stringify({ ok: true, value: await readFormFields(formSession) }));
    } finally {
      await mupdfWriter.close(formSession);
    }

    // UNDO'S CONTROL, measured with the capture the MuPDF host runs: rotating every page must capture more than a frame,
    // so the old build could neither answer the capture nor, had it got through, send it back as undo's request.
    const rotateBytes = await manyPages();
    const rotatePath = join(scratch, 'many-pages.pdf');
    writeFileSync(rotatePath, rotateBytes);
    // AS RUNS, the way the page sends every page list (ADR-0125's decision D): ten thousand single numbers is over
    // `MAX_PAGE_SET_ENTRIES` and the host's schema refuses it. The capture still holds one prior per page, so the
    // answer is as large as before.
    const { pageSetOf } = await built('packages/contract/dist/pageSet.js');
    const rotateAll = /** @type {const} */ ({
      kind: 'rotatePages',
      pages: pageSetOf(Array.from({ length: ROTATED_PAGES }, (_, page) => page)),
      quarterTurns: 1,
    });
    const { localMupdfExecution } = await built('packages/kernel/dist/mupdfSpecs.js');
    const rotateSession = await mupdfWriter.open(rotateBytes);
    let captureAnswerBytes = 0;
    try {
      const captured = await localMupdfExecution.capture(rotateSession, rotateAll);
      captureAnswerBytes = captured.captured
        ? Buffer.byteLength(JSON.stringify({ ok: true, value: { captured: true, value: captured.prior } }))
        : 0;
    } finally {
      await mupdfWriter.close(rotateSession);
    }

    // THE INPUT IS THE CONTROL: measured with the reader the host runs, the answer must exceed a frame.
    const library = process.env['MONSTERA_PDFIUM_LIBRARY'] ?? '';
    pdfium.openPdfium(library);
    const measured = await pdfium.pdfiumWriter.open(bytes);
    let runsAnswerBytes = 0;
    let runCount = 0;
    // THE RUNS A BLOCK MAY HOLD: text set at an angle is counted and left out of the blocks by design (the composition's
    // `textBlocks`), so "every run" is every UPRIGHT run.
    let uprightRunCount = 0;
    try {
      const runs = await pdfium.textRuns(measured, 0);
      runCount = runs.runs.length;
      uprightRunCount = runs.runs.filter((/** @type {any} */ run) => run.style.upright).length;
      runsAnswerBytes = Buffer.byteLength(JSON.stringify({ ok: true, value: runs }));
    } finally {
      await pdfium.pdfiumWriter.close(measured);
    }

    const sessionRoot = join(scratch, 'engine-sessions');
    mkdirSync(sessionRoot, { recursive: true });
    const platform = platformModule.createEngineHostPlatform(sessionRoot, {
      report: (outcome) => {
        if (!outcome.ok) process.stderr.write(`package-data check: ${outcome.error}\n`);
      },
    });
    if (platform === null) throw new Error('createEngineHostPlatform returned null, so no contained host can exist here.');
    const pdfiumPlatform = platformModule.createPdfiumHostPlatform(platform);
    if (pdfiumPlatform === null) {
      throw new Error('createPdfiumHostPlatform returned null: MONSTERA_PDFIUM_LIBRARY did not reach this process.');
    }
    // THE COMPOSE HOST TOO, which keeps a page's inline images before PDFium regenerates it (ADR-0126): without it
    // the inline-picture case below would measure a build that cannot keep them.
    const composePlatform = platformModule.createComposeHostPlatform(platform);
    if (composePlatform === null) throw new Error('createComposeHostPlatform returned null, so no inline image can be kept.');

    /** @type {string[]} */
    const failures = [];
    const { handlers } = composition.createShellDependencies({
      ...harnessModule.harnessSurfaces('the file-answer live harness'),
      appInfo: { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' },
      pickDocument: () => Promise.resolve(picked.path),
      // THE WORD EXPORT'S DESTINATION, the one Office file this harness writes.
      pickOffice: () => Promise.resolve(join(scratch, 'pictured.docx')),
      enginePlatform: platform,
      pdfiumPlatform,
      composePlatform,
      // A RECORDING LOG, so a host that ends during the run is a line in the report rather than on a handle nobody
      // reads — the owner's failure was exactly such a line.
      log: {
        directory: scratch,
        failures: (/** @type {{ event: string, detail: string }} */ failure) => {
          failures.push(`${failure.event}: ${failure.detail}`);
        },
        incidents: (/** @type {{ id: string, channel: string }} */ incident) => {
          failures.push(`incident ${incident.id} on ${incident.channel}`);
        },
        reveal: () => Promise.resolve(false),
        write: () => undefined,
      },
    });

    const opened = await observed(() => handlers['document.open']({}));
    /** @type {any} */
    let blocks = null;
    /** @type {any} */
    let edited = null;
    /** @type {any} */
    let saved = null;
    /** @type {any} */
    let reopenedBlocks = null;
    if (opened?.ok === true && opened.value.kind === 'opened') {
      const docId = opened.value.docId;
      blocks = await observed(() => handlers['document.textBlocks']({ docId, page: 0, from: 0 }));
      const first = blocks?.ok === true ? blocks.value.blocks[0] : undefined;
      if (first !== undefined) {
        edited = await observed(() =>
          handlers['document.execute']({
            docId,
            command: {
              kind: 'editTextBlock',
              page: 0,
              ...blockEditOf([
                {
                  lines: first.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)),
                  text: EDITED,
                },
              ]),
              fit: 'reflow',
              version: blocks.value.version,
            },
          }),
        );
      }
      if (edited?.ok === true) saved = await observed(() => handlers['document.save']({ docId, breakSignatures: false }));
      await observed(() => handlers['document.close']({ docId }));
      if (saved?.ok === true) {
        const again = await observed(() => handlers['document.open']({}));
        if (again?.ok === true && again.value.kind === 'opened') {
          reopenedBlocks = await observed(() => handlers['document.textBlocks']({ docId: again.value.docId, page: 0, from: 0 }));
        }
      }
    }

    // THE MUPDF HOST, the one holding the document: a field list larger than a frame, through its real pipe.
    picked.path = formPath;
    const form = await observed(() => handlers['document.open']({}));
    /** @type {any} */
    let formFields = null;
    if (form?.ok === true && form.value.kind === 'opened') {
      // EVERY PART, as `readWholeList` asks for them: the count is the list's only when each part was asked for.
      const docId = form.value.docId;
      let from = 0;
      let count = 0;
      let parts = 0;
      /** @type {any} */
      let listed = null;
      for (;;) {
        const at = from;
        listed = await observed(() => handlers['document.formFields']({ docId, from: at }));
        if (listed?.ok !== true) break;
        parts += 1;
        count += listed.value.fields.length;
        if (listed.value.next === null) break;
        from = listed.value.next;
      }
      formFields = listed?.ok === true ? { count, parts, truncated: listed.value.truncated } : listed;
    } else {
      formFields = form;
    }

    // UNDO'S PAIR, through the MuPDF host: the capture answers in a file and the undo sends the same prior back in one.
    // Read back through the view model at both ends of the document, so an undo that answered and restored nothing, or
    // a rotate that never applied, is visible rather than the same `undone`.
    picked.path = rotatePath;
    const many = await observed(() => handlers['document.open']({}));
    /** @type {any} */
    let rotated = null;
    /** @type {any} */
    let rotatedView = null;
    /** @type {any} */
    let undone = null;
    /** @type {any} */
    let undoneView = null;
    const ends = [0, ROTATED_PAGES - 1];
    if (many?.ok === true && many.value.kind === 'opened') {
      const docId = many.value.docId;
      rotated = await observed(() => handlers['document.execute']({ docId, command: rotateAll }));
      const view = await observed(() => handlers['document.viewModel']({ docId, pages: ends }));
      rotatedView = view?.ok === true ? view.value.rotations : view;
      if (rotated?.ok === true) {
        undone = await observed(() => handlers['document.undo']({ docId }));
        const after = await observed(() => handlers['document.viewModel']({ docId, pages: ends }));
        undoneView = after?.ok === true ? after.value.rotations : after;
      }
    }

    // THE INLINE PICTURE (ADR-0126): the page edited through BOTH real hosts — the compose host keeping the picture,
    // PDFium regenerating the page — saved, and the bytes on disk read back with the adapter in this process.
    const inlineBytes = inlinePicturePage();
    const inlinePath = join(scratch, 'inline-picture.pdf');
    writeFileSync(inlinePath, inlineBytes);
    const inlineBefore = await pictureDrawn(pdfium, inlineBytes);
    picked.path = inlinePath;
    const inlineOpened = await observed(() => handlers['document.open']({}));
    /** @type {any} */
    let inlineEdited = null;
    /** @type {any} */
    let inlineSaved = null;
    let inlineAfter = false;
    let inlineText = '';
    if (inlineOpened?.ok === true && inlineOpened.value.kind === 'opened') {
      const docId = inlineOpened.value.docId;
      const inlineBlocks = await observed(() => handlers['document.textBlocks']({ docId, page: 0, from: 0 }));
      const block = inlineBlocks?.ok === true ? inlineBlocks.value.blocks[0] : undefined;
      if (block !== undefined) {
        inlineEdited = await observed(() =>
          handlers['document.execute']({
            docId,
            command: {
              kind: 'editTextBlock',
              page: 0,
              ...blockEditOf([
                {
                  lines: block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)),
                  text: 'Edited',
                },
              ]),
              fit: 'reflow',
              version: inlineBlocks.value.version,
            },
          }),
        );
      }
      if (inlineEdited?.ok === true) {
        inlineSaved = await observed(() => handlers['document.save']({ docId, breakSignatures: false }));
      }
      await observed(() => handlers['document.close']({ docId }));
      if (inlineSaved?.ok === true) {
        const onDisk = new Uint8Array(readFileSync(inlinePath));
        inlineAfter = await pictureDrawn(pdfium, onDisk);
        const reread = await pdfium.pdfiumWriter.open(onDisk);
        try {
          inlineText = (await pdfium.textRuns(reread, 0)).runs.map((/** @type {any} */ run) => run.text).join(' ');
        } finally {
          await pdfium.pdfiumWriter.close(reread);
        }
      }
    }

    // THE WORD EXPORT, COMPOSED IN THE REAL CONTAINED MuPDF HOST (ADR-0072's amendment of 2026-10-01): the composer is
    // loaded there on first use, draws the page's pictures, writes the package into the session's output directory,
    // and main moves it here. Read back with fflate; the picture-level second readers are `proof:wordpictures`'.
    const picturedPath = join(scratch, 'pictured.pdf');
    writeFileSync(picturedPath, await picturedPage());
    picked.path = picturedPath;
    const wordOpened = await observed(() => handlers['document.open']({}));
    /** @type {any} */
    let wordExported = null;
    let wordPictures = -1;
    let wordInOrder = false;
    if (wordOpened?.ok === true && wordOpened.value.kind === 'opened') {
      const docId = wordOpened.value.docId;
      wordExported = await observed(() => handlers['document.exportWord']({ docId, mode: 'rich' }));
      await observed(() => handlers['document.close']({ docId }));
      if (wordExported?.ok === true && wordExported.value.kind === 'copied') {
        const { strFromU8, unzipSync } = await import('fflate');
        const files = unzipSync(new Uint8Array(readFileSync(join(scratch, 'pictured.docx'))));
        wordPictures = Object.keys(files).filter((name) => name.startsWith('word/media/')).length;
        const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array());
        const drawing = xml.indexOf('<w:drawing>');
        wordInOrder = xml.indexOf(ABOVE) >= 0 && drawing > xml.indexOf(ABOVE) && xml.indexOf(BELOW) > drawing;
      }
    }

    const report = {
      wordExported: wordExported?.ok === true ? wordExported.value.kind : wordExported,
      wordPictures,
      wordInOrder,
      inlineBefore,
      inlineOpened: inlineOpened?.ok === true ? inlineOpened.value.kind : inlineOpened,
      inlineEdited: inlineEdited?.ok === true ? 'ok' : inlineEdited,
      inlineSaved: inlineSaved?.ok === true ? inlineSaved.value.kind : inlineSaved,
      inlineAfter,
      inlineText,
      rotatedPages: ROTATED_PAGES,
      captureAnswerBytes,
      rotateOpened: many?.ok === true ? many.value.kind : many,
      rotated: rotated?.ok === true ? 'ok' : rotated,
      rotatedView,
      undone: undone?.ok === true ? undone.value.kind : undone,
      undoneView,
      frameMaxBytes: ENGINE_HOST_FRAME_MAX_BYTES,
      formAnswerBytes,
      formFieldCount: FORM_FIELDS,
      formFields,
      runsAnswerBytes,
      runCount,
      uprightRunCount,
      opened: opened?.ok === true ? opened.value.kind : opened,
      blocks: blocks?.ok === true ? { count: blocks.value.blocks.length } : blocks,
      blockRuns:
        blocks?.ok === true
          ? blocks.value.blocks.reduce(
              (/** @type {number} */ sum, /** @type {any} */ block) =>
                sum + block.lines.reduce((/** @type {number} */ lines, /** @type {any} */ line) => lines + line.runs.length, 0),
              0,
            )
          : 0,
      edited: edited?.ok === true ? 'ok' : edited,
      saved: saved?.ok === true ? saved.value.kind : saved,
      reopenedHasEdit: blockTexts(reopenedBlocks).some((text) => text.replace(/\s+/gu, ' ').includes(EDITED)),
      reopenedBlocks: reopenedBlocks?.ok === true ? 'ok' : reopenedBlocks,
      failures,
    };
    // THE REPORT FIRST, for `hostRecoveryHost.mjs`' reason: everything after it is cleanup, and cleanup can fail.
    writeFileSync(REPORT_PATH, `${JSON.stringify(report)}\n`, 'utf8');

    for (const id of childProcessIds()) {
      try {
        process.kill(id);
      } catch {
        // Already gone.
      }
    }
    const startedAt = Date.now();
    while (childProcessIds().length > 0 && Date.now() - startedAt < DEATH_BUDGET_MS) await sleep(POLL_MS);
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      process.stderr.write(`MONSTERA_FILE_ANSWERS_LIVE_LEAKED ${scratch} could not be removed: ${formatError(error)}\n`);
    }
    // EXIT EXPLICITLY: the shell holds reader workers and pipes whose lifetimes are the application's.
    process.exit(0);
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`MONSTERA_FILE_ANSWERS_LIVE_FAILED ${formatError(error)}\n`);
  process.exitCode = 1;
});
