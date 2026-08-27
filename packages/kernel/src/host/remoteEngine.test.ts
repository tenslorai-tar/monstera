import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { type CommandOfKind, createClient, type Incident, wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import { type ByteImage, type MupdfSession } from '../engineSeam.js';
import { mupdfWriter, withDocument } from '../mupdfWriter.js';
import { engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';
import {
  createRemoteSessions,
  EngineSessionGone,
  remoteMupdfExecution,
  UnknownRemoteSession,
} from './remoteEngine.js';

/**
 * The two halves of ADR-0023 Decision 10, joined (Decision 11's channels).
 *
 * **These cases drive BOTH halves against ONE document**, which is the only way
 * the decision's central claim is testable: the host performs the same
 * `declaredSpecs` lookup main would have performed, so a command that crosses
 * has the same effect as one that did not. Anything less — a stubbed host, an
 * asserted round trip — proves the wire and not the claim.
 *
 * The transport here is a function call rather than a pipe. That is deliberate
 * and is stated so it is not read as more than it is: framing, the reader thread
 * and the client's correlation are proven in their own files, and joining them
 * here would test four things at once and locate a failure in none of them.
 * What this file proves is that the two EXECUTION halves agree.
 */

let flat: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  flat = await document.save();
});

const rotateFirst: CommandOfKind<'rotatePages'> = {
  kind: 'rotatePages',
  pages: [0],
  quarterTurns: 1,
};

/** The page's `/Rotate`, or `null` where the key is absent. */
const rotationOf = (session: MupdfSession): Promise<number | null> =>
  withDocument(session, (document) => {
    const rotate = document.loadPage(0).getObject().get('Rotate');
    return rotate.isNull() ? null : rotate.asNumber();
  });

/**
 * One host and one main, wired to each other.
 *
 * `requests` counts what reached the wire, which is what separates *refused on
 * this side* from *refused by the host* — two outcomes that produce the same
 * rejection otherwise.
 */
async function joined(): Promise<{
  readonly session: MupdfSession;
  readonly token: MupdfSession;
  readonly remote: ReturnType<typeof remoteMupdfExecution>;
  readonly sessions: ReturnType<typeof createRemoteSessions>;
  readonly requests: () => number;
  readonly incidents: readonly Incident[];
}> {
  const session = await mupdfWriter.open(flat);
  const held = new Map<string, HostSession>([
    ['h1', { session, outputDirectory: 'no directory: the execution half writes no bytes' }],
  ]);

  const incidents: Incident[] = [];
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers(
      {
        lookup: (id) => held.get(id),
        issue: () => {
          throw new Error('this file drives the EXECUTION half; nothing here opens a session');
        },
        forget: () => {
          throw new Error('this file drives the EXECUTION half; nothing here closes a session');
        },
      },
      localMupdfExecution,
      // THROWING STUBS RATHER THAN WORKING ONES. Every case below is about
      // apply, capture and invert, none of which may touch a document image or
      // a directory — so a handler that reached for either fails loudly here
      // instead of passing against a surface that happened to work.
      {
        open: () => {
          throw new Error('the execution half must not open');
        },
        serialise: () => {
          throw new Error('the execution half must not serialise');
        },
        close: () => {
          throw new Error('the execution half must not close');
        },
      },
      {
        readSnapshot: () => {
          throw new Error('the execution half must not read the snapshot directory');
        },
        writeOutput: () => {
          throw new Error('the execution half must not write the output directory');
        },
      },
      () => {
        throw new Error('the execution half must not probe containment');
      },
    ),
    (incident) => incidents.push(incident),
  );

  let requests = 0;
  const client = createClient(engineChannels, async (id, params) => {
    requests += 1;
    return wrapped[id](params);
  });

  const sessions = createRemoteSessions();
  return {
    session,
    token: sessions.adopt('h1'),
    remote: remoteMupdfExecution(client, sessions),
    sessions,
    requests: () => requests,
    incidents,
  };
}

describe('the remote engine execution half (ADR-0023 Decisions 10 and 11)', () => {
  it('THE ROUND TRIP: an applied command changes the document the HOST holds', async () => {
    const { session, token, remote } = await joined();
    try {
      expect(await rotationOf(session)).toBeNull();

      await remote.apply(token, rotateFirst);

      // The claim, and it is about the host's copy of `declaredSpecs` rather
      // than about the wire: nothing main-side touched this document.
      expect(await rotationOf(session)).toBe(90);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('and CAPTURE returns exactly what the local half returns for the same document', async () => {
    const { session, token, remote } = await joined();
    try {
      const overWire = await remote.capture(token, rotateFirst);
      const inProcess = await localMupdfExecution.capture(session, rotateFirst);

      // B3a's claim made checkable: one implementation, two routes to it. A
      // second remote `capture` — the candidate Decision 10 rejected — would
      // agree here most of the time, which is precisely why the assertion is
      // equality against the local half rather than against a literal.
      expect(overWire).toStrictEqual(inProcess);
      expect(overWire).toStrictEqual({
        captured: true,
        prior: [{ page: 0, prior: { present: false } }],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('and INVERT restores prior state through the same route', async () => {
    const { session, token, remote } = await joined();
    try {
      const captured = await remote.capture(token, rotateFirst);
      if (!captured.captured) throw new Error('the fixture must capture');
      await remote.apply(token, rotateFirst);
      expect(await rotationOf(session)).toBe(90);

      await remote.invert(token, 'rotatePages', captured.prior);

      // §3: prior state restored VERBATIM, including absence. The page
      // inherited, so the inverse DELETES the key — a reversing rotation would
      // leave a `0` here and render identically, which is the whole reason §3
      // is written the way it is.
      expect(await rotationOf(session)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a session the host does not hold is a DECLARED failure, and nothing is applied', async () => {
    const { session, remote, sessions } = await joined();
    try {
      const stranger = sessions.adopt('h-does-not-exist');

      await expect(remote.apply(stranger, rotateFirst)).rejects.toThrow(EngineSessionGone);

      // Declared, not `internal`: the supervisor rebuilds on this and cannot
      // decide that from an opaque code. Asserting the CLASS is what separates
      // the two, since both arrive as a rejection.
      expect(await rotationOf(session)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a token this registry never adopted is refused BEFORE the wire', async () => {
    const { session, remote, requests } = await joined();
    try {
      const forged = { engine: 'mupdf' } as MupdfSession;
      const before = requests();

      await expect(remote.apply(forged, rotateFirst)).rejects.toThrow(UnknownRemoteSession);

      // The count is the whole assertion. A forged token refused by the HOST
      // and one refused HERE both reject, and only the request count tells them
      // apart — which is the property 10b is about: main holds a token whose
      // meaning is membership of this map, not a string it can invent.
      expect(requests()).toBe(before);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a released token stops working, though it is still a valid token', async () => {
    const { session, token, remote, sessions } = await joined();
    try {
      sessions.release(token);

      // What a brand cannot express: this object was minted by the registry and
      // is still structurally a `MupdfSession`. Only map membership separates a
      // live token from a spent one.
      await expect(remote.apply(token, rotateFirst)).rejects.toThrow(UnknownRemoteSession);
      expect(await rotationOf(session)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a handler that throws is reported as an incident, never as a declared code', async () => {
    const session = await mupdfWriter.open(flat);
    const incidents: Incident[] = [];
    const wrapped = wrapHandlers(
      engineChannels,
      createEngineHandlers(
        {
          lookup: () => ({ session, outputDirectory: 'unused' }),
          issue: () => {
            throw new Error('unused');
          },
          forget: () => {
            throw new Error('unused');
          },
        },
        {
          ...localMupdfExecution,
          apply: () => Promise.reject(new Error('the engine faulted')),
        },
        {
          open: () => {
            throw new Error('unused');
          },
          serialise: () => {
            throw new Error('unused');
          },
          close: () => {
            throw new Error('unused');
          },
        },
        {
          readSnapshot: () => {
            throw new Error('unused');
          },
          writeOutput: () => {
            throw new Error('unused');
          },
        },
        () => {
          throw new Error('unused');
        },
      ),
      (incident) => incidents.push(incident),
    );
    const sessions = createRemoteSessions();
    const client = createClient(engineChannels, async (id, params) => wrapped[id](params));
    const remote = remoteMupdfExecution(client, sessions);

    try {
      await expect(remote.apply(sessions.adopt('h1'), rotateFirst)).rejects.toThrow(
        /engine\/apply/u,
      );

      // The diagnostic stays this side of the boundary and the renderer-facing
      // code is `internal` — so a fault cannot be mistaken for `no-such-session`
      // and answered with a rebuild that would fault again.
      expect(incidents).toHaveLength(1);
      expect(JSON.stringify(incidents[0]?.diagnostic)).toMatch(/the engine faulted/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
