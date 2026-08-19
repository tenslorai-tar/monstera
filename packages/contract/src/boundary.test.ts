import { err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createClient, wrapHandler, wrapHandlers } from './boundary.js';

/**
 * Declared here rather than by widening this package's `lib`.
 *
 * `packages/contract` deliberately has no Node and no DOM types — it is the
 * wire contract, and nothing in it should be able to reach a process. That
 * boundary already refused a `console.error` in `incident.ts` and was right to.
 * `structuredClone` is the transport's copying semantics, which is exactly what
 * these tests are about, so it is named locally and the package's reach is left
 * alone.
 */
declare function structuredClone<T>(value: T): T;
import { channel, type Handlers } from './channel.js';
import { type Incident, IncidentLog } from './incident.js';

/**
 * A fixture registry rather than the real one.
 *
 * The real registry holds only channels that have handlers (the wired rule), so
 * it is deliberately small and would exercise almost none of the mechanism.
 * These channels exist to push on the boundary itself — validation in both
 * directions, declared failures, throws, and what does **not** cross with them.
 */
const fixture = {
  'fixture.add': channel(
    'Adds two integers.',
    z.object({ left: z.number().int(), right: z.number().int() }),
    z.object({ sum: z.number().int() }),
    ['too-large'],
  ),
  'fixture.fail': channel('Always throws.', z.object({}), z.object({ never: z.string() })),
} as const;

type FixtureHandlers = Handlers<typeof fixture>;

/**
 * A thrown error shaped like the one that motivated ADR-0009 §9.
 *
 * Measured rather than invented: `readFileIdentity` rethrows every errno that is
 * not `ENOENT`/`ENOTDIR`, and a real `EPERM` from `stat` reads exactly this,
 * with the same absolute path in the stack. Constructed directly so the fixture
 * holds on every platform CI runs rather than only where that path exists.
 */
const SECRET_PATH = 'C:\\Users\\someone\\Documents\\salary-review.pdf';

function fsErrorCarryingAPath(): Error {
  const inner = new Error(`EPERM: operation not permitted, stat '${SECRET_PATH}'`);
  inner.stack = `Error: EPERM: operation not permitted, stat '${SECRET_PATH}'\n    at stat (${SECRET_PATH}:1:1)`;
  const outer = new Error('could not open the document', { cause: inner });
  outer.stack = `Error: could not open the document\n    at open (${SECRET_PATH}:2:2)`;
  return outer;
}

const handlers: FixtureHandlers = {
  'fixture.add': ({ left, right }) => Promise.resolve(ok({ sum: left + right })),
  'fixture.fail': () => {
    throw fsErrorCarryingAPath();
  },
};

/** Collects what the boundary logged, so a test can read the side that keeps the path. */
function recorder(): { sink: (incident: Incident) => void; seen: Incident[] } {
  const seen: Incident[] = [];
  return { sink: (incident) => seen.push(incident), seen };
}

/** A sink for the cases that are not about what was logged. */
function ignore(_incident: Incident): void {
  // Deliberately empty: these cases assert what CROSSED, not what was kept.
}

function wrapOne<K extends keyof typeof fixture>(
  id: K,
  handler: FixtureHandlers[K],
  sink: (incident: Incident) => void = ignore,
) {
  return wrapHandler(fixture, id, handler, new IncidentLog(sink));
}

describe('wrapHandler', () => {
  it('passes valid params through and returns the value', async () => {
    // Control for every rejection case below: without it, a wrapper that
    // rejected everything would satisfy all of them.
    const result = await wrapOne('fixture.add', handlers['fixture.add'])({ left: 2, right: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sum).toBe(5);
  });

  it('rejects params that do not match the schema', async () => {
    const { sink, seen } = recorder();
    const result = await wrapOne('fixture.add', handlers['fixture.add'], sink)({
      left: 'two',
      right: 3,
    });

    expect(result.ok).toBe(false);
    // A schema error names fields and values, which is a disclosure question
    // as much as an fs error is. It is recorded, not forwarded.
    if (!result.ok) expect(result.error.code).toBe('internal');
    expect(seen[0]?.diagnostic.message).toContain('Invalid params for "fixture.add"');
  });

  it('rejects params of the right type but the wrong shape', async () => {
    // `left` is declared an integer. Accepting 2.5 here would let a fractional
    // page index reach a writer of record.
    const result = await wrapOne('fixture.add', handlers['fixture.add'])({ left: 2.5, right: 3 });

    expect(result.ok).toBe(false);
  });

  it('passes a DECLARED failure straight through', async () => {
    const refuses: FixtureHandlers['fixture.add'] = () =>
      Promise.resolve(err({ code: 'too-large', incident: 'i0' }));
    const result = await wrapOne('fixture.add', refuses)({ left: 1, right: 1 });

    expect(result).toStrictEqual({ ok: false, error: { code: 'too-large', incident: 'i0' } });
  });

  it('CONTROL: an UNDECLARED code becomes internal rather than crossing', async () => {
    // The type already forbids this. The runtime check covers what the type
    // cannot see — a handler reached through an `any`, or a build that drifted
    // from the contract it was compiled against.
    const rogue = { 'fixture.add': () => Promise.resolve(err({ code: 'invented', incident: 'x' })) };
    const { sink, seen } = recorder();
    const result = await wrapOne(
      'fixture.add',
      rogue['fixture.add'] as unknown as FixtureHandlers['fixture.add'],
      sink,
    )({ left: 1, right: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal');
    expect(seen[0]?.diagnostic.message).toContain('undeclared failure code');
  });

  it('rejects a handler whose return value has drifted from the declared result', async () => {
    const drifted = { 'fixture.add': () => Promise.resolve(ok({ sum: 'not a number' })) };
    const { sink, seen } = recorder();
    const result = await wrapOne(
      'fixture.add',
      drifted['fixture.add'] as unknown as FixtureHandlers['fixture.add'],
      sink,
    )({ left: 1, right: 1 });

    expect(result.ok).toBe(false);
    expect(seen[0]?.diagnostic.message).toContain('does not match its declared result');
  });
});

describe('a thrown error does not carry its diagnostic across (ADR-0009 §9)', () => {
  it('THE PATH IS ABSENT FROM message, stack AND A NESTED cause', async () => {
    const { sink } = recorder();
    const result = await wrapOne('fixture.fail', handlers['fixture.fail'], sink)({});

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Asserted on the SERIALISED failure, and on all three fields separately.
    // A sanitiser that missed one of the three would pass a test checking the
    // other two, and the nested cause is the one a top-level fix leaves open.
    const wire = JSON.stringify(result.error);
    expect(wire).not.toContain(SECRET_PATH);
    expect(wire).not.toContain('salary-review');

    // And by name, so the assertion says which field it is about rather than
    // relying on the serialisation happening to include them.
    const asRecord = result.error as unknown as Record<string, unknown>;
    expect(asRecord['message']).toBeUndefined();
    expect(asRecord['stack']).toBeUndefined();
    expect(asRecord['cause']).toBeUndefined();
    expect(Object.keys(result.error).sort()).toStrictEqual(['code', 'incident']);
  });

  it('CONTROL: and the path IS in all three, main-side — the leak is real', async () => {
    const { sink, seen } = recorder();
    await wrapOne('fixture.fail', handlers['fixture.fail'], sink)({});

    // The control B2 requires: this reproduces the original defect. If the
    // diagnostic did not carry the path, the case above would pass against an
    // error that never had one — the vacuous shape, in the exact place §9 is
    // about. Each field asserted separately, for the reason above.
    const diagnostic = seen[0]?.diagnostic;
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.stack).toContain(SECRET_PATH);
    expect(diagnostic?.cause?.message).toContain(SECRET_PATH);
    expect(diagnostic?.cause?.stack).toContain(SECRET_PATH);
  });

  it('the incident id joins the two, and is not derived from anything about the document', async () => {
    const { sink, seen } = recorder();
    const result = await wrapOne('fixture.fail', handlers['fixture.fail'], sink)({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(seen[0]?.id).toBe(result.error.incident);
    // Opaque: it identifies a log line, not a file. A hash of the path would
    // join them just as well and would be a disclosure.
    expect(result.error.incident).toMatch(/^i\d+$/u);
  });
});

describe('everything that crosses survives structuredClone', () => {
  /**
   * The hard shape the in-process tests cannot see (audit item 2).
   *
   * Every test above calls the boundary as a function. The transport will
   * `structuredClone` what crosses, and a value carrying anything unclonable —
   * a class instance, a `Symbol`, a function, a getter on a prototype — passes
   * every one of those and dies at the first Electron call. Asserting it here
   * is what makes Electron *pure transport* later rather than a discovery.
   */
  const crossing = [
    ['a success envelope', ok({ sum: 5 })],
    ['a declared failure', err({ code: 'too-large', incident: 'i1' })],
    ['an internal failure', err({ code: 'internal', incident: 'i2' })],
    ['params', { left: 1, right: 2 }],
  ] as const;

  for (const [label, value] of crossing) {
    it(`${label} clones, and the clone is deep-equal`, () => {
      const cloned: unknown = structuredClone(value);
      expect(cloned).toStrictEqual(value);
    });
  }

  it('CONTROL: structuredClone REFUSES the shapes this is guarding against', () => {
    // Without this the cases above are satisfied by a clone that accepts
    // anything — and then they would prove nothing about the transport. A
    // function and a class instance with a method are the two shapes a failure
    // type could plausibly acquire.
    expect(() => structuredClone({ code: 'x', render: () => 'boom' })).toThrow();
    class WithMethod {
      readonly code = 'x';
      describe(): string {
        return 'boom';
      }
    }
    // A class instance clones, but arrives as a plain object without its
    // prototype — so the method is GONE rather than refused. That is the
    // quieter half of the same hazard and the reason the assertions above are
    // deep-equal rather than truthy.
    const clonedInstance = structuredClone(new WithMethod()) as unknown as Record<string, unknown>;
    expect(clonedInstance['describe']).toBeUndefined();
    expect(clonedInstance).toStrictEqual({ code: 'x' });
  });

  it('and a real boundary result clones', async () => {
    const { sink } = recorder();
    const result = await wrapOne('fixture.fail', handlers['fixture.fail'], sink)({});
    expect(structuredClone(result)).toStrictEqual(result);
  });
});

describe('createClient', () => {
  /** Wires a client straight to the wrapped handlers, no process in between. */
  function inProcessClient(sink: (incident: Incident) => void = ignore) {
    const wrapped = wrapHandlers(fixture, handlers, sink);
    return createClient(fixture, (id, params) => wrapped[id](params));
  }

  it('returns the value on success', async () => {
    await expect(inProcessClient()['fixture.add']({ left: 4, right: 5 })).resolves.toStrictEqual(
      ok({ sum: 9 }),
    );
  });

  it('returns a FAILURE as a value, not a throw', async () => {
    // It used to rebuild an Error so callers could use try/catch. There is no
    // message to rebuild one from now, and a value is the shape a caller cannot
    // forget to handle.
    const result = await inProcessClient()['fixture.fail']({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(JSON.stringify(result.error)).not.toContain(SECRET_PATH);
    }
  });

  it('rejects a malformed envelope rather than passing undefined onward', async () => {
    const client = createClient(fixture, () => Promise.resolve({ unexpected: true }));
    await expect(client['fixture.add']({ left: 1, right: 1 })).rejects.toThrow(
      'Malformed response envelope for "fixture.add"',
    );
  });

  it('CONTROL: an envelope carrying a MESSAGE is rejected, not passed on', async () => {
    // The last place a diagnostic could cross from a main build that drifted.
    // Extra fields are exactly what a permissive parse ignores, so the failure
    // this catches would otherwise be silent.
    const drifted = {
      ok: false,
      error: { code: 'internal', incident: 'i1', message: `stat '${SECRET_PATH}'` },
    };
    const client = createClient(fixture, () => Promise.resolve(drifted));
    await expect(client['fixture.add']({ left: 1, right: 1 })).rejects.toThrow(
      'Malformed response envelope',
    );
  });
});
