import { serveApart } from './apartThread.js';
import { FACE_PROGRAM } from './faceProgramApart.js';

/**
 * The thread an edit's face program is made in ({@link faceProgramApart}).
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by path through `new Worker(…)`, never imported. It ends when the program has been posted, and the HarfBuzz
 * instances that read the face's whole file end with it. The program's module is imported inside the work, so a
 * failure to load it is answered (`serveApart`).
 */

await serveApart(FACE_PROGRAM, async (request) => {
  const { faceProgram } = await import('./faceProgram.js');
  return faceProgram(request);
});
