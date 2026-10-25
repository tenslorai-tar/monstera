import { existsSync, readdirSync } from 'node:fs';

import { type Catalogue, type CatalogueReading, readCatalogue } from './fontCatalogue.js';

/**
 * The bundled fonts' folder for a test, as `vitest.config.mjs` passes it in `MONSTERA_FONTS_DIRECTORY`. TEST-ONLY: nothing
 * the application runs imports this.
 *
 * **ABSENT IS A FAILURE THAT SAYS SO, never a skip and never a bare error.** A font test that passed without its font is
 * a could-not-look reading as a pass, so a missing folder fails; and it fails naming the folder and the command that
 * provisions it. Each test read the variable with an empty fallback of its own, and on a machine with no fonts three of
 * `textOperatorEdit.test.ts`' cases threw *no readable font face … ENOENT* from deep in the catalogue, which reads as a
 * defect in the code under test (VVVVVVV-3). One reader, so the next test that needs the fonts cannot spell it again.
 */
export function bundledFontsFolder(): string {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  const faces = folder !== '' && existsSync(folder) ? readdirSync(folder).filter((name) => /\.(?:ttf|otf)$/iu.test(name)) : [];
  if (faces.length === 0) {
    throw new Error(`The bundled fonts are not provisioned at ${folder === '' ? '(no folder given)' : folder}. Run: npm run provision:fonts`);
  }
  return folder;
}

const readings = new Map<string, Catalogue>();

/**
 * {@link readCatalogue}, read ONCE per folder set for the life of a test worker: the reading a test binds where it binds
 * before every case. TEST-ONLY, like the rest of this module.
 *
 * **AN IN-THREAD READ KEEPS WHAT IT READ.** harfbuzzjs 1.6.2 copies each font file into its WebAssembly heap and frees it
 * only through a finaliser, which heap pressure never runs, and the heap stops at 2 GiB (`getHeapMax`). Measured
 * 2026-10-25 by reading the bundled folder the way `readFace` does, in one loop: 15.7 MB kept per read with GNU Unifont
 * in the folder, and *memory access out of bounds* at read 137 — after which every read in that worker fails, a face
 * that read a moment earlier included. A file binding before each of its three hundred cases reached that. A host reads
 * apart for the same reason (`fontCatalogueApart.ts`, whose proof measures the retention); a test reads once, because the
 * bundled folder does not change during a run.
 *
 * `fontCatalogue.test.ts` and `editFaces.test.ts` take {@link readCatalogue} itself: what they test is the reading.
 */
export const readCatalogueOnce: CatalogueReading = (folders) => {
  const key = JSON.stringify(folders);
  const known = readings.get(key);
  if (known !== undefined) return known;
  const read = readCatalogue(folders);
  readings.set(key, read);
  return read;
};
