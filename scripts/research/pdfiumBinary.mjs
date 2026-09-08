// @ts-check
/**
 * What is inside the PDFium this project pins, measured before it is bound.
 *
 * ## The question that had to come first
 *
 * Invariant 24: *opening a document runs none of its content* — no embedded
 * JavaScript, no automatic action. This project has already paid to establish
 * that for MuPDF, and the mechanism is a **scan of the shipped binary**
 * (`proof:activecontent`) rather than a call-graph argument, because the
 * call-graph version is one line of diff away from being false.
 *
 * PDFium ships in two flavours per release, and one of them links **V8**.
 * Taking that one would put a JavaScript engine into the process that parses
 * documents, in a second engine, and leave invariant 24 resting on the reading
 * this project already refused to rest on.
 *
 * So this asks what the pinned archive actually contains, before a line of FFI
 * is written against it.
 *
 * ## Its own control
 *
 * A string scan's reassuring answer is *found nothing*, and that is exactly the
 * answer wanted here — which makes it worthless until the same scan has located
 * something the file is known to carry. Three exported symbols are checked
 * first, and the script **throws** rather than reporting if it cannot see them.
 *
 * Run (after `node scripts/provision/pdfium.mjs`):
 *
 *   node scripts/research/pdfiumBinary.mjs
 *
 * It prints readings, never a verdict.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import koffi from 'koffi';

import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const library = pdfiumLibrary(root);

/**
 * Occurrences of a marker in the binary, read as latin1 so every byte maps to
 * one character and no sequence is lost to a decoder.
 *
 * @param {string} text
 * @param {string} needle
 * @returns {number}
 */
function occurrences(text, needle) {
  let found = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    found += 1;
    at = text.indexOf(needle, at + 1);
  }
  return found;
}

/** Symbols the DLL certainly exports. The scan's positive control. */
const KNOWN_PRESENT = ['FPDF_LoadMemDocument', 'FPDF_RenderPageBitmap', 'FPDFBitmap_Create'];

/**
 * What a JavaScript engine leaves in a binary.
 *
 * `v8::` and `V8_Fatal` are V8's own symbols; `Torque` is its code generator;
 * `IsolateData` is the per-isolate state every embedding carries. `CJS_Runtime`
 * and `CJS_Object` are PDFium's OWN JavaScript layer, which exists only when
 * V8 does — so the two groups answer different questions and both are asked.
 */
const ENGINE_MARKERS = ['v8::', 'V8_Fatal', 'Torque', 'IsolateData', 'CJS_Runtime', 'CJS_Object'];

/**
 * Names that are present in EVERY build, including this one.
 *
 * They are export-table entries: a non-V8 PDFium still exports
 * `FPDFDoc_GetJavaScriptActionCount` and `FPDF_LoadXFA`, and their bodies do
 * nothing. Printed so that finding them is not later read as finding an engine
 * — which is the misreading this table exists to prevent.
 */
const EXPORTED_NAMES = ['FPDFDoc_GetJavaScriptActionCount', 'FPDF_LoadXFA'];

function main() {
  console.log('# What is inside the pinned PDFium');
  console.log('');
  console.log(`  version: ${PDFIUM_VERSION}`);
  console.log(`  library: ${library}`);
  console.log(`  bytes:   ${String(statSync(library).size)}`);
  console.log('');

  const text = readFileSync(library).toString('latin1');

  console.log('## 1. The scan can see');
  for (const known of KNOWN_PRESENT) {
    const seen = occurrences(text, known);
    if (seen === 0) {
      throw new Error(
        `the scan cannot find "${known}", which this DLL certainly exports — so its answers ` +
          'about V8 below would be this script being broken rather than a fact about the build',
      );
    }
    console.log(`  ${known}: ${String(seen)}`);
  }
  console.log('');

  console.log('## 2. Whether a JavaScript engine is linked');
  for (const marker of ENGINE_MARKERS) {
    console.log(`  ${marker}: ${String(occurrences(text, marker))}`);
  }
  console.log('');

  console.log('## 3. Names present in every build, engine or not');
  console.log('   export-table entries whose bodies do nothing without V8 — printed so');
  console.log('   that finding them is not read as finding an engine');
  for (const name of EXPORTED_NAMES) {
    console.log(`  ${name}: ${String(occurrences(text, name))}`);
  }
  console.log('');

  // ------------------------------------------------------- 4: can koffi bind
  console.log('## 4. Whether koffi binds it, and what a first call answers');
  console.log('   ASKED HERE rather than assumed by the adapter that will need it: an FFI');
  console.log('   binding that resolves and a library that loads are two facts, and the');
  console.log('   second is the one a missing runtime dependency breaks.');
  const pdfium = koffi.load(library);
  const initialise = pdfium.func('void FPDF_InitLibrary()');
  const destroy = pdfium.func('void FPDF_DestroyLibrary()');
  const lastError = pdfium.func('unsigned long FPDF_GetLastError()');

  initialise();
  console.log('  FPDF_InitLibrary returned, and FPDF_GetLastError answers ' + String(lastError()));

  // A DOCUMENT THIS SCRIPT BUILDS, so the reading is about PDFium rather than
  // about a fixture on disk that may not be there.
  const loadFromMemory = pdfium.func(
    'void *FPDF_LoadMemDocument(const void *data, int size, const char *password)',
  );
  const pageCount = pdfium.func('int FPDF_GetPageCount(void *document)');
  const closeDocument = pdfium.func('void FPDF_CloseDocument(void *document)');

  const minimal = Buffer.from(MINIMAL_PDF, 'latin1');
  const document = loadFromMemory(minimal, minimal.length, null);
  console.log(`  FPDF_LoadMemDocument on a ${String(minimal.length)}-byte document: ` +
    `${document === null ? 'null' : 'a handle'}`);
  if (document !== null) {
    console.log(`  FPDF_GetPageCount: ${String(pageCount(document))}`);
    closeDocument(document);
  } else {
    console.log(`  FPDF_GetLastError: ${String(lastError())}`);
  }
  destroy();
}

/**
 * The smallest document PDFium will open, written by hand.
 *
 * A generated one would need `@cantoo/pdf-lib` here, and what this question is
 * about is whether the LIBRARY loads and parses — a fixture built by another
 * PDF library would make a failure ambiguous between the two.
 */
const MINIMAL_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
  '',
].join('\n');

main();
