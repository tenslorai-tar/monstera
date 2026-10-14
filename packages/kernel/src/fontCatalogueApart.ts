import type { Worker } from 'node:worker_threads';

import { type ApartWork, runApartSync } from './apart.js';
import type { Catalogue, FontFolder } from './fontCatalogue.js';

/** The catalogue's thread, taken by this reader and by `fontCatalogueWorker.ts`. */
export const FONT_CATALOGUE: ApartWork<readonly FontFolder[], Catalogue> = {
  entry: new URL('./fontCatalogueWorker.js', import.meta.url),
  label: 'the font catalogue',
};

/**
 * Reads the font catalogue in a thread that ends when it has answered, so what reading it costs is not kept by the
 * host that asked (the owner's Part 7 A, measured 2026-10-13; the one runner is `apart.ts`, ADR-0239).
 *
 * ## Why apart
 *
 * `readFace` reads each face through harfbuzzjs (1.6.2, and 1.6.3 is the same), whose objects free their WebAssembly
 * memory only from a `FinalizationRegistry`, and two of whose calls never free at all: `referenceTable` keeps a
 * reference to the font's blob, so the whole file stays, and `collectUnicodes` leaves its array behind. A catalogue is
 * read in one synchronous loop, in which no finaliser can run, and WebAssembly memory never shrinks. So a host kept
 * about 1.6 times the size of every font it read, for its whole life: 116 MB of fonts left 180 MB after a forced
 * collection, and a second read added 130 MB more (`node --expose-gc`, this container, 2026-10-13). A Windows machine
 * with Office's fonts is what the owner's 960 MB compose host was.
 *
 * ## Synchronous, because every caller is
 *
 * `editFaces()` and the compose host's `faces()` are read inside synchronous code, so it is `runApartSync`.
 */

/**
 * `readCatalogue(folders)`, read in a thread that ends after it.
 *
 * @param started given the thread as it starts, for a proof that must see it end: the asking isolate's own memory
 *   cannot show what a thread that stayed alive still holds
 * @throws where the thread could not read: the message is the thread's own
 */
export function readCatalogueApart(folders: readonly FontFolder[], started?: (thread: Worker) => void): Catalogue {
  return runApartSync(FONT_CATALOGUE, folders, started);
}
