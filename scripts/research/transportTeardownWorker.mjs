// @ts-check
/**
 * The reader thread whose termination is the thing under measurement.
 *
 * Every wait here is over TWO handles — the pending operation's completion event
 * and a stop event main owns — and returns on whichever fires. That is the whole
 * design being tested: a thread blocked inside a syscall has to be unwedged with
 * `CancelIoEx` or by closing the handle underneath it, and both are teardown
 * that works on one machine and hangs on another. Waiting over
 * completion-plus-stop replaces interrupting a syscall with returning from a
 * wait.
 *
 * ## THERE ARE TWO WAITS, and the first version of this file had one
 *
 * It issued `ReadFile` immediately and got `GetLastError 536` —
 * `ERROR_PIPE_LISTENING`. A server instance cannot be read before a client
 * connects, so a reader's life is: wait for a client, then wait for bytes. The
 * first wait is the one a `terminate()` most often lands in — a host that never
 * connects is exactly the failure Decision 8 kills for — so a design stoppable
 * only in the second would be stoppable in the case that does not matter.
 *
 * ## Handles arrive as ADDRESSES, and whether that works is part of the reading
 *
 * Worker threads share the process handle table, so a handle created in main is
 * valid here — if its value can cross `postMessage`, which carries
 * structured-cloneable data and not koffi pointers. The address goes over as a
 * string and comes back through `koffi.as`. Had that failed, the shipped adapter
 * would have to create the pipe inside the worker, which moves where
 * `createHostPipe` is called.
 *
 * Usage: not directly. `transportTeardown.mjs` starts it.
 */

import { parentPort, workerData } from 'node:worker_threads';

import koffi from 'koffi';

const kernel = koffi.load('kernel32.dll');
const ConnectNamedPipe = kernel.func('bool ConnectNamedPipe(void *pipe, void *overlapped)');
const ReadFile = kernel.func(
  'bool ReadFile(void *file, _Out_ void *buffer, uint32 toRead, _Out_ uint32 *read, void *overlapped)',
);
const WaitForMultipleObjects = kernel.func(
  'uint32 WaitForMultipleObjects(uint32 count, void *handles, bool all, uint32 ms)',
);
const CreateEventW = kernel.func(
  'void *CreateEventW(void *attrs, bool manualReset, bool initial, const char16_t *name)',
);
const ResetEvent = kernel.func('bool ResetEvent(void *event)');
const CancelIoEx = kernel.func('bool CancelIoEx(void *file, void *overlapped)');
const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
const GetLastError = kernel.func('uint32 GetLastError()');

/** The operation has not completed yet, which is what a wait is for. */
const ERROR_IO_PENDING = 997;
/** `ConnectNamedPipe` when a client is already at the other end. */
const ERROR_PIPE_CONNECTED = 535;
const WAIT_OBJECT_0 = 0;
const WAIT_TIMEOUT = 258;
/** How long a wait may last before this run is a failure rather than a reading. */
const WAIT_BUDGET_MS = 15000;

const POINTER = koffi.sizeof('void *');

/** @param {Record<string, unknown>} message */
const say = (message) => parentPort?.postMessage(message);

try {
  const { pipeAddress, stopAddress } = workerData;

  // The address back into a pointer. koffi takes an integer for a `void *`,
  // which is the step this file confirms as much as the waits are.
  const pipe = koffi.as(BigInt(pipeAddress), 'void *');
  const stop = koffi.as(BigInt(stopAddress), 'void *');

  // MANUAL RESET on the operation's event: an auto-reset event consumed by the
  // wait leaves nothing for a later `GetOverlappedResult` to see, and it is
  // reused across the two waits, so it is reset by hand between them.
  const done = CreateEventW(null, true, false, null);

  // OVERLAPPED is five pointer-sized fields and only `hEvent` is set. Built here
  // rather than passed in: it must outlive the call, and a buffer main owns is
  // one two threads then reference.
  const overlapped = Buffer.alloc(POINTER * 5);
  koffi.encode(overlapped, POINTER * 4, 'void *', done);

  // Two contiguous pointers: index 0 is the operation completing, index 1 is
  // main asking this thread to stop.
  const handles = Buffer.alloc(POINTER * 2);
  koffi.encode(handles, 0, 'void *', done);
  koffi.encode(handles, POINTER, 'void *', stop);

  /**
   * MUTATED, 2026-08-25, and the mutation IS the rejected design: with the count
   * at 1 — waiting on the operation alone, which is what blocking in `ReadFile`
   * amounts to — both cells wedge. The budget expires with the thread alive and
   * the exit code is `null`, at the connect wait and at the read wait:
   *
   *   waiting for a client   exited 2010ms after the signal, code null
   *   waiting for bytes      exited 2015ms after the signal, code null
   *
   * Against 10ms and 7ms with the count at 2. So the second handle is not
   * defensive; it is the whole difference between a transport that stops and one
   * that has to be unwedged from outside.
   *
   * @param {string} stage @returns {number}
   */
  const waitBoth = (stage) => {
    say({ outcome: 'waiting', stage, detail: `the ${stage} is pending and the wait is entered` });
    return WaitForMultipleObjects(2, handles, false, WAIT_BUDGET_MS);
  };

  /** @param {number} woke @param {string} stage @returns {boolean} true when the stop fired */
  const settle = (woke, stage) => {
    if (woke === WAIT_OBJECT_0 + 1) {
      // THE PROPERTY. Returned from a wait rather than being interrupted inside
      // a syscall, so the cleanup runs on this thread's own terms.
      CancelIoEx(pipe, overlapped);
      say({ outcome: 'stopped', stage, detail: `the ${stage} wait returned on the stop event` });
      return true;
    }
    if (woke === WAIT_TIMEOUT) {
      say({
        outcome: 'error',
        stage,
        detail: `neither handle fired within ${String(WAIT_BUDGET_MS)}ms — the stop never reached this thread`,
      });
      return true;
    }
    if (woke !== WAIT_OBJECT_0) {
      say({
        outcome: 'error',
        stage,
        detail: `WaitForMultipleObjects returned ${String(woke)}, GetLastError ${String(GetLastError())}`,
      });
      return true;
    }
    return false;
  };

  // WAIT ONE: for a client. A reader that cannot be stopped here is a reader
  // that cannot be stopped in the case Decision 8 exists for — a host that
  // never connects.
  let connected = ConnectNamedPipe(pipe, overlapped);
  let why = GetLastError();
  if (!connected && why === ERROR_PIPE_CONNECTED) connected = true;
  else if (!connected && why !== ERROR_IO_PENDING) {
    say({ outcome: 'error', stage: 'connect', detail: `ConnectNamedPipe: GetLastError ${String(why)}` });
  } else if (!connected) {
    if (!settle(waitBoth('connect'), 'connect')) connected = true;
    else connected = false;
  }

  if (connected) {
    // WAIT TWO: for bytes, where a running transport spends its life.
    ResetEvent(done);
    const buffer = Buffer.alloc(4096);
    const read = [0];
    const started = ReadFile(pipe, buffer, buffer.length, read, overlapped);
    why = GetLastError();
    if (!started && why !== ERROR_IO_PENDING) {
      say({ outcome: 'error', stage: 'read', detail: `ReadFile: GetLastError ${String(why)}` });
    } else if (!settle(waitBoth('read'), 'read')) {
      say({ outcome: 'read', stage: 'read', detail: 'the wait returned on bytes arriving' });
    }
  }

  CloseHandle(done);
} catch (error) {
  // A throw is not a refusal and not a clean stop. Reported as itself so a
  // broken binding cannot read as a teardown that worked.
  say({ outcome: 'error', stage: 'binding', detail: error instanceof Error ? error.message : String(error) });
}
