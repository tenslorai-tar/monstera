import { ENGINE_ANSWER_FILE_MAX_BYTES, ENGINE_HOST_FRAME_MAX_BYTES, encodeFrame } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { type HostClient, HostConnectionLost, createHostClient } from './client.js';
import type { HostTermination } from './runtime.js';

/**
 * A recording transport, and a way to answer as the host would.
 *
 * ONE call list, as the modules beside this do, because the properties here are
 * about ORDER — the pending entry registered before the write, the map cleared
 * before the rejections — and per-member spies would let those pass against a
 * client that did them backwards.
 */
function harness(options: { maxInFlight?: number; ids?: string[] } = {}) {
  const writes: Uint8Array[] = [];
  const terminations: HostTermination[] = [];
  const ids = options.ids ?? [];
  let next = 0;

  const client = createHostClient({
    transport: {
      write: (frame) => writes.push(frame),
      terminate: (reason) => terminations.push(reason),
    },
    maxInFlight: options.maxInFlight ?? 4,
    correlate: () => ids[next++] ?? `id-${String(next)}`,
  });

  return {
    client,
    writes,
    terminations,
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

  it('resolves each call with ITS answer when they come back out of order', async () => {
    const h = harness({ ids: ['a', 'b'] });

    const first = h.client.invoke('one', {});
    const second = h.client.invoke('two', {});
    // OUT OF ORDER, which is the whole reason a correlation id exists: the host
    // answers when it finishes, and a client that assumed a queue would hand
    // the second answer to the first caller.
    h.answer({ which: 'second' }, 'b');
    h.answer({ which: 'first' }, 'a');

    await expect(first).resolves.toEqual({ which: 'first' });
    await expect(second).resolves.toEqual({ which: 'second' });
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

    // Queueing moves the same unbounded growth into a list, which is the rule
    // `runtime.ts` states for its own limit.
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
    h.answer({}, 'c');
    await expect(second).resolves.toEqual({});
    await expect(third).resolves.toEqual({});
  });

  it('ENDS when the correlation source repeats an id that is outstanding', async () => {
    const h = harness({ ids: ['a', 'a'] });

    const first = h.client.invoke('one', {});
    const second = h.client.invoke('two', {});

    // OUR defect rather than the peer's, and still terminal: two calls sharing
    // an id means the next answer resolves the wrong promise and there is no
    // way to tell which.
    expect(h.terminations.map((t) => t.code)).toEqual(['duplicate-id']);
    await expect(second).rejects.toBeInstanceOf(HostConnectionLost);
    await expect(first).rejects.toBeInstanceOf(HostConnectionLost);
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
    });

    await expect(held.client.invoke('one', {})).resolves.toEqual({ echoed: true });
    expect(terminations).toEqual([]);
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
 * @param take the file's bytes as main would read them, or an Error to throw
 */
function fileHarness(take: Uint8Array | Error | null = null) {
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
    fileAnswers: {
      routed: (channel) => channel === 'doc:big',
      mint: () => 'n1',
      take: (params, name, bytes) => {
        taken.push({ params, name, bytes });
        if (take instanceof Error) return Promise.reject(take);
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
