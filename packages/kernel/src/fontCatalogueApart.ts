import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';

import type { StructuredError } from '@monstera/shared';

import type { Catalogue, FontFolder } from './fontCatalogue.js';

/**
 * Reads the font catalogue in a thread that ends when it has answered, so what reading it costs is not kept by the
 * host that asked (the owner's Part 7 A, measured 2026-10-13).
 *
 * ## Why apart
 *
 * `readFace` reads each face through harfbuzzjs (1.6.2, and 1.6.3 is the same), whose objects free their WebAssembly
 * memory only from a `FinalizationRegistry`, and two of whose calls never free at all: `referenceTable` keeps a
 * reference to the font's blob, so the whole file stays, and `collectUnicodes` leaves its array behind. A catalogue is
 * read in one synchronous loop, in which no finaliser can run, and WebAssembly memory never shrinks. So a host kept
 * about 1.6 times the size of every font it read, for its whole life: 116 MB of fonts left 180 MB after a forced
 * collection, and a second read added 130 MB more (`node --expose-gc`, this container, 2026-10-13). A Windows machine
 * with Office's fonts is what the owner's 960 MB compose host was.
 *
 * The leaks are in the wrapper, outside this repository, and a catalogue is a bulk read whose working memory is
 * wanted only until it ends. A thread is exactly that lifetime: its HarfBuzz instance is its own, and the thread's end
 * releases all of it, whatever the wrapper kept. What comes back is the catalogue's plain data.
 *
 * ## Synchronous, because every caller is
 *
 * `editFaces()` and the compose host's `faces()` are read inside synchronous code. The host blocks in `Atomics.wait`
 * while the thread reads, as it blocked on the in-process read before, and takes the answer with
 * `receiveMessageOnPort`, which needs no turn of the event loop.
 */

/** What the thread is started with. */
export interface CatalogueWorkerData {
  readonly folders: readonly FontFolder[];
  /** Raised to 1 by the thread when its answer is on the port. */
  readonly signal: Int32Array;
}

/** The thread's one message. */
export type CatalogueAnswer =
  | { readonly kind: 'read'; readonly catalogue: Catalogue }
  | { readonly kind: 'failed'; readonly error: StructuredError };

/**
 * `readCatalogue(folders)`, read in a thread that ends after it.
 *
 * @param started given the thread as it starts, for a proof that must see it end: the asking isolate's own memory
 *   cannot show what a thread that stayed alive still holds
 * @throws where the thread could not read: the message is the thread's own
 */
export function readCatalogueApart(folders: readonly FontFolder[], started?: (thread: Worker) => void): Catalogue {
  const entry = new URL('./fontCatalogueWorker.js', import.meta.url);
  // A MISSING ENTRY IS REFUSED HERE: the thread would fail to load it before its `exit` listener existed, and nothing
  // would raise the signal this thread is about to wait on.
  if (!existsSync(entry)) throw new Error(`the font catalogue thread's entry is not beside its reader: ${fileURLToPath(entry)}`);
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(entry, {
    workerData: { folders, signal, port: port2 },
    transferList: [port2],
  });
  started?.(worker);
  try {
    Atomics.wait(signal, 0, 0);
    const received = receiveMessageOnPort(port1);
    if (received === undefined) throw new Error('the font catalogue thread raised its signal with nothing on its port');
    const answer = received.message as CatalogueAnswer;
    if (answer.kind === 'failed') {
      throw new Error(`the font catalogue thread could not read: ${answer.error.message}`, { cause: answer.error });
    }
    return answer.catalogue;
  } finally {
    port1.close();
    // ENDED, not left to wind down: its memory is the point. `terminate` fulfils with the exit code once the thread has
    // stopped, and nothing here needs to wait for that.
    void worker.terminate();
  }
}
