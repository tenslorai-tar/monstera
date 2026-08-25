import { parentPort, workerData } from 'node:worker_threads';

import koffi from 'koffi';

import type { ReaderEnded, ReaderMessage, ReaderWorkerData } from './readerProtocol.js';

/**
 * The engine host's reader thread (ADR-0023 §4 and its 2026-08-25 addition).
 *
 * ## Every wait is over TWO handles, and that is the whole design
 *
 * A thread blocked inside `ReadFile` has to be unwedged with `CancelIoEx` or by
 * closing the handle underneath it, and both are teardown that works on one
 * machine and hangs on another. Waiting over *the operation's completion event*
 * **and** *a stop event main owns* replaces interrupting a syscall with
 * returning from a wait.
 *
 * Measured before this file existed, by mutating the wait to one handle: both
 * cells wedged with the thread alive, at the connect wait and at the read wait,
 * against 10ms and 7ms with two. The second handle is not defensive; it is the
 * difference between a transport that stops and one that must be killed.
 *
 * ## There are TWO waits, and a design stoppable only in the second is wrong
 *
 * A server instance cannot be read before a client connects — `ReadFile` answers
 * `ERROR_PIPE_LISTENING`. So a reader's life is *wait for a client, then wait
 * for bytes*, and the first wait is where a `terminate()` most often lands: a
 * host that never connects is exactly the failure Decision 8 kills for.
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by path through `new Worker(…)`, never imported. It runs in **Node
 * mode** — `process.versions.electron` is set inside Electron and Electron's
 * APIs are absent — which is why it lives in this package and not beside the
 * factory that spawns it (ADR-0024).
 *
 * ## No `parentPort` listener, deliberately
 *
 * Nothing is sent to this thread. A listener would be an active handle in its
 * event loop and a reader that registers one outlives its Win32 work — measured.
 * And it could not be delivered anyway while the thread is inside its wait,
 * which is where it spends its life.
 */

/**
 * The Win32 calls, declared rather than left as koffi's `any`.
 *
 * B7 permits an `any` at a native boundary and does not ask for one: `func()`
 * returns a callable assignable to any signature, so every entry point here is
 * declared with the signature from the C prototype on the adjacent line and the
 * pair reading together is the review mechanism — the same shape as the surfaces
 * under `apps/desktop/`.
 *
 * The four returns that could be `boolean` are `unknown` on purpose, so the
 * compiler REQUIRES a comparison against `true` and a marshalling surprise
 * cannot read as success at a `!x` test.
 */
interface ReaderBindings {
  readonly connectNamedPipe: (pipe: unknown, overlapped: Buffer) => unknown;
  readonly readFile: (
    file: unknown,
    buffer: Buffer,
    toRead: number,
    read: unknown[],
    overlapped: Buffer,
  ) => unknown;
  readonly getOverlappedResult: (
    file: unknown,
    overlapped: Buffer,
    transferred: unknown[],
    wait: boolean,
  ) => unknown;
  readonly waitForMultipleObjects: (
    count: number,
    handles: Buffer,
    all: boolean,
    ms: number,
  ) => number;
  readonly createEvent: (
    attrs: unknown,
    manualReset: boolean,
    initial: boolean,
    name: string | null,
  ) => unknown;
  readonly resetEvent: (event: unknown) => unknown;
  readonly cancelIoEx: (file: unknown, overlapped: Buffer) => unknown;
  readonly closeHandle: (handle: unknown) => unknown;
  readonly lastError: () => number;
}

const kernel = koffi.load('kernel32.dll');
const win32: ReaderBindings = {
  connectNamedPipe: kernel.func('bool ConnectNamedPipe(void *pipe, void *overlapped)'),
  readFile: kernel.func(
    'bool ReadFile(void *file, _Out_ void *buffer, uint32 toRead, _Out_ uint32 *read, void *overlapped)',
  ),
  getOverlappedResult: kernel.func(
    'bool GetOverlappedResult(void *file, void *overlapped, _Out_ uint32 *transferred, bool wait)',
  ),
  waitForMultipleObjects: kernel.func(
    'uint32 WaitForMultipleObjects(uint32 count, void *handles, bool all, uint32 ms)',
  ),
  createEvent: kernel.func(
    'void *CreateEventW(void *attrs, bool manualReset, bool initial, const char16_t *name)',
  ),
  resetEvent: kernel.func('bool ResetEvent(void *event)'),
  cancelIoEx: kernel.func('bool CancelIoEx(void *file, void *overlapped)'),
  closeHandle: kernel.func('bool CloseHandle(void *handle)'),
  lastError: kernel.func('uint32 GetLastError()'),
};

/** The operation was queued, which is what a wait is for. */
const ERROR_IO_PENDING = 997;
/** `ConnectNamedPipe` when a client is already at the other end. */
const ERROR_PIPE_CONNECTED = 535;
/** The peer closed its end. An ending, not a fault. */
const ERROR_BROKEN_PIPE = 109;
/** The read was cancelled by our own teardown. */
const ERROR_OPERATION_ABORTED = 995;
const WAIT_OBJECT_0 = 0;
const WAIT_FAILED = 0xffffffff;
/**
 * `INFINITE`.
 *
 * A timeout here would be a second way to end, and this thread already has two
 * that cover every case: the stop event main signals, and the pipe breaking. A
 * budget would turn *the host is quiet* into an ending, and a quiet host is the
 * ordinary state of a transport with nothing to say.
 */
const INFINITE = 0xffffffff;

const POINTER = koffi.sizeof('void *');

const port = parentPort;
/** @returns whether the message could be sent at all. */
const say = (message: ReaderMessage): void => {
  port?.postMessage(message);
};

const data = workerData as ReaderWorkerData;

/**
 * Ends once and says why.
 *
 * The transport above decides *who* caused an ending from which of its own calls
 * it was in. This says only that one happened, which is the fact this thread is
 * in a position to know.
 */
let ended = false;
const finish = (detail: string): void => {
  if (ended) return;
  ended = true;
  const message: ReaderEnded = { kind: 'ended', detail };
  say(message);
};

const pipe = koffi.as(BigInt(data.pipeAddress), 'void *');
const stop = koffi.as(BigInt(data.stopAddress), 'void *');

// MANUAL RESET on the operation's event. An auto-reset event consumed by the
// wait leaves nothing for the following `GetOverlappedResult` to see, and this
// one is reused across every read, so it is reset by hand between them.
const done: unknown = win32.createEvent(null, true, false, null);

// OVERLAPPED IS FOUR POINTER-SIZED FIELDS AND `hEvent` IS THE FOURTH, at offset
// 3 — `Internal`, `InternalHigh`, the `Offset`/`Pointer` union, then `hEvent`.
// Written at offset 4 first, in the probe this descends from: `hEvent` was then
// NULL, the kernel signalled the FILE HANDLE instead, and the cell passed for
// several runs anyway because the client happened to connect before
// `ConnectNamedPipe` was issued. A setup arriving by race.
const overlapped = Buffer.alloc(POINTER * 4);
koffi.encode(overlapped, POINTER * 3, 'void *', done);

// Two contiguous pointers: index 0 is the operation completing, index 1 is main
// asking this thread to stop.
const handles = Buffer.alloc(POINTER * 2);
koffi.encode(handles, 0, 'void *', done);
koffi.encode(handles, POINTER, 'void *', stop);

/**
 * Which handle woke the wait.
 *
 * A discriminated union rather than `'operation' | 'stop' | string`, which was
 * the first spelling: the `string` swallows both literals, so every comparison
 * against them typechecks and none of them narrows. The lint rule that named it
 * — `no-redundant-type-constituents` — was reporting a real hole rather than a
 * style, because `woke === 'operation'` in that shape is a comparison the
 * compiler cannot check.
 */
type Woken = { readonly kind: 'operation' } | { readonly kind: 'stop' } | { readonly kind: 'failed'; readonly detail: string };

function waitBoth(): Woken {
  const woke = win32.waitForMultipleObjects(2, handles, false, INFINITE);
  if (woke === WAIT_OBJECT_0) return { kind: 'operation' };
  if (woke === WAIT_OBJECT_0 + 1) return { kind: 'stop' };
  if (woke === WAIT_FAILED) {
    return {
      kind: 'failed',
      detail: `WaitForMultipleObjects failed, GetLastError ${String(win32.lastError())}`,
    };
  }
  return { kind: 'failed', detail: `WaitForMultipleObjects returned ${String(woke)}` };
}

/** Stops the outstanding operation on the way out. Safe when there is none. */
function abandonOperation(): void {
  win32.cancelIoEx(pipe, overlapped);
}

function run(): void {
  // WAIT ONE: for a client. A reader that cannot be stopped here cannot be
  // stopped in the case Decision 8 exists for — a host that never connects.
  const connected = win32.connectNamedPipe(pipe, overlapped);
  if (connected !== true) {
    const why = win32.lastError();
    if (why === ERROR_PIPE_CONNECTED) {
      // Already there. Nothing was queued, so nothing is waited on.
    } else if (why !== ERROR_IO_PENDING) {
      finish(`ConnectNamedPipe failed, GetLastError ${String(why)}`);
      return;
    } else {
      const woke = waitBoth();
      if (woke.kind === 'stop') {
        abandonOperation();
        finish('stopped while waiting for the host to connect');
        return;
      }
      if (woke.kind === 'failed') {
        abandonOperation();
        finish(woke.detail);
        return;
      }
    }
  }

  // WAIT TWO, repeatedly: for bytes, where a running transport spends its life.
  const buffer = Buffer.alloc(data.readBytes);
  for (;;) {
    win32.resetEvent(done);
    const read: unknown[] = [0];
    const ok = win32.readFile(pipe, buffer, buffer.length, read, overlapped);
    if (ok !== true) {
      const why = win32.lastError();
      if (why === ERROR_BROKEN_PIPE) {
        finish('the host closed its end of the pipe');
        return;
      }
      if (why !== ERROR_IO_PENDING) {
        finish(`ReadFile failed, GetLastError ${String(why)}`);
        return;
      }
      const woke = waitBoth();
      if (woke.kind === 'stop') {
        abandonOperation();
        finish('stopped while waiting for bytes');
        return;
      }
      if (woke.kind === 'failed') {
        abandonOperation();
        finish(woke.detail);
        return;
      }
    }

    const transferred: unknown[] = [0];
    if (win32.getOverlappedResult(pipe, overlapped, transferred, false) !== true) {
      const why = win32.lastError();
      if (why === ERROR_BROKEN_PIPE) {
        finish('the host closed its end of the pipe');
        return;
      }
      if (why === ERROR_OPERATION_ABORTED) {
        finish('the read was cancelled');
        return;
      }
      finish(`GetOverlappedResult failed, GetLastError ${String(why)}`);
      return;
    }

    const count = Number(transferred[0]);
    if (count === 0) {
      // A zero-byte read is not an ending on a byte-mode pipe; it is a read that
      // returned nothing. Looping is right, and treating it as EOF would end a
      // live transport on an empty completion.
      continue;
    }
    // A RIGHT-SIZED COPY, never a view — and the reason is the CLONE SIZE, not
    // aliasing.
    //
    // `postMessage` structured-clones synchronously, so a view into the reused
    // `buffer` would not see the next read's bytes; the aliasing hazard this
    // looks like is not the one that bites, measured by making it a view and
    // finding every case still green.
    //
    // What bites is that cloning a TypedArray clones its ENTIRE underlying
    // `ArrayBuffer`. Measured 2026-08-25: a 512-byte view into a 64KB buffer
    // arrives with `byteLength` 512 and `buffer.byteLength` **65536**, while
    // `Uint8Array.from` arrives with both at 512. So posting a view copies the
    // whole read buffer across the thread boundary on every chunk, whatever the
    // read actually returned — a 128× amplification at those sizes, in the
    // process that carries ARCHITECTURE §9.17's budget.
    say({ kind: 'chunk', bytes: Uint8Array.from(buffer.subarray(0, count)) });
  }
}

try {
  run();
} catch (error) {
  // ANY failure becomes a message, never a silent thread. An uncaught throw
  // reaches the parent as an `error` event with a stack, which is a different
  // shape from an ending and would have to be handled twice.
  finish(`the reader threw: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  win32.closeHandle(done);
}
