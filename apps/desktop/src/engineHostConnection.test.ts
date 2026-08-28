import { ENGINE_HOST_FRAME_MAX_BYTES, encodeFrame } from '@monstera/contract';
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

function connect(h: Harness) {
  return createEngineHostConnection(h.surfaces, {
    pipeName: PIPE_NAME,
    user: USER,
    container: CONTAINER,
    readBytes: 8192,
    maxOutstandingWrites: 8,
    maxInFlight: 8,
    processMemoryLimitBytes: 3_221_225_472,
    correlate: () => 'id-1',
    onEnded: (reason) => {
      h.calls.push(`onEnded:${reason.code}`);
      h.endings.push(reason);
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
