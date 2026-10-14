import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MessageChannel, type MessagePort, type Transferable, Worker, receiveMessageOnPort } from 'node:worker_threads';

import type { StructuredError } from '@monstera/shared';

/**
 * Work done in a thread that ends when it has answered, so what the work cost is not kept by the host that asked
 * ([ADR-0239](../../../docs/DECISIONS/0239-a-fonts-whole-file-is-read-in-a-thread-that-ends.md)).
 *
 * ## Why apart
 *
 * harfbuzzjs (1.6.2) frees its WebAssembly memory only from a `FinalizationRegistry`, its `referenceTable` keeps a
 * font's whole blob, and WebAssembly memory never shrinks. A host that read a font's whole file kept what reading it
 * cost for its whole life: 20 edits setting words in an 18.6 MB face grew one by 496 MB (measured 2026-10-14). A thread
 * is exactly the lifetime the work wants: its HarfBuzz instance is its own, and its end releases all of it, whatever
 * the wrapper kept. What comes back is plain data.
 *
 * THE ONE WAY a host does this (B3a): the catalogue's read, an edit's face program and a composition all take it.
 *
 * ## One declaration per work, taken by both sides
 *
 * An {@link ApartWork} names the entry and what crosses each way. The asker passes it to {@link runApartSync} or
 * {@link runApart}, and the entry passes the same value to `serveApart` (`apartThread.ts`), so a thread answering a
 * type its asker does not expect is a compile error rather than a message read through a cast.
 *
 * ## The thread's side is `apartThread.ts`
 *
 * It answers on every path, because a synchronous asker is blocked until it does: the signal is raised in the thread's
 * own `exit`, after an answer, a throw, or a module that failed to load.
 */

/** A work done apart: its entry beside the module that declares it, what it is in a failure's message, and its types. */
export interface ApartWork<I, O> {
  readonly entry: URL;
  readonly label: string;
  /** Never set: carries the input and output types from the declaration to both sides. */
  readonly types?: (input: I) => O;
}

/** What a thread is started with. */
export interface ApartWorkerData {
  readonly input: unknown;
  /** Raised to 1 by the thread when its answer is on the port. */
  readonly signal: Int32Array;
}

/** The thread's one message. */
export type ApartAnswer<O> = { readonly kind: 'done'; readonly output: O } | { readonly kind: 'failed'; readonly error: StructuredError };

/** A thread at `entry`, its port and its signal; refused here where the entry is not beside its asker. */
function start(
  work: Pick<ApartWork<never, unknown>, 'entry' | 'label'>,
  input: unknown,
  transfer: readonly Transferable[],
): { worker: Worker; port: MessagePort; signal: Int32Array } {
  // A MISSING ENTRY IS REFUSED HERE: the thread would fail to load it before its `exit` listener existed, and nothing
  // would raise the signal a synchronous asker waits on.
  if (!existsSync(work.entry)) throw new Error(`${work.label}'s thread entry is not beside its asker: ${fileURLToPath(work.entry)}`);
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(work.entry, {
    workerData: { input, signal, port: port2 },
    transferList: [port2, ...transfer],
  });
  return { worker, port: port1, signal };
}

/** The answer, or the thread's failure thrown with its own message. */
function outputOf<O>(answer: ApartAnswer<O>, label: string): O {
  if (answer.kind === 'failed') throw new Error(`${label} failed in its thread: ${answer.error.message}`, { cause: answer.error });
  return answer.output;
}

/**
 * `work` done on `input` in its thread, WAITED FOR SYNCHRONOUSLY: the asker blocks in `Atomics.wait` and takes the
 * answer with `receiveMessageOnPort`, which needs no turn of the event loop. For callers inside synchronous code.
 *
 * @param started given the thread as it starts, for a proof that must see it end
 * @param transfer buffers in `input` moved to the thread rather than copied; the caller loses them
 */
export function runApartSync<I, O>(
  work: ApartWork<I, O>,
  input: I,
  started?: (thread: Worker) => void,
  transfer: readonly Transferable[] = [],
): O {
  const { worker, port, signal } = start(work, input, transfer);
  started?.(worker);
  try {
    Atomics.wait(signal, 0, 0);
    const received = receiveMessageOnPort(port);
    if (received === undefined) throw new Error(`${work.label}'s thread raised its signal with nothing on its port`);
    return outputOf(received.message as ApartAnswer<O>, work.label);
  } finally {
    port.close();
    // ENDED, not left to wind down: its memory is the point.
    void worker.terminate();
  }
}

/** `work` done on `input` in its thread and awaited: for asynchronous callers, which keep their event loop. */
export async function runApart<I, O>(work: ApartWork<I, O>, input: I, transfer: readonly Transferable[] = []): Promise<O> {
  const { worker, port } = start(work, input, transfer);
  try {
    const answer = await new Promise<ApartAnswer<O>>((resolve) => {
      port.once('message', (message: ApartAnswer<O>) => {
        resolve(message);
      });
      // A THREAD THAT DIED BEFORE ITS ANSWER answers nothing on the port; its exit says so.
      worker.once('exit', () => {
        resolve({ kind: 'failed', error: { name: 'Error', message: `${work.label}'s thread ended without an answer` } });
      });
    });
    return outputOf(answer, work.label);
  } finally {
    port.close();
    void worker.terminate();
  }
}
