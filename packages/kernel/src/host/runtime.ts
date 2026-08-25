import {
  type ChannelMap,
  FrameDecoder,
  type FrameViolation,
  type Handlers,
  type IncidentSink,
  encodeFrame,
  hostRequestSchema,
  wrapHandlers,
} from '@monstera/contract';

/**
 * The engine host's runtime loop: bytes in, dispatch, bytes out (ADR-0023 §4).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is the join between two things that already exist and had nothing between
 * them: `frame.ts`, which turns a byte stream into messages and refuses a
 * hostile one, and `wrapHandler`, which validates a call against its channel
 * declaration. ADR-0023 §4 says the framing sits **beneath** the contract's
 * discipline rather than beside it, and XX-1's correction says to extend that
 * discipline rather than write a second — so this file introduces no validation
 * of its own above the envelope. `params` are checked by the channel's schema,
 * in the same wrapper the renderer path uses.
 *
 * It is **not** a transport. No socket, no pipe, no `net`. The caller hands it
 * chunks and gives it somewhere to write; the factory in `apps/desktop` owns
 * the Win32 pipe, whose DACL names this user AND the container SID — the
 * container's ACE alone refuses the contained host, because an AppContainer's
 * access check is conjunctive (ADR-0023 §4's 2026-08-24 correction).
 *
 * The overlapped reads and writes are also `apps/desktop`'s, because a Win32
 * handle **cannot** be adopted into Node: `node.exe` links its CRT statically,
 * so an fd minted by any DLL an FFI can reach answers `EBADF` in node's own
 * runtime (measured). The chunks this loop receives therefore arrive from the
 * surface rather than from a stream — which is the shape it already had.
 *
 * They are **not one owner**, and the sentence here used to say they were. A
 * reader thread inside `WaitForMultipleObjects` cannot be told anything, so
 * writes cannot travel to it: the worker does the reads and main issues the
 * writes itself (ADR-0023 §4's 2026-08-25 decision). Nothing about this loop
 * changes — it hands frames to `transport.write` either way — which is exactly
 * why the claim could sit here being false. That boundary is not
 * tidiness — a loop that owned a socket could only be tested by opening one,
 * and CLAUDE.md's rule is that a test needing a fake window bridge is evidence
 * the boundary is wrong.
 *
 * It is also **not specific to the engine host**, and takes its frame maximum
 * as a required argument for the reason the codec does: a default is how a
 * number nobody chose becomes the number in force. `ENGINE_HOST_FRAME_MAX_BYTES`
 * is the engine host's answer and belongs at that call site.
 *
 * ## Every protocol violation is terminal, and that is the whole design
 *
 * The peer on the other side of this pipe is hostile by invariant 25's own
 * premise. There is exactly one response to a stream that has stopped obeying
 * the protocol, and it is to stop: **resynchronising means guessing where the
 * next message starts, which is the peer choosing our parse offsets.**
 *
 * So there is no "skip this message and carry on" path, and no error reply for
 * a malformed request. An error reply would be a message we composed in answer
 * to bytes we could not understand — the shape of a parser that recovered when
 * it should have refused. A CHANNEL failure is a different thing entirely: it
 * is declared, typed, and travels as a result.
 *
 * Once terminated, later chunks are dropped and in-flight handlers' answers are
 * never written. A handler that was already running still finishes — this loop
 * cannot cancel someone else's promise, and pretending otherwise would be worse
 * than saying so.
 */

/**
 * Why the connection stopped. Always terminal; there is no resumption.
 *
 * **ONE vocabulary for BOTH ends, and that is forced rather than chosen.**
 * `HostRuntimeTransport.terminate` takes this type, and `client.ts` calls the
 * same method over the same transport — so a separate client vocabulary would
 * be a second type that has to be converted into this one at the only place
 * either is used.
 *
 * Which end can raise which is not symmetric, and the comments say so per code
 * rather than leaving a reader to work it out from where the string appears.
 *
 * ## Not every ending is a violation, and this type could not say so (DDDD-15)
 *
 * The seven codes below all name something an end did **wrong**. A connection
 * also ends two ways in which nobody did anything wrong — the host died, or we
 * shut it down — and until 2026-08-25 there was no code for either, so the only
 * way to settle outstanding calls was to pick a violation that parses.
 *
 * `client.test.ts` picked `frame` for *"the reader thread exited"*, three times,
 * and its cases passed because they assert only that the call rejects. Shipped,
 * that renders as *the engine host connection ended (frame): …* for a process
 * that simply died, sending its reader to the framing code.
 *
 * **The two are separate codes rather than one, because that distinction
 * already exists one layer down and collapsing it here would destroy it at the
 * point the caller reads it.** `TransportEnd.by` exists so that *"a host that
 * crashed and a host we killed produce the same silence on the pipe, and only
 * the first is a defect"* — a single `ended` code would throw that away
 * immediately above the module that computes it.
 *
 * The sentence above about which end *raises* a code stays true of those seven
 * and is false of these two: neither end raises them, because neither end is
 * why. That is why it is qualified here rather than left standing — it is the
 * half-true compound claim, whose live clause vouches for the dead one.
 */
export interface HostTermination {
  readonly code:
    /** Either end: the byte stream violated the framing. */
    | 'frame'
    /** Either end: a frame's bytes were not UTF-8 JSON. */
    | 'not-utf8-json'
    /** The LOOP: the peer sent something that is not a request. */
    | 'malformed-request'
    /** The CLIENT: the host sent something that is not a response. */
    | 'malformed-response'
    /** The LOOP: the peer named a channel that does not exist. */
    | 'unknown-channel'
    /** Either end: an id arrived twice. */
    | 'duplicate-id'
    /**
     * The CLIENT: the host answered an id nobody sent.
     *
     * Terminal rather than ignored, for the reason every other violation here
     * is: a peer inventing correlation ids is a peer we have stopped
     * understanding, and dropping the message is choosing to keep talking to it.
     */
    | 'unknown-correlation'
    /** Either end: more calls outstanding than the limit anybody chose. */
    | 'too-many-in-flight'
    /** The LOOP: a declared result cannot be sent within the frame maximum. */
    | 'unsendable-response'
    /**
     * NEITHER END: the peer went away without a violation.
     *
     * The host process died, or the reader stopped producing bytes. Nothing was
     * done wrong by anyone; there is simply nobody to answer, so every
     * outstanding call has to be settled rather than left pending.
     *
     * A **defect** to report, which is what separates it from `shutdown`: this
     * one is the host disappearing when it was supposed to be there.
     */
    | 'connection-lost'
    /**
     * NEITHER END: we ended it deliberately.
     *
     * Closing the connection is an ordinary lifecycle event, so an outstanding
     * call rejecting because of one is **not** a fault to report — the caller
     * still has to be told, since a promise nobody settles is the failure that
     * costs most.
     */
    | 'shutdown';
  /** Diagnostic text. Shapes, counts and limits — never payload content. */
  readonly detail: string;
}

/** Where the loop writes, and how it gives up. */
export interface HostRuntimeTransport {
  /** Sends one already-framed message. */
  readonly write: (frame: Uint8Array) => void;
  /**
   * Tears the connection down. Called at most once.
   *
   * Separate from `write` so the loop cannot express "explain the violation to
   * the peer and continue" — the shape it must not have.
   */
  readonly terminate: (reason: HostTermination) => void;
}

/** What the caller keeps hold of. */
export interface HostRuntime {
  /** Feeds bytes in, in whatever pieces they arrived. */
  readonly receive: (chunk: Uint8Array) => void;
  /** The violation that stopped this loop, or `null` while it is running. */
  readonly termination: () => HostTermination | null;
  /** How many dispatched calls have not yet answered. */
  readonly inFlight: () => number;
}

export interface HostRuntimeOptions<TMap extends ChannelMap> {
  readonly channels: TMap;
  readonly handlers: Handlers<TMap>;
  readonly transport: HostRuntimeTransport;
  /** Where a handler's thrown diagnostic is recorded. Never crosses the pipe. */
  readonly incidents: IncidentSink;
  /** Required, undefaulted — see the note above. */
  readonly maxFrameBytes: number;
  /**
   * How many calls may be outstanding at once.
   *
   * Required for the same reason: an unbounded number of in-flight requests is
   * a peer deciding how much memory this process holds, and "however many
   * arrive" is not a limit anybody chose. Exceeding it is terminal rather than
   * queued, because queueing moves the same unbounded growth into a list.
   */
  readonly maxInFlight: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * @param options See {@link HostRuntimeOptions}.
 * @returns The loop. Nothing happens until bytes are fed to `receive`.
 */
export function createHostRuntime<TMap extends ChannelMap>(
  options: HostRuntimeOptions<TMap>,
): HostRuntime {
  if (!Number.isInteger(options.maxInFlight) || options.maxInFlight < 1) {
    throw new RangeError(
      `maxInFlight must be a positive integer, received ${String(options.maxInFlight)}. ` +
        'A zero or fractional cap answers every request with a violation, which reads as a ' +
        'hostile peer rather than as a misconfiguration.',
    );
  }

  const frames = new FrameDecoder(options.maxFrameBytes);

  /**
   * A MAP, not the mapped-type object `wrapHandlers` returns.
   *
   * That object's type says every key is present, which is true of the keys the
   * registry declares and says nothing about the string a hostile peer sent.
   * Indexing it with a cast produced a lookup the compiler believed could never
   * be `undefined` — the type asserting away the exact case the next check
   * exists for. A `Map` keyed by `string` types the miss honestly.
   */
  const dispatchTable: ReadonlyMap<string, (params: unknown) => Promise<unknown>> = new Map(
    Object.entries(wrapHandlers(options.channels, options.handlers, options.incidents)),
  );

  const outstanding = new Set<string>();

  /**
   * Held on an object rather than in a `let`, so that reading it after a call
   * is not narrowed away.
   *
   * `handleFrame` can stop the loop, and the caller re-checks between frames in
   * one chunk. With a plain `let` the compiler narrows the flag to `null` after
   * the first guard and calls the second check unreachable — which would have
   * been "fixed" by deleting the check that stops a violated stream from having
   * its remaining frames processed.
   */
  const state: { stopped: HostTermination | null } = { stopped: null };

  /**
   * Read through a call, because narrowing survives one.
   *
   * TypeScript keeps a property's narrowed type across an intervening function
   * call, so `if (state.stopped !== null) return;` at the top of a loop made
   * the same test inside the loop "always false" — and the compiler was wrong,
   * since `handleFrame` can stop it. The lint rule reporting an unnecessary
   * condition was reporting the unsoundness, and deleting the check to satisfy
   * it would have let a violated stream's remaining frames be processed.
   */
  const isStopped = (): boolean => state.stopped !== null;

  const stop = (reason: HostTermination): void => {
    // Guarded rather than trusted: a violation discovered while answering one
    // request must not tear down a connection that a previous violation already
    // tore down, and `terminate` is a caller's function that may close a handle.
    if (state.stopped !== null) return;
    state.stopped = reason;
    options.transport.terminate(reason);
  };

  /**
   * Answers one request. Never throws: a throw here would escape into whatever
   * fed us bytes, which on a socket is an event handler with no caller.
   */
  const dispatch = (id: string, channel: string, params: unknown): void => {
    const handler = dispatchTable.get(channel);
    if (handler === undefined) {
      // The registry is ONE declaration in one package that both ends compile
      // against, so a request naming a channel that does not exist means the
      // peer is not the peer this build expects. There is no version to
      // negotiate and nothing to answer with.
      stop({
        code: 'unknown-channel',
        detail: `Request for "${channel}", which this build declares no channel for.`,
      });
      return;
    }
    if (outstanding.has(id)) {
      stop({
        code: 'duplicate-id',
        detail: `Correlation id "${id}" is already in flight. Two answers for one id is the peer contradicting itself.`,
      });
      return;
    }
    if (outstanding.size >= options.maxInFlight) {
      stop({
        code: 'too-many-in-flight',
        detail: `${String(outstanding.size)} calls are outstanding against a cap of ${String(options.maxInFlight)}.`,
      });
      return;
    }

    outstanding.add(id);
    void handler(params).then(
      (body) => {
        outstanding.delete(id);
        answer(id, body);
      },
      (thrown: unknown) => {
        // `wrapHandler` already turns a handler's throw into a recorded
        // incident and a wire failure, so reaching here means the WRAPPER
        // threw — a defect in this build, not in the peer. It is still not
        // allowed to escape, and it is not allowed to look like a channel
        // failure either, so the connection ends and the reason says whose
        // bug it is.
        outstanding.delete(id);
        stop({
          code: 'unsendable-response',
          detail: `The boundary wrapper for "${channel}" rejected: ${String(thrown)}`,
        });
      },
    );
  };

  const answer = (id: string, body: unknown): void => {
    if (isStopped()) return;
    let framed: Uint8Array;
    try {
      framed = encodeFrame(encoder.encode(JSON.stringify({ id, body })), options.maxFrameBytes);
    } catch (thrown) {
      // OUR answer does not fit OUR limit. Named separately from every peer
      // violation above because the diagnosis is the opposite one: a channel
      // whose declared result can exceed the frame maximum is a contract
      // defect, and reporting it as a protocol violation would send the reader
      // to the wrong side of the pipe.
      stop({
        code: 'unsendable-response',
        detail: `A response could not be framed: ${String(thrown)}`,
      });
      return;
    }
    options.transport.write(framed);
  };

  const handleFrame = (payload: Uint8Array): void => {
    let parsedJson: unknown;
    try {
      // `fatal: true` on the decoder: lone surrogates and invalid sequences are
      // a malformed stream, and replacing them with U+FFFD would hand the
      // schema layer text the peer did not send.
      parsedJson = JSON.parse(decoder.decode(payload));
    } catch (thrown) {
      stop({
        code: 'not-utf8-json',
        detail: `A frame of ${String(payload.byteLength)} bytes was not UTF-8 JSON: ${String(thrown)}`,
      });
      return;
    }

    const request = hostRequestSchema.safeParse(parsedJson);
    if (!request.success) {
      // The schema message names fields, never values — `params` is `unknown`
      // in the schema, so nothing the peer sent as a payload can appear here.
      stop({
        code: 'malformed-request',
        detail: `A frame did not carry a host request: ${request.error.message}`,
      });
      return;
    }

    dispatch(request.data.id, request.data.channel, request.data.params);
  };

  return {
    receive: (chunk: Uint8Array): void => {
      // UNPROVEN AT THIS LAYER, AND SAID SO RATHER THAN LEFT LOOKING COVERED
      // (finding NNN-3). Deleting this line reddens no case, and that is not a
      // missing case: its whole effect is that the decoder does not accumulate
      // a refused peer's bytes, and nothing on this surface can see the
      // decoder. The loop after it already refuses to dispatch, so `written`,
      // `terminations`, `termination` and `inFlight` are identical either way.
      //
      // The property is real and belongs to the TRANSPORT. A pipe that has been
      // terminated should stop being read; this line is what survives a
      // transport that keeps calling anyway, which is why it stays. It becomes
      // measurable the day a real transport exists — memory held against a peer
      // that keeps writing after refusal — and that is the trigger, not a
      // reason to widen this module's surface for a test.
      if (isStopped()) return;
      const pushed = frames.push(chunk);
      if (!pushed.ok) {
        const violation: FrameViolation = pushed.error;
        stop({ code: 'frame', detail: `${violation.code}: ${violation.detail}` });
        return;
      }
      for (const payload of pushed.value) {
        // Re-checked each iteration: one frame in a chunk can terminate the
        // loop, and the frames after it in that same chunk are bytes we already
        // decided not to trust.
        if (isStopped()) return;
        handleFrame(payload);
      }
    },
    termination: () => state.stopped,
    inFlight: () => outstanding.size,
  };
}
