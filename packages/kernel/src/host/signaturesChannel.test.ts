import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { createClient, wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { SignaturesUnreadable } from '../signatureRead.js';
import { engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';
import { createRemoteSessions, EngineCallFailed, remoteMupdfSignatures } from './remoteEngine.js';

/**
 * `engine/signatures` crossing the engine host's wire — finding GGGGGG-1.
 *
 * ## THE SUBJECT IS WHICH FAILURE A THROW BECOMES
 *
 * The handler used to answer `signatures-unreadable` for every throw, a failed
 * serialise included, and main answered every refusal as *a signature could not
 * be read*. That sentence is about the document, so it is reserved for the one
 * throw that is: a PKCS#7 this build cannot parse. `signatureRead`'s own cases
 * own the parse; this file owns the handler's decision, over the real JSON round
 * trip `ocrChannel.test.ts` uses for its reason.
 */

let document: ByteImage;

beforeAll(async () => {
  const built = await PDFDocument.create();
  built.addPage([200, 200]);
  document = await built.save();
});

const AREA = {
  snapshotDirectory: 'no directory: a signatures read carries no asset',
  outputDirectory: 'no directory: a signatures read writes nothing',
};

function refuse(what: string): () => never {
  return () => {
    throw new Error(`a signatures read must not ${what}`);
  };
}

/** The two halves joined, with the serialise and the reader injected. */
async function joined(parts: {
  readonly serialise: (session: MupdfSession) => Promise<ByteImage>;
  readonly signatures: () => Promise<never>;
}): Promise<{
  readonly session: MupdfSession;
  readonly read: ReturnType<typeof remoteMupdfSignatures>;
  readonly close: () => Promise<void>;
}> {
  const session = await mupdfWriter.open(document);
  const held = new Map<string, HostSession>([
    ['h1', { session, outputDirectory: AREA.outputDirectory, snapshotDirectory: AREA.snapshotDirectory }],
  ]);
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: {
        lookup: (id) => held.get(id),
        issue: refuse('open a session'),
        forget: refuse('close a session'),
      },
      execution: localMupdfExecution,
      writer: { open: refuse('open'), serialise: parts.serialise, close: refuse('close') },
      access: refuse('ask what a password bought'),
      signatures: parts.signatures,
      files: { readSnapshot: refuse('read the snapshot directory'), writeOutput: refuse('write output') },
      probe: refuse('probe containment'),
      geometry: refuse('read the page tree'),
      pageText: refuse('read the page text'),
      pageLinks: refuse('read the page links'),
      ocr: refuse('recognise a page'),
      destinations: refuse('read the outline'),
      layers: refuse('read the layers'),
      annotations: refuse('list annotations'),
      formFields: refuse('read the fields'),
      duplicates: refuse('look for duplicates'),
      extract: refuse('build a document'),
      snapshot: refuse('write a PNG out'),
      exportFormData: refuse('encode an export'),
      pageImage: refuse('export a page image'),
      flatFields: refuse('propose fields'),
      barcodes: refuse('read barcodes'),
      exportAnnotationData: refuse('export annotations'),
      accessibility: refuse('check accessibility'),
      annotationRecords: refuse('read annotation records'),
    }),
    () => undefined,
  );
  const client = createClient(engineChannels, async (channel, params) => {
    const framed: unknown = JSON.parse(JSON.stringify({ channel, params }));
    const { params: parsed } = framed as { params: unknown };
    return wrapped[channel](parsed);
  });
  const sessions = createRemoteSessions();
  return {
    session: sessions.adopt('h1', AREA),
    read: remoteMupdfSignatures(client, sessions),
    close: async () => {
      await mupdfWriter.close(session);
    },
  };
}

const serialiseIt = (session: MupdfSession): Promise<ByteImage> => mupdfWriter.serialise(session);

/** The refusal code a read was answered with, or `null` if it was not an `EngineCallFailed`. */
async function refusalOf(pending: Promise<unknown>): Promise<string | null> {
  try {
    await pending;
  } catch (error) {
    return error instanceof EngineCallFailed ? error.code : null;
  }
  throw new Error('the read resolved, and every case here expects a refusal');
}

describe('engine/signatures: which refusal a throw becomes', () => {
  it('a PKCS#7 this build cannot parse is SIGNATURES-UNREADABLE', async () => {
    const { session, read, close } = await joined({
      serialise: serialiseIt,
      signatures: () => Promise.reject(new SignaturesUnreadable('not a PKCS#7 this build can read')),
    });
    try {
      expect(await refusalOf(read(session))).toBe('signatures-unreadable');
    } finally {
      await close();
    }
  });

  it('CONTROL: any other throw from the reader is SIGNATURES-FAILED, not unreadable', async () => {
    const { session, read, close } = await joined({
      serialise: serialiseIt,
      signatures: () => Promise.reject(new Error('the object model would not walk')),
    });
    try {
      expect(await refusalOf(read(session))).toBe('signatures-failed');
    } finally {
      await close();
    }
  });

  it('a session that cannot SERIALISE never reaches the reader and is not a signature refusal', async () => {
    let reached = false;
    const { session, read, close } = await joined({
      serialise: () => Promise.reject(new Error('the engine could not serialise the session')),
      signatures: () => {
        reached = true;
        return Promise.reject(new Error('unreachable'));
      },
    });
    try {
      const code = await refusalOf(read(session));
      expect(reached).toBe(false);
      expect(code).not.toBe('signatures-unreadable');
      expect(code).not.toBe('signatures-failed');
    } finally {
      await close();
    }
  });
});
