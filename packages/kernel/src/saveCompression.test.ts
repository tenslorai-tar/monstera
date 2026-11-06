import { PDFDocument as PdfLibDocument } from '@cantoo/pdf-lib';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { extractPages } from './pageExtract.js';
import { savedBuffer } from './saveDepth.js';
import { readSignatures } from './signatureRead.js';
import { applySignDocument } from './signpdfWriter.js';

/**
 * A full save writes no stream raw (`saveDepth.ts`' FULL_SAVE_TERMS), and what it writes decodes to exactly what the
 * session holds. Each case compares the save with the same document written with `garbage` alone, the terms before this
 * change, which is the control: there the stream the edit made is raw, and every stream decodes to the same bytes.
 */

const STAMP = { author: 'Priya Raman', created: '2026-11-06T09:00:00.000Z' } as const;

/** A document of `pages` pages whose producer stored its content as `stored` says. */
function made(pages: number, stored: 'compressed' | 'raw'): ByteImage {
  const document = new mupdf.PDFDocument();
  try {
    const font = document.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin');
    for (let at = 0; at < pages; at += 1) {
      const resources = document.addObject({ Font: { F: font } });
      let content = '';
      for (let line = 0; line < 40; line += 1) {
        content += `BT /F 10 Tf 40 ${String(760 - line * 12)} Td (Line ${String(line)} of page ${String(at)}) Tj ET\n`;
      }
      document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, resources, content));
    }
    return document.saveToBuffer(stored === 'compressed' ? 'garbage,compress' : 'garbage').asUint8Array().slice();
  } finally {
    document.destroy();
  }
}

interface Streams {
  /** Every stream's object number and its DECODED bytes, as hex, in object order. */
  readonly decoded: ReadonlyMap<number, string>;
  /** The object numbers of streams written with no filter. */
  readonly raw: readonly number[];
}

function streamsOf(bytes: ByteImage): Streams {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the case expected a PDF');
  try {
    const decoded = new Map<number, string>();
    const raw: number[] = [];
    for (let number = 1; number < document.countObjects(); number += 1) {
      const object = document.newIndirect(number);
      if (!object.isStream()) continue;
      decoded.set(number, Buffer.from(object.readStream().asUint8Array()).toString('hex'));
      if (object.get('Filter').isNull()) raw.push(number);
    }
    // A SEARCH THAT FOUND NO STREAM IS A BROKEN READ, not a clean file: every document here has page content.
    if (decoded.size === 0) throw new Error('no stream was read, so the comparison would mean nothing');
    return { decoded, raw };
  } finally {
    document.destroy();
  }
}

const stamp = (session: MupdfSession): Promise<unknown> =>
  applyAddAnnotation(session, {
    kind: 'addAnnotation',
    page: 0,
    stamp: STAMP,
    annotation: { type: 'stamp', stamp: 'approved', rect: { x0: 50, y0: 100, x1: 200, y1: 150 }, colour: [0.8, 0, 0], opacity: 1 },
  });

/** The session's save, and the same document written with `garbage` alone, before this change. */
async function savedBothWays(bytes: ByteImage, edit: (session: MupdfSession) => Promise<unknown>): Promise<{ saved: ByteImage; before: ByteImage }> {
  const session = await mupdfWriter.open(bytes);
  try {
    await edit(session);
    const before = await withDocument(session, (document) => {
      const buffer = savedBuffer(document, 'garbage');
      try {
        return buffer.asUint8Array().slice();
      } finally {
        buffer.destroy();
      }
    });
    return { saved: await mupdfWriter.serialise(session), before };
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a full save compresses every stream it writes, and changes no content', () => {
  it('an edit on a document stored compressed: the new appearance is not raw, and every stream decodes the same', async () => {
    const { saved, before } = await savedBothWays(made(3, 'compressed'), stamp);
    const was = streamsOf(before);
    const now = streamsOf(saved);
    expect(was.raw.length, 'CONTROL: before this change the edit wrote its stream raw').toBeGreaterThan(0);
    expect(now.raw).toStrictEqual([]);
    expect(now.decoded).toStrictEqual(was.decoded);
    expect(saved.byteLength).toBeLessThan(before.byteLength);
  }, 60_000);

  it('a document its producer stored raw saves at a quarter of the size, with every stream decoding the same', async () => {
    const { saved, before } = await savedBothWays(made(40, 'raw'), stamp);
    const was = streamsOf(before);
    const now = streamsOf(saved);
    expect(was.raw.length).toBeGreaterThan(40);
    expect(now.raw).toStrictEqual([]);
    expect(now.decoded).toStrictEqual(was.decoded);
    expect(saved.byteLength * 3).toBeLessThan(before.byteLength);
  }, 60_000);

  it('Extract pages writes its file compressed too', async () => {
    const session = await mupdfWriter.open(made(4, 'raw'));
    try {
      const extracted = await extractPages(session, [1, 2], 'engraved');
      expect(streamsOf(extracted).raw).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);
});

describe('CONTROL: a signed document appends exactly as it did', () => {
  let signed: ByteImage;

  beforeAll(async () => {
    const document = await PdfLibDocument.create();
    document.addPage([300, 300]);
    document.addPage([300, 300]);
    const unsigned = await document.save();
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86_400_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    cert.setSubject([{ name: 'commonName', value: 'Monstera Test' }]);
    cert.setIssuer([{ name: 'commonName', value: 'Monstera Test' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'a passphrase', { algorithm: '3des' })).getBytes();
    signed = await applySignDocument(unsigned, {
      kind: 'signDocument',
      bytes: Uint8Array.from(der, (character: string) => character.charCodeAt(0)),
      passphrase: 'a passphrase',
      name: 'Grace Hopper',
    });
  }, 60_000);

  it('the appended save is MuPDF’s plain incremental one, byte for byte, and the signature still covers it', async () => {
    // TWO SESSIONS with the same edit: one saved by the writer, one by MuPDF's incremental save alone.
    const ours = await mupdfWriter.open(signed);
    const plain = await mupdfWriter.open(signed);
    try {
      await stamp(ours);
      await stamp(plain);
      const saved = await mupdfWriter.serialise(ours);
      const incremental = await withDocument(plain, (document) => document.saveToBuffer('incremental').asUint8Array().slice());
      expect(Buffer.from(saved).equals(Buffer.from(incremental))).toBe(true);
      expect(Buffer.from(saved.subarray(0, signed.byteLength)).equals(Buffer.from(signed))).toBe(true);
      // THE APPENDED STREAM IS STILL RAW: the signed path does not take the full save's terms.
      expect(streamsOf(saved).raw.length).toBeGreaterThan(0);
      const fresh = await mupdfWriter.open(saved);
      try {
        expect((await readSignatures(fresh, saved)).map((each) => each.coversDocument)).toStrictEqual([true]);
      } finally {
        await mupdfWriter.close(fresh);
      }
    } finally {
      await mupdfWriter.close(ours);
      await mupdfWriter.close(plain);
    }
  }, 60_000);
});
