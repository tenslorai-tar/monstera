import { PDFDocument, PDFName, type PDFRef, PDFString } from '@cantoo/pdf-lib';
import { CERTIFICATION_LEVELS, type CertificationLevel } from '@monstera/contract';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { docMdpOf, savedUncertified } from './docMdp.js';
import type { ByteImage } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';
import { certificationOf, readSignatures, signatureFacts } from './signatureRead.js';
import { applySignDocument } from './signpdfWriter.js';

/**
 * ADR-0291 Decision 1: one reader of a certification, `/Perms /DocMDP` and its `/TransformParams /P`, with the certifier
 * named as every signature is. Each level is written by this build's own signer, so the reader is held to the writer.
 */

let credential: Uint8Array;
beforeAll(() => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'Certificate Name' }]);
  cert.setIssuer([{ name: 'commonName', value: 'Certificate Name' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pass', { algorithm: '3des' })).getBytes();
  credential = Uint8Array.from(p12, (character: string) => character.charCodeAt(0));
}, 60_000);

async function blank(): Promise<ByteImage> {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  return document.save();
}

const sign = (bytes: ByteImage, name: string | undefined, certify?: CertificationLevel) =>
  applySignDocument(bytes, {
    kind: 'signDocument',
    bytes: credential,
    passphrase: 'pass',
    ...(name === undefined ? {} : { name }),
    ...(certify === undefined ? {} : { certify }),
  });

function read(bytes: ByteImage): ReturnType<typeof certificationOf> {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    return certificationOf(document);
  } finally {
    document.destroy();
  }
}

/** A blank page whose catalogue carries `/Perms /DocMDP` as `perms` builds it, signed by nothing. */
async function withPerms(perms: (document: PDFDocument) => PDFRef | number): Promise<ByteImage> {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  document.catalog.set(PDFName.of('Perms'), document.context.obj({ DocMDP: perms(document) }));
  return document.save();
}

const signatureWith = (params: Record<string, unknown>) => (document: PDFDocument) =>
  document.context.register(
    document.context.obj({
      Type: 'Sig',
      Name: PDFString.of('Hand Built'),
      Reference: [{ Type: 'SigRef', TransformMethod: 'DocMDP', TransformParams: { Type: 'TransformParams', V: '1.2', ...params } }],
    }),
  );

describe('a certification, read (ADR-0291 Decision 1)', () => {
  for (const level of CERTIFICATION_LEVELS) {
    it(`the ${level} level this build's signer writes reads back, with the certifier's name`, async () => {
      expect(read(await sign(await blank(), 'Grace Hopper', level))).toStrictEqual({ level, signer: 'Grace Hopper' });
    }, 60_000);
  }

  it('a certifier with no /Name is named by the certificate', async () => {
    expect(read(await sign(await blank(), undefined, 'no-changes'))).toStrictEqual({ level: 'no-changes', signer: 'Certificate Name' });
  }, 60_000);

  it('CONTROL: an ordinary signature is no certification, and neither is an unsigned file', async () => {
    expect(read(await sign(await blank(), 'Grace Hopper'))).toBeNull();
    expect(read(await blank())).toBeNull();
  }, 60_000);

  it('a /TransformParams with no /P is the format’s default, form filling and signing', async () => {
    expect(read(await withPerms(signatureWith({})))).toStrictEqual({ level: 'form-fill', signer: 'Hand Built' });
  });

  it('a /P this build cannot read, and a /Perms naming no signature, are read as no changes', async () => {
    expect(read(await withPerms(signatureWith({ P: 7 })))?.level).toBe('no-changes');
    expect(read(await withPerms(() => 5))).toStrictEqual({ level: 'no-changes', signer: '' });
    // CONTROL: the same hand-built signature with a /P of 3 reads 3, so the refusal above is the value's doing.
    expect(read(await withPerms(signatureWith({ P: 3 })))?.level).toBe('form-fill-and-annotate');
  });

  it('a copy written uncertified carries no certification, is written whole, and the session stays certified', async () => {
    const certified = await sign(await blank(), 'Grace Hopper', 'no-changes');
    const session = await mupdfWriter.open(certified);
    try {
      const copy = await mupdfWriter.serialise(session, { certification: 'removed' });
      expect(read(copy), 'the copy is no longer certified').toBeNull();
      // WHOLE: the certified file is not the copy's first bytes, so no earlier revision holds the certification.
      expect(Buffer.from(copy.subarray(0, certified.length)).equals(Buffer.from(certified))).toBe(false);
      expect(Buffer.from(copy).includes('/DocMDP')).toBe(false);
      // THE SIGNATURE STAYS (preserve, never drop): its dictionary is still in the copy.
      expect(Buffer.from(copy).includes('/ByteRange')).toBe(true);
      // THE SESSION IS PUT BACK: the next save as held is certified, and appended to the signed bytes.
      const held = await mupdfWriter.serialise(session);
      expect(read(held)).toStrictEqual({ level: 'no-changes', signer: 'Grace Hopper' });
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('a /Perms holding usage rights and NO /DocMDP is no certification, and taking one out writes no /DocMDP', async () => {
    const built = await PDFDocument.create();
    built.addPage([400, 600]);
    built.catalog.set(PDFName.of('Perms'), built.context.obj({ UR3: built.context.register(built.context.obj({ Type: 'Sig' })) }));
    const bytes = await built.save();
    const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    try {
      if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
      expect(docMdpOf(document)).toBeNull();
      expect(certificationOf(document)).toBeNull();
      const plain = document.saveToBuffer('').asUint8Array();
      const taken = savedUncertified(document, () => document.saveToBuffer('').asUint8Array());
      expect(Buffer.from(taken).equals(Buffer.from(plain)), 'nothing taken out, nothing put back').toBe(true);
      expect(Buffer.from(document.saveToBuffer('').asUint8Array()).includes('/DocMDP'), 'and none left after it').toBe(false);
      // CONTROL: the usage rights are in what it wrote, so the search above can see the catalogue's /Perms.
      expect(Buffer.from(taken).includes('/UR3')).toBe(true);
    } finally {
      document.destroy();
    }
  });

  it('CONTROL: an ordinary signed document is written exactly as without the option', async () => {
    const signed = await sign(await blank(), 'Grace Hopper');
    const asked = await mupdfWriter.open(signed);
    const plain = await mupdfWriter.open(signed);
    try {
      const removed = await mupdfWriter.serialise(asked, { certification: 'removed' });
      const asHeld = await mupdfWriter.serialise(plain);
      expect(Buffer.from(removed).equals(Buffer.from(asHeld))).toBe(true);
    } finally {
      await mupdfWriter.close(asked);
      await mupdfWriter.close(plain);
    }
  }, 60_000);

  it('a certification whose signature NO LONGER VERIFIES still locks (the owner’s answer of 2026-11-12)', async () => {
    const certified = await sign(await blank(), 'Grace Hopper', 'no-changes');
    // ONE BYTE INSIDE THE SIGNED RANGE: the page's width, 400 made 401, so the file still opens and its digest does not
    // match what was signed.
    const at = Buffer.from(certified).indexOf('/MediaBox [ 0 0 400');
    expect(at, 'the page box is in the signed bytes').toBeGreaterThan(0);
    const changed = Uint8Array.from(certified);
    const digit = at + '/MediaBox [ 0 0 40'.length;
    changed[digit] = '1'.charCodeAt(0);
    const session = await mupdfWriter.open(changed);
    try {
      // CONTROL: the certifier's signature really does not verify over these bytes; it did over the unchanged ones.
      expect((await readSignatures(session, changed)).map((each) => each.coversDocument)).toStrictEqual([false]);
      expect((await signatureFacts(session)).certification).toStrictEqual({ level: 'no-changes', signer: 'Grace Hopper' });
    } finally {
      await mupdfWriter.close(session);
    }
    const intact = await mupdfWriter.open(certified);
    try {
      expect((await readSignatures(intact, certified)).map((each) => each.coversDocument)).toStrictEqual([true]);
    } finally {
      await mupdfWriter.close(intact);
    }
  }, 60_000);

  it('the lane’s one read carries it beside the signature count', async () => {
    const certified = await sign(await blank(), 'Grace Hopper', 'form-fill');
    const session = await mupdfWriter.open(certified);
    try {
      expect(await signatureFacts(session)).toStrictEqual({
        signatures: 1,
        kept: true,
        certification: { level: 'form-fill', signer: 'Grace Hopper' },
      });
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);
});
