import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from '@cantoo/pdf-lib';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { applySignDocument, withSignaturePlaceholder } from './documentSign.js';
import type { ByteImage } from './engineSeam.js';

/**
 * Signing — Stage 7's PKCS#7 row, paying ADR-0054's gate.
 *
 * ## The certificate is MINTED HERE, not committed
 *
 * B10 forbids committing a binary and an unvetted fixture, and a private key is
 * the worst example of both. `node-forge` builds a self-signed P12 in memory
 * for each run, exactly as the gate's own spike did — so nothing on disk is a
 * credential and nothing has to be rotated.
 *
 * ## The load-bearing case does NOT ask the signer whether it worked
 *
 * That is the gate's own sentence and it is the point: a signature that
 * "worked" over the wrong bytes is the failure nothing else here would see. The
 * case recomputes SHA-256 over the two covered spans and compares it with the
 * `messageDigest` attribute the signature actually attests.
 */
let unsigned: ByteImage;
let certificate: Uint8Array;

const PASSPHRASE = 'spike-passphrase';

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 600]).drawText('A document to sign', { font, size: 18, x: 20, y: 540 });
  unsigned = await document.save();

  // A SELF-SIGNED P12, built the way ADR-0054's spike built one.
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [
    { name: 'commonName', value: 'Monstera Test' },
    { name: 'organizationName', value: 'Tenslor Inc.' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12).getBytes();
  certificate = Uint8Array.from(der, (character: string) => character.charCodeAt(0));
}, 60_000);

/** The command every case here signs with. */
const command = {
  kind: 'signDocument' as const,
  bytes: new Uint8Array(),
  passphrase: PASSPHRASE,
  name: 'Grace Hopper',
  reason: 'I approve this document',
  location: 'Arlington',
};

describe('the placeholder this build writes', () => {
  it('carries the literal token shape `findByteRange` requires', async () => {
    // ADR-0054 Decision 3. Four NUMBERS is the obvious shape and is refused
    // with a message that names the wrong thing, so this asserts the shape
    // rather than trusting that signing later succeeds — a case that only ever
    // saw a signed file could not tell a correct placeholder from one the
    // signer happened to tolerate.
    //
    // **THE SPACING IS pdf-lib's, and it is not the ADR's.** Decision 3 writes
    // the requirement as `/ByteRange [0 /********** …]`; `@cantoo/pdf-lib`
    // serialises an array as `[ 0 /********** … ]`, with spaces inside the
    // brackets, and `@signpdf` accepts it — the gate case below signs this very
    // document. So what the ADR pins is the **token shape** (a number then
    // three names of ten asterisks) rather than a byte-exact string, and this
    // case asserts the tokens in the order they must appear.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const text = Buffer.from(placed).toString('latin1');
    // The slot ESCAPED, one backslash per asterisk: `*` is a quantifier, and
    // the first draft interpolated ten of them unescaped and produced
    // *Nothing to repeat* — a regular expression that refuses to compile,
    // which is at least loud.
    const slot = '\\*'.repeat(10);
    expect(text).toMatch(
      new RegExp(`/ByteRange \\[\\s*0\\s+/${slot}\\s+/${slot}\\s+/${slot}\\s*\\]`, 'u'),
    );
  });

  it('is NOT compressed into an object stream, which is what the signer reads', async () => {
    // ADR-0054 Decision 3's second constraint: `@signpdf` locates the
    // `/Contents` hole in the raw bytes. A compressed signature dictionary is
    // invisible to it, and the failure is *no byte range found* rather than
    // anything naming compression.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const text = Buffer.from(placed).toString('latin1');
    expect(text).toContain('/Type /Sig');
    expect(text).toContain('/SubFilter /adbe.pkcs7.detached');
  });

  it('registers the field in /AcroForm with /SigFlags and one entry in /Fields', async () => {
    // BOTH HALVES, because either alone passes for a placeholder a reader would
    // not treat as a signature: `/SigFlags` without a field is a document that
    // announces a signature it does not have, and a field without the flag is
    // one some readers never look for.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const back = await PDFDocument.load(placed, { updateMetadata: false });
    const acroForm = back.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm).toBeDefined();
    expect(acroForm?.lookup(PDFName.of('SigFlags'), PDFNumber).asNumber()).toBe(3);
    expect(acroForm?.lookup(PDFName.of('Fields'), PDFArray).size()).toBe(1);
  });
});

describe('applySignDocument', () => {
  it('signs, and the signed file is EXACTLY as long as its placeholder', async () => {
    // The property the whole scheme rests on, and the apply asserts it too —
    // this is the case that says the assertion can be true.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    expect(signed.byteLength).toBe(placed.byteLength);
  }, 60_000);

  it('THE GATE: the messageDigest matches SHA-256 of exactly the covered ranges', async () => {
    // ADR-0054's own verification, without asking the signer whether it worked.
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    const text = Buffer.from(signed).toString('latin1');

    const ranges = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/u.exec(text);
    expect(ranges, 'the signed file carries a resolved byte range').not.toBeNull();
    if (ranges === null) return;
    const [a, b, c, d] = [
      Number(ranges[1]),
      Number(ranges[2]),
      Number(ranges[3]),
      Number(ranges[4]),
    ];
    // THE RANGES DESCRIBE THE FILE THEY ARE IN, which is the claim a reader
    // takes on trust: the two spans plus the hole are the whole document.
    expect(b + d + (c - b)).toBe(signed.byteLength);

    const covered = Buffer.concat([
      Buffer.from(signed.subarray(a, a + b)),
      Buffer.from(signed.subarray(c, c + d)),
    ]);
    const digest = forge.md.sha256.create();
    digest.update(covered.toString('latin1'));

    // THE SIGNATURE'S OWN ATTESTATION, parsed out of the PKCS#7 rather than
    // recomputed from anything this test controls.
    const hole = /\/Contents <([0-9A-Fa-f]+)>/u.exec(text);
    expect(hole, 'the signed file carries a PKCS#7 blob').not.toBeNull();
    if (hole === null) return;
    const der = Buffer.from((hole[1] ?? '').replace(/0+$/u, ''), 'hex').toString('latin1');
    const message = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as unknown as {
      rawCapture: { authenticatedAttributes: unknown[] };
    };

    // THE OID FROM THE TABLE, and its absence is a throw rather than a `find`
    // that silently matches nothing: `forge.pki.oids` is typed as an index
    // signature, so a mistyped key reads as `undefined` and every attribute
    // would then "contain" it.
    const messageDigestOid = forge.pki.oids['messageDigest'];
    expect(messageDigestOid, 'node-forge knows the messageDigest OID').toBeDefined();
    if (messageDigestOid === undefined) return;

    const attributes = message.rawCapture.authenticatedAttributes;
    const attested = attributes
      .map((attribute) => forge.asn1.toDer(attribute as never).getBytes())
      .find((bytes) => bytes.includes(forge.asn1.oidToDer(messageDigestOid).getBytes()));
    expect(attested, 'the signature carries a messageDigest attribute').toBeDefined();
    expect(attested).toContain(digest.digest().getBytes());
  }, 60_000);

  it('CONTROL: a WRONG passphrase refuses rather than signing something', async () => {
    // Without this the cases above are satisfied by a signer that ignores the
    // credential entirely — which would sign every document with whatever key
    // it found first.
    await expect(
      applySignDocument(unsigned, { ...command, bytes: certificate, passphrase: 'not-it' }),
    ).rejects.toThrow();
  }, 60_000);

  it('CONTROL: a file that is not a PKCS#12 refuses', async () => {
    await expect(
      applySignDocument(unsigned, { ...command, bytes: unsigned }),
    ).rejects.toThrow();
  }, 60_000);
});
