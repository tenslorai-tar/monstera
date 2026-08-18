// @ts-check
/**
 * Measures which document-format parsers are actually present in the shipped
 * DLL, by looking for strings only their code can produce.
 *
 * ## Why this is measured rather than reasoned
 *
 * MuPDF's `FZ_ENABLE_*` flags gate **registration only**. Every one of them is
 * referenced from exactly two files — `source/fitz/document-all.c` and
 * `config.h` — and nothing in `source/html/epub-doc.c`, `source/xps/xps-doc.c`
 * or their siblings is inside an `#if`. So `-DFZ_ENABLE_EPUB=0` does not, by
 * itself, remove one byte of EPUB code from the objects.
 *
 * What can remove it is the LINKER discarding objects nothing references — the
 * same mechanism that kept every barcode symbol out of this DLL while libzxing
 * sat on the link line. Whether it fires here is a fact about a particular link,
 * not a property of the flag, and the difference matters: a verdict of "the code
 * is not present" is worth far more than "the code is present but unregistered",
 * and only one of them is true.
 *
 * So this reports what is in the binary, and the register cites the measurement
 * rather than the intention.
 *
 * ## The positive control
 *
 * A search reports "found nothing" for every way it can be broken — a wrong
 * path, an unreadable file, a marker that was never right. PDF's markers must be
 * FOUND on every run, or the absence of the others means nothing at all.
 *
 * Usage:
 *   node scripts/security/handlerFootprint.mjs [path-to-dll]
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';

/**
 * Byte sequences each parser's own code carries.
 *
 * Chosen from format-specific literals — mimetypes, magic strings, element
 * names — rather than from anything a caller might pass in, so a hit means the
 * parser's code is present rather than that the word appears somewhere.
 *
 * @type {Array<{ handler: string, markers: string[] }>}
 */
export const HANDLER_MARKERS = [
  { handler: 'pdf', markers: ['/Type/Catalog', 'endstream', 'Linearized'] },
  { handler: 'epub', markers: ['application/epub+zip', 'META-INF/container.xml'] },
  { handler: 'xps', markers: ['FixedDocumentSequence', 'application/vnd.ms-package'] },
  { handler: 'svg', markers: ['svg:svg', 'preserveAspectRatio'] },
  { handler: 'html', markers: ['<!DOCTYPE html', 'text/html'] },
  { handler: 'office', markers: ['word/document.xml', 'xl/workbook.xml'] },
  { handler: 'mobi', markers: ['BOOKMOBI', 'TEXtREAd'] },
  { handler: 'fb2', markers: ['FictionBook', 'binary id='] },
];

/**
 * @param {string} dllPath
 * @returns {Array<{ handler: string, found: string[], missing: string[] }>}
 */
export function handlerFootprint(dllPath) {
  if (!existsSync(dllPath)) {
    throw new Error(
      `${dllPath} does not exist. A footprint measured against a missing binary would report ` +
        `every parser absent, which is the reassuring answer and a false one.`,
    );
  }

  // Latin-1 so every byte maps to a character and ASCII markers match wherever
  // they sit, including inside UTF-16 runs where they appear NUL-separated.
  const text = readFileSync(dllPath).toString('latin1');

  return HANDLER_MARKERS.map((entry) => ({
    handler: entry.handler,
    found: entry.markers.filter((marker) => text.includes(marker)),
    missing: entry.markers.filter((marker) => !text.includes(marker)),
  }));
}

if (process.argv[1]?.endsWith('handlerFootprint.mjs')) {
  const dll =
    process.argv[2] ?? join(repoRoot(), 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll');
  const results = handlerFootprint(dll);

  process.stdout.write(`${dll}\n\n`);
  for (const result of results) {
    const state = result.found.length === 0 ? 'ABSENT ' : 'present';
    process.stdout.write(
      `  ${state} ${result.handler.padEnd(8)} found: ${result.found.join(', ') || '(none)'}\n`,
    );
  }

  const pdf = results.find((result) => result.handler === 'pdf');
  if (pdf === undefined || pdf.found.length === 0) {
    process.stderr.write(
      `\nCONTROL FAILED: no PDF marker was found. This measurement located nothing it is known ` +
        `to be able to locate, so every "ABSENT" above is unsupported.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`\n  ok  control: PDF markers found (${pdf.found.join(', ')})\n`);
}
