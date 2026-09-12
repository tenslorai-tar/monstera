import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { createClient, type Incident, wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { OcrModelUnreadableError, type RecognisedPage } from '../ocrRecognise.js';
import { engineChannels } from './engineChannels.js';
import {
  type HostHandwritingReader,
  type HostOcrReader,
  type HostSession,
  createEngineHandlers,
} from './engineHandlers.js';
import { createRemoteSessions, remoteMupdfHandwriting, remoteMupdfOcr } from './remoteEngine.js';

/**
 * Recognition crossing the engine host's wire.
 *
 * ## WHAT THIS FILE IS ABOUT, and what it deliberately is not
 *
 * `scripts/proofs/ocrRecognise.proof.mjs` owns the recognition: the real engine,
 * the real corpus, and the coordinate conversion whose control is a word drawn at
 * a known point. This file owns the **wire** and the handler's one piece of
 * logic, which is **which failure state a throw becomes**.
 *
 * So the reader is injected and no Tesseract is loaded here. That is not
 * convenience: `recognisePage` instantiates 2.8 MB of WASM and takes about four
 * seconds a page, and every case below would pay it to assert something the
 * engine has nothing to do with.
 *
 * ## THE TWO FAILURE STATES ARE THE SUBJECT
 *
 * `ocr-model-unreadable` and `ocr-failed` are answered by different people — a
 * grant or a provisioning problem is main's to fix, a page Tesseract will not
 * read is the feature's — and collapsing them would send the supervisor after a
 * recognition bug when a file simply is not there. The handler separates them by
 * the error's **type**, which it did not at first: it matched on the wording of
 * the message, a guard keyed on a name its own author controls.
 *
 * The transport is the real one, for `engineAsset.test.ts`' reason:
 * `host/client.ts` frames `JSON.stringify` and `host/runtime.ts` parses the other
 * end, so `structuredClone` here would preserve shapes the shipped pipe cannot
 * carry — which for this channel means the readonly tuple every box is.
 */

let document: ByteImage;

beforeAll(async () => {
  const built = await PDFDocument.create();
  built.addPage([200, 200]);
  document = await built.save();
});

const AREA = {
  snapshotDirectory: 'no directory: a recognition carries no asset',
  outputDirectory: 'no directory: a recognition writes nothing',
};

const MODELS = 'C:/granted/tessdata';

/** An answer the real reader could produce, with one word on one line. */
const ANSWER: RecognisedPage = {
  lines: [
    {
      text: 'MONSTERA',
      box: [40, 230, 180, 252],
      words: [{ text: 'MONSTERA', box: [40, 230, 180, 252], confidence: 96 }],
    },
  ],
  confidence: 96,
  language: 'eng',
};

/** What the handwriting engine answers: one line, no words (ADR-0052 §4). */
const HANDWRITTEN: RecognisedPage = {
  lines: [{ text: 'Monstera deliciosa', box: [30, 180, 370, 230], words: [] }],
  confidence: 88,
  language: 'eng',
};

/** The cache main downloads the runtime and models into — NOT the tessdata one. */
const HANDWRITING_CACHE = 'C:/granted/trocr';

/**
 * The two halves joined over a JSON round trip, with both readers injected.
 *
 * `handwriting` defaults to a throwing stub rather than to a second happy
 * answer, so a case that drives the Tesseract arm and silently reached the
 * other engine fails loudly. The channel's discriminant is what routes them, and
 * a stub that answered would make routing invisible.
 */
async function joined(
  ocr: HostOcrReader,
  handwriting: HostHandwritingReader = () => {
    throw new Error('this case drives Tesseract; the handwriting engine must not be reached');
  },
): Promise<{
  readonly session: MupdfSession;
  readonly read: ReturnType<typeof remoteMupdfOcr>;
  readonly readHandwriting: ReturnType<typeof remoteMupdfHandwriting>;
  readonly stranger: MupdfSession;
  readonly incidents: readonly Incident[];
  readonly close: () => Promise<void>;
}> {
  const session = await mupdfWriter.open(document);
  const held = new Map<string, HostSession>([
    ['h1', { session, outputDirectory: AREA.outputDirectory, snapshotDirectory: AREA.snapshotDirectory }],
  ]);

  const incidents: Incident[] = [];
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: {
        lookup: (id) => held.get(id),
        issue: () => {
          throw new Error('this file drives a READ; nothing here opens a session');
        },
        forget: () => {
          throw new Error('this file drives a READ; nothing here closes a session');
        },
      },
      execution: localMupdfExecution,
      // THROWING STUBS, so a handler that reached for a document image or a
      // granted directory fails loudly rather than passing against a surface
      // that happened to work. A recognition touches neither: the raster is made
      // from the session the host already holds.
      writer: {
        open: () => {
          throw new Error('a recognition must not open');
        },
        serialise: () => {
          throw new Error('a recognition must not serialise');
        },
        close: () => {
          throw new Error('a recognition must not close');
        },
      },
      access: () => {
        throw new Error('a recognition must not ask what a password bought');
      },
      signatures: () => {
        throw new Error('a recognition must not verify a signature');
      },
      files: {
        readSnapshot: () => {
          throw new Error('a recognition must not read the snapshot directory');
        },
        writeOutput: () => {
          throw new Error('a recognition must not write the output directory');
        },
      },
      probe: () => {
        throw new Error('a recognition must not probe containment');
      },
      geometry: () => {
        throw new Error('a recognition must not read the page tree');
      },
      pageText: () => {
        throw new Error('a recognition must not read the page text');
      },
      pageLinks: () => {
        throw new Error('a recognition must not read the page links');
      },
      ocr,
      handwriting,
      destinations: () => {
        throw new Error('a recognition must not read the outline');
      },
      layers: () => {
        throw new Error('a recognition must not read the layers');
      },
      annotations: () => {
        throw new Error('a recognition must not list annotations');
      },
      formFields: () => {
        throw new Error('a recognition must not read the fields');
      },
      duplicates: () => {
        throw new Error('a recognition must not look for duplicates');
      },
      extract: () => {
        throw new Error('a recognition must not build a document');
      },
      snapshot: () => {
        throw new Error('a recognition must not write a PNG out');
      },
      exportFormData: () => {
        throw new Error('a recognition must not encode an export');
      },
      flatFields: () => {
        throw new Error('a recognition must not propose fields');
      },
    }),
    (incident) => incidents.push(incident),
  );

  const client = createClient(engineChannels, async (channel, params) => {
    const framed: unknown = JSON.parse(JSON.stringify({ channel, params }));
    const { params: parsed } = framed as { params: unknown };
    return wrapped[channel](parsed);
  });

  const sessions = createRemoteSessions();
  // A TOKEN THE HOST HOLDS, and a second one it does not. `h2` is adopted the
  // same way, so the miss case below is a session the REGISTRY knows and the
  // HOST does not — which is the real shape of a rebuilt host, against a token
  // main never issued, which nothing can produce.
  const token = sessions.adopt('h1', AREA);
  const stranger = sessions.adopt('h2', AREA);
  return {
    session: token,
    read: remoteMupdfOcr(client, sessions),
    readHandwriting: remoteMupdfHandwriting(client, sessions),
    stranger,
    incidents,
    close: async () => {
      await mupdfWriter.close(session);
    },
  };
}

describe('engine/ocr-page', () => {
  it('CARRIES LINES, WORDS AND BOXES over a real JSON round trip', async () => {
    const { session, read, close } = await joined(() => Promise.resolve(ANSWER));
    try {
      const answer = await read(session, { page: 0, language: 'eng', modelDirectory: MODELS });
      // STRICT EQUALITY against the whole shape, which is what makes the tuple
      // the assertion: a box that arrived as an object, or as a three-member
      // array, fails here rather than at the first consumer to index it.
      expect(answer).toStrictEqual(ANSWER);
    } finally {
      await close();
    }
  });

  it('hands the REQUEST through unchanged — page, language and the granted directory', async () => {
    const asked: unknown[] = [];
    const { session, read, close } = await joined((_session, request) => {
      asked.push(request);
      return Promise.resolve(ANSWER);
    });
    try {
      // NOT PAGE 0 AND NOT `eng`. A page of zero and the first language would
      // both be produced by a handler that dropped the field and let a default
      // stand — which is the shape the rotate shipped with.
      await read(session, { page: 4, language: 'heb', modelDirectory: MODELS });
      expect(asked).toStrictEqual([{ page: 4, language: 'heb', modelDirectory: MODELS }]);
    } finally {
      await close();
    }
  });

  it('answers NO-SUCH-SESSION for a token this host does not hold', async () => {
    const { stranger, read, close } = await joined(() => {
      throw new Error('the session miss must be answered before the reader is reached');
    });
    try {
      await expect(
        read(stranger, { page: 0, language: 'eng', modelDirectory: MODELS }),
        // THE PROSE, NOT THE STATE NAME. `answered` turns the failure into the
        // sentence the supervisor reads, and it names the channel — so this
        // asserts that the miss was answered for THIS channel rather than that
        // some refusal happened.
      ).rejects.toThrow(/does not hold this session \(engine\/ocr-page\)/u);
    } finally {
      await close();
    }
  });

  it('A MODEL IT CANNOT READ IS ITS OWN STATE, not a recognition failure', async () => {
    const { session, read, close } = await joined(() => {
      throw new OcrModelUnreadableError(
        'the eng model could not be read from the granted model directory',
        new Error('ENOENT'),
      );
    });
    try {
      await expect(
        read(session, { page: 0, language: 'eng', modelDirectory: MODELS }),
      ).rejects.toThrow(/ocr-model-unreadable/u);
    } finally {
      await close();
    }
  });

  it('CONTROL: and any other throw is OCR-FAILED, so the state above is not what every throw becomes', async () => {
    // The case that separates them. Without it, a handler returning
    // `ocr-model-unreadable` for everything passes the one above — and the
    // supervisor would be sent after a grant every time a page would not
    // recognise.
    const { session, read, close } = await joined(() => {
      throw new Error('Tesseract would not read the rasterised page');
    });
    try {
      const refusal = read(session, { page: 0, language: 'eng', modelDirectory: MODELS });
      await expect(refusal).rejects.toThrow(/ocr-failed/u);
      await expect(refusal).rejects.not.toThrow(/ocr-model-unreadable/u);
    } finally {
      await close();
    }
  });

  it('refuses a confidence outside Tesseract’s own scale at the BOUNDARY', async () => {
    // A hostile host can send 10,000 as easily as 94, and a confidence reaches a
    // UI that renders it as a proportion. The schema is what refuses it, which is
    // why this case drives the wire rather than the reader.
    const { session, read, close } = await joined(() =>
      Promise.resolve({ ...ANSWER, confidence: 10_000 }),
    );
    try {
      await expect(
        read(session, { page: 0, language: 'eng', modelDirectory: MODELS }),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });

  // -------------------------------------------------------------------------
  // THE SECOND ENGINE. One channel, two arms, and what these cases are about is
  // that the DISCRIMINANT routes — not that either reader works, which is the
  // recognisers' own proofs.
  // -------------------------------------------------------------------------

  it('routes a handwriting request to the handwriting reader, and not to Tesseract', async () => {
    const { session, readHandwriting, close } = await joined(
      () => {
        throw new Error('a handwriting request must not reach Tesseract');
      },
      () => Promise.resolve(HANDWRITTEN),
    );
    try {
      const answer = await readHandwriting(session, {
        page: 0,
        region: [30, 180, 370, 230],
        size: 'small',
        modelDirectory: HANDWRITING_CACHE,
      });
      // STRICT EQUALITY, including the EMPTY word list: a line with no words is
      // what this engine answers and what `ocrTextLayer.ts` already handles, so
      // an arm that helpfully filled one in would be inventing positions.
      expect(answer).toStrictEqual(HANDWRITTEN);
    } finally {
      await close();
    }
  });

  it('hands the handwriting REQUEST through unchanged — region, size and its own cache', async () => {
    const asked: unknown[] = [];
    const { session, readHandwriting, close } = await joined(
      () => {
        throw new Error('a handwriting request must not reach Tesseract');
      },
      (_session, request) => {
        asked.push(request);
        return Promise.resolve(HANDWRITTEN);
      },
    );
    try {
      // NOT `small` AND NOT THE TESSDATA DIRECTORY. Both defaults would be
      // produced by a handler that dropped the field, which is the shape the
      // rotate shipped with — and the directory matters most, because the two
      // caches hold entirely different files.
      await readHandwriting(session, {
        page: 3,
        region: [11, 22, 33, 44],
        size: 'base',
        modelDirectory: HANDWRITING_CACHE,
      });
      expect(asked).toStrictEqual([
        { page: 3, region: [11, 22, 33, 44], size: 'base', modelDirectory: HANDWRITING_CACHE },
      ]);
    } finally {
      await close();
    }
  });

  it('CONTROL: a Tesseract request does not reach the handwriting reader', async () => {
    // The mirror of the case above, and it is what makes that one a routing
    // claim rather than a claim that one arm happens to work: the default
    // handwriting stub throws, so this passing means the discriminant carried
    // the request to the other side.
    const { session, read, close } = await joined(() => Promise.resolve(ANSWER));
    try {
      const answer = await read(session, { page: 0, language: 'eng', modelDirectory: MODELS });
      expect(answer).toStrictEqual(ANSWER);
    } finally {
      await close();
    }
  });

  it('refuses a handwriting request carrying NO REGION at the boundary', async () => {
    // B5 made visible: the schema's handwriting arm requires a region, because
    // TrOCR reads one text line and a page-scoped request would work and take
    // minutes. This drives the wire directly, since the typed client cannot
    // express the illegal shape.
    const { session, readHandwriting, close } = await joined(
      () => {
        throw new Error('unused');
      },
      () => Promise.resolve(HANDWRITTEN),
    );
    try {
      await expect(
        readHandwriting(
          session,
          // The cast is the case: it constructs the value the type forbids, to
          // show the SCHEMA refuses it too. Without it this would assert only
          // that the compiler is working.
          { page: 0, size: 'small', modelDirectory: HANDWRITING_CACHE } as Parameters<
            ReturnType<typeof remoteMupdfHandwriting>
          >[1],
        ),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
