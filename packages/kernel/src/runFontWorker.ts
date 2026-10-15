import { serveApart } from './apartThread.js';
import { RUN_FONTS } from './runFontApart.js';

/**
 * The thread one read's run fonts are rebuilt in ({@link runFontsApart}).
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by `apartEntry.ts` in the thread it starts, never imported by the host. It ends when the fonts have been
 * posted, and the HarfBuzz instances that read each program end with it. A failure to load this file or anything it
 * imports is answered there.
 */

await serveApart(RUN_FONTS, async (requests) => {
  const { runFontFor } = await import('./runFont.js');
  return requests.map((request) => runFontFor(request.program, request.drawn));
});
