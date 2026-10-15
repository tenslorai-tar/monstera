import { serveApart } from './apartThread.js';
import { FACE_PROGRAM } from './faceProgramApart.js';

/**
 * The thread an edit's face program is made in ({@link faceProgramApart}).
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by `apartEntry.ts` in the thread it starts, never imported by the host. It ends when the program has been
 * posted, and the HarfBuzz instances that read the face's whole file end with it. A failure to load this file or
 * anything it imports is answered there.
 */

await serveApart(FACE_PROGRAM, async (request) => {
  const { faceProgram } = await import('./faceProgram.js');
  return faceProgram(request);
});
