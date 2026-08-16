import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { wrapHandler, createClient, toError, unwrap } from './boundary.js';
import { channel, type Handlers } from './channel.js';

/**
 * A fixture registry rather than the real one.
 *
 * The real registry holds only channels that have handlers (the wired rule), so
 * it is deliberately small and would exercise almost none of the mechanism.
 * These channels exist to push on the boundary itself — validation in both
 * directions, throws, and cause chains — without inventing channels in the
 * shipping contract that nothing implements.
 */
const fixture = {
  'fixture.add': channel(
    'Adds two integers.',
    z.object({ left: z.number().int(), right: z.number().int() }),
    z.object({ sum: z.number().int() }),
  ),
  'fixture.fail': channel('Always throws.', z.object({}), z.object({ never: z.string() })),
} as const;

type FixtureHandlers = Handlers<typeof fixture>;

const handlers: FixtureHandlers = {
  'fixture.add': ({ left, right }) => Promise.resolve({ sum: left + right }),
  'fixture.fail': () => {
    throw new Error('the underlying thing broke', {
      cause: new TypeError('because this was wrong'),
    });
  },
};

describe('wrapHandler', () => {
  it('passes valid params through and returns the value', async () => {
    // Control for every rejection case below: without it, a wrapper that
    // rejected everything would satisfy all of them.
    const invoke = wrapHandler(fixture, 'fixture.add', handlers['fixture.add']);
    const result = await invoke({ left: 2, right: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sum).toBe(5);
  });

  it('rejects params that do not match the schema, naming the channel', async () => {
    const invoke = wrapHandler(fixture, 'fixture.add', handlers['fixture.add']);
    const result = await invoke({ left: 'two', right: 3 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Invalid params for "fixture.add"');
  });

  it('rejects params of the right type but the wrong shape', async () => {
    // `left` is declared an integer. Accepting 2.5 here would let a fractional
    // page index reach a writer of record.
    const invoke = wrapHandler(fixture, 'fixture.add', handlers['fixture.add']);
    const result = await invoke({ left: 2.5, right: 3 });

    expect(result.ok).toBe(false);
  });

  it('converts a thrown handler error into a structured error, preserving the cause', async () => {
    const invoke = wrapHandler(fixture, 'fixture.fail', handlers['fixture.fail']);
    const result = await invoke({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.name).toBe('Error');
    expect(result.error.message).toBe('the underlying thing broke');
    // The cause is the half of a failure that usually explains it, and it is
    // exactly the half a bare-string error loses.
    expect(result.error.cause?.name).toBe('TypeError');
    expect(result.error.cause?.message).toBe('because this was wrong');
  });

  it('rejects a handler whose return value has drifted from the declared result', async () => {
    // The defect this catches is a main-process bug. Caught here it names the
    // channel and the field; uncaught it becomes `undefined` in the renderer.
    const drifted = { 'fixture.add': () => Promise.resolve({ sum: 'not a number' }) };
    const invoke = wrapHandler(
      fixture,
      'fixture.add',
      drifted['fixture.add'] as unknown as FixtureHandlers['fixture.add'],
    );
    const result = await invoke({ left: 1, right: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('does not match its declared result');
    }
  });
});

describe('toError', () => {
  it('rebuilds name, message and the whole cause chain', () => {
    const error = toError({
      name: 'RangeError',
      message: 'outer',
      cause: { name: 'TypeError', message: 'inner' },
    });

    expect(error.name).toBe('RangeError');
    expect(error.message).toBe('outer');
    expect((error.cause as Error).name).toBe('TypeError');
  });

  it('keeps the remote stack separate from the local one', () => {
    const error = toError({ name: 'Error', message: 'boom', stack: 'REMOTE FRAMES' });

    // Overwriting `stack` with the sender's frames would make the local call
    // site that failed unfindable, which is the opposite of helpful.
    expect(error.stack).not.toBe('REMOTE FRAMES');
    expect((error as unknown as { remoteStack: string }).remoteStack).toBe('REMOTE FRAMES');
  });
});

describe('createClient', () => {
  /** Wires a client straight to the wrapped handlers, no process in between. */
  function inProcessClient() {
    const wrapped = {
      'fixture.add': wrapHandler(fixture, 'fixture.add', handlers['fixture.add']),
      'fixture.fail': wrapHandler(fixture, 'fixture.fail', handlers['fixture.fail']),
    };
    return createClient(fixture, (id, params) => wrapped[id](params));
  }

  it('returns the value on success', async () => {
    await expect(inProcessClient()['fixture.add']({ left: 4, right: 5 })).resolves.toEqual({
      sum: 9,
    });
  });

  it('throws a reconstructed Error, with its cause, on failure', async () => {
    // The full round trip: a throw in the handler, structured for the wire,
    // rebuilt as a throw at the call site. A caller writes ordinary try/catch
    // and still sees the original cause.
    await expect(inProcessClient()['fixture.fail']({})).rejects.toThrow(
      'the underlying thing broke',
    );

    try {
      await inProcessClient()['fixture.fail']({});
      expect.unreachable('the client should have thrown');
    } catch (thrown) {
      expect((thrown as Error).cause).toBeInstanceOf(Error);
      expect(((thrown as Error).cause as Error).message).toBe('because this was wrong');
    }
  });

  it('rejects a malformed envelope rather than passing undefined onward', async () => {
    const client = createClient(fixture, () => Promise.resolve({ unexpected: true }));
    await expect(client['fixture.add']({ left: 1, right: 1 })).rejects.toThrow(
      'Malformed response envelope for "fixture.add"',
    );
  });
});

describe('unwrap', () => {
  it('returns the value of a success', () => {
    expect(unwrap({ ok: true, value: 42 })).toBe(42);
  });

  it('throws on a failure', () => {
    expect(() => unwrap({ ok: false, error: { name: 'Error', message: 'nope' } })).toThrow('nope');
  });
});
