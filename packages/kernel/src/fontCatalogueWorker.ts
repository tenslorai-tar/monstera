import { serveApart } from './apartThread.js';
import { FONT_CATALOGUE } from './fontCatalogueApart.js';

/**
 * The thread a host reads its font catalogue in ({@link readCatalogueApart}).
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by `apartEntry.ts` in the thread it starts, never imported by the host. It runs in the host's own process, in
 * Node mode, and ends when the catalogue has been posted: the HarfBuzz instance it loads, and every byte that
 * instance's memory grew to, end with it. A failure to load this file or anything it imports is answered there.
 */

await serveApart(FONT_CATALOGUE, async (folders) => {
  const { readCatalogue } = await import('./fontCatalogue.js');
  return readCatalogue(folders);
});
