import {
  answerCrossesInFile,
  ENGINE_ANSWER_FILE_MAX_BYTES,
  ENGINE_HOST_FRAME_MAX_BYTES,
  FrameDecoder,
  encodeFrame,
  hostResponseSchema,
} from '@monstera/contract';

import type { DocId } from '@monstera/shared';

import type { HostRuntimeTransport, HostTermination } from './runtime.js';

/**
 * Main's half of the engine host protocol: a framed byte stream turned into the
 * one function `createClient` asks for (ADR-0023 §4).
 *
 * ## What this is and what it is not
 *
 * `runtime.ts` is the loop that runs INSIDE the host: bytes in, dispatch, bytes
 * out. This is its mirror on main's side: a call goes out as a framed request
 * carrying a correlation id, and the answer comes back on the same stream.
 *
 * ## One call on the wire at a time, so an ending has one cause
 *
 * A call is sent only when no other is waiting for its answer; the rest wait here, in the order they were made
 * (ADR-0023's correction of 2026-10-03). When a host ends — a crash, a deadline, a memory kill — the call it was
 * running is then the one call sent and unanswered, known on this side without asking a host that invariant 25 says
 * may be lying, and {@link HostClient.during} names the document that call was made for. With calls overlapping, a
 * handler awaiting a file let another run, so an ending could not be pinned to either and every document was counted.
 * Measured cost, 2026-10-03, on a real host: a light document's slowest page-text call rose from 57–78 ms to 113–133
 * ms while a 64 MiB document's session was made beside it; the medians did not move.
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
 * **A call has a DEADLINE, and it is not a guess at whether the host is gone.** A host that is slow and a host that
 * is gone are different facts, and only the transport can tell them apart — it reports the connection ending, and
 * {@link HostClient.fail} turns that into a rejection for every call still waiting. This used to be the whole
 * story, and it left a third fact out: a host that is ALIVE AND NEVER ANSWERS — a document that makes the engine
 * loop — holds the host's one thread, and every call for every document on it waits until the application quits.
 * Only a duration can end that, so {@link HostClientOptions.deadline} gives each call one, set far past any
 * legitimate call's duration (ADR-0023 §3, corrected 2026-10-03), and a call past it ends the connection with
 * `deadline`: the host is killed and rebuilt, and two deaths poison the document that caused them.
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

/**
 * A connection's ending as main reads it: why it ended, and what it counts against. One named object so a handler
 * cannot take the reason and silently drop the cause — a function ignoring a trailing parameter is assignable to one
 * that passes it (ADR-0069).
 */
export interface HostEnding {
  readonly termination: HostTermination;
  /** The document whose call the host was running ({@link HostClient.during}), or `undefined`. */
  readonly during: DocId | undefined;
  /** The document whose call the host was sent last ({@link HostClient.last}), or `undefined`. */
  readonly last: DocId | undefined;
}

/**
 * One call this side could not send — too large for its route — refused BEFORE anything was written, so it ends that
 * call and nothing else: the connection, its other calls and every session on the host are as they were. The one
 * class both routes throw, the frame and the params file, so a caller has one thing to recognise.
 */
export class RequestTooLarge extends RangeError {
  constructor(
    readonly channel: string,
    detail: string,
  ) {
    super(`a request on "${channel}" was not sent: ${detail}`);
    this.name = 'RequestTooLarge';
  }
}

export interface HostClientOptions {
  /** Where framed requests go and how the connection is given up. */
  readonly transport: HostRuntimeTransport;
  /**
   * How many calls may be outstanding at once: the one on the wire and those waiting their turn, together.
   *
   * Required and undefaulted, for the reason `runtime.ts` gives for its own:
   * "however many arrive" is not a limit anybody chose. Exceeding it rejects the
   * call AND ends the connection, because a wait with no bound moves the same
   * unbounded growth into a list.
   */
  readonly maxInFlight: number;
  /**
   * The document a call being made is for, asked as it is made: `DocumentService.executingDocument`, the lane the
   * caller is running in. `undefined` for a call made outside every lane — a containment probe, a closing document's
   * `engine/close` — which no ending can count against.
   *
   * Required and undefaulted: an ending's cause is read from it, and a default would make every ending causeless.
   */
  readonly owner: () => DocId | undefined;
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
  /**
   * How long each call may go unanswered, and how a timer is started.
   *
   * Required and undefaulted, for `maxInFlight`'s reason: a default here is a duration nobody chose. The figure is
   * asked at the moment each call is sent, because what bounds a legitimate call is the documents open then.
   */
  readonly deadline: HostCallDeadline;
}

/** See {@link HostClientOptions.deadline}. */
export interface HostCallDeadline {
  /** Milliseconds the call being sent may wait for its answer. */
  readonly ms: () => number;
  /** Runs `expire` after `ms` unless the returned cancel is called first. Injected so cases drive the clock. */
  readonly schedule: (expire: () => void, ms: number) => () => void;
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
  /** Whether a channel's params cross in a file — its declaration (ADR-0125's addendum). */
  readonly requested: (channel: string) => boolean;
  /** Writes a call's params into the snapshot directory of the session they name, which the host may only read. */
  readonly put: (params: unknown, name: string, bytes: Uint8Array) => Promise<void>;
  /** Removes them once the call has ended. Called from a `finally`, so it must not throw on absence. */
  readonly drop: (params: unknown, name: string) => Promise<void>;
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
  /**
   * The peer broke the protocol in an answer this client delivered intact: a well-formed `engine/open` whose session
   * handle is one already held (CR-SEC-10). Ends the connection as the client's own violations do, the transport
   * terminated and every outstanding call settled, so the ending is a failure recovery acts on and not the `shutdown`
   * a deliberate close reports.
   *
   * @returns the termination this client stopped with: this violation, or the earlier cause if it had already stopped.
   */
  readonly violated: (detail: string) => HostTermination;
  /** How many calls are waiting for an answer. */
  readonly inFlight: () => number;
  /** Why this client stopped, or `null` while it is running. */
  readonly termination: () => HostTermination | null;
  /**
   * The document whose call the host was running when this connection ended, or `undefined` — while it runs, when the
   * call was made outside every lane, or when no call was on the wire. What a host's ending counts against.
   */
  readonly during: () => DocId | undefined;
  /**
   * The document the last call sent was made for, running or settled, or `undefined`. What a memory kill between
   * calls counts against: a session holds its memory after the call that grew it has ended (ADR-0023's addendum of
   * 2026-10-03).
   */
  readonly last: () => DocId | undefined;
}

/**
 * Why a response did not match the wire, in words this build chose: each issue's zod code and its path's length.
 *
 * NEVER zod's own message (CR-SEC-13). A strict object's refusal names the keys it did not recognise, and a record's
 * path names the peer's keys, so either one carries text the host chose — up to a frame of it — into the termination
 * `main` writes to its diagnostics.
 */
function issuesOf(error: { readonly issues: readonly { readonly code: string; readonly path: readonly PropertyKey[] }[] }): string {
  const named = error.issues.slice(0, 8).map((issue) => `${issue.code} at depth ${String(issue.path.length)}`);
  const more = error.issues.length > named.length ? `, and ${String(error.issues.length - named.length)} more` : '';
  return `the response did not match the host wire: ${named.join(', ')}${more}`;
}

export function createHostClient({
  transport,
  maxInFlight,
  maxFrameBytes = ENGINE_HOST_FRAME_MAX_BYTES,
  correlate,
  fileAnswers,
  deadline,
  owner,
}: HostClientOptions): HostClient {
  const decoder = new FrameDecoder(maxFrameBytes);
  /** The call on the wire, waiting for its answer: one at most, because a call is sent only in its turn. */
  const pending = new Map<
    string,
    {
      resolve: (body: unknown) => void;
      reject: (why: Error) => void;
      /** The params, for a file answer's `take`, which resolves the session's directory from them. */
      params: unknown;
      /** The name this call's answer is written under, when its channel answers in a file. */
      into: string | undefined;
      /** The document this call was made for, read when it was made. */
      owner: DocId | undefined;
    }
  >();
  /**
   * Held on an object rather than in a `let` for the reason `runtime.ts` states
   * about its own stop flag: a plain `let` lets the compiler narrow after one
   * guard and call the next check unreachable, and the check it would delete is
   * the one that stops a call being written into a connection that has ended.
   */
  const state: {
    stopped: HostTermination | null;
    /** The document whose call was on the wire when the connection ended. */
    during: DocId | undefined;
    /** The document the last call sent was made for. */
    last: DocId | undefined;
    /** Whether a call has been sent and has not settled — answered, file taken, or refused. */
    busy: boolean;
  } = { stopped: null, during: undefined, last: undefined, busy: false };
  /** The calls waiting for their turn, oldest first. Each starts its own call when it is called. */
  const waiting: (() => void)[] = [];

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
    const waiting = [...pending.values()];
    // THE CALL THE HOST WAS RUNNING, read before anything settles. One at most, by the turn; were there two, neither
    // could be told from the other, so neither is named.
    state.during = waiting.length === 1 ? waiting[0]?.owner : undefined;
    if (ours) transport.terminate(reason);
    pending.clear();
    // AFTER the map is cleared, so a rejection handler that calls `invoke`
    // synchronously meets a client that has already stopped rather than one
    // still holding its own dead entries.
    for (const call of waiting) call.reject(new HostConnectionLost(reason));
  };

  /**
   * Frames and sends one call — with its params in the frame, or with the params file main already wrote named in
   * their place (ADR-0125's addendum).
   */
  const send = async (
    channel: string,
    params: unknown,
    paramsFile: { readonly session: string; readonly name: string; readonly bytes: number } | undefined,
    made: DocId | undefined,
  ): Promise<unknown> => {
      const stopped = state.stopped;
      if (stopped !== null) throw new HostConnectionLost(stopped);

      const id = correlate();
      if (pending.has(id)) {
        // OUR OWN defect, not the peer's, and it is still terminal: two calls
        // sharing an id means the next answer resolves the wrong promise, and
        // there is no way to tell which. Unreachable while the turn holds one
        // call on the wire; kept, because what it refuses is still true of any
        // client that sends a second before the first has left.
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

      const carried = paramsFile === undefined ? { params } : { paramsFile };
      let frame: Uint8Array;
      try {
        frame = encodeFrame(
          new TextEncoder().encode(
            JSON.stringify(into === undefined ? { id, channel, ...carried } : { id, channel, ...carried, answerInto: into }),
          ),
          maxFrameBytes,
        );
      } catch (cause) {
        // THIS CALL IS REFUSED, AND NOTHING ELSE ENDS (decision D). The request was never written, so the host has
        // seen nothing and every other session on it is as it was; ending the connection sent every document on this
        // host to recovery over one command this side could not send. `hostProtocol.ts` says the frame refuses such a
        // request, and this is where that is true.
        throw new RequestTooLarge(channel, cause instanceof Error ? cause.message : String(cause));
      }

      return await new Promise<unknown>((resolve, reject) => {
        // THE DEADLINE, cancelled by however the call settles — an answer, a refusal, or the connection ending — so a
        // timer never outlives its call and never ends a connection over a call that has already been answered.
        const ms = deadline.ms();
        const cancel = deadline.schedule(() => {
          if (pending.has(id)) {
            stop(
              {
                code: 'deadline',
                detail: `"${channel}" had no answer within ${String(ms)} ms, so the host is treated as wedged`,
              },
              true,
            );
          }
        }, ms);
        // REGISTERED BEFORE THE WRITE. A transport that answered synchronously
        // would otherwise arrive at an empty map and be reported as an unknown
        // correlation — a violation manufactured by the order of two lines.
        pending.set(id, {
          resolve: (body) => {
            cancel();
            resolve(body);
          },
          reject: (why) => {
            cancel();
            reject(why);
          },
          params,
          into,
          owner: made,
        });
        state.last = made;
        transport.write(frame);
      });
  };

  /**
   * Sends a call in its TURN: once every call made before it has settled, so one call at most is on the wire. The
   * bound counts those waiting with the one sent, and is checked as the call is made. The deadline starts in `send`,
   * so it times the call's own run and never its wait behind another.
   */
  const inTurn = (
    channel: string,
    params: unknown,
    paramsFile: { readonly session: string; readonly name: string; readonly bytes: number } | undefined,
    made: DocId | undefined,
  ): Promise<unknown> => {
    const stopped = state.stopped;
    if (stopped !== null) return Promise.reject(new HostConnectionLost(stopped));
    const outstanding = (state.busy ? 1 : 0) + waiting.length;
    if (outstanding >= maxInFlight) {
      const reason: HostTermination = {
        code: 'too-many-in-flight',
        detail: `${String(outstanding)} call(s) outstanding against a limit of ${String(maxInFlight)}`,
      };
      stop(reason, true);
      return Promise.reject(new HostConnectionLost(reason));
    }
    return new Promise<unknown>((resolve, reject) => {
      const start = (): void => {
        state.busy = true;
        // The next call starts once this one has SETTLED, however it settles; its outcome is its own caller's.
        void send(channel, params, paramsFile, made)
          .then(resolve, reject)
          .finally(() => {
            const next = waiting.shift();
            if (next === undefined) state.busy = false;
            else next();
          });
      };
      // SENT NOW when nothing is ahead of it, in this same turn of the event loop, as every call was before the turn
      // existed; otherwise behind the last call waiting.
      if (state.busy) waiting.push(start);
      else start();
    });
  };

  return {
    invoke: async (channel: string, params: unknown): Promise<unknown> => {
      // ASKED NOW, as the call is made, in the caller's own context — the lane it is running in.
      const made = owner();
      if (fileAnswers?.requested(channel) !== true) return inTurn(channel, params, undefined, made);
      // THE PARAMS GO IN A FILE, written before the call and removed when it ends however it ends (ADR-0125's
      // addendum). Above the ceiling this is refused here, before anything is written: the host would refuse it too,
      // and ending the connection over params this side chose to send would be our defect named as a violation.
      const bytes = new TextEncoder().encode(JSON.stringify(params));
      if (bytes.byteLength > ENGINE_ANSWER_FILE_MAX_BYTES) {
        throw new RequestTooLarge(
          channel,
          `its params are ${String(bytes.byteLength)} bytes, above the ${String(ENGINE_ANSWER_FILE_MAX_BYTES)}-byte ceiling`,
        );
      }
      const session = (params as { readonly session?: unknown } | null)?.session;
      if (typeof session !== 'string') throw new TypeError(`"${channel}" takes its params in a file and names no session`);
      const name = fileAnswers.mint();
      await fileAnswers.put(params, name, bytes);
      try {
        return await inTurn(channel, params, { session, name, bytes: bytes.byteLength }, made);
      } finally {
        await fileAnswers.drop(params, name);
      }
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
          stop({ code: 'malformed-response', detail: issuesOf(response.error) }, true);
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
          if (call.into !== undefined && answerCrossesInFile(answered.body)) {
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
            // A CALL WHOSE FILE WAS STILL BEING TAKEN WHEN THIS CLIENT STOPPED IS SETTLED HERE, because nothing else
            // can: it left `pending` when its answer arrived, so `stop` never saw it. Returning without settling held
            // the caller for ever, and a command's caller holds its document's lane, so every later command on that
            // document waited behind it and its recovery never entered.
            const stopped = state.stopped;
            if (stopped !== null) {
              call.reject(new HostConnectionLost(stopped));
              return;
            }
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

    violated: (detail: string): HostTermination => {
      // `ours` true, as for every violation this client raises: the peer is alive and is told to go.
      const reason: HostTermination = { code: 'malformed-response', detail };
      stop(reason, true);
      return state.stopped ?? reason;
    },

    inFlight: (): number => pending.size,
    termination: (): HostTermination | null => state.stopped,
    during: (): DocId | undefined => state.during,
    last: (): DocId | undefined => state.last,
  };
}
