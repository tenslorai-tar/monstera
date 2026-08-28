/**
 * What the engine host's reader thread posts back, and what it is started with.
 *
 * Declared once and used by both sides — the worker in this package and the
 * channel factory in `apps/desktop/` — because two spellings of one wire shape
 * is the second opinion B3a is about, and this one crosses a thread boundary
 * where the compiler is the only thing that can notice a drift.
 *
 * ## Nothing travels the other way
 *
 * There is no message TO the reader, and that is a measurement rather than a
 * simplification: a thread inside `WaitForMultipleObjects` cannot run its
 * JavaScript event loop, so a `postMessage` to it is not delivered until the
 * wait returns — which is precisely when it is no longer needed. Main tells the
 * reader one thing, *stop*, and it tells it by signalling a Win32 event the
 * wait is already watching.
 *
 * That is also why this worker registers no `parentPort` listener. One would be
 * an active handle in its event loop, and a reader that registers one outlives
 * its Win32 work — measured, on the probe that first added an acknowledgement.
 */

/** How the reader is started. Handles arrive as addresses; see below. */
export interface ReaderWorkerData {
  /**
   * The pipe instance's `HANDLE`, as a decimal string.
   *
   * Worker threads share the process handle table, so a handle created in main
   * is valid here — but `postMessage` carries structured-cloneable data and a
   * koffi pointer is not that. The address crosses as a string and comes back
   * through `koffi.as`, which was measured before the shipped reader existed:
   * had it failed, the pipe would have to be created inside the worker, which
   * moves where `createHostPipe` is called.
   */
  readonly pipeAddress: string;
  /** The stop event's `HANDLE`, same encoding. Main signals it; this waits on it. */
  readonly stopAddress: string;
  /** How many bytes one read may return. */
  readonly readBytes: number;
}

/** Bytes the reader took off the pipe. */
export interface ReaderChunk {
  readonly kind: 'chunk';
  /** A right-sized copy, never a view into the reader's own buffer. */
  readonly bytes: Uint8Array;
}

/**
 * The reader stopped, whatever the cause.
 *
 * ONE message for every ending, including the one main asked for. The
 * transport's `TransportEnd` is where *who caused it* is decided, and it decides
 * that from which call it was in — not from a field the reader guesses at. A
 * reader that classified its own ending would be a second opinion about a
 * question the layer above already answers.
 */
export interface ReaderEnded {
  readonly kind: 'ended';
  /** Diagnostic text. Shapes and reasons — never payload content. */
  readonly detail: string;
}

/**
 * The host has connected to the pipe instance. Sent **once**, before any chunk.
 *
 * ## Why the reader is what says this, and why anything needs telling
 *
 * `ConnectNamedPipe` is issued here and nowhere else, so this thread is the only
 * place that knows the moment a peer arrives. Nothing used to carry it, and the
 * cost of that was measured (finding YYYY-1): the connection factory returned as
 * soon as the host process existed, main's first frame beat the host's
 * `CreateFile` on the pipe **3 times out of 3**, and `WriteFile` answered
 * `ERROR_PIPE_LISTENING`. A startup ordering problem then arrived at
 * `engineSessions` as a host death, which poisons the document at two in a row
 * under ADR-0023 Decision 9a.
 *
 * The factory now waits for this before it hands out a client, so a host that
 * never connects is a **creation failure with a stage**, where
 * `createContainedHost` already reports one — rather than a live client that
 * fails later and is counted as a crash.
 *
 * ## Sent once, and the layer above enforces that rather than trusting it
 *
 * `run()` reaches its connected state on two paths — the overlapped wait
 * completing, and `ERROR_PIPE_CONNECTED`, which means the peer arrived between
 * the instance being created and the call being made. Both say it, and neither
 * knows what the other did.
 */
export interface ReaderConnected {
  readonly kind: 'connected';
}

export type ReaderMessage = ReaderChunk | ReaderEnded | ReaderConnected;
