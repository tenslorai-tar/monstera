import {
  ENGINE_HOST_FRAME_MAX_BYTES,
  FrameDecoder,
  encodeFrame,
  hostResponseSchema,
} from '@monstera/contract';

import type { HostRuntimeTransport, HostTermination } from './runtime.js';

/**
 * Main's half of the engine host protocol: a framed byte stream turned into the
 * one function `createClient` asks for (ADR-0023 §4).
 *
 * ## What this is and what it is not
 *
 * `runtime.ts` is the loop that runs INSIDE the host: bytes in, dispatch, bytes
 * out. This is its mirror on main's side: a call goes out as a framed request
 * carrying a correlation id, and the answer comes back on the same stream in
 * whatever order the host finishes.
 *
 * It adds **no validation of its own above the envelope**. `createClient`
 * already parses each answer against `envelopeSchema(channel.result)`, so this
 * layer's only question is *which call is this the answer to* — a second parse
 * here would be a second opinion about what a channel returns (B3a).
 *
 * ## Every protocol violation is terminal, on this side too
 *
 * A response for an id nobody sent, an id answered twice, bytes that are not a
 * response: each of them means the peer has stopped being one we understand, and
 * the only alternative to stopping is guessing which of our own calls it meant.
 * Decision 8 kills the host rather than resuming it, and this is that rule
 * arriving at the correlation layer.
 *
 * **There is no timeout, deliberately.** A host that is slow and a host that is
 * gone are different facts, and only the transport can tell them apart — it
 * reports the connection ending, and {@link HostClient.fail} turns that into a
 * rejection for every call still waiting. A timeout here would invent the
 * distinction from a duration, which is the same guess `runtime.ts` refuses when
 * it declines to time out a handler.
 *
 * ## A dead host rejects; it does not leave promises pending
 *
 * The failure that costs most is the quiet one: the host dies, nothing rejects,
 * and a caller waits for ever holding whatever it was going to do next. Every
 * ending — a violation this side raised, or the transport reporting the peer
 * gone — settles every outstanding call.
 */

/** How a call ends when the connection did rather than the call. */
export class HostConnectionLost extends Error {
  /** @param termination why the connection stopped. */
  constructor(readonly termination: HostTermination) {
    super(`the engine host connection ended (${termination.code}): ${termination.detail}`);
    this.name = 'HostConnectionLost';
  }
}

export interface HostClientOptions {
  /** Where framed requests go and how the connection is given up. */
  readonly transport: HostRuntimeTransport;
  /**
   * How many calls may be outstanding at once.
   *
   * Required and undefaulted, for the reason `runtime.ts` gives for its own:
   * "however many arrive" is not a limit anybody chose. Exceeding it rejects the
   * call AND ends the connection rather than queueing, because queueing moves
   * the same unbounded growth into a list.
   */
  readonly maxInFlight: number;
  /** The frame ceiling. Defaults to the engine host's declared maximum. */
  readonly maxFrameBytes?: number;
  /**
   * The correlation id source.
   *
   * Injected rather than generated here so a test can make it deterministic —
   * and so the one property that matters, that ids are not reused while a call
   * is outstanding, is testable by handing it a source that repeats.
   */
  readonly correlate: () => string;
  /**
   * How a `file`-routed channel's answer is fetched
   * ([ADR-0125](../../../../docs/DECISIONS/0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md)).
   * Absent for a host whose channels all answer in the frame, and then a file answer arriving is the host breaking
   * the contract this build compiled.
   */
  readonly fileAnswers?: ClientFileAnswers;
}

/** See {@link HostClientOptions.fileAnswers}. */
export interface ClientFileAnswers {
  /** Whether a channel's answer arrives in a file — the channel map's own declaration, never a guess by size. */
  readonly routed: (channel: string) => boolean;
  /** A fresh name the host's output-name schema accepts, for this call's answer. */
  readonly mint: () => string;
  /**
   * Reads and removes the named answer in the granted output directory of the session these params name.
   *
   * Refuses — throws — before reading when the file is not exactly `bytes` long: the frame's figure is already
   * bounded by the ceiling, so a file that disagrees with it is a host writing other than it said.
   */
  readonly take: (params: unknown, name: string, bytes: number) => Promise<Uint8Array>;
}

/** Whether an envelope is a success — the one kind a file-routed channel's file carries. */
function succeeded(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { readonly ok?: unknown }).ok === true;
}

export interface HostClient {
  /** The one function `createClient` wraps. */
  readonly invoke: (channel: string, params: unknown) => Promise<unknown>;
  /** Feed bytes from the transport, in whatever pieces they arrived. */
  readonly receive: (chunk: Uint8Array) => void;
  /**
   * The connection ended for a reason this client did not raise — the reader
   * went away, the host died. Settles every outstanding call.
   */
  readonly fail: (termination: HostTermination) => void;
  /** How many calls are waiting for an answer. */
  readonly inFlight: () => number;
  /** Why this client stopped, or `null` while it is running. */
  readonly termination: () => HostTermination | null;
}

export function createHostClient({
  transport,
  maxInFlight,
  maxFrameBytes = ENGINE_HOST_FRAME_MAX_BYTES,
  correlate,
  fileAnswers,
}: HostClientOptions): HostClient {
  const decoder = new FrameDecoder(maxFrameBytes);
  const pending = new Map<
    string,
    {
      resolve: (body: unknown) => void;
      reject: (why: Error) => void;
      /** The params, for a file answer's `take`, which resolves the session's directory from them. */
      params: unknown;
      /** The name this call's answer is written under, when its channel answers in a file. */
      into: string | undefined;
    }
  >();
  /**
   * Held on an object rather than in a `let` for the reason `runtime.ts` states
   * about its own stop flag: a plain `let` lets the compiler narrow after one
   * guard and call the next check unreachable, and the check it would delete is
   * the one that stops a call being written into a connection that has ended.
   */
  const state: { stopped: HostTermination | null } = { stopped: null };

  /**
   * Read through a call, because narrowing survives one — the same idiom, and
   * the same reason, as `runtime.ts`.
   *
   * TypeScript keeps a property's narrowed type across an intervening function
   * call, so the guard at the top of `receive` made the same test inside its
   * frame loop "always false" — and the compiler is wrong, since `stop` can be
   * reached from inside that loop. The lint rule reporting an unnecessary
   * condition was reporting the unsoundness, and deleting the check to satisfy
   * it would let the frames after a violation be processed.
   */
  const isStopped = (): boolean => state.stopped !== null;

  /**
   * Ends the connection once and settles everything waiting.
   *
   * The FIRST cause wins, as it does one layer down: a violation raised here and
   * a transport that then reported the peer gone are one ending, and the later
   * one is the less informative.
   */
  const stop = (reason: HostTermination, ours: boolean): void => {
    if (state.stopped !== null) return;
    state.stopped = reason;
    if (ours) transport.terminate(reason);
    const waiting = [...pending.values()];
    pending.clear();
    // AFTER the map is cleared, so a rejection handler that calls `invoke`
    // synchronously meets a client that has already stopped rather than one
    // still holding its own dead entries.
    for (const call of waiting) call.reject(new HostConnectionLost(reason));
  };

  return {
    invoke: async (channel: string, params: unknown): Promise<unknown> => {
      const stopped = state.stopped;
      if (stopped !== null) throw new HostConnectionLost(stopped);

      if (pending.size >= maxInFlight) {
        const reason: HostTermination = {
          code: 'too-many-in-flight',
          detail: `${String(pending.size)} call(s) outstanding against a limit of ${String(maxInFlight)}`,
        };
        stop(reason, true);
        throw new HostConnectionLost(reason);
      }

      const id = correlate();
      if (pending.has(id)) {
        // OUR OWN defect, not the peer's, and it is still terminal: two calls
        // sharing an id means the next answer resolves the wrong promise, and
        // there is no way to tell which.
        const reason: HostTermination = {
          code: 'duplicate-id',
          detail: `the correlation source produced "${id}" while a call with that id was outstanding`,
        };
        stop(reason, true);
        throw new HostConnectionLost(reason);
      }

      // THE NAME IS MINTED HERE, per call, and never by the host: main joins it to a directory it created, so a host
      // that could name the file would choose what main reads (ADR-0125).
      const into = fileAnswers?.routed(channel) === true ? fileAnswers.mint() : undefined;

      let frame: Uint8Array;
      try {
        frame = encodeFrame(
          new TextEncoder().encode(
            JSON.stringify(into === undefined ? { id, channel, params } : { id, channel, params, answerInto: into }),
          ),
          maxFrameBytes,
        );
      } catch (cause) {
        // A request too large for the frame is OUR defect — the same shape
        // `unsendable-response` names on the other side, and named for us
        // rather than for the peer for the same reason.
        const reason: HostTermination = {
          code: 'unsendable-response',
          detail: `a request on "${channel}" could not be framed: ${cause instanceof Error ? cause.message : String(cause)}`,
        };
        stop(reason, true);
        throw new HostConnectionLost(reason);
      }

      return await new Promise<unknown>((resolve, reject) => {
        // REGISTERED BEFORE THE WRITE. A transport that answered synchronously
        // would otherwise arrive at an empty map and be reported as an unknown
        // correlation — a violation manufactured by the order of two lines.
        pending.set(id, { resolve, reject, params, into });
        transport.write(frame);
      });
    },

    receive: (chunk: Uint8Array): void => {
      if (state.stopped !== null) return;
      const read = decoder.push(chunk);
      if (!read.ok) {
        stop({ code: 'frame', detail: `${read.error.code}: ${read.error.detail}` }, true);
        return;
      }
      for (const payload of read.value) {
        // Re-checked each iteration: one frame in a chunk can end this client,
        // and the frames after it in that same chunk are bytes we already have
        // no way to attribute.
        if (isStopped()) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
        } catch (cause) {
          stop(
            {
              code: 'not-utf8-json',
              detail: `a frame was not UTF-8 JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
            },
            true,
          );
          return;
        }
        const response = hostResponseSchema.safeParse(parsed);
        if (!response.success) {
          stop({ code: 'malformed-response', detail: response.error.message }, true);
          return;
        }
        const call = pending.get(response.data.id);
        if (call === undefined) {
          // Never dropped. See the note at the top: a peer inventing ids is one
          // we have stopped understanding, and continuing is choosing to keep
          // talking to it.
          stop(
            {
              code: 'unknown-correlation',
              detail: `a response arrived for an id no call is waiting on`,
            },
            true,
          );
          return;
        }
        pending.delete(response.data.id);
        const answered = response.data;
        if (!('answerFile' in answered)) {
          // A SUCCESS FOR A FILE-ROUTED CALL arriving in the frame is the host declaring a different route from the
          // one this build compiled — refused, for the reason a file answer to a framed call is below.
          if (call.into !== undefined && succeeded(answered.body)) {
            stop({ code: 'malformed-response', detail: 'a file-routed call was answered with a success in the frame' }, true);
            call.reject(new HostConnectionLost({ code: 'malformed-response', detail: 'answered outside its route' }));
            return;
          }
          call.resolve(answered.body);
          continue;
        }
        const { into } = call;
        if (into === undefined || fileAnswers === undefined) {
          stop({ code: 'malformed-response', detail: 'a file answer arrived for a call that answers in the frame' }, true);
          call.reject(new HostConnectionLost({ code: 'malformed-response', detail: 'answered outside its route' }));
          return;
        }
        const { bytes } = answered.answerFile;
        fileAnswers.take(call.params, into, bytes).then(
          (raw) => {
            if (isStopped()) return;
            let body: unknown;
            try {
              if (raw.byteLength !== bytes) throw new Error(`the file holds ${String(raw.byteLength)} bytes`);
              body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
            } catch (cause) {
              const reason: HostTermination = {
                code: 'malformed-response',
                detail: `a file answer of ${String(bytes)} bytes was not one: ${cause instanceof Error ? cause.message : String(cause)}`,
              };
              stop(reason, true);
              call.reject(new HostConnectionLost(reason));
              return;
            }
            // THE SAME ENVELOPE a frame carries, handed to the same caller — `createClient`'s `acceptAnswer` parses it
            // against the channel's result schema, so a file answer is validated exactly as a framed one (B3a).
            call.resolve(body);
          },
          (cause: unknown) => {
            const reason: HostTermination = {
              code: 'malformed-response',
              detail: `a file answer of ${String(bytes)} bytes could not be taken: ${cause instanceof Error ? cause.message : String(cause)}`,
            };
            stop(reason, true);
            call.reject(new HostConnectionLost(reason));
          },
        );
      }
    },

    fail: (termination: HostTermination): void => {
      // `ours` false: the transport is already gone, and telling it to terminate
      // would be a call made to look symmetrical.
      stop(termination, false);
    },

    inFlight: (): number => pending.size,
    termination: (): HostTermination | null => state.stopped,
  };
}
