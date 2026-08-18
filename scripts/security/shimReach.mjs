// @ts-check
/**
 * Answers, by walking the call graph forward from the shim's own exports, what
 * the shipped DLL's public surface can actually reach.
 *
 * ## The question this exists for
 *
 * `docs/security/engine-advisories.json` holds a NOT-REACHABLE verdict for
 * Tesseract and Leptonica. Its evidence was that no shipped file NAMES an OCR
 * door. That is sound as far as it goes, but it answers a question about our
 * source text, not about the binary: it would still read clean if one of our
 * exports reached a door through an intermediate that names it for us.
 *
 * `fz_new_document_writer` makes that concrete rather than theoretical. It
 * selects a writer from a FILE EXTENSION, so a path ending `.ocr` reaches
 * Tesseract with no caller naming a single OCR symbol. If any export routed a
 * caller-supplied path into that dispatcher, the verdict would be wrong today
 * and a symbol grep would never say so.
 *
 * ## Why "live in the DLL" was never the answer
 *
 * The OCR code is compiled in — `FZ_ENABLE_OCR_OUTPUT` defaults to 1 and the
 * Release configuration defines `HAVE_TESSERACT` and `HAVE_LEPTONICA`. That
 * establishes the code is present. Presence is not reachability, and conflating
 * them is how this whole question kept producing confident wrong answers.
 *
 * ## The positive control is not optional
 *
 * This is an instrument implemented as a SEARCH, and every failure mode of a
 * search points at "found nothing" — which here is the reassuring answer. Four
 * successive versions of the door derivation returned "nothing reaches
 * Tesseract", each for a different broken reason, and not one announced itself.
 *
 * So every run must first locate something known-present. Two controls:
 *
 *   - `pdf_save_document` MUST be reachable from the exports, because `mz_save`
 *     calls it directly. If the walk cannot find that, it has found nothing
 *     because it is broken.
 *   - a synthetic root that references `fz_new_document_writer` MUST reach
 *     `ocr_init`. This proves the walk can traverse the exact path whose absence
 *     it is being trusted to report.
 *
 * A run whose controls fail reports FAILURE, never "clean".
 *
 * Usage:
 *   node scripts/security/shimReach.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { mupdfSourcePath } from '../provision/mupdf.mjs';
import { buildCallGraph, deriveOcrDoors } from './ocrDoors.mjs';

/**
 * The shim's exported functions, read from its source.
 *
 * `MZ_EXPORT` is the shim's own marker for `__declspec(dllexport)`. Confirmed
 * against the built DLL with `dumpbin /EXPORTS`: 24 in the source, 24 in the
 * binary, same names.
 *
 * @param {string} shimSource
 * @returns {string[]}
 */
export function shimExports(shimSource) {
  const text = readFileSync(shimSource, 'utf8');
  const names = [
    ...new Set(
      [...text.matchAll(/^MZ_EXPORT\s+[A-Za-z_][A-Za-z0-9_ \t*]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu)].map(
        (match) => `${match[1]}`,
      ),
    ),
  ].sort();

  if (names.length === 0) {
    throw new Error(
      `No MZ_EXPORT functions were found in ${shimSource}. An empty root set makes everything ` +
        `unreachable, which is exactly the answer this must never produce by accident.`,
    );
  }
  return names;
}

/**
 * @typedef {{
 *   exports: string[],
 *   reached: number,
 *   reachedDoors: string[],
 *   controls: Array<{ name: string, passed: boolean, detail: string }>,
 *   pathTo: (name: string) => string[],
 * }} ShimReach
 */

/**
 * @param {string} sourceRoot
 * @param {string} shimProject
 * @param {string} shimSource
 * @returns {ShimReach}
 */
export function shimReach(sourceRoot, shimProject, shimSource) {
  const doors = deriveOcrDoors(sourceRoot, shimProject).doors;
  const exports = shimExports(shimSource);

  const { callees } = buildCallGraph(sourceRoot, shimProject, {
    extraFiles: [shimSource],
    assumeDefined: doors,
  });

  /** @param {readonly string[]} roots @returns {{ reached: Set<string>, via: Map<string, string> }} */
  const walk = (roots) => {
    /** @type {Map<string, string>} */
    const via = new Map();
    /** @type {Set<string>} */
    const reached = new Set(roots);
    /** @type {string[]} */
    const queue = [...roots];
    while (queue.length > 0) {
      const name = `${queue.shift()}`;
      for (const callee of callees.get(name) ?? []) {
        if (reached.has(callee)) continue;
        reached.add(callee);
        via.set(callee, name);
        queue.push(callee);
      }
    }
    return { reached, via };
  };

  const { reached, via } = walk(exports);

  /** @param {string} name @returns {string[]} The chain back to an export. */
  const pathTo = (name) => {
    /** @type {string[]} */
    const chain = [name];
    let current = via.get(name);
    while (current !== undefined && !chain.includes(current)) {
      chain.push(current);
      current = via.get(current);
    }
    return chain.reverse();
  };

  // CONTROL 1 — the walk finds a path we know exists. mz_save calls
  // pdf_save_document directly, so a walk that misses it is broken, not clean.
  const savePath = reached.has('pdf_save_document');

  // CONTROL 2 — the walk can traverse the very path it is trusted to report the
  // absence of. Rooted at the dispatcher rather than at our exports, so a
  // failure here means the OCR path is untraversable by this instrument and its
  // silence about our exports means nothing.
  const dispatcherReach = walk(['fz_new_document_writer']).reached;
  const dispatcherFindsOcr = dispatcherReach.has('ocr_init');

  return {
    exports,
    reached: reached.size,
    reachedDoors: doors.filter((door) => reached.has(door)),
    controls: [
      {
        name: 'the walk reaches pdf_save_document from the exports',
        passed: savePath,
        detail: savePath
          ? 'mz_save -> pdf_save_document found'
          : 'NOT FOUND. mz_save calls it directly, so this walk is broken and its "no doors ' +
            'reached" result is meaningless.',
      },
      {
        name: 'the walk can traverse the dispatcher into Tesseract',
        passed: dispatcherFindsOcr,
        detail: dispatcherFindsOcr
          ? `fz_new_document_writer reaches ocr_init in ${dispatcherReach.size} nodes`
          : 'NOT FOUND. The instrument cannot see the OCR path at all, so it cannot report its ' +
            'absence from our exports.',
      },
    ],
    pathTo,
  };
}

if (process.argv[1]?.endsWith('shimReach.mjs')) {
  const root = repoRoot();
  const source = mupdfSourcePath(root);
  const shimProject = join(root, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');
  const shimSource = join(root, 'native', 'mupdf-shim', 'monstera_mupdf.c');

  if (!existsSync(join(source, 'source', 'fitz', 'tessocr.h'))) {
    process.stderr.write('MuPDF source not provisioned — nothing was measured here.\n');
    process.exit(1);
  }

  const result = shimReach(source, shimProject, shimSource);

  process.stdout.write(
    `${result.exports.length} shim exports, reaching ${result.reached} functions\n\n` +
      `CONTROLS (a search's failures all look like "found nothing"):\n` +
      result.controls
        .map((control) => `  ${control.passed ? 'ok  ' : 'FAIL'} ${control.name}\n        ${control.detail}\n`)
        .join('') +
      `\n`,
  );

  if (result.controls.some((control) => !control.passed)) {
    process.stderr.write('A control failed. This run measured nothing; do not read the result.\n');
    process.exit(1);
  }

  if (result.reachedDoors.length === 0) {
    process.stdout.write('  ok  no OCR door is reachable from any shim export\n');
  } else {
    process.stdout.write(
      `  REACHABLE OCR doors (${result.reachedDoors.length}):\n` +
        result.reachedDoors
          .map((door) => `    ${door}\n      ${result.pathTo(door).join(' -> ')}\n`)
          .join(''),
    );
    process.exitCode = 1;
  }
}
