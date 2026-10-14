import type { Worker } from 'node:worker_threads';

import { type ApartWork, runApartSync } from './apart.js';
import type { FaceProgramRequest } from './faceProgram.js';

/** The face program's thread, taken by this asker and by `faceProgramWorker.ts`. */
export const FACE_PROGRAM: ApartWork<FaceProgramRequest, Uint8Array | null> = {
  entry: new URL('./faceProgramWorker.js', import.meta.url),
  label: 'a face program',
};

/**
 * `faceProgram(request)`, made in a thread that ends after it
 * ([ADR-0239](../../../docs/DECISIONS/0239-a-fonts-whole-file-is-read-in-a-thread-that-ends.md) Decision 2): the face's
 * whole file is read through HarfBuzz there, and what that keeps goes with the thread. Synchronous, because an edit
 * loads a face from inside its synchronous layout.
 *
 * THE WHOLE FILE IS MOVED, not copied: its buffer is transferred, so the caller must not use `request.whole` after this
 * call. A view of part of a larger buffer is copied first, because transferring the buffer would take the rest with it.
 *
 * @param started given the thread as it starts, for a proof that must see it end
 * @throws where the thread failed: the message is the thread's own
 */
export function faceProgramApart(request: FaceProgramRequest, started?: (thread: Worker) => void): Uint8Array | null {
  const whole =
    request.whole.byteOffset === 0 && request.whole.byteLength === request.whole.buffer.byteLength ? request.whole : request.whole.slice();
  // A SharedArrayBuffer cannot be transferred, and is shared without it.
  const transfer = whole.buffer instanceof ArrayBuffer ? [whole.buffer] : [];
  return runApartSync(FACE_PROGRAM, { ...request, whole }, started, transfer);
}
