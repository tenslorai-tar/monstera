import { PDFDocument } from '@cantoo/pdf-lib';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { readSignatures } from './signatureRead.js';
import { applySignDocument } from './signpdfWriter.js';

/**
 * THE MEASUREMENT THE OWNER ASKED FOR FIRST (Group 5, 2026-11-06): does cutting a file back to the bytes a signature
 * signed give a file whose signature still verifies? A signature's `/ByteRange` is `[0, a, b, c]` and covers the file up
 * to `b + c`; a file signed and then appended to carries the signed file as its first `b + c` bytes. Each case cuts there
 * and reads the result with this build's own reader, which checks the digest AND that the ranges reach the file's end.
 */

let credential: Uint8Array;
beforeAll(() => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'Monstera Test' }]);
  cert.setIssuer([{ name: 'commonName', value: 'Monstera Test' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pass', { algorithm: '3des' })).getBytes();
  credential = Uint8Array.from(p12, (character: string) => character.charCodeAt(0));
}, 60_000);

async function blank(): Promise<ByteImage> {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  return document.save();
}

const sign = (bytes: ByteImage, name: string, certify?: 'no-changes' | 'form-fill' | 'form-fill-and-annotate') =>
  applySignDocument(bytes, { kind: 'signDocument', bytes: credential, passphrase: 'pass', name, ...(certify === undefined ? {} : { certify }) });

async function onSession<T>(bytes: ByteImage, work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** A rectangle drawn and saved: an ordinary edit, which MuPDF appends to a signed file. */
const edited = (bytes: ByteImage) =>
  onSession(bytes, async (session) => {
    await applyAddAnnotation(session, {
      kind: 'addAnnotation',
      page: 0,
      stamp: { author: 'Priya Raman', created: '2026-11-12T09:00:00.000Z' },
      annotation: { type: 'square', rect: { x0: 50, y0: 50, x1: 150, y1: 120 }, colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
    });
    return mupdfWriter.serialise(session);
  });

/** Each signature's `/ByteRange` end (`b + c`), in the order the document lists them. */
function signedEnds(bytes: ByteImage): number[] {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    const ends: number[] = [];
    const fields = document.getTrailer().get('Root').get('AcroForm').get('Fields');
    fields.forEach((field) => {
      const range = field.get('V').get('ByteRange');
      if (range.isArray() && range.length === 4) ends.push(range.get(2).asNumber() + range.get(3).asNumber());
    });
    if (ends.length === 0) throw new Error('no signature found: the lookup is broken, not the document');
    return ends;
  } finally {
    document.destroy();
  }
}

const read = (bytes: ByteImage) => onSession(bytes, (session) => readSignatures(session, bytes));

describe('cutting a file back to the bytes a signature signed (Group 5, measured first)', () => {
  it('one signature, then an edit appended: the cut is the signed file, and its signature covers the whole of it', async () => {
    const signed = await sign(await blank(), 'Grace Hopper');
    const later = await edited(signed);
    // CONTROL: the edit was appended and the later file's signature no longer covers the whole file.
    expect(later.length).toBeGreaterThan(signed.length);
    expect((await read(later)).map((each) => [each.coversDocument, each.coversWholeFile])).toStrictEqual([[true, false]]);
    const [end = 0] = signedEnds(later);
    const cut = later.subarray(0, end);
    expect(Buffer.from(cut).equals(Buffer.from(signed)), 'the cut is byte for byte the file that was signed').toBe(true);
    expect((await read(cut)).map((each) => [each.coversDocument, each.coversWholeFile])).toStrictEqual([[true, true]]);
  }, 60_000);

  it('CONTROL: one byte short of the end, the signature no longer verifies', async () => {
    const later = await edited(await sign(await blank(), 'Grace Hopper'));
    const [end = 0] = signedEnds(later);
    const short = later.subarray(0, end - 1);
    const found = await read(short).catch(() => []);
    expect(found.every((each) => !(each.coversDocument && each.coversWholeFile))).toBe(true);
  }, 60_000);

  it('two signatures: each cut gives the file as that signer signed it, the first alone in the first', async () => {
    const first = await sign(await blank(), 'Grace Hopper');
    const second = await sign(first, 'Ada Lovelace');
    const later = await edited(second);
    const ends = signedEnds(later).sort((a, b) => a - b);
    expect(ends).toStrictEqual([first.length, second.length]);
    const [firstEnd = 0, secondEnd = 0] = ends;
    const atFirst = await read(later.subarray(0, firstEnd));
    expect(atFirst.map((each) => [each.signer, each.coversDocument, each.coversWholeFile])).toStrictEqual([['Grace Hopper', true, true]]);
    const atSecond = await read(later.subarray(0, secondEnd));
    expect(atSecond.map((each) => [each.signer, each.coversDocument, each.coversWholeFile]).sort()).toStrictEqual(
      [
        ['Ada Lovelace', true, true],
        ['Grace Hopper', true, false],
      ].sort(),
    );
  }, 120_000);

  it('the reader reports each signature’s end as signedThrough, which is where its signer’s file ends', async () => {
    const first = await sign(await blank(), 'Grace Hopper');
    const second = await sign(first, 'Ada Lovelace');
    const later = await edited(second);
    const reported = (await read(later)).map((each) => [each.signer, each.signedThrough]).sort();
    // CONTROL FOR THE READ: the ends read by hand from each /ByteRange, and the files' own lengths, agree with it.
    expect(signedEnds(later).sort((a, b) => a - b)).toStrictEqual([first.length, second.length]);
    expect(reported).toStrictEqual(
      [
        ['Ada Lovelace', second.length],
        ['Grace Hopper', first.length],
      ].sort(),
    );
  }, 120_000);

  it('a file damaged after its signature: the cut recovers the signed file', async () => {
    const signed = await sign(await blank(), 'Grace Hopper');
    const later = await edited(signed);
    // DAMAGE: the appended revision's last 40 bytes, its cross-reference and trailer, overwritten.
    const damaged = Uint8Array.from(later);
    damaged.fill(0x2a, damaged.length - 40);
    // MuPDF repairs the damaged tail on open and still finds the signature, whose range is inside the undamaged part.
    const [end = 0] = signedEnds(damaged);
    const cut = damaged.subarray(0, end);
    expect(Buffer.from(cut).equals(Buffer.from(signed))).toBe(true);
    expect((await read(cut)).map((each) => [each.coversDocument, each.coversWholeFile])).toStrictEqual([[true, true]]);
  }, 60_000);

  it('a certified document: the cut keeps /Perms and the /DocMDP level, inside what was signed', async () => {
    const certified = await sign(await blank(), 'Grace Hopper', 'no-changes');
    const later = await edited(certified);
    const [end = 0] = signedEnds(later);
    const cut = later.subarray(0, end);
    expect((await read(cut)).map((each) => [each.coversDocument, each.coversWholeFile])).toStrictEqual([[true, true]]);
    const document = mupdf.PDFDocument.openDocument(cut, 'application/pdf');
    try {
      if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
      const perms = document.getTrailer().get('Root').get('Perms').get('DocMDP');
      expect(perms.isDictionary(), 'CONTROL for the read: /Perms names the certifying signature').toBe(true);
      expect(perms.get('Reference').get(0).get('TransformParams').get('P').asNumber()).toBe(1);
    } finally {
      document.destroy();
    }
  }, 60_000);
});
