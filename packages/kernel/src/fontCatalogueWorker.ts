import { type MessagePort, workerData } from 'node:worker_threads';

import { toStructuredError } from '@monstera/shared';

import type { CatalogueAnswer, CatalogueWorkerData } from './fontCatalogueApart.js';

/**
 * The thread a host reads its font catalogue in ({@link readCatalogueApart}).
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by path through `new Worker(…)`, never imported. It runs in the host's own process, in Node mode, and ends
 * when the catalogue has been posted: the HarfBuzz instance it loads, and every byte that instance's memory grew to,
 * end with it.
 *
 * ## It answers on every path, because the reader is blocked until it does
 *
 * The host waits in `Atomics.wait` and cannot run an `error` or `exit` listener while it waits. So the signal is
 * raised in this thread's own `exit`, which runs after an answer, after a thrown read, and after a module that failed
 * to load; the catalogue's module is imported after that listener exists, so a failure to load it is answered too.
 */

const { folders, signal, port } = workerData as CatalogueWorkerData & { readonly port: MessagePort };

let answered = false;
function answer(message: CatalogueAnswer): void {
  port.postMessage(message);
  answered = true;
}

process.on('exit', () => {
  if (!answered) answer({ kind: 'failed', error: { name: 'Error', message: 'the font catalogue thread ended without an answer' } });
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});

try {
  const { readCatalogue } = await import('./fontCatalogue.js');
  answer({ kind: 'read', catalogue: readCatalogue(folders) });
} catch (error) {
  answer({ kind: 'failed', error: toStructuredError(error) });
}
