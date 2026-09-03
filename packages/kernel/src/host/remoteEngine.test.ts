import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { type CommandOfKind, createClient, type Incident, wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { mupdfWriter, withDocument } from '../mupdfWriter.js';
import { readPageGeometry } from '../pageGeometry.js';
import { readDestinations } from '../destinations.js';
import { readLayers } from '../layers.js';
import { readPageLinks } from '../pageLinks.js';
import { readPageTextJson } from '../pageText.js';
import { engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';
import {
  createRemoteSessions,
  EngineSessionGone,
  remoteMupdfExecution,
  remoteMupdfGeometry,
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

/**
 * A token stands for a handle AND an area since ADR-0030 Decision 2.
 *
 * This file's subject is running a command against a session, which touches
 * neither directory — so one shared value is honest here, and a case that
 * needed two would be a case about the lifecycle in the wrong file.
 */
const AREA = { snapshotDirectory: 'in', outputDirectory: 'out' };

/** Every page of the three-page fixture, in order. */
const ALL_PAGES = [0, 1, 2];

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
  readonly geometry: ReturnType<typeof remoteMupdfGeometry>;
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
      // THE REAL READER, unlike the four stubs above, because the geometry
      // cases below are about what the HOST's page tree says after a command
      // crossed — which a stub cannot answer without becoming the thing under
      // test.
      readPageGeometry,
      // THE REAL READER for the same reason, so the text case below is about
      // what the HOST's document says rather than what a stub was told to say.
      readPageTextJson,
      readPageLinks,
      readDestinations,
      readLayers,
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
    token: sessions.adopt('h1', AREA),
    remote: remoteMupdfExecution(client, sessions),
    geometry: remoteMupdfGeometry(client, sessions),
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

  it('the GEOMETRY read crosses and reports the page tree the host holds', async () => {
    const { session, token, geometry } = await joined();
    try {
      expect(await geometry(token, ALL_PAGES)).toStrictEqual({
        pageCount: 3,
        rotations: [0, 0, 0],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THE CLAIM: a command that crossed moves the geometry the next read reports', async () => {
    const { session, token, remote, geometry } = await joined();
    try {
      // The before reading is what makes the after one mean something: without
      // it, `[90, 0, 0]` is satisfied by a fixture that already carried a
      // rotation, and this file's document is built by `pdf-lib` with no
      // `/Rotate` at all — which is exactly the shape that would make it so.
      expect(await geometry(token, ALL_PAGES)).toStrictEqual({
        pageCount: 3,
        rotations: [0, 0, 0],
      });

      await remote.apply(token, rotateFirst);

      // FINDING OOOOO-1 ANSWERED. Main's canonical image is unchanged by that
      // apply — a `DocumentRecord`'s bytes are `readonly` — so this is the only
      // route by which the rotation can reach anything main hands the renderer.
      // A view model that read main's bytes would report `[0, 0, 0]` here and be
      // wrong in the one direction nothing else observes.
      expect(await geometry(token, ALL_PAGES)).toStrictEqual({
        pageCount: 3,
        rotations: [90, 0, 0],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the PAGE LIST crosses, so the answer describes the pages this side asked about', async () => {
    const { session, token, remote, geometry } = await joined();
    try {
      await remote.apply(token, rotateFirst);

      // EVERY OTHER GEOMETRY CASE HERE NAMES ALL THREE PAGES IN ORDER, which is
      // the one request an adapter that ignored the list would also produce. So
      // this one asks out of order and short: `[2, 0]` separates a list that
      // crossed from a list that was rebuilt on the far side, and the rotate
      // above is what makes the two entries differ — against a flat document
      // both answers are `[0, 0]`.
      expect(await geometry(token, [2, 0])).toStrictEqual({ pageCount: 3, rotations: [0, 90] });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a session the host has forgotten is a declared miss, not an empty geometry', async () => {
    const { session, sessions, geometry } = await joined();
    try {
      // A zero-page answer and a missing session are the same news to anything
      // that only checks `rotations.length`, and the reassuring one is the empty
      // reading — a document with no pages needs no rotations. The declared code
      // is what separates them, and it is the one the supervisor rebuilds for.
      await expect(geometry(sessions.adopt('gone', AREA), ALL_PAGES)).rejects.toBeInstanceOf(
        EngineSessionGone,
      );
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
      const stranger = sessions.adopt('h-does-not-exist', AREA);

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
        () => {
          throw new Error('unused');
        },
        () => {
          throw new Error('unused');
        },
        () => {
          throw new Error('unused');
        },
        () => {
          throw new Error('unused');
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
      await expect(remote.apply(sessions.adopt('h1', AREA), rotateFirst)).rejects.toThrow(
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

  it('a rotation that is NOT a quarter turn is refused at the boundary, not drawn', async () => {
    // The schema's `refine` is what says a host that stopped snapping cannot
    // reach a viewport, and nothing exercised it: every geometry answer in this
    // file comes from `readPageGeometry`, which snaps. A guard whose only input
    // is a correct one is a guard nobody has seen work.
    //
    // 45 rather than a wild number, because 45 is what documents in the wild
    // actually carry (ADR-0009 §3) and it is the value MuPDF renders as 90 —
    // so it is the one a caller would draw half a quarter turn wrong.
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
        localMupdfExecution,
        mupdfWriter,
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
        // The page decides, so one harness carries the case and its control:
        // page 0 answers a raw 45 and page 1 a legal quarter turn.
        (_held, pages) =>
          Promise.resolve({ pageCount: 3, rotations: pages.map((page) => (page === 0 ? 45 : 90)) }),
        () => {
          throw new Error('the rotation-refusal case must not read page text');
        },
        () => {
          throw new Error('the rotation-refusal case must not read page links');
        },
        () => {
          throw new Error('the rotation-refusal case must not read the outline');
        },
        () => {
          throw new Error('the rotation-refusal case must not read the layers');
        },
      ),
      (incident) => incidents.push(incident),
    );
    const sessions = createRemoteSessions();
    const client = createClient(engineChannels, async (id, params) => wrapped[id](params));
    const geometry = remoteMupdfGeometry(client, sessions);

    try {
      const token = sessions.adopt('h1', AREA);
      await expect(geometry(token, [0])).rejects.toThrow(/engine\/page-geometry/u);
      expect(incidents).toHaveLength(1);

      // CONTROL: the same harness, the same channel, a legal value. Without it
      // this case is satisfied by a boundary that refuses every geometry answer
      // — which would be invisible here and would blank the renderer in the
      // product.
      expect(await geometry(token, [1])).toStrictEqual({ pageCount: 3, rotations: [90] });
      expect(incidents).toHaveLength(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
