import { ENGINE_HOST_FRAME_MAX_BYTES, encodeFrame } from '@monstera/contract';
import { asDocId, type DocId } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { HOST_CONNECT_TIMEOUT_MS, createEngineHostConnection } from './engineHostConnection.js';
import {
  FAKE_CONTAINER,
  FAKE_PIPE_NAME,
  FAKE_USER,
  type HostHarness,
  hostHarness,
} from './engineHostFake.js';

const USER = FAKE_USER;
const CONTAINER = FAKE_CONTAINER;
const PIPE_NAME = FAKE_PIPE_NAME;

/**
 * ONE call list across every surface, which is the point rather than a
 * convenience.
 *
 * Every property this file asserts is about ORDER or about how many times
 * something happened — the host created after the reader, the process
 * terminated before its handles close, one host surface built and not two —
 * and per-surface spies would let a composition that did them backwards pass
 * each of them individually.
 */
type Harness = HostHarness;

/**
 * The fake moved to `engineHostFake.ts` on 2026-08-28, unchanged.
 *
 * The composition root's cases needed the same surfaces, and writing them a
 * second time would have been a second opinion about how this protocol behaves
 * (B3a) — two fakes agree until the ordering changes, at which point one file
 * passes while the product cannot talk to itself. This file remains where the
 * fake is exercised hardest; it is no longer where it lives.
 */
const harness = hostHarness;

/**
 * Asserts one call happened before another, and that BOTH happened.
 *
 * The presence half is the whole reason this exists. `indexOf` answers `-1` for
 * a call that never ran, and `-1 < n` is true — so every order assertion in
 * this file would pass for a composition that skipped the earlier step
 * entirely, which is the failure they exist to catch. An absent lookup
 * returning the reassuring answer is item 4b arriving inside a comparison.
 */
function expectOrder(calls: readonly string[], before: string, after: string): void {
  expect(calls).toContain(before);
  expect(calls).toContain(after);
  expect(calls.indexOf(before)).toBeLessThan(calls.indexOf(after));
}

/**
 * @param owner the document each call is for, as the shell's lanes answer it
 * @param during where each ending's running call's document is recorded, beside `h.endings`' reasons
 * @param last where each ending's last call's document is recorded
 */
function connect(
  h: Harness,
  owner: () => DocId | undefined = () => undefined,
  during: (DocId | undefined)[] = [],
  last: (DocId | undefined)[] = [],
) {
  return createEngineHostConnection(h.surfaces, {
    pipeName: PIPE_NAME,
    user: USER,
    container: CONTAINER,
    readBytes: 8192,
    maxOutstandingWrites: 8,
    maxInFlight: 8,
    processMemoryLimitBytes: 3_221_225_472,
    memorySampling: { intervalMs: 100, headroomBytes: 536_870_912 },
    correlate: () => 'id-1',
    // A DEADLINE THAT NEVER FIRES: no case here is about time, and the client's own cases own the deadline.
    deadline: { ms: () => 30_000, schedule: () => () => undefined },
    owner,
    onEnded: (ending) => {
      h.calls.push(`onEnded:${ending.termination.code}`);
      h.endings.push(ending.termination);
      during.push(ending.during);
      last.push(ending.last);
    },
  });
}

describe('createEngineHostConnection', () => {
  it('creates the HOST LAST, after the reader is already waiting', async () => {
    const h = harness();
    const connection = await connect(h);

    expect(connection.ok).toBe(true);
    // The reader issues `ConnectNamedPipe`; a server instance nobody has
    // connected cannot be read. Asserted as an ORDER rather than as presence,
    // because a composition that starts the process first still calls both.
    expectOrder(h.calls, 'reader.startWorker', 'host.createSuspended');
    expectOrder(h.calls, 'pipe.createInstance', 'reader.startWorker');
  });

  it('builds the host surface EXACTLY ONCE, so the kill runs through the adapter that created it', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    connection.value.close();

    // Two would be two opinions about the same handles (B3a), and the second
    // would be the one holding the terminate. This case exists because the
    // first draft of the composition called `hostFor` twice.
    expect(h.calls.filter((call) => call === 'host.surfaceBuilt')).toHaveLength(1);
  });

  it('refuses at the PIPE without starting a reader or a process', async () => {
    const h = harness({ pipe: true });
    const connection = await connect(h);

    expect(connection.ok).toBe(false);
    if (connection.ok) return;
    expect(connection.error.stage).toBe('pipe');
    expect(h.calls).not.toContain('reader.startWorker');
    expect(h.calls).not.toContain('host.createSuspended');
    expect(h.calls).not.toContain('onEnded:shutdown');
  });

  it('refuses at the READER, closing the pipe and creating no process', async () => {
    const h = harness({ worker: true });
    const connection = await connect(h);

    expect(connection.ok).toBe(false);
    if (connection.ok) return;
    expect(connection.error.stage).toBe('reader');
    expect(h.calls).toContain('pipe.close');
    expect(h.calls).not.toContain('host.createSuspended');
  });

  /**
   * The double-report property, and the fixture is chosen so the bug cannot
   * satisfy it.
   *
   * A composition that reported the failure BOTH ways — as a refusal and as a
   * death — would still close the pipe, so asserting teardown alone separates
   * nothing. The load-bearing assertion is that `onEnded` was never called
   * while the teardown ran anyway.
   */
  it('refuses at the HOST, tearing down but NOT reporting an ending', async () => {
    const h = harness({ host: true });
    const connection = await connect(h);

    expect(connection.ok).toBe(false);
    if (connection.ok) return;
    expect(connection.error.stage).toBe('host');
    // THE READER IS STILL ON ITS WAY OUT, so the pipe and its stop event are not yet closed: the reader's last act is a
    // cancel on the pipe (`engineReaderChannel.ts`). The fake reader ends one turn after the stop, as the shipped one
    // does some tens of milliseconds after it.
    expect(h.calls).toContain('reader.signal');
    expect(h.calls).not.toContain('pipe.close');
    await new Promise((settled) => setImmediate(settled));
    expect(h.calls).toContain('pipe.close');
    expect(h.calls).toContain('reader.closeEvent');
    expect(h.endings).toEqual([]);
  });

  it('maps a reader that went away to CONNECTION-LOST, not to a framing violation', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    h.exit(1);

    // DDDD-15's payoff. Before `connection-lost` existed the only values here
    // were violations, and a host that simply died would have been reported as
    // one — sending its reader to the framing code.
    expect(h.endings.map((reason) => reason.code)).toEqual(['connection-lost']);
    expect(connection.value.ended()).toBe(true);
  });

  it('hands the ending the document whose call was ON THE WIRE, for a crash and a memory kill alike (P3)', async () => {
    // THROUGH THE CONNECTION, which is what sits between the client that knows the call and the handler that counts
    // it: a connection that read `during` before `fail`, or never passed it, would hand on `undefined` here.
    const guilty = asDocId('aaaaaaaa-guilty');
    for (const end of ['crash', 'memory kill'] as const) {
      const h = harness();
      const during: (DocId | undefined)[] = [];
      const connection = await connect(h, () => guilty, during);
      expect(connection.ok).toBe(true);
      if (!connection.ok) return;
      const call = connection.value.client.invoke('any', {});

      if (end === 'crash') h.exit(1);
      else h.samplerKills();

      await expect(call).rejects.toThrow(/connection ended/u);
      expect(during).toStrictEqual([guilty]);
    }
  });

  it('CONTROL: an ending with no call on the wire is handed no document while running, and the LAST call’s', async () => {
    // A call answered, then the sampler's kill between calls: what a session holding its memory after the call that
    // grew it looks like. `during` must be empty — nothing was running — and `last` must name the answered call, which
    // is what `endingCountsAgainst` counts a memory kill against.
    const idle = asDocId('aaaaaaaa-answered');
    const h = harness({ peer: () => ({ ok: true, value: {} }) });
    const during: (DocId | undefined)[] = [];
    const last: (DocId | undefined)[] = [];
    const connection = await connect(h, () => idle, during, last);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;
    await expect(connection.value.client.invoke('any', {})).resolves.toEqual({ ok: true, value: {} });

    h.samplerKills();

    expect(h.endings.map((reason) => reason.code)).toEqual(['memory-budget']);
    expect(during).toStrictEqual([undefined]);
    expect(last).toStrictEqual([idle]);
  });

  describe('the memory sampler (ADR-0023 §3, corrected 2026-10-03)', () => {
    it('starts once the host exists, at the job limit less its headroom, and stops before the host is killed', async () => {
      const h = harness();
      const connection = await connect(h);
      expect(connection.ok).toBe(true);
      if (!connection.ok) return;

      // 3 GiB less 512 MiB, every 100 ms, for the fake's process 4242: what `connect` was configured with.
      const started = h.calls.find((call) => call.startsWith('sampler.start:'));
      expect(started).toBe(`sampler.start:${String(connection.value.pid)}:${String(3_221_225_472 - 536_870_912)}:100`);
      expectOrder(h.calls, 'host.createSuspended', started ?? '');

      connection.value.close();
      expectOrder(h.calls, 'sampler.stop', 'host.terminate');
    });

    it('names an ending the sampler caused MEMORY-BUDGET, not a host that vanished', async () => {
      const h = harness();
      const connection = await connect(h);
      expect(connection.ok).toBe(true);
      if (!connection.ok) return;

      h.samplerKills();

      expect(h.endings.map((reason) => reason.code)).toEqual(['memory-budget']);
      expect(h.endings[0]?.detail).toContain(String(3_221_225_472 - 536_870_912));
    });

    it('CONTROL: the same ending with no kill recorded is still CONNECTION-LOST', async () => {
      // The flag is what separates the two, so a connection that read nothing would report this one as above.
      const h = harness();
      const connection = await connect(h);
      expect(connection.ok).toBe(true);
      if (!connection.ok) return;

      h.exit(1);

      expect(h.endings.map((reason) => reason.code)).toEqual(['connection-lost']);
    });

    it('ENDS the host when the sampler cannot watch it, by name, rather than leaving it to the backstop', async () => {
      const h = harness();
      const connection = await connect(h);
      expect(connection.ok).toBe(true);
      if (!connection.ok) return;

      h.samplerFails('OpenProcess refused process 4242 (GetLastError 5)');

      expect(h.endings.map((reason) => reason.code)).toEqual(['sampler-failed']);
      expect(h.endings[0]?.detail).toContain('GetLastError 5');
      expect(h.calls).toContain('host.terminate');
    });

    it('refuses the host when the sampler thread cannot start, and the process is killed', async () => {
      const h = harness({ sampler: true });
      const connection = await connect(h);

      expect(connection.ok).toBe(false);
      if (connection.ok) return;
      expect(connection.error.stage).toBe('host');
      expect(connection.error.detail).toContain('memory sampler');
      expect(h.calls).toContain('host.terminate');
    });
  });

  it('maps a deliberate close to SHUTDOWN, and reports it rather than staying silent', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    connection.value.close();

    expect(h.endings.map((reason) => reason.code)).toEqual(['shutdown']);
  });

  it('KEEPS a violation the client raised rather than relabelling it as a shutdown', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    // An answer for an id nobody sent. The client terminates the transport, so
    // `TransportEnd.by` reads `us` — the same value a deliberate close produces,
    // which is the ambiguity this mapping exists to resolve.
    // A WELL-FORMED response for an id nobody sent, and the shape matters: a
    // malformed one is refused before the correlation is ever looked up, so the
    // case would pass on `malformed-response` and prove a different thing than
    // its name claims. Measured — that is what the first version of this
    // fixture did.
    h.post({ kind: 'chunk', bytes: framed({ id: 'never-sent', body: {} }) });

    expect(h.endings.map((reason) => reason.code)).toEqual(['unknown-correlation']);
    await expect(connection.value.client.invoke('any', {})).rejects.toThrow(/unknown-correlation/u);
  });

  it('TERMINATES the process before closing either handle', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    connection.value.close();

    // `engineHostFactory.ts`'s own rule: the job carries `KILL_ON_JOB_CLOSE`, so
    // closing it would kill the host as a side effect of tidying up — which
    // stops being true in exactly the case where something else went wrong.
    expectOrder(h.calls, 'host.terminate', 'host.close:process');
    expectOrder(h.calls, 'host.terminate', 'host.close:job');
  });

  it('reports the ending AFTER everything is freed, so a caller may rebuild inside it', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    h.exit(1);

    for (const freed of ['reader.closeEvent', 'host.terminate', 'pipe.close']) {
      expectOrder(h.calls, freed, 'onEnded:connection-lost');
    }
  });

  it('is IDEMPOTENT on close, and a close after a death frees nothing twice', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    h.exit(1);
    connection.value.close();
    connection.value.close();

    expect(h.endings).toHaveLength(1);
    expect(h.calls.filter((call) => call === 'pipe.close')).toHaveLength(1);
    expect(h.calls.filter((call) => call === 'host.terminate')).toHaveLength(1);
  });

  it('SETTLES a waiting call when the host dies, rather than leaving it pending', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    const call = connection.value.client.invoke('any', {});
    h.exit(1);

    // The failure that costs most is the quiet one: the host dies, nothing
    // rejects, and a caller waits for ever holding whatever it was going to do.
    await expect(call).rejects.toThrow(/connection-lost/u);
  });

  it('refuses at CONNECT when the host starts and never reaches the pipe', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ connect: true });
      const pending = connect(h);
      await vi.advanceTimersByTimeAsync(HOST_CONNECT_TIMEOUT_MS + 1);
      const connection = await pending;

      expect(connection.ok).toBe(false);
      expect(!connection.ok && connection.error.stage).toBe('connect');

      // THE LOAD-BEARING ASSERTION, and it is not the stage. Before this, a host
      // that never connected was handed back as a live client and surfaced later
      // as `connection-lost` — which `engineSessions` counts as a DEATH, and two
      // deaths poison the document (Decision 9a). A startup failure taking the
      // recovery path built for a crash is finding YYYY-1's real cost, and the
      // only thing that separates the two is whether `onEnded` ran.
      expect(h.endings).toEqual([]);
      expect(h.calls).not.toContain('onEnded:shutdown');
      expect(h.calls).not.toContain('onEnded:connection-lost');

      // AND EVERYTHING IS FREED. A refusal that leaves the process running would
      // be worse than the defect it replaces.
      expect(h.calls).toContain('host.terminate');
      expect(h.calls).toContain('pipe.close');
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the HOST'S OWN words into the refusal when it wrote any", async () => {
    const h = harness({ connect: true, said: 'icu_util.cc:232 Invalid file descriptor' });
    const pending = connect(h);
    h.post({ kind: 'ended', detail: 'the reader stopped' });
    const connection = await pending;

    // THE HOST'S TEXT, VERBATIM, and not a sentence this file composed. Before
    // this the shipped app passed `diagnosticPath: null` — so a host that died
    // loading its own runtime data was reported as one that "started and did
    // not reach its pipe", which sends the reader to the pipe. Measured twice
    // while building `hostRecovery.mjs`; the line below is what the host
    // actually printed on the second of them.
    expect(!connection.ok && connection.error.detail).toContain(
      'icu_util.cc:232 Invalid file descriptor',
    );
    // AND THE REASON MAIN HAS, kept beside it: the host's output cannot say
    // whether the reader ended or the bound expired, and only one of those is
    // worth ten seconds.
    expect(!connection.ok && connection.error.detail).toContain('the reader ended');
  });

  /**
   * THE CONTROL, and without it the case above passes against a connection that
   * appends a constant. A host that wrote nothing must leave the detail exactly
   * as the wait produced it — `null` from `diagnostics()` is *no file*, *could
   * not read it* and *it was empty*, and none of those gives a caller anything
   * to say.
   */
  it('CONTROL: adds nothing when the host wrote nothing', async () => {
    const h = harness({ connect: true });
    const pending = connect(h);
    h.post({ kind: 'ended', detail: 'the reader stopped' });
    const connection = await pending;

    expect(h.calls).toContain('host.diagnostics');
    expect(!connection.ok && connection.error.detail).not.toContain('The host said');
  });

  /**
   * ASSERTED AS A CALL, not as an absent file. The surface owns the path — a
   * `string` path on anything the kernel or the renderer can name is a compile
   * error — so what this layer can be responsible for is *asking*, and a test
   * that looked for a missing file would be testing `rmSync`.
   */
  it('discards the diagnostics when the connection is torn down', async () => {
    const h = harness({ connect: true });
    const pending = connect(h);
    h.post({ kind: 'ended', detail: 'the reader stopped' });
    await pending;

    expect(h.calls).toContain('host.discardDiagnostics');
    // AFTER the handles, so the host cannot still be writing to it.
    expect(h.calls.indexOf('host.discardDiagnostics')).toBeGreaterThan(
      h.calls.indexOf('host.terminate'),
    );
  });

  it('fails FAST when the reader dies mid-wait, rather than waiting out the bound', async () => {
    const h = harness({ connect: true });
    const pending = connect(h);

    // The factory runs synchronously as far as its first `await`, so by the time
    // `connect` has returned a promise it is already waiting on the peer. No
    // fake timers here on purpose: if this case ever needed them, the wait would
    // not be failing fast and that is exactly what it exists to prove.
    h.post({ kind: 'ended', detail: 'the reader stopped' });
    const connection = await pending;

    expect(!connection.ok && connection.error.stage).toBe('connect');
    expect(!connection.ok && connection.error.detail).toContain('the reader ended');
    expect(h.endings).toEqual([]);
  });

  it('accepts a peer that connected BEFORE anything waited for it', async () => {
    const h = harness({ connect: true });
    // Delivered synchronously from `resume`, which is earlier than the composer
    // can possibly be listening. Without the latch in `onConnected` this is a
    // lost wakeup and the connection times out — the same class of race the
    // whole mechanism exists to remove, one layer up.
    h.connectOnResume();

    const connection = await connect(h);

    expect(connection.ok).toBe(true);
  });

  it('carries the host PID, which nothing addresses the host by', async () => {
    const h = harness();
    const connection = await connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    expect(connection.value.pid).toBe(4242);
  });
});

/**
 * One framed response, as the host would put it on the pipe.
 *
 * Through `encodeFrame` rather than by writing a length prefix here. A second
 * hand-rolled framing in a test is a second opinion about what a frame is
 * (B3a), and it agrees with the real one right up until the moment the framing
 * changes — at which point this file would pass while the product could not
 * talk to itself.
 */
function framed(response: unknown): Uint8Array {
  return encodeFrame(
    new TextEncoder().encode(JSON.stringify(response)),
    ENGINE_HOST_FRAME_MAX_BYTES,
  );
}
