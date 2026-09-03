import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import {
  PROBE_CODE_MAX_CHARS,
  type ContainmentProbePaths,
  type ContainmentProbeRequest,
  type ContainmentReport,
  type ProbeOutcome,
  classifyContainment,
  outcomeForErrorCode,
  probeCode,
  probeContainment,
  PROBE_TIMED_OUT,
  outcomeForConnectErrorCode,
  probeLoopback,
  probePath,
} from './containment.js';
import { engineChannels } from './engineChannels.js';
import { createEngineHandlers } from './engineHandlers.js';

/**
 * ADR-0023 §5's table, and the fixtures are built so the classifier's likely
 * bugs cannot produce them.
 *
 * The recurring shape here: **every negative-side case carries a positive probe
 * that READ.** A classifier that consults the positive side first, or that
 * skips the request-validity check, answers `contained` for those inputs — and
 * a fixture whose positive side had also failed would let that bug through
 * while looking like coverage.
 */

const REFUSED: ProbeOutcome = { kind: 'refused', code: 'EACCES' };
const READ: ProbeOutcome = { kind: 'read', bytes: 64 };

/** A request whose negative side is valid: main read it just before. */
function request(overrides: Partial<ContainmentProbeRequest> = {}): ContainmentProbeRequest {
  return {
    positive: { path: 'C:\\install\\koffi.node', origin: 'install-root' },
    negative: { path: 'C:\\elsewhere\\secret.txt', origin: 'app-created', readableBytes: 4096 },
    loopback: { port: 51_515, mainReadBytes: 23 },
    ...overrides,
  };
}

/**
 * The loopback outcome defaults to `refused` — the contained answer — so every
 * case written before (c) existed keeps asking exactly what it asked, and the
 * cases below that vary it are the only ones making a claim about it.
 */
const report = (
  positive: ProbeOutcome,
  negative: ProbeOutcome,
  loopback: ProbeOutcome = REFUSED,
): ContainmentReport => ({
  positive,
  negative,
  loopback,
});

describe('classifyContainment', () => {
  it('reports contained when the host reached what it must and was refused what it must not', () => {
    expect(classifyContainment(request(), report(READ, REFUSED))).toEqual({ kind: 'contained' });
  });

  it('reports containment-absent when the negative path was reachable, even though the positive one was too', () => {
    const verdict = classifyContainment(request(), report(READ, { kind: 'read', bytes: 4096 }));
    expect(verdict.kind).toBe('containment-absent');
  });

  /**
   * The fixture is otherwise a clean `contained`: negative refused, positive
   * read. Only the missing evidence separates them, which is the point — a
   * classifier that trusted the refusal answers `contained` here.
   */
  it('refuses to conclude when main never read the negative path', () => {
    const verdict = classifyContainment(
      request({ negative: { path: 'C:\\gone.txt', origin: 'app-created', readableBytes: 0 } }),
      report(READ, REFUSED),
    );
    expect(verdict.kind).toBe('unreadable');
    expect(verdict.kind === 'unreadable' && verdict.detail).toMatch(/did not read/u);
  });

  it('refuses to conclude when the negative path was absent to the host but readable to main', () => {
    const verdict = classifyContainment(
      request(),
      report(READ, { kind: 'absent', code: 'ENOENT' }),
    );
    expect(verdict.kind).toBe('unreadable');
  });

  it('refuses to conclude when the negative probe errored in some third way', () => {
    const verdict = classifyContainment(request(), report(READ, { kind: 'error', code: 'EMFILE' }));
    expect(verdict.kind).toBe('unreadable');
  });

  /**
   * The two rows that differ only by `origin`, and the difference is the whole
   * of UU-2: one is a premise failing on a condition the app cannot fix, the
   * other is a grant the app owns not taking. Same observation, opposite
   * responses, so a classifier that ignored `origin` passes either case alone.
   */
  it('names premise P1 when the refused positive path is in the install root', () => {
    const verdict = classifyContainment(
      request({ positive: { path: 'C:\\Program Files\\WindowsApps\\x\\koffi.node', origin: 'install-root' } }),
      report({ kind: 'refused', code: 'EACCES' }, REFUSED),
    );
    expect(verdict.kind).toBe('premise-p1-false');
    expect(verdict.kind === 'premise-p1-false' && verdict.detail).toMatch(/cannot repair it/u);
  });

  it('names the grant when the refused positive path is one the app created', () => {
    const verdict = classifyContainment(
      request({ positive: { path: 'C:\\Users\\me\\AppData\\handed\\in.pdf', origin: 'app-created' } }),
      report({ kind: 'refused', code: 'EACCES' }, REFUSED),
    );
    expect(verdict.kind).toBe('grant-did-not-take');
  });

  /**
   * (c), ADR-0023 Decision 15. Every case here carries a positive that READ and
   * a filesystem negative that was REFUSED — an otherwise clean `contained` —
   * so the loopback side is the only thing separating the verdicts, and a
   * classifier that never looked at it answers `contained` for all of them.
   */
  it('reports network-reachable when the host read bytes off the loopback listener', () => {
    const verdict = classifyContainment(request(), report(READ, REFUSED, { kind: 'read', bytes: 23 }));
    expect(verdict.kind).toBe('network-reachable');
    expect(verdict.kind === 'network-reachable' && verdict.detail).toMatch(/send a document/u);
  });

  /**
   * The control that makes the refusal mean anything. Same fixture as the
   * `contained` case in every other respect: only main's own reading is
   * missing, and a classifier that trusted the host's refusal answers
   * `contained` here.
   */
  it('refuses to conclude when main never read from the loopback port', () => {
    const verdict = classifyContainment(
      request({ loopback: { port: 51_515, mainReadBytes: 0 } }),
      report(READ, REFUSED),
    );
    expect(verdict.kind).toBe('unreadable');
    expect(verdict.kind === 'unreadable' && verdict.detail).toMatch(/answers nobody/u);
  });

  /**
   * `ECONNREFUSED` after main read from the port is two readings of different
   * worlds — the listener main used is gone — and folding it into the host's
   * refusal would report containment for a probe that measured a dead endpoint.
   */
  it('refuses to conclude when nothing was listening for the host but something was for main', () => {
    const verdict = classifyContainment(
      request(),
      report(READ, REFUSED, { kind: 'absent', code: 'ECONNREFUSED' }),
    );
    expect(verdict.kind).toBe('unreadable');
    expect(verdict.kind === 'unreadable' && verdict.detail).toMatch(/different worlds/u);
  });

  it('refuses to conclude when our own bound fired instead of the stack answering', () => {
    const verdict = classifyContainment(
      request(),
      report(READ, REFUSED, { kind: 'error', code: PROBE_TIMED_OUT }),
    );
    expect(verdict.kind).toBe('unreadable');
  });

  it('refuses to conclude when the positive path was absent', () => {
    const verdict = classifyContainment(
      request(),
      report({ kind: 'absent', code: 'ENOENT' }, REFUSED),
    );
    expect(verdict.kind).toBe('unreadable');
  });

  /**
   * No input produces `contained` except the one above, and that is worth an
   * assertion of its own: the reassuring verdict is the one a broken classifier
   * drifts towards, so it is checked as an exhaustive property rather than only
   * as a happy path.
   */
  it('produces contained for exactly one combination out of every triple of outcomes', () => {
    const outcomes: ProbeOutcome[] = [
      READ,
      REFUSED,
      { kind: 'absent', code: 'ENOENT' },
      { kind: 'error', code: 'EMFILE' },
    ];
    const contained = outcomes.flatMap((positive) =>
      outcomes.flatMap((negative) =>
        outcomes
          .filter(
            (loopback) =>
              classifyContainment(request(), report(positive, negative, loopback)).kind ===
              'contained',
          )
          .map((loopback) => `${positive.kind}/${negative.kind}/${loopback.kind}`),
      ),
    );
    expect(contained).toEqual(['read/refused/refused']);
    // The count is stated so a shrinking outcome set cannot make the assertion
    // above pass by never reaching the other 63.
    expect(outcomes.length ** 3).toBe(64);
  });
});

describe('outcomeForConnectErrorCode', () => {
  it.each([
    ['ETIMEDOUT', 'refused'],
    ['EACCES', 'refused'],
    ['EPERM', 'refused'],
    ['ECONNREFUSED', 'absent'],
    ['ENETUNREACH', 'error'],
    ['EHOSTUNREACH', 'error'],
  ])('maps %s to %s', (code, kind) => {
    expect(outcomeForConnectErrorCode(code).kind).toBe(kind);
  });

  /**
   * The two rules are separate authorities, not a copy, and this is what says
   * so: a filesystem code means nothing to a connect and vice versa. If one
   * were quietly delegating to the other, these would agree.
   */
  it('disagrees with the filesystem rule on the codes that belong to one domain each', () => {
    expect(outcomeForConnectErrorCode('ECONNREFUSED').kind).toBe('absent');
    expect(outcomeForErrorCode('ECONNREFUSED').kind).toBe('error');
    expect(outcomeForErrorCode('ENOENT').kind).toBe('absent');
    expect(outcomeForConnectErrorCode('ENOENT').kind).toBe('error');
  });

  /**
   * The direction that matters. An unrecognised code must never become the
   * answer a containment probe hopes for.
   */
  it('never folds an unrecognised code into refused', () => {
    for (const code of ['EMFILE', 'EPIPE', 'UNKNOWN', 'ENOTSOCK', PROBE_TIMED_OUT]) {
      expect(outcomeForConnectErrorCode(code).kind).not.toBe('refused');
    }
  });
});

describe('outcomeForErrorCode', () => {
  it.each([
    ['ENOENT', 'absent'],
    ['ENOTDIR', 'absent'],
    ['EACCES', 'refused'],
    ['EPERM', 'refused'],
  ])('maps %s to %s', (code, kind) => {
    expect(outcomeForErrorCode(code).kind).toBe(kind);
  });

  /**
   * An unrecognised code must NOT fold into `refused`. That fold would be a
   * guess in the reassuring direction — `refused` is the answer a containment
   * probe hopes for, so an error class nobody anticipated would arrive as
   * evidence of containment.
   */
  it('leaves an unrecognised code as error rather than folding it into refused', () => {
    expect(outcomeForErrorCode('EMFILE').kind).toBe('error');
    expect(outcomeForErrorCode('UNKNOWN').kind).toBe('error');
  });
});

/**
 * The probe against a real filesystem.
 *
 * `refused` is NOT exercised here, and saying so is better than a case that
 * pretends: producing a genuine access denial needs an ACL edit, which is
 * machine state and belongs to the spike and to RR-3's proof on the shim job
 * (ADR-0023 §6). What is covered here is the distinction the classifier depends
 * on most — that a missing path reports `absent` and never `refused` — with a
 * present file beside it so "absent" is a reading and not a broken probe.
 */
describe('probePath against a real filesystem', () => {
  let directory: string;
  let present: string;
  let empty: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'monstera-containment-'));
    present = join(directory, 'present.bin');
    empty = join(directory, 'empty.bin');
    await writeFile(present, new Uint8Array([1, 2, 3, 4]));
    await writeFile(empty, new Uint8Array(0));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads a file that is there', async () => {
    expect(await probePath(present)).toEqual({ kind: 'read', bytes: 4 });
  });

  it('reports a zero-length file as read, not as a failure', async () => {
    expect(await probePath(empty)).toEqual({ kind: 'read', bytes: 0 });
  });

  it('reports a missing path as absent, in the same directory a present one reads from', async () => {
    const outcome = await probePath(join(directory, 'nope.bin'));
    expect(outcome.kind).toBe('absent');
  });

  it('runs all three probes and reports all three, without deciding anything', async () => {
    const listener = createServer((socket) => {
      socket.end('hello');
    });
    await new Promise<void>((resolve) => {
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    const port = address !== null && typeof address !== 'string' ? address.port : 0;

    try {
      const observed = await probeContainment({
        positive: present,
        negative: join(directory, 'nope.bin'),
        loopbackPort: port,
      });
      expect(observed.positive.kind).toBe('read');
      expect(observed.negative.kind).toBe('absent');
      expect(observed.loopback).toEqual({ kind: 'read', bytes: 5 });
    } finally {
      listener.close();
    }
  });

  /**
   * `probeLoopback`'s resolution test (audit item 4a), against the two states
   * that decide a verdict: an endpoint that answers, and one that does not.
   *
   * **Reaching a real listener is the load-bearing half.** A probe that could
   * never report `read` would answer `refused` on an uncontained host and hand
   * back `contained` — the reassuring verdict, from an instrument that cannot
   * see. The closed-port half then separates that from the absent case.
   */
  it('reports a listening loopback port as read and a closed one as absent', async () => {
    const listener = createServer((socket) => {
      socket.end('hello');
    });
    await new Promise<void>((resolve) => {
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    const port = address !== null && typeof address !== 'string' ? address.port : 0;

    const open = await probeLoopback(port);
    // Closed by taking the SAME port down, so the two readings differ in one
    // thing. A different port number would vary two.
    await new Promise<void>((resolve) => {
      listener.close(() => {
        resolve();
      });
    });
    const closed = await probeLoopback(port);

    expect(open).toEqual({ kind: 'read', bytes: 5 });
    expect(closed.kind).toBe('absent');
    expect(closed.kind === 'absent' && closed.code).toBe('ECONNREFUSED');
  });

  /**
   * A socket that connects and is closed with nothing on it has not shown that
   * bytes can cross, so it must not read as `read`. This is the branch a probe
   * keyed on the `connect` event would get wrong, and it would get it wrong in
   * the direction that reports a contained host as reachable.
   */
  it('does not call an empty connection a read', async () => {
    const listener = createServer((socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve) => {
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    const port = address !== null && typeof address !== 'string' ? address.port : 0;

    try {
      const outcome = await probeLoopback(port);
      expect(outcome.kind).not.toBe('read');
      expect(outcome.kind).toBe('error');
    } finally {
      listener.close();
    }
  });
});

/**
 * The rule `probeCode` composes against and `engineChannels.ts` validates
 * against are the same rule, and this is the case that says so.
 *
 * The property is a **joint** one — *nothing the host can compose is refused by
 * its own channel* — so it is asserted against the real declared schema rather
 * than against a second spelling of the pattern here. A copy would agree with
 * itself while both drifted.
 *
 * Every input below is a value a thrown filesystem error can actually carry:
 * `code` is not a documented-and-guaranteed errno string, and `String()` of an
 * object, a symbol-free bag or a number produces exactly these shapes.
 */
describe('a probe code the host composes is one the channel accepts', () => {
  const RESULT = engineChannels['engine/probe-containment'].result;

  const ADVERSARIAL: readonly { readonly label: string; readonly thrown: unknown }[] = [
    { label: 'an ordinary errno', thrown: { code: 'EACCES' } },
    { label: 'a newline, which would write a line of its own in a log', thrown: { code: 'E\nX' } },
    { label: 'longer than the bound', thrown: { code: `E${'X'.repeat(PROBE_CODE_MAX_CHARS)}` } },
    { label: 'lower case', thrown: { code: 'eacces' } },
    { label: 'empty', thrown: { code: '' } },
    { label: 'an object, which String() renders', thrown: { code: {} } },
    { label: 'a number', thrown: { code: 404 } },
    { label: 'no code at all', thrown: new Error('boom') },
    { label: 'not an object', thrown: 'EACCES' },
  ];

  it.each(ADVERSARIAL)('accepts a report built from $label', ({ thrown }) => {
    const outcome = outcomeForErrorCode(probeCode(thrown));
    expect(
      RESULT.safeParse({ positive: outcome, negative: outcome, loopback: outcome }).success,
    ).toBe(true);
  });

  /**
   * THE CONTROL, and without it the cases above pass against a schema that
   * accepts anything — which is the failure they exist to rule out, not a
   * hypothetical one: `code: z.string()` with no bound would satisfy all nine.
   *
   * So this asserts the schema DISCRIMINATES, by feeding it what the host would
   * send with the normalisation removed. Mutating `probeCode` to return `raw`
   * reddens the run here.
   */
  it('refuses the same reports with the normalisation removed', () => {
    const raw = ADVERSARIAL.map(({ thrown }) =>
      outcomeForErrorCode(
        typeof thrown === 'object' && thrown !== null && 'code' in thrown
          ? String((thrown as { readonly code: unknown }).code)
          : 'UNKNOWN',
      ),
    ).filter((outcome) => !RESULT.safeParse({ positive: outcome, negative: outcome }).success);

    expect(raw.length).toBeGreaterThan(0);
  });

  it('never normalises toward the reassuring answer', () => {
    // A code this rule cannot read must reach `error` — *measured nothing* —
    // and never `refused`, which is the observation a containment probe hopes
    // for. Asserted over the whole set rather than one case, because the
    // direction is the property and one input cannot show it.
    for (const { thrown } of ADVERSARIAL) {
      const normalised = probeCode(thrown);
      if (normalised !== 'UNKNOWN') continue;
      expect(outcomeForErrorCode(normalised).kind).toBe('error');
    }
  });
});

/**
 * The host's side of the channel: it probes what it was asked to probe, and
 * adds no judgement.
 *
 * **The assertion is the CALL, not the answer**, and that is the whole design of
 * these two cases. A handler that ignored the request and probed two paths of
 * its own choosing returns a report of exactly the same shape, so an assertion
 * on the returned outcomes cannot separate the two — which is the end-state
 * trap this project has now paid for four times.
 *
 * Driven through `wrapHandlers` rather than by calling the handler directly, so
 * the declared schema validates both directions here as it does in the host.
 */
describe('the engine host answers a containment probe', () => {
  /** Everything a probe must not touch, so a handler that reaches fails loudly. */
  const forbidden = {
    sessions: {
      lookup: () => {
        throw new Error('a containment probe must not look a session up');
      },
      issue: () => {
        throw new Error('a containment probe must not issue a session');
      },
      forget: () => {
        throw new Error('a containment probe must not forget a session');
      },
    },
    writer: {
      open: () => {
        throw new Error('a containment probe must not open a document');
      },
      serialise: () => {
        throw new Error('a containment probe must not serialise');
      },
      close: () => {
        throw new Error('a containment probe must not close');
      },
    },
    files: {
      readSnapshot: () => {
        throw new Error('a containment probe must not read the snapshot directory');
      },
      writeOutput: () => {
        throw new Error('a containment probe must not write the output directory');
      },
    },
    geometry: () => {
      throw new Error('a containment probe must not read a page tree');
    },
    pageText: () => {
      throw new Error('a containment probe must not read page text');
    },
    pageLinks: () => {
      throw new Error('a containment probe must not read page links');
    },
    destinations: () => {
      throw new Error('a containment probe must not read the outline');
    },
    layers: () => {
      throw new Error('a containment probe must not read the layers');
    },
  };

  function probeHandler(answer: ContainmentReport) {
    const asked: ContainmentProbePaths[] = [];
    const wrapped = wrapHandlers(
      engineChannels,
      createEngineHandlers(
        forbidden.sessions,
        localMupdfExecution,
        forbidden.writer,
        forbidden.files,
        (paths) => {
          asked.push(paths);
          return Promise.resolve(answer);
        },
        forbidden.geometry,
        forbidden.pageText,
        forbidden.pageLinks,
        forbidden.destinations,
        forbidden.layers,
      ),
      () => undefined,
    );
    return { asked, call: wrapped['engine/probe-containment'] };
  }

  it('probes the two paths and the one port it was sent, and no others', async () => {
    const { asked, call } = probeHandler(report(READ, REFUSED));

    await call({
      positive: 'C:\\install\\koffi.node',
      negative: 'C:\\elsewhere\\secret.txt',
      loopbackPort: 51_515,
    });

    expect(asked).toEqual([
      {
        positive: 'C:\\install\\koffi.node',
        negative: 'C:\\elsewhere\\secret.txt',
        loopbackPort: 51_515,
      },
    ]);
  });

  /**
   * `mainReadBytes` is main's evidence, and the type keeps it out of the
   * request the host receives. This asserts the wire agrees: a schema that
   * tolerated the extra key would let a future caller hand the measuring half
   * the very thing its report is judged against.
   */
  it('refuses a request carrying the evidence main judges the report against', () => {
    const PAYLOAD = engineChannels['engine/probe-containment'].params;
    expect(
      PAYLOAD.safeParse({
        positive: 'C:\\install\\koffi.node',
        negative: 'C:\\elsewhere\\secret.txt',
        loopbackPort: 51_515,
      }).success,
    ).toBe(true);
    expect(
      PAYLOAD.safeParse({
        positive: 'C:\\install\\koffi.node',
        negative: 'C:\\elsewhere\\secret.txt',
        loopbackPort: 51_515,
        mainReadBytes: 23,
      }).success,
    ).toBe(false);
  });

  it('reports what the probe observed, unchanged and unjudged', async () => {
    // `containment-absent` in everything but name: the host read the path it
    // must not reach. The handler must hand that back exactly as observed —
    // a host that quietly softened its own worst answer is the one shape this
    // channel cannot tolerate, and `classifyContainment` in MAIN is the only
    // thing entitled to turn it into a verdict.
    const observed = report(READ, { kind: 'read', bytes: 4096 });
    const { call } = probeHandler(observed);

    await expect(
      call({
        positive: 'C:\\install\\koffi.node',
        negative: 'C:\\elsewhere\\secret.txt',
        loopbackPort: 51_515,
      }),
    ).resolves.toEqual({ ok: true, value: observed });
  });
});
