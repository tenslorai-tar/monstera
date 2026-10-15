import { type MessagePort, workerData } from 'node:worker_threads';

import { toStructuredError } from '@monstera/shared';

import type { ApartAnswer, ApartWork, ApartWorkerData } from './apart.js';

/**
 * The thread's side of {@link runApartSync} and {@link runApart}: an entry calls `serveApart` once, with the same
 * {@link ApartWork} its asker passes and the function that does it.
 *
 * ## It posts the answer; `apartEntry.ts` raises the signal
 *
 * The asker's signal is set up by the module every thread starts at, before this one or the entry is loaded, so a
 * failure to load either is answered there. Here the answer is posted and slot 1 marks it posted, which tells that
 * module's `exit` not to post a second one.
 *
 * @param _work the declaration the asker passed, which binds `I` and `O` here to the asker's; its label travels in the
 *   thread's start data
 * @param run given the asker's input; its result must be structured-cloneable
 */
export async function serveApart<I, O>(_work: ApartWork<I, O>, run: (input: I) => O | Promise<O>): Promise<void> {
  const { input, signal, port } = workerData as ApartWorkerData & { readonly port: MessagePort };
  const answer = (message: ApartAnswer<O>): void => {
    port.postMessage(message);
    Atomics.store(signal, 1, 1);
  };
  try {
    // THE ASKER'S INPUT, typed by the declaration both sides take: `runApartSync` and `runApart` accept only an `I`.
    answer({ kind: 'done', output: await run(input as I) });
  } catch (error) {
    answer({ kind: 'failed', error: toStructuredError(error) });
  }
}
