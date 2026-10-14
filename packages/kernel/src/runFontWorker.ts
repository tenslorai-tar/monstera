import { serveApart } from './apartThread.js';
import { RUN_FONTS } from './runFontApart.js';

/**
 * The thread one read's run fonts are rebuilt in ({@link runFontsApart}).
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by path through `new Worker(…)`, never imported. It ends when the fonts have been posted, and the HarfBuzz
 * instances that read each program end with it. The rebuild's module is imported inside the work, so a failure to load
 * it is answered (`serveApart`).
 */

await serveApart(RUN_FONTS, async (requests) => {
  const { runFontFor } = await import('./runFont.js');
  return requests.map((request) => runFontFor(request.program, request.drawn));
});
