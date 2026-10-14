import { type MessagePort, workerData } from 'node:worker_threads';

import { toStructuredError } from '@monstera/shared';

import type { ApartAnswer, ApartWork, ApartWorkerData } from './apart.js';

/**
 * The thread's side of {@link runApartSync} and {@link runApart}: an entry calls `serveApart` once, with the same
 * {@link ApartWork} its asker passes and the function that does it.
 *
 * ## It answers on every path, because a synchronous asker is blocked until it does
 *
 * The asker waits in `Atomics.wait` and cannot run an `error` or `exit` listener while it waits. So the signal is
 * raised in this thread's own `exit`, which runs after an answer, after a thrown work, and after a module the work
 * imports failed to load; the work's modules are imported inside `run`, after that listener exists, so a failure to
 * load one is answered too.
 *
 * @param run given the asker's input; its result must be structured-cloneable
 */
export async function serveApart<I, O>(work: ApartWork<I, O>, run: (input: I) => O | Promise<O>): Promise<void> {
  const { input, signal, port } = workerData as ApartWorkerData & { readonly port: MessagePort };
  let answered = false;
  const answer = (message: ApartAnswer<O>): void => {
    port.postMessage(message);
    answered = true;
  };
  process.on('exit', () => {
    if (!answered) answer({ kind: 'failed', error: { name: 'Error', message: `${work.label}'s thread ended without an answer` } });
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  });
  try {
    // THE ASKER'S INPUT, typed by the declaration both sides take: `runApartSync` and `runApart` accept only an `I`.
    answer({ kind: 'done', output: await run(input as I) });
  } catch (error) {
    answer({ kind: 'failed', error: toStructuredError(error) });
  }
}
