// @ts-check
/**
 * Where the MuPDF engine the APPLICATION loads actually lives.
 *
 * ## Resolved, never written down
 *
 * Every MuPDF consumer in `packages/kernel` imports the bare specifier
 * `'mupdf'`, and Node resolves that to `node_modules/mupdf/dist/mupdf.js`, which
 * instantiates `mupdf-wasm.wasm` beside it. A scan that spelt that path as a
 * literal would keep passing after the application's import moved, and would
 * then be reporting a clean absence about a file nothing loads.
 *
 * `import.meta.resolve` performs the same resolution the kernel's own import
 * performs, so a target cannot drift away from its subject in silence.
 *
 * ## Why it is a module rather than a function in one proof
 *
 * `proof:activecontent` derived this for itself on 2026-09-08, and on 2026-09-10
 * a second question — *does the loaded engine expose OCR at all* — needed the
 * same answer. Two files each joining a directory to a filename is a second
 * opinion about which artefact the application runs (B3a): both would be right
 * today and one would be stale the day the package's layout changes. The
 * resolution lives here and both call it.
 *
 * **This is not a claim that the file is the right subject.** A positive control
 * proves an instrument can see the file it was given; nothing proves that file
 * is the subject except deriving it the way the application does, which is what
 * this module is.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory the resolved `mupdf` package ships its artefacts in. */
export function shippedEngineDirectory() {
  return dirname(fileURLToPath(import.meta.resolve('mupdf')));
}

/**
 * The WASM engine the application's own import resolves to.
 *
 * @returns {string} an absolute path, which may not exist if nothing is installed
 */
export function shippedEngine() {
  return join(shippedEngineDirectory(), 'mupdf-wasm.wasm');
}

/**
 * The JavaScript and declaration files beside it, which are the other half of
 * the surface: a member the engine does not declare is one no caller can name.
 *
 * @returns {string[]} the ones that exist, so a caller reports on what it read
 */
export function shippedEngineSurface() {
  const directory = shippedEngineDirectory();
  return ['mupdf.js', 'mupdf.d.ts', 'mupdf-wasm.d.ts', 'mupdf-wasm.js']
    .map((name) => join(directory, name))
    .filter((path) => existsSync(path));
}
