import { PDFArray, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { type CommandOfKind, createClient, type Incident, wrapHandlers } from '@monstera/contract';
import { ColorSpace, Pixmap } from 'mupdf';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { readAnnotations } from '../pageAnnotations.js';
import { engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';
import {
  createRemoteSessions,
  remoteMupdfExecution,
  type SessionAssets,
} from './remoteEngine.js';

/**
 * A command's bytes reaching the engine host without crossing its wire
 * ([ADR-0044](../../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)).
 *
 * ## THE TRANSPORT HERE IS A REAL JSON ROUND TRIP, unlike its neighbour's
 *
 * `remoteEngine.test.ts` joins the two execution halves with a function call and
 * says so — framing and correlation are proven in their own files, and joining
 * everything at once locates a failure nowhere. This file cannot do that,
 * because **the whole subject is what JSON does to a payload**: the host's
 * client frames `JSON.stringify({ id, channel, params })` and its runtime parses
 * the other end, so a `Uint8Array` arrives as an object of numeric keys and the
 * schema refines it away.
 *
 * So the shim below stringifies and parses, and a case that passes here is a
 * case whose payload genuinely survived that. The control asserts the shim can
 * SEE the failure — a command carrying bytes, sent through the same route, is
 * refused — because *nothing went wrong* is this file's reassuring answer and an
 * inert shim produces it.
 */

let flat: ByteImage;
let png: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 2; index += 1) document.addPage([612, 792]);
  flat = await document.save();

  // 7x3, deliberately not square: a dimension only the right XObject produces.
  const pixmap = new Pixmap(ColorSpace.DeviceRGB, [0, 0, 7, 3], false);
  pixmap.clear(200);
  png = pixmap.asPNG();
});

const SNAPSHOT_DIRECTORY = 'granted-read';
const AREA = { snapshotDirectory: SNAPSHOT_DIRECTORY, outputDirectory: 'granted-modify' };

function placement(bytes: Uint8Array): CommandOfKind<'placeImage'> {
  return {
    kind: 'placeImage',
    pages: [0],
    rect: { x0: 40, y0: 60, x1: 240, y1: 160 },
    bytes,
  };
}

/**
 * The two halves joined, with an in-memory directory standing in for the one
 * main grants and the host reads.
 *
 * `written` records every name that was ever created, so a case can tell *the
 * asset was removed* from *the asset was never written* — two states the
 * directory looks identical in afterwards, and only one of them is correct.
 */
async function joined(): Promise<{
  readonly remote: ReturnType<typeof remoteMupdfExecution>;
  readonly token: MupdfSession;
  readonly session: MupdfSession;
  readonly directory: Map<string, Uint8Array>;
  readonly written: string[];
  readonly incidents: readonly Incident[];
  /** The handler, reached through the same JSON shim the client uses. */
  readonly call: (id: 'engine/apply', params: unknown) => Promise<unknown>;
}> {
  const session = await mupdfWriter.open(flat);
  const directory = new Map<string, Uint8Array>();
  const written: string[] = [];

  const held = new Map<string, HostSession>([
    ['h1', { session, outputDirectory: AREA.outputDirectory, snapshotDirectory: SNAPSHOT_DIRECTORY }],
  ]);

  const incidents: Incident[] = [];
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: {
        lookup: (id) => held.get(id),
        issue: () => {
          throw new Error('this file drives the EXECUTION half; nothing here opens a session');
        },
        forget: () => {
          throw new Error('this file drives the EXECUTION half; nothing here closes a session');
        },
      },
      execution: localMupdfExecution,
      writer: {
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
      access: () => {
        throw new Error('the execution half opens nothing, so nothing has an access');
      },
      files: {
        // THE ONE STUB HERE THAT WORKS, and only for the directory this session
        // was granted: a handler reading anywhere else fails loudly, which is
        // what the second case asserts is not happening.
        readSnapshot: (where, name) => {
          if (where !== SNAPSHOT_DIRECTORY) {
            throw new Error(`the host read "${where}", which is not the directory it was granted`);
          }
          const found = directory.get(name);
          if (found === undefined) throw new Error(`no such file: ${name}`);
          return Promise.resolve(found);
        },
        writeOutput: () => {
          throw new Error('the execution half must not write the output directory');
        },
      },
      probe: () => {
        throw new Error('the execution half must not probe containment');
      },
      geometry: () => {
        throw new Error('unused');
      },
      pageText: () => {
        throw new Error('unused');
      },
      pageLinks: () => {
        throw new Error('unused');
      },
      ocr: () => {
        throw new Error('unused');
      },
      handwriting: () => {
        throw new Error('unused');
      },
      destinations: () => {
        throw new Error('unused');
      },
      layers: () => {
        throw new Error('unused');
      },
      annotations: readAnnotations,
      formFields: () => {
        throw new Error('unused');
      },
      duplicates: () => {
        throw new Error('unused');
      },
      extract: () => {
        throw new Error('unused');
      },
      snapshot: () => {
        throw new Error('unused');
      },
      exportFormData: () => {
        throw new Error('unused');
      },
      flatFields: () => {
        throw new Error('unused');
      },
    }),
    (incident) => incidents.push(incident),
  );

  // THE JSON ROUND TRIP, which is this file's whole subject. `structuredClone`
  // would preserve a `Uint8Array` and every case here would pass against a
  // transport that cannot.
  const client = createClient(engineChannels, async (id, params) =>
    wrapped[id](JSON.parse(JSON.stringify(params)) as never),
  );

  const assets: SessionAssets = {
    // LOWER-CASE HEX, which is what `outputNameSchema` accepts — and the first
    // spelling of this stub was `asset0`, which the channel refused at the
    // boundary with a `ZodError` naming the pattern. Worth keeping as a note:
    // that refusal is why `SessionAssets.name` is injected from the shell,
    // where `sessionDirectoryName` already mints names both this schema and the
    // directory policy accept, rather than composed in `packages/kernel` where
    // only one of the two rules is visible.
    name: () => written.length.toString(16).padStart(4, '0'),
    write: (where, name, bytes) => {
      if (where !== SNAPSHOT_DIRECTORY) {
        throw new Error(`main wrote to "${where}", which is not the directory the host reads`);
      }
      written.push(name);
      directory.set(name, bytes);
      return Promise.resolve();
    },
    remove: (_where, name) => {
      directory.delete(name);
      return Promise.resolve();
    },
  };

  const sessions = createRemoteSessions();
  return {
    remote: remoteMupdfExecution(client, sessions, assets),
    token: sessions.adopt('h1', AREA),
    session,
    directory,
    written,
    incidents,
    call: async (id, params) => await wrapped[id](JSON.parse(JSON.stringify(params)) as never),
  };
}

/** How many annotations the first page of a session's document carries. */
async function stampsOnFirstPage(session: MupdfSession): Promise<number> {
  const bytes = await mupdfWriter.serialise(session);
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = document.getPages()[0]?.node.lookup(PDFName.of('Annots'));
  return annots instanceof PDFArray ? annots.size() : 0;
}

describe('a command whose bytes cannot cross the wire', () => {
  it('REACHES THE APPLY ANYWAY, having travelled the granted directory', async () => {
    const { remote, token, session, written, incidents } = await joined();

    await remote.apply(token, placement(png));

    // THE EFFECT, at the far end of a real JSON round trip.
    expect(await stampsOnFirstPage(session)).toBe(1);
    // AND IT WENT BY THE DOOR, which is the half the effect alone cannot show:
    // an implementation that somehow got the bytes across the wire would
    // satisfy the line above and write nothing here.
    expect(written).toStrictEqual(['0000']);
    expect(incidents).toStrictEqual([]);
  });

  it('A CAPTURE WRITES ONE TOO, though no capture reads an asset', async () => {
    // Recorded rather than hidden, because it is a cost this design chose: the
    // bus captures before every apply, so a placement writes its image out
    // twice. The channel's own field says why — a capture reads no asset and
    // still needs a WHOLE command, and keeping one file alive from capture
    // until apply makes its lifetime span two calls, leaking it whenever a
    // capture is not followed by one.
    const { remote, token, written, directory } = await joined();

    const captured = await remote.capture(token, placement(png));

    expect(captured.captured).toBe(false);
    expect(written).toStrictEqual(['0000']);
    expect([...directory.keys()]).toStrictEqual([]);
  });

  it('REMOVES THE ASSET when the call returns', async () => {
    const { remote, token, directory, written } = await joined();
    await remote.apply(token, placement(png));
    // THE PAIR, and the second half is what makes the first mean anything:
    // an empty directory is also what *never wrote it* produces.
    expect(written.length).toBeGreaterThan(0);
    expect([...directory.keys()]).toStrictEqual([]);
  });

  it('REMOVES IT EVEN WHEN THE CALL FAILS, which is what the finally is for', async () => {
    // A file that outlives a failed call is one nothing holds a name for, in a
    // directory whose other occupant is the user's document.
    const { remote, token, directory, written } = await joined();
    await expect(
      remote.apply(token, { ...placement(png), pages: [0, 9] }),
    ).rejects.toThrow();
    expect(written.length).toBeGreaterThan(0);
    expect([...directory.keys()]).toStrictEqual([]);
  });

  it('CONTROL: a command carrying no asset writes nothing at all', async () => {
    // Without this, every assertion above would pass for a transport that
    // wrote a file for every command that crossed.
    const { remote, token, written } = await joined();
    await remote.apply(token, { kind: 'rotatePages', pages: [0], quarterTurns: 1 });
    expect(written).toStrictEqual([]);
  });

  it('CONTROL: bytes LEFT in the payload are refused, so the round trip is real', async () => {
    // THE POSITIVE CONTROL FOR THE SHIM, and this file needs one badly: every
    // case above passes if the shim preserves a `Uint8Array` — which
    // `structuredClone` does and JSON does not — and *nothing went wrong* is
    // indistinguishable between a working transport and an inert test.
    //
    // So this puts the image back into the command and sends it the way the
    // transport does not, straight at the handler. The refusal is the SCHEMA's:
    // what arrives is an object of numeric keys, and `placeImageSchema`'s
    // `instanceof` refines it away.
    const { call, session } = await joined();

    const answer = await call('engine/apply', { session: 'h1', command: placement(png) });

    expect(answer).toMatchObject({ ok: false });
    // AND NOTHING HAPPENED TO THE DOCUMENT, which is the half a refusal alone
    // does not give: an implementation that applied the command and then
    // reported a failure would satisfy the line above.
    expect(await stampsOnFirstPage(session)).toBe(0);
  });

  it('CONTROL: the SAME call with the bytes taken out is served', async () => {
    // The partner the refusal needs. Without it, *refused* is satisfied by a
    // handler that refuses everything — and every case in this file would then
    // be about a boundary that says no.
    const { call, directory, incidents } = await joined();
    directory.set('abcd', png);

    const { bytes, ...wire } = placement(png);
    void bytes;
    const answer = await call('engine/apply', {
      session: 'h1',
      command: wire,
      asset: 'abcd',
    });

    expect(incidents).toStrictEqual([]);
    expect(answer).toMatchObject({ ok: true });
  });
});
