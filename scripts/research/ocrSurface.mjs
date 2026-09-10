// @ts-check
/**
 * Does the MuPDF engine this application actually loads expose OCR at all?
 *
 * ## The question, and why it is asked before a matrix row is written
 *
 * `docs/ARCHITECTURE.md` §3's writer-of-record matrix has a row for *drawing
 * onto pages … OCR text layer* → `@cantoo/pdf-lib`, which is the **embedding**.
 * It has no row for the **recognition** — turning a raster into characters — and
 * D6 rows 2 to 7 all sit on that concern. A stage cannot build six features on a
 * concern with no writer.
 *
 * [ADR-0014](../../docs/DECISIONS/0014-ocr-stays-inside-the-engine.md) (Accepted,
 * 2026-08-18) keeps Tesseract 5.5.2 and Leptonica 1.87.0 **inside MuPDF**,
 * *"reached only through MuPDF's own OCR API"*, and one of its three grounds is
 * that *"Stage 6 needs them … the integration it needs is exactly the one
 * already present."*
 *
 * That ground is a claim about an artefact, so it is measured against one.
 *
 * ## The subject is derived, never spelt
 *
 * `shippedEngine()` resolves the specifier the kernel's own modules import, so
 * this cannot drift onto a file the application does not load — which is exactly
 * how the active-content scan spent weeks reading `monstera_mupdf.dll`, a binary
 * nothing under `packages/` opens. That failure is the reason this file derives
 * its target and reports the path it read.
 *
 * **Both artefacts are scanned**, because the interesting answer is the
 * contrast: ADR-0014's integration is real, and it is in the shim.
 *
 * ## Controls, because every needle here can come back zero
 *
 * *No OCR in this engine* is the answer that decides the matrix row, and it is
 * the reassuring shape twice over — a search reporting nothing found, about a
 * binary. So each scan must first locate something it is **known** to contain:
 * MuPDF's own library strings in the WASM engine, and the API names the kernel
 * demonstrably calls. If a control comes back zero the scan is blind and the run
 * refuses to report.
 *
 * Usage: node scripts/research/ocrSurface.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatError } from '../lib/reportError.mjs';
import { shimPath } from '../lib/shimBinary.mjs';
import { shippedEngine, shippedEngineSurface } from '../lib/shippedEngine.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What an OCR integration cannot be present without naming. */
const OCR_NEEDLES = ['tesseract', 'leptonica', 'ocr_'];

/**
 * What each artefact is known to contain, so a zero in the OCR row means
 * absence rather than blindness.
 *
 * **THE FIRST VERSION USED ONE LIST FOR BOTH AND THE CONTROL CAUGHT IT.** It
 * looked for `PDFDocument` and `StructuredText` in the WASM binary and found
 * neither: those are the names of the JavaScript wrapper's classes, and the
 * binary holds libmupdf's C strings. The needles were about the right library
 * and the wrong artefact — and had the control not been there, the run would
 * have reported `tesseract=0` in exactly the voice of a finding.
 *
 * So the anchors are per-artefact: libmupdf's own error text for the binary,
 * the wrapper's class names for the JavaScript beside it. The binary's pair is
 * the one `proof:activecontent` already uses on the same file.
 */
const KNOWN_PRESENT = {
  binary: ['Cannot read linearly with encryption', 'Document handler list not found'],
  surface: ['PDFDocument', 'StructuredText'],
};

/**
 * How many times a needle occurs in a buffer, case-insensitively.
 *
 * Latin-1 rather than UTF-8 so a byte sequence that is not valid UTF-8 — which
 * most of a WASM binary is — cannot silently drop the region a needle sits in.
 *
 * @param {Buffer} bytes
 * @param {string} needle
 * @returns {number}
 */
function occurrences(bytes, needle) {
  const haystack = bytes.toString('latin1').toLowerCase();
  const target = needle.toLowerCase();
  let count = 0;
  let at = haystack.indexOf(target);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(target, at + target.length);
  }
  return count;
}

/**
 * Scans one artefact and prints its counts.
 *
 * @param {string} label
 * @param {readonly string[]} anchors what this artefact is known to contain
 * @param {string} path
 * @returns {{ read: boolean, ocr: number, blind: boolean }}
 */
function scan(label, anchors, path) {
  if (!existsSync(path)) {
    process.stdout.write(`  ${label}\n    ${relative(REPO_ROOT, path)} — ABSENT, nothing read\n\n`);
    return { read: false, ocr: 0, blind: false };
  }
  const bytes = readFileSync(path);
  const controls = anchors.map((needle) => `${needle}=${String(occurrences(bytes, needle))}`);
  const found = OCR_NEEDLES.map((needle) => occurrences(bytes, needle));
  const blind = anchors.some((needle) => occurrences(bytes, needle) === 0);
  process.stdout.write(
    `  ${label}\n` +
      `    ${relative(REPO_ROOT, path)} (${String(bytes.length)} bytes)\n` +
      `    CONTROL  ${controls.join('  ')}\n` +
      `    OCR      ${OCR_NEEDLES.map((n, i) => `${n}=${String(found[i])}`).join('  ')}\n\n`,
  );
  return { read: true, ocr: found.reduce((sum, hits) => sum + hits, 0), blind };
}

try {
  process.stdout.write('# Does the engine this application loads expose OCR?\n\n');

  process.stdout.write('## The engine the kernel\'s own import resolves to\n\n');
  const engine = scan('WASM engine', KNOWN_PRESENT.binary, shippedEngine());
  if (engine.blind) {
    throw new Error(
      'POSITIVE CONTROL FAILED: this scan cannot find libmupdf\'s own error text in the engine ' +
        'the application loads, so its OCR count says nothing.',
    );
  }

  process.stdout.write('## And its JavaScript surface — a member nothing declares is unnameable\n\n');
  let declared = 0;
  let surfaceSeen = false;
  for (const file of shippedEngineSurface()) {
    const result = scan('surface', KNOWN_PRESENT.surface, file);
    declared += result.ocr;
    if (result.read && !result.blind) surfaceSeen = true;
  }
  if (!surfaceSeen) {
    throw new Error(
      'POSITIVE CONTROL FAILED: no file in the engine\'s JavaScript surface carried the class ' +
        'names the kernel calls, so nothing here read the surface it claims to report on.',
    );
  }

  process.stdout.write('## The shim, which is the artefact ADR-0014 is about\n\n');
  const shim = scan('native shim', KNOWN_PRESENT.binary, shimPath(REPO_ROOT));

  process.stdout.write(
    `## What this decides\n\n` +
      `  engine OCR hits   ${String(engine.ocr)}\n` +
      `  surface OCR hits  ${String(declared)}\n` +
      `  shim OCR hits     ${shim.read ? String(shim.ocr) : 'not built here'}\n\n` +
      `  ADR-0014's second ground is that "the integration it needs is exactly the one already\n` +
      `  present". That integration is in the SHIM. The engine the application's own import\n` +
      `  resolves to is a different artefact, and what it exposes is what a Stage 6 row could\n` +
      `  call today.\n`,
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
