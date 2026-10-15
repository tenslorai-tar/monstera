import { type MessagePort, workerData } from 'node:worker_threads';

import type { ApartAnswer, ApartWorkerData } from './apart.js';

/**
 * Where every thread of {@link runApartSync} and {@link runApart} starts (`apart.ts`): it raises the asker's signal on
 * the thread's `exit` BEFORE the work's entry is loaded, then loads it.
 *
 * ## Why the signal is set up here and not in the entry
 *
 * A synchronous asker waits in `Atomics.wait` and runs no listener while it waits, so only the thread can wake it. Set
 * up by the entry, the listener existed only once the entry's static imports had loaded, and a failure in one of them
 * (`apartThread.js`, the module that declares the work, `@monstera/shared`) ended the thread with nothing raised, and
 * the asker waited for ever (GGGGGGGG-5, HHHHHHHH-6). The entry is loaded here by `import()`, whose failure is a
 * rejection this module answers, and this module imports nothing but Node's own `worker_threads` and erased types.
 *
 * ## Slot 1 says an answer is on the port
 *
 * `serveApart` stores 1 there after it posts, so the `exit` below posts a failure only for a thread that answered
 * nothing, and the asker always finds exactly one message once slot 0 is raised.
 */

const { signal, port, entry, label } = workerData as ApartWorkerData & { readonly port: MessagePort };

function fail(message: string): void {
  if (Atomics.load(signal, 1) === 1) return;
  const answer: ApartAnswer<never> = { kind: 'failed', error: { name: 'Error', message } };
  port.postMessage(answer);
  Atomics.store(signal, 1, 1);
}

process.on('exit', () => {
  fail(`${label}'s thread ended without an answer`);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});

try {
  await import(entry);
} catch (error) {
  fail(`${label}'s entry could not be loaded:${error instanceof Error ? error.message : String(error)}`);
}
