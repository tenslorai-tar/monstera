import { ENGINE_ANSWER_FILE_MAX_BYTES, ENGINE_HOST_FRAME_MAX_BYTES, encodeFrame } from '@monstera/contract';
import { asDocId, type DocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type HostCallDeadline, type HostClient, HostConnectionLost, RequestTooLarge, createHostClient } from './client.js';
import type { HostTermination } from './runtime.js';

/**
 * A deadline on a MANUAL clock: every timer the client starts is recorded with its duration, and fires only when a
 * case calls `expire`. A case that never expires one is a case in which no call ever runs out of time.
 */
function manualDeadline(ms = 30_000) {
  const timers: { ms: number; expire: () => void; cancelled: boolean }[] = [];
  const deadline: HostCallDeadline = {
    ms: () => ms,
    schedule: (expire, after) => {
      const timer = { ms: after, expire, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return {
    deadline,
    timers,
    /** Fires every timer still running, as the clock reaching each one would. */
    expire: () => {
      for (const timer of timers) if (!timer.cancelled) timer.expire();
    },
  };
}

/**
 * A recording transport, and a way to answer as the host would.
 *
 * ONE call list, as the modules beside this do, because the properties here are
 * about ORDER — the pending entry registered before the write, the map cleared
 * before the rejections — and per-member spies would let those pass against a
 * client that did them backwards.
 */
function harness(options: { maxInFlight?: number; ids?: string[]; owner?: () => DocId | undefined } = {}) {
  const writes: Uint8Array[] = [];
  const terminations: HostTermination[] = [];
  const ids = options.ids ?? [];
  let next = 0;
  const clock = manualDeadline();

  const client = createHostClient({
    transport: {
      write: (frame) => writes.push(frame),
      terminate: (reason) => terminations.push(reason),
    },
    maxInFlight: options.maxInFlight ?? 4,
    correlate: () => ids[next++] ?? `id-${String(next)}`,
    deadline: clock.deadline,
    owner: options.owner ?? (() => undefined),
  });

  return {
    client,
    writes,
    terminations,
    clock,
    /** What the client asked, decoded. */
    sent: () =>
      writes.map((frame) => JSON.parse(new TextDecoder().decode(frame.subarray(4))) as unknown),
    /** Answers as the host would, in one frame. */
    answer: (body: unknown, id: string) => {
      client.receive(
        encodeFrame(
          new TextEncoder().encode(JSON.stringify({ id, body })),
          ENGINE_HOST_FRAME_MAX_BYTES,
        ),
      );
    },
    /** Sends arbitrary bytes as one frame's payload. */
    sendRaw: (payload: Uint8Array) => {
      client.receive(encodeFrame(payload, ENGINE_HOST_FRAME_MAX_BYTES));
    },
  };
}

describe('createHostClient', () => {
  it('writes one framed request carrying the channel, the params and an id', async () => {
    const h = harness({ ids: ['a'] });

    const call = h.client.invoke('doc:open', { path: 1 });
    expect(h.sent()).toEqual([{ id: 'a', channel: 'doc:open', params: { path: 1 } }]);
    expect(h.client.inFlight()).toBe(1);

    h.answer({ ok: true }, 'a');
    await expect(call).resolves.toEqual({ ok: true });
    expect(h.client.inFlight()).toBe(0);
  });

  /**
   * DECISION D: a request too large for the frame is refused as THAT call. It was never written, so the host has seen
   * nothing, and ending the connection would send every document on it to recovery. The control is the next call on
   * the same connection being written and answered — a client that stopped would refuse it instead.
   */
  it('REFUSES a request too large for the frame as that call alone, and the connection carries the next one', async () => {
    const h = harness({ ids: ['a', 'b'] });

    await expect(h.client.invoke('doc:big', { blob: 'x'.repeat(ENGINE_HOST_FRAME_MAX_BYTES) })).rejects.toBeInstanceOf(
      RequestTooLarge,
    );
    expect(h.terminations).toStrictEqual([]);
    expect(h.writes).toHaveLength(0);

    const next = h.client.invoke('doc:small', { blob: 'y' });
    expect(h.sent()).toStrictEqual([{ id: 'b', channel: 'doc:small', params: { blob: 'y' } }]);
    h.answer({ ok: true }, 'b');
    await expect(next).resolves.toEqual({ ok: true });
  });

  it('sends ONE call at a time: the next is written only once the one on the wire has settled (ADR-0023, 2026-10-03)', async () => {
    const h = harness({ ids: ['a', 'b'] });

    const first = h.client.invoke('one', {});
    const second = h.client.invoke('two', {});
    // THE SEPARATING ASSERTION: the second call is held here, not written. A client that sent both — as this one did
    // until the correction — would leave the host running two calls, and an ending could not be pinned to either.
    expect(h.sent()).toStrictEqual([{ id: 'a', channel: 'one', params: {} }]);
    expect(h.clock.timers).toHaveLength(1);

    h.answer({ which: 'first' }, 'a');
    await expect(first).resolves.toEqual({ which: 'first' });
    // ITS DEADLINE STARTS WHEN IT IS SENT, so the wait behind the first is not counted against it.
    expect(h.sent()).toStrictEqual([
      { id: 'a', channel: 'one', params: {} },
      { id: 'b', channel: 'two', params: {} },
    ]);
    expect(h.clock.timers).toHaveLength(2);
    h.answer({ which: 'second' }, 'b');
    await expect(second).resolves.toEqual({ which: 'second' });
  });

  it('a REFUSED call settles its turn too, and the call behind it is sent', async () => {
    // THE TURN PASSES ON HOWEVER A CALL SETTLES: a turn handed on only by an answer would leave every later call
    // waiting for ever behind one the frame refused.
    const h = harness({ ids: ['a', 'b'] });
    const big = h.client.invoke('doc:big', { blob: 'x'.repeat(ENGINE_HOST_FRAME_MAX_BYTES) });
    const next = h.client.invoke('doc:small', {});
    await expect(big).rejects.toBeInstanceOf(RequestTooLarge);
    await Promise.resolve();
    // `b`: the refused call drew `a` before its frame was found too large.
    expect(h.sent()).toStrictEqual([{ id: 'b', channel: 'doc:small', params: {} }]);
    h.answer({ ok: true }, 'b');
    await expect(next).resolves.toEqual({ ok: true });
  });

  it('ENDS on a response for an id nobody is waiting on', async () => {
    const h = harness({ ids: ['a'] });
    const call = h.client.invoke('one', {});

    h.answer({}, 'never-sent');

    // Not dropped. A peer inventing correlation ids is one we have stopped
    // understanding, and continuing is choosing to keep talking to it.
    expect(h.terminations.map((t) => t.code)).toEqual(['unknown-correlation']);
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
  });

  it('ENDS on the same id answered twice', async () => {
    const h = harness({ ids: ['a'] });
    const call = h.client.invoke('one', {});

    h.answer({ first: true }, 'a');
    h.answer({ second: true }, 'a');

    // The second is an id nobody is waiting on, because the first consumed it.
    // Terminal either way.
    expect(h.terminations).toHaveLength(1);
    await expect(call).resolves.toEqual({ first: true });
  });

  it('ENDS on a frame whose bytes are not a response', async () => {
    const h = harness({ ids: ['a'] });
    const call = h.client.invoke('one', {});

    h.sendRaw(new TextEncoder().encode(JSON.stringify({ id: 'a', body: 1, extra: true })));

    // `.strict()`: an extra field is either a peer we do not understand or a
    // field added on one side only, and both are better refused than ignored.
    expect(h.terminations.map((t) => t.code)).toEqual(['malformed-response']);
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
  });

  it('ENDS on a frame that is not UTF-8 JSON', async () => {
    const h = harness({ ids: ['a'] });
    const call = h.client.invoke('one', {});

    h.sendRaw(Uint8Array.from([0xff, 0xfe, 0xfd]));

    expect(h.terminations.map((t) => t.code)).toEqual(['not-utf8-json']);
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
  });

  it('ENDS rather than queueing when more calls are outstanding than the limit', async () => {
    const h = harness({ maxInFlight: 2, ids: ['a', 'b', 'c'] });

    const first = h.client.invoke('one', {});
    const second = h.client.invoke('two', {});
    const third = h.client.invoke('three', {});

    // THE BOUND COUNTS THE WAITING WITH THE SENT: one on the wire and one waiting are two. A wait with no bound moves
    // the same unbounded growth into a list, which is the rule `runtime.ts` states for its own limit.
    expect(h.terminations.map((t) => t.code)).toEqual(['too-many-in-flight']);
    await expect(third).rejects.toBeInstanceOf(HostConnectionLost);
    await expect(first).rejects.toBeInstanceOf(HostConnectionLost);
    await expect(second).rejects.toBeInstanceOf(HostConnectionLost);
  });

  it('CONTROL: the limit counts what is OUTSTANDING, not how many were called', async () => {
    const h = harness({ maxInFlight: 2, ids: ['a', 'b', 'c'] });

    const first = h.client.invoke('one', {});
    h.answer({}, 'a');
    await first;
    const second = h.client.invoke('two', {});
    const third = h.client.invoke('three', {});

    // A client that counted TOTAL calls ends here, and every assertion in the
    // case above passes against it — because nothing completes there.
    expect(h.terminations).toEqual([]);
    h.answer({}, 'b');
    await expect(second).resolves.toEqual({});
    h.answer({}, 'c');
    await expect(third).resolves.toEqual({});
  });

  it('an id the correlation source REPEATS is never outstanding twice, because one call is on the wire', async () => {
    // The duplicate-id guard in `send` is kept and cannot now be reached: a call is sent only once the one before it
    // has left the wire, so a repeated id names one call. Before the turn, two calls sharing an id resolved the wrong
    // promise; this is that sequence, and each call gets its own answer.
    const h = harness({ ids: ['a', 'a'] });

    const first = h.client.invoke('one', {});
    const second = h.client.invoke('two', {});
    h.answer({ which: 'first' }, 'a');
    await expect(first).resolves.toEqual({ which: 'first' });
    h.answer({ which: 'second' }, 'a');
    await expect(second).resolves.toEqual({ which: 'second' });
    expect(h.terminations).toEqual([]);
  });

  it('REJECTS every waiting call when the transport reports the peer gone', async () => {
    const h = harness({ ids: ['a', 'b'] });
    const first = h.client.invoke('one', {});
    const second = h.client.invoke('two', {});

    h.client.fail({ code: 'connection-lost', detail: 'the reader thread exited' });

    // THE FAILURE THAT COSTS MOST is the quiet one: the host dies, nothing
    // rejects, and a caller waits for ever holding whatever it was going to do
    // next.
    await expect(first).rejects.toBeInstanceOf(HostConnectionLost);
    await expect(second).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.client.inFlight()).toBe(0);
    // NOT terminated back: the transport is already gone, and telling it to
    // would be a call made to look symmetrical.
    expect(h.terminations).toEqual([]);
  });

  it('rejects a call made after the connection ended, without writing', async () => {
    const h = harness({ ids: ['a'] });
    h.client.fail({ code: 'connection-lost', detail: 'gone' });

    await expect(h.client.invoke('one', {})).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.writes).toEqual([]);
  });

  /**
   * DDDD-15's control, and the fixture is the whole of it.
   *
   * These three `fail` calls used to pass `frame` for a reader thread that
   * exited, because `HostTermination` had no code for an ending nobody caused
   * and a violation is what the type would accept. The cases passed — they
   * assert that the call rejects, and it does either way — so the constant was
   * free to be a lie, and the missing state hid behind it until the first real
   * caller had to choose a value for a host that had simply died.
   *
   * This case is what makes the constant load-bearing: it asserts that the code
   * a caller SUPPLIED is the code the rejection carries, so a client that
   * invented one goes red. Both new codes are exercised, because they are two
   * facts rather than one — `TransportEnd.by` already separates a host that
   * crashed from a host we killed, and a single code here would collapse that
   * distinction one line above the module that computes it.
   */
  it('CARRIES the supplied code into the rejection, for both endings nobody caused', async () => {
    for (const code of ['connection-lost', 'shutdown'] as const) {
      const h = harness({ ids: ['a'] });
      const call = h.client.invoke('one', {});

      h.client.fail({ code, detail: 'why this ended' });

      const thrown: unknown = await call.catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(HostConnectionLost);
      // Read off the error rather than off the client, because the error is
      // what a caller actually holds — and rendering it is where a wrong code
      // would be read as a framing bug in a host that never framed anything.
      expect((thrown as HostConnectionLost).termination.code).toBe(code);
      expect(String(thrown)).toContain(code);
      expect(h.client.termination()?.code).toBe(code);
    }
  });

  it('keeps the FIRST cause when a violation is followed by the transport failing', async () => {
    const h = harness({ ids: ['a'] });
    const call = h.client.invoke('one', {});

    h.answer({}, 'never-sent');
    h.client.fail({ code: 'connection-lost', detail: 'and then the reader went away' });

    await expect(call).rejects.toThrow(/unknown-correlation/u);
    expect(h.client.termination()?.code).toBe('unknown-correlation');
  });

  it('survives a transport that answers INSIDE write, before invoke has returned', async () => {
    const terminations: HostTermination[] = [];
    /**
     * Late-bound because the transport answers by calling back into the client.
     *
     * On an object rather than in a `let` for the reason the modules under test
     * give: the compiler narrows a `let` after the assignment below and then
     * calls the closure's null check unreachable — but the closure is captured
     * BEFORE that assignment, so the check is the only thing standing between
     * this case and a crash if the transport ever wrote during construction.
     */
    const held: { client: HostClient | null } = { client: null };
    held.client = createHostClient({
      transport: {
        write: (frame) => {
          const sent = JSON.parse(new TextDecoder().decode(frame.subarray(4))) as { id: string };
          // SYNCHRONOUSLY, which is what an in-process fake or a future
          // same-thread transport does. The client registers its pending entry
          // BEFORE writing precisely so this arrives at a map that knows the id
          // — written the other way round, this is reported as an unknown
          // correlation, a violation manufactured by the order of two lines.
          held.client?.receive(
            encodeFrame(
              new TextEncoder().encode(JSON.stringify({ id: sent.id, body: { echoed: true } })),
              ENGINE_HOST_FRAME_MAX_BYTES,
            ),
          );
        },
        terminate: (reason) => terminations.push(reason),
      },
      maxInFlight: 2,
      correlate: () => 'only',
      deadline: manualDeadline().deadline,
      owner: () => undefined,
    });

    await expect(held.client.invoke('one', {})).resolves.toEqual({ echoed: true });
    expect(terminations).toEqual([]);
  });

  it('a call past its deadline ends the connection as `deadline`, and every call on it rejects', async () => {
    const h = harness({ ids: ['slow', 'other'] });
    const slow = h.client.invoke('engine:loop', {});
    const other = h.client.invoke('engine:read', {});
    // ONE TIMER: the call waiting behind the slow one has not been sent, so its deadline has not started.
    expect(h.clock.timers.map((timer) => timer.ms)).toStrictEqual([30_000]);

    h.clock.expire();

    await expect(slow).rejects.toBeInstanceOf(HostConnectionLost);
    await expect(other).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.terminations).toHaveLength(1);
    expect(h.terminations[0]?.code).toBe('deadline');
    expect(h.terminations[0]?.detail).toContain('"engine:loop" had no answer within 30000 ms');
    expect(h.client.termination()?.code).toBe('deadline');
  });

  it('names the document whose call was ON THE WIRE when the connection ended — and only that one', async () => {
    // Asked as each call is made, as the shell asks its lanes: `made` stands for the lane the caller runs in.
    const made: { document: DocId | undefined } = { document: asDocId('aaaaaaaa-guilty') };
    const h = harness({ ids: ['a', 'b'], owner: () => made.document });
    const running = h.client.invoke('engine:apply', {});
    made.document = asDocId('bbbbbbbb-waiting');
    const waiting = h.client.invoke('engine:read', {});
    expect(h.client.during()).toBeUndefined();

    h.client.fail({ code: 'connection-lost', detail: 'the host crashed' });

    await expect(running).rejects.toBeInstanceOf(HostConnectionLost);
    await expect(waiting).rejects.toBeInstanceOf(HostConnectionLost);
    // THE WAITING CALL'S DOCUMENT IS NOT NAMED: it was never sent, so the host cannot have been running it.
    expect(h.client.during()).toBe(asDocId('aaaaaaaa-guilty'));
  });

  it('CONTROL: once the first call is answered the second is on the wire, and it is the one named', async () => {
    // The fixture the defect would also pass is the one above with the order reversed; this is the same two calls with
    // the first ANSWERED, so a client naming the first call made, rather than the one on the wire, goes red here.
    const made: { document: DocId | undefined } = { document: asDocId('aaaaaaaa-answered') };
    const h = harness({ ids: ['a', 'b'], owner: () => made.document });
    const first = h.client.invoke('engine:read', {});
    made.document = asDocId('bbbbbbbb-running');
    const second = h.client.invoke('engine:apply', {});
    h.answer({ fine: true }, 'a');
    await first;

    h.clock.expire();

    await expect(second).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.client.termination()?.code).toBe('deadline');
    expect(h.client.during()).toBe(asDocId('bbbbbbbb-running'));
  });

  it('names NO document when nothing was on the wire, or the call on it was made outside every lane', async () => {
    const idle = harness({ ids: ['a'], owner: () => asDocId('aaaaaaaa-idle') });
    expect(idle.client.last()).toBeUndefined();
    const answered = idle.client.invoke('engine:read', {});
    idle.answer({}, 'a');
    await answered;
    idle.client.fail({ code: 'connection-lost', detail: 'ended between calls' });
    expect(idle.client.during()).toBeUndefined();
    // THE LAST CALL SENT is still named, settled as it is: what a memory kill between calls counts against.
    expect(idle.client.last()).toBe(asDocId('aaaaaaaa-idle'));

    const outside = harness({ ids: ['a'], owner: () => undefined });
    const probe = outside.client.invoke('engine/probe-containment', {});
    outside.client.fail({ code: 'connection-lost', detail: 'ended during the probe' });
    await expect(probe).rejects.toBeInstanceOf(HostConnectionLost);
    expect(outside.client.during()).toBeUndefined();
  });

  it('CONTROL: an answered call cancels its deadline, so its expiry ends nothing', async () => {
    // THE MUTATION THIS SEPARATES: a timer left running after its answer would end a healthy connection one deadline
    // after every call — the case above cannot tell that client from this one.
    const h = harness({ ids: ['a'] });
    const call = h.client.invoke('one', {});
    h.answer({ fine: true }, 'a');
    await expect(call).resolves.toEqual({ fine: true });

    expect(h.clock.timers.map((timer) => timer.cancelled)).toStrictEqual([true]);
    for (const timer of h.clock.timers) timer.expire();
    expect(h.terminations).toStrictEqual([]);
    expect(h.client.termination()).toBeNull();
  });

  it('CONTROL: a running client reports no termination and answers normally', async () => {
    const h = harness({ ids: ['a'] });
    const call = h.client.invoke('one', {});

    expect(h.client.termination()).toBeNull();
    h.answer({ fine: true }, 'a');

    // VACUITY GUARD for every case above: a client that terminated on
    // everything would satisfy all of them and be useless.
    await expect(call).resolves.toEqual({ fine: true });
    expect(h.terminations).toEqual([]);
  });
});

/**
 * A client whose file-routed channel is `doc:big`, and whose `take` the case decides — what the directory holds under
 * the name, or a refusal to read it (ADR-0125).
 *
 * @param take the file's bytes as main would read them, an Error to throw, or a promise the case settles itself
 */
function fileHarness(take: Uint8Array | Error | Promise<Uint8Array> | null = null) {
  const writes: Uint8Array[] = [];
  const terminations: HostTermination[] = [];
  const taken: { params: unknown; name: string; bytes: number }[] = [];
  /** Every put and drop, in order, so a case can assert the file existed exactly for the call's lifetime. */
  const files: string[] = [];
  const client = createHostClient({
    transport: {
      write: (frame) => {
        files.push('sent');
        writes.push(frame);
      },
      terminate: (reason) => terminations.push(reason),
    },
    maxInFlight: 4,
    correlate: () => 'c1',
    deadline: manualDeadline().deadline,
    owner: () => undefined,
    fileAnswers: {
      routed: (channel) => channel === 'doc:big',
      mint: () => 'n1',
      take: (params, name, bytes) => {
        taken.push({ params, name, bytes });
        if (take instanceof Error) return Promise.reject(take);
        if (take instanceof Promise) return take;
        return Promise.resolve(take ?? new Uint8Array());
      },
      requested: (channel) => channel === 'doc:undo',
      put: (_params, name, bytes) => {
        files.push(`put ${name} ${new TextDecoder().decode(bytes)}`);
        return Promise.resolve();
      },
      drop: (_params, name) => {
        files.push(`drop ${name}`);
        return Promise.resolve();
      },
    },
  });
  const frame = (response: unknown): void => {
    client.receive(encodeFrame(new TextEncoder().encode(JSON.stringify(response)), ENGINE_HOST_FRAME_MAX_BYTES));
  };
  return {
    client,
    terminations,
    taken,
    files,
    frame,
    sent: () => writes.map((written) => JSON.parse(new TextDecoder().decode(written.subarray(4))) as unknown),
  };
}

describe('a file-routed answer on the client (ADR-0125)', () => {
  const envelope = { ok: true, value: { runs: ['a', 'b'] } };
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));

  /**
   * THE NAME IS MAIN'S, and the envelope in the file is what the call resolves to — the same object a frame would
   * have carried, handed to the same `acceptAnswer`.
   */
  it('names the file itself, takes it for the session in the params, and resolves to the envelope in it', async () => {
    const h = fileHarness(bytes);
    const call = h.client.invoke('doc:big', { session: 's1' });
    expect(h.sent()).toStrictEqual([{ id: 'c1', channel: 'doc:big', params: { session: 's1' }, answerInto: 'n1' }]);

    h.frame({ id: 'c1', answerFile: { bytes: bytes.byteLength } });
    await expect(call).resolves.toStrictEqual(envelope);
    expect(h.taken).toStrictEqual([{ params: { session: 's1' }, name: 'n1', bytes: bytes.byteLength }]);
    expect(h.terminations).toStrictEqual([]);
  });

  it('a call whose file is still being read when the connection ends is REJECTED with the ending, never left waiting', async () => {
    // The call leaves `pending` when its frame arrives, so the ending's sweep of `pending` does not reach it; the take
    // finishing afterwards must still settle it.
    let finishTake: (bytes: Uint8Array) => void = () => undefined;
    const h = fileHarness(new Promise<Uint8Array>((done) => (finishTake = done)));
    const call = h.client.invoke('doc:big', { session: 's1' });
    h.frame({ id: 'c1', answerFile: { bytes: bytes.byteLength } });
    h.client.fail({ code: 'connection-lost', detail: 'the reader stopped' });
    finishTake(bytes);

    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
    await expect(call).rejects.toMatchObject({ termination: { code: 'connection-lost' } });
  });

  it('names no file for a channel that answers in the frame', () => {
    const h = fileHarness(bytes);
    void h.client.invoke('doc:small', { session: 's1' }).catch(() => undefined);
    expect(h.sent()).toStrictEqual([{ id: 'c1', channel: 'doc:small', params: { session: 's1' } }]);
  });

  it('ends the connection when the file holds other than the announced length', async () => {
    const h = fileHarness(bytes.subarray(1));
    const call = h.client.invoke('doc:big', { session: 's1' });
    h.frame({ id: 'c1', answerFile: { bytes: bytes.byteLength } });
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.terminations.map((reason) => reason.code)).toStrictEqual(['malformed-response']);
  });

  it('ends the connection when the file cannot be taken', async () => {
    const h = fileHarness(new Error('an answer arrived for a session this host is not holding'));
    const call = h.client.invoke('doc:big', { session: 's1' });
    h.frame({ id: 'c1', answerFile: { bytes: 10 } });
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.terminations.map((reason) => reason.code)).toStrictEqual(['malformed-response']);
  });

  it('refuses a file answer to a call that answers in the frame', async () => {
    const h = fileHarness(bytes);
    const call = h.client.invoke('doc:small', {});
    h.frame({ id: 'c1', answerFile: { bytes: bytes.byteLength } });
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.taken).toStrictEqual([]);
    expect(h.terminations.map((reason) => reason.code)).toStrictEqual(['malformed-response']);
  });

  it('refuses a SUCCESS in the frame for a file-routed call, and accepts a failure there', async () => {
    const refused = fileHarness(bytes);
    const call = refused.client.invoke('doc:big', { session: 's1' });
    refused.frame({ id: 'c1', body: envelope });
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
    expect(refused.terminations.map((reason) => reason.code)).toStrictEqual(['malformed-response']);

    const failed = fileHarness(bytes);
    const declined = failed.client.invoke('doc:big', { session: 's1' });
    failed.frame({ id: 'c1', body: { ok: false, error: { code: 'answer-too-large' } } });
    await expect(declined).resolves.toStrictEqual({ ok: false, error: { code: 'answer-too-large' } });
    expect(failed.terminations).toStrictEqual([]);
  });
});

describe('a file-requested call on the client (ADR-0125 addendum)', () => {
  /**
   * THE FILE EXISTS FOR EXACTLY THE CALL: written before the frame is sent, named in place of the params, and removed
   * once the answer has come — so a prior never sits in a directory the host may read longer than the call needs it.
   */
  it('writes the params before sending, names the file in their place, and drops it when the call ends', async () => {
    const h = fileHarness();
    const params = { session: 's1', inverse: { kind: 'rotatePages', prior: [1, 2, 3] } };
    const call = h.client.invoke('doc:undo', params);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const json = JSON.stringify(params);
    expect(h.files).toStrictEqual([`put n1 ${json}`, 'sent']);
    expect(h.sent()).toStrictEqual([
      { id: 'c1', channel: 'doc:undo', paramsFile: { session: 's1', name: 'n1', bytes: new TextEncoder().encode(json).byteLength } },
    ]);

    h.frame({ id: 'c1', body: { ok: true, value: {} } });
    await expect(call).resolves.toStrictEqual({ ok: true, value: {} });
    expect(h.files).toStrictEqual([`put n1 ${json}`, 'sent', 'drop n1']);
  });

  it('drops the file when the call fails as well', async () => {
    const h = fileHarness();
    const call = h.client.invoke('doc:undo', { session: 's1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.client.fail({ code: 'connection-lost', detail: 'the host went away' });
    await expect(call).rejects.toBeInstanceOf(HostConnectionLost);
    expect(h.files.at(-1)).toBe('drop n1');
  });

  it('refuses params above the ceiling before writing anything', async () => {
    const h = fileHarness();
    await expect(
      h.client.invoke('doc:undo', { session: 's1', blob: 'x'.repeat(ENGINE_ANSWER_FILE_MAX_BYTES) }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(h.files).toStrictEqual([]);
    expect(h.terminations).toStrictEqual([]);
  });
});
