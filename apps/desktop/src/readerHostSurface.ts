import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { ReaderMessage, ReaderWorkerData } from '@monstera/nodemode';

import type { ReaderHostSurface, ReaderWorkerHandle } from './engineReaderChannel.js';
import { createWin32ReaderControl } from './win32PipeSurface.js';

/**
 * The Win32 and worker calls `engineReaderChannel.ts` declares.
 *
 * ## Why this is its own module
 *
 * It composes two things that are not the same boundary: the Win32 event
 * operations, which belong to `win32PipeSurface.ts` because they are the same
 * native boundary as the pipe, and starting a `worker_threads` Worker, which is
 * Node rather than Win32 and has no business inside a koffi adapter. Neither
 * belongs to the ordering, so both arrive through here.
 *
 * ## The reader is resolved THROUGH THE PACKAGE
 *
 * `@monstera/nodemode` names its entry in `exports`, and the reader sits beside
 * it in that package's `dist`. Walking relative directories out of this file's
 * own build output would encode the distance between two packages — a number
 * that is correct until either of them moves, and this one already moved once
 * when ADR-0024 made execution mode a placement axis.
 *
 * `createRequire` rather than `__dirname`: this package is `"type": "module"`
 * and the build emits ESM. Written the other way in a harness first, and it
 * rejected with exactly that message.
 *
 * ## Nothing here decides anything
 *
 * Every ordering question — the event before the worker, one ending, what
 * `stop` may and may not do — is in `engineReaderChannel.ts` and is exercised
 * without any of this. What is here is the part a unit test cannot reach, kept
 * as small as it can be for that reason.
 */

/** Where the reader's entry point sits, resolved through the package. */
export function readerEntryPath(): string {
  const entry = createRequire(import.meta.url).resolve('@monstera/nodemode');
  return join(dirname(entry), 'readerWorker.js');
}

/**
 * @param entryPath The reader's built entry point. Defaults to
 *   {@link readerEntryPath}; taken as a parameter so a probe can drive a
 *   deliberately absent one and see the refusal rather than an exception.
 */
export function createReaderHostSurface(entryPath: string = readerEntryPath()): ReaderHostSurface {
  const control = createWin32ReaderControl();

  return {
    createStopEvent: control.createStopEvent,
    signal: control.signal,
    closeEvent: control.closeEvent,
    addressOf: control.addressOf,
    lastError: control.lastError,

    startWorker: (data: ReaderWorkerData): ReaderWorkerHandle | null => {
      let worker: Worker;
      try {
        worker = new Worker(entryPath, { workerData: data });
      } catch {
        // A REFUSAL, not a throw. The ordering above treats `null` as *the
        // thread could not be started* and closes the stop event on its way
        // out; an exception escaping here would skip that and leave a handle
        // behind on the one path nobody exercises.
        return null;
      }

      return {
        onMessage: (sink: (message: ReaderMessage) => void): void => {
          worker.on('message', (message: ReaderMessage) => {
            sink(message);
          });
        },
        onError: (sink: (error: Error) => void): void => {
          worker.on('error', (error: Error) => {
            sink(error);
          });
        },
        onExit: (sink: (code: number) => void): void => {
          worker.on('exit', (code: number) => {
            sink(code);
          });
        },
        // `void` on purpose: `terminate()` answers with a promise nobody here
        // waits for, because this is the backstop path — the thread is already
        // being given up on, and awaiting it would put a wait into the one call
        // whose reason for existing is that a wait did not work.
        terminate: (): void => {
          void worker.terminate();
        },
      };
    },
  };
}
