// @ts-check
/**
 * The child of `hostFileAnswersLive.mjs`: a real shell editing text through the real PDFium host on a page drawn one
 * text object per glyph, and reading a 3,000-field form's field list through the real MuPDF host.
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

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

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

/** How many text fields the generated form has: enough that its field list exceeds a frame (531,355 B, measured). */
const FORM_FIELDS = 3000;

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
    page.drawText(alphabet[index % alphabet.length] ?? 'a', { x: 20 + column * 7, y: 820 - row * 30, size: 9, font });
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
    const { bindNativeEngine } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'nativeEngine.mjs')).href);
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

    /** @type {string[]} */
    const failures = [];
    const { handlers } = composition.createShellDependencies({
      ...harnessModule.harnessSurfaces('the file-answer live harness'),
      appInfo: { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' },
      pickDocument: () => Promise.resolve(picked.path),
      enginePlatform: platform,
      pdfiumPlatform,
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
      blocks = await observed(() => handlers['document.textBlocks']({ docId, page: 0 }));
      const first = blocks?.ok === true ? blocks.value.blocks[0] : undefined;
      if (first !== undefined) {
        edited = await observed(() =>
          handlers['document.execute']({
            docId,
            command: {
              kind: 'editTextBlock',
              page: 0,
              blocks: [
                {
                  lines: first.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)),
                  text: EDITED,
                  fit: 'reflow',
                },
              ],
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
          reopenedBlocks = await observed(() => handlers['document.textBlocks']({ docId: again.value.docId, page: 0 }));
        }
      }
    }

    // THE MUPDF HOST, the one holding the document: a field list larger than a frame, through its real pipe.
    picked.path = formPath;
    const form = await observed(() => handlers['document.open']({}));
    /** @type {any} */
    let formFields = null;
    if (form?.ok === true && form.value.kind === 'opened') {
      const listed = await observed(() => handlers['document.formFields']({ docId: form.value.docId }));
      formFields = listed?.ok === true ? { count: listed.value.fields.length, truncated: listed.value.truncated } : listed;
    } else {
      formFields = form;
    }

    const report = {
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
