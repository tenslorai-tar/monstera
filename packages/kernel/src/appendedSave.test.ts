import { PDFDocument } from '@cantoo/pdf-lib';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { applySetDocumentProtection, protectedImageOf } from './documentProtection.js';
import { NO_TIMESTAMPS, signPrepared } from './documentSign.js';
import type { ByteImage, MupdfSession } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { prepareSignature } from './signaturePlaceholder.js';
import { placeholderRequestOf } from './signatureHole.js';
import { readSignatures } from './signatureRead.js';
import { applySignDocument } from './signpdfWriter.js';

/**
 * Every appended save of a signed document opens, however many one session makes (the owner's ruling of 2026-11-06,
 * `mupdfWriter.ts`' `rebasedOn`). MuPDF took the section an appended save into memory wrote as the document's last,
 * while the next save still appended to the bytes the session was opened from, so the second save's `/Prev` named an
 * offset of a file that was not there, and a plain reader found no pages.
 *
 * Each case reads every saved file as another application would: a PLAIN open, with no repair (`mupdfOpen.ts` rebuilds a
 * broken chain, which would hide the fault), its page count, every earlier file's bytes as its prefix, and this build's
 * signature reader on a fresh session.
 */

const PASSPHRASE = 'a passphrase';
const USER = 'open-me';
const OWNER = 'own-me';
const PAGES = 2;
let unsigned: ByteImage;
let certificate: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let at = 0; at < PAGES; at += 1) document.addPage([300, 300]);
  unsigned = await document.save();
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'Monstera Test' }]);
  cert.setIssuer([{ name: 'commonName', value: 'Monstera Test' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, { algorithm: '3des' })).getBytes();
  certificate = Uint8Array.from(der, (character: string) => character.charCodeAt(0));
}, 60_000);

const command = { kind: 'signDocument' as const, bytes: new Uint8Array(), passphrase: PASSPHRASE, name: 'Grace Hopper' };

/** How many pages a PLAIN open reads, the way another application reads the file: no repair, no password. */
function plainPages(bytes: ByteImage): number {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    return document.countPages();
  } finally {
    document.destroy();
  }
}

/** Whether each signature in `bytes` covers what it signed, read on a fresh session. */
async function covering(bytes: ByteImage, password?: string): Promise<boolean[]> {
  const session = await mupdfWriter.open(bytes, password);
  try {
    return (await readSignatures(session, bytes)).map((each) => each.coversDocument);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * Three appended saves of `signed` from ONE session, every file checked. `every`: a change before each save; `first`: a
 * change before the first only, so the second and third change nothing.
 */
async function threeSaves(signed: ByteImage, change: 'every' | 'first', password?: string): Promise<void> {
  const session: MupdfSession = await mupdfWriter.open(signed, password);
  try {
    let earlier: ByteImage = signed;
    for (let round = 1; round <= 3; round += 1) {
      if (change === 'every' || round === 1) await withDocument(session, (document) => {
        document.findPage(0).put('Rotate', (round * 90) % 360);
      });
      const saved = await mupdfWriter.serialise(session);
      expect(plainPages(saved), `save ${String(round)}: the page count a plain reader finds`).toBe(PAGES);
      // APPENDED: every earlier file, the signed one included, is this one's first bytes, unchanged.
      expect(Buffer.from(saved.subarray(0, earlier.byteLength)).equals(Buffer.from(earlier)), `save ${String(round)} keeps the earlier bytes`).toBe(true);
      expect(Buffer.from(saved.subarray(0, signed.byteLength)).equals(Buffer.from(signed))).toBe(true);
      expect(await covering(saved, password), `save ${String(round)}: the signature covers what it signed`).toStrictEqual([true]);
      if (change === 'every') expect(saved.byteLength).toBeGreaterThan(earlier.byteLength);
      earlier = saved;
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('appended saves of a signed document, any number from one session', () => {
  it('CONTROL: the signed file itself opens plainly with its pages, and its signature covers it', async () => {
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    expect(plainPages(signed)).toBe(PAGES);
    expect(await covering(signed)).toStrictEqual([true]);
  }, 60_000);

  it('three saves in a row with a change between them', async () => {
    await threeSaves(await applySignDocument(unsigned, { ...command, bytes: certificate }), 'every');
  }, 60_000);

  it('three saves in a row with no change between them, after one change before the first', async () => {
    await threeSaves(await applySignDocument(unsigned, { ...command, bytes: certificate }), 'first');
  }, 60_000);

  it('a protected document, signed under its key and saved three times with a change between', async () => {
    const protect = await mupdfWriter.open(unsigned);
    let protectedFile: ByteImage;
    try {
      await applySetDocumentProtection(protect, {
        kind: 'setDocumentProtection',
        encryption: 'aes-256',
        userPassword: USER,
        ownerPassword: OWNER,
        permissions: ['print'],
      });
      protectedFile = await mupdfWriter.serialise(protect);
    } finally {
      await mupdfWriter.close(protect);
    }
    // SIGNED THE WAY THE HOST SIGNS A PROTECTED DOCUMENT: the revision appended under its key (`appendedUnderKey`).
    const holding = await mupdfWriter.open(protectedFile, USER);
    let signed: ByteImage;
    try {
      const signing = { ...command, bytes: certificate };
      const protection = await protectedImageOf(holding);
      if (protection === undefined) throw new Error('the case expected a protected session');
      const prepared = await prepareSignature(protection.image, placeholderRequestOf(signing), { password: protection.password });
      signed = await signPrepared(prepared, signing, NO_TIMESTAMPS);
    } finally {
      await mupdfWriter.close(holding);
    }
    await threeSaves(signed, 'every', USER);
  }, 60_000);
});
