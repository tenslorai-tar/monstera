import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { createClient, wrapHandlers } from '@monstera/contract';

import { barcodeRect } from '../barcodePlacement.js';
import { type FoundBarcode, readPageBarcodes } from '../barcodeReader.js';
import { writeBarcodePng } from '../barcodeWriter.js';
import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { applyPlaceImage } from '../pageAnnotations.js';
import { ENGINE_BARCODE_TEXT_MAX, ENGINE_BARCODES_MAX, engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';
import { EngineCallFailed, createRemoteSessions, remoteMupdfBarcodes } from './remoteEngine.js';

/**
 * `engine/page-barcodes` crossing the engine host's wire, over the real JSON round trip
 * `signaturesChannel.test.ts` uses (ADR-0076).
 *
 * The first case runs the reader the host runs against a page carrying a placed symbol, so the
 * remote half, the schema and the handler are crossed by one case with both ends named. The rest
 * inject the reader, because what they own is the handler's decisions: which code a throw
 * becomes, and what the bounds keep.
 */

let withQr: ByteImage;
let blank: ByteImage;

beforeAll(async () => {
  const built = await PDFDocument.create();
  built.addPage([612, 792]);
  blank = await built.save();

  const session = await mupdfWriter.open(blank);
  try {
    const image = await writeBarcodePng('crossed the wire', 'QRCode');
    await applyPlaceImage(session, {
      kind: 'placeImage',
      pages: [0],
      rect: barcodeRect({ x0: 100, y0: 400, x1: 300, y1: 600 }, image.width, image.height),
      bytes: image.png,
      stamp: { author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' },
    });
    withQr = await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
});

/** A place for a symbol the bound cases inject: what they own is the handler's decisions, not where a symbol is. */
const SOMEWHERE = { x0: 10, y0: 20, x1: 110, y1: 120 };

const AREA = {
  snapshotDirectory: 'no directory: a barcode read carries no asset',
  outputDirectory: 'no directory: a barcode read writes nothing',
};

function refuse(what: string): () => never {
  return () => {
    throw new Error(`a barcode read must not ${what}`);
  };
}

async function joined(
  bytes: ByteImage,
  barcodes: (session: MupdfSession, page: number) => Promise<readonly FoundBarcode[]>,
): Promise<{
  readonly session: MupdfSession;
  readonly read: ReturnType<typeof remoteMupdfBarcodes>;
  readonly close: () => Promise<void>;
}> {
  const session = await mupdfWriter.open(bytes);
  const held = new Map<string, HostSession>([
    ['h1', { session, outputDirectory: AREA.outputDirectory, snapshotDirectory: AREA.snapshotDirectory }],
  ]);
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: { lookup: (id) => held.get(id), issue: refuse('open a session'), forget: refuse('close a session') },
      execution: localMupdfExecution,
      writer: { open: refuse('open'), serialise: refuse('serialise'), close: refuse('close') },
      access: refuse('ask what a password bought'),
      signatures: refuse('read signatures'),
      files: {
        readSnapshot: refuse('read the snapshot directory'),
        writeOutput: refuse('write output'),
        writeOutputStream: refuse('write output'),
      },
      probe: refuse('probe containment'),
      geometry: refuse('read the page tree'),
      pageText: refuse('read the page text'),
      pageLinks: refuse('read the page links'),
      linkAddress: refuse('read a link address'),
      pageFills: refuse('read the page fills'),
      pageRewrite: refuse('read which writer a page needs'),
      wordBoxes: refuse('read the word boxes'),
      ocr: refuse('recognise a page'),
      destinations: refuse('read the outline'),
      layers: refuse('read the layers'),
      annotations: refuse('list annotations'),
      formFields: refuse('read the fields'),
      duplicates: refuse('look for duplicates'),
      extract: refuse('build a document'),
      applyPdfLib: refuse('run pdf-lib'),
      prepareSignature: refuse('prepare a signature'),
      snapshot: refuse('write a PNG out'),
      exportFormData: refuse('encode an export'),
      pageImage: refuse('export a page image'),
      word: refuse('export a Word file'),
      flatFields: refuse('propose fields'),
      fieldProperties: refuse('read field properties'),
      formImportPlan: refuse('plan an import'),
      annotationImportPlan: refuse('plan a comment import'),
      barcodes,
      exportAnnotationData: refuse('export annotations'),
      accessibility: refuse('check accessibility'),
      annotationRecords: refuse('read annotation records'),
      annotationWords: refuse('read annotation words'),
      signaturesKept: refuse('ask whether a save keeps signatures'),
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
    read: remoteMupdfBarcodes(client, sessions),
    close: async () => {
      await mupdfWriter.close(session);
    },
  };
}

describe('engine/page-barcodes over the wire', () => {
  it('reads a placed symbol through the host’s own reader, and a blank page reads none', async () => {
    const placed = await joined(withQr, readPageBarcodes);
    try {
      const answer = await placed.read(placed.session, 0);
      expect(answer.truncated).toBe(false);
      expect(answer.barcodes.map(({ format, text }) => ({ format, text }))).toStrictEqual([{ format: 'QRCode', text: 'crossed the wire' }]);
      // WHERE IT IS, in display space (points, top left, y down): the symbol was placed over x 100–300 and PDF y 400–600 of a
      // 792-point page, which is display y 192–392. The finder patterns sit inside the picture's quiet zone, so the box is
      // INSIDE that area and fills most of it; a box in raster pixels (scale 200/72 too big) or with y flipped would be
      // nowhere near it.
      const box = answer.barcodes[0]?.box;
      if (box === undefined) throw new Error('the read symbol carried no box');
      expect(box.x0).toBeGreaterThanOrEqual(98);
      expect(box.x1).toBeLessThanOrEqual(302);
      expect(box.y0).toBeGreaterThanOrEqual(190);
      expect(box.y1).toBeLessThanOrEqual(394);
      expect(box.x1 - box.x0).toBeGreaterThan(120);
      expect(box.y1 - box.y0).toBeGreaterThan(120);
    } finally {
      await placed.close();
    }
    const empty = await joined(blank, readPageBarcodes);
    try {
      expect(await empty.read(empty.session, 0)).toStrictEqual({ barcodes: [], truncated: false });
    } finally {
      await empty.close();
    }
  });

  it('a page the document does not have is BARCODE-READ-FAILED, not a sick host', async () => {
    const { session, read, close } = await joined(blank, readPageBarcodes);
    try {
      const refused = await read(session, 7).then(
        () => null,
        (error: unknown) => (error instanceof EngineCallFailed ? error.code : 'not a refusal'),
      );
      expect(refused).toBe('barcode-read-failed');
    } finally {
      await close();
    }
  });

  it('keeps the first bound’s worth and SAYS the list was stopped', async () => {
    const many = Array.from({ length: ENGINE_BARCODES_MAX + 3 }, (_unused, index) => ({
      format: 'Code128',
      text: `label ${String(index)}`,
      box: SOMEWHERE,
    }));
    const { session, read, close } = await joined(blank, () => Promise.resolve(many));
    try {
      const answer = await read(session, 0);
      expect(answer.barcodes).toStrictEqual(many.slice(0, ENGINE_BARCODES_MAX));
      expect(answer.truncated).toBe(true);
    } finally {
      await close();
    }
  });

  it('drops a text past the bound WHOLE rather than cutting it, and says so', async () => {
    const found = [
      { format: 'QRCode', text: '9'.repeat(ENGINE_BARCODE_TEXT_MAX + 1), box: SOMEWHERE },
      { format: 'EAN13', text: '4006381333931', box: SOMEWHERE },
    ];
    const { session, read, close } = await joined(blank, () => Promise.resolve(found));
    try {
      expect(await read(session, 0)).toStrictEqual({
        barcodes: [{ format: 'EAN13', text: '4006381333931', box: SOMEWHERE }],
        truncated: true,
      });
    } finally {
      await close();
    }
  });

  it('CONTROL: a list inside both bounds is not reported as stopped', async () => {
    const found = [{ format: 'QRCode', text: '9'.repeat(ENGINE_BARCODE_TEXT_MAX), box: SOMEWHERE }];
    const { session, read, close } = await joined(blank, () => Promise.resolve(found));
    try {
      expect(await read(session, 0)).toStrictEqual({ barcodes: found, truncated: false });
    } finally {
      await close();
    }
  });
});
