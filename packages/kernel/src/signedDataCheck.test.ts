import { constants, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { applySignDocument } from './documentSign.js';
import { mupdfWriter } from './mupdfWriter.js';
import { readSignatures } from './signatureRead.js';
import { checkSigner, readContentInfo, type SignerCheck } from './signedDataCheck.js';

/**
 * The one signer check, against a SignedData built here for each scheme a PDF signer
 * uses — finding GGGGGG-2.
 *
 * ## BUILT IN-PROCESS, never pasted
 *
 * B10: no committed credential. Every key is minted per run by `node:crypto`, and the
 * certificate and SignedData are assembled node by node with node-forge's DER writer —
 * `timestampToken.test.ts`' shape, and needed for the same reason: node-forge's own
 * signer makes neither an EC nor a PSS signature. This builder's output was accepted by
 * `openssl cms -verify` on 2026-09-13 (JOURNAL), so what is verified here is CMS as a
 * second implementation reads it, not this module's reading of its own writer.
 *
 * ## EVERY REFUSAL IS THE PASSING SIGNATURE WITH ONE THING CHANGED
 *
 * And each asserts the REFUSAL, not only `verified: false`: a changed byte and a
 * changed parameter both leave a signature unverified, and only the reason separates a
 * check that read the parameters from one that failed for any cause.
 */

const { asn1 } = forge;
const UNIVERSAL = asn1.Class.UNIVERSAL;

const OID = {
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  rsaPss: '1.2.840.113549.1.1.10',
  mgf1: '1.2.840.113549.1.1.8',
  commonName: '2.5.4.3',
  organisation: '2.5.4.10',
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
} as const;

/** The organisation every certificate built here names — never the P12's, below. */
const ORGANISATION = 'Analytical Engines';

const seq = (children: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  asn1.create(UNIVERSAL, asn1.Type.SEQUENCE, true, children);
const set = (children: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  asn1.create(UNIVERSAL, asn1.Type.SET, true, children);
const tagged = (tag: number, children: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, true, children);
const oidNode = (value: string): forge.asn1.Asn1 =>
  asn1.create(UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(value).getBytes());
const nullNode = (): forge.asn1.Asn1 => asn1.create(UNIVERSAL, asn1.Type.NULL, false, '');
const utf8 = (value: string): forge.asn1.Asn1 =>
  asn1.create(UNIVERSAL, asn1.Type.UTF8, false, forge.util.encodeUtf8(value));
const integer = (hex: string): forge.asn1.Asn1 =>
  asn1.create(UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(hex));
const der = (node: forge.asn1.Asn1): string => asn1.toDer(node).getBytes();
const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

const SERIAL = '0a1b2c';

const algorithm = (identifier: string): forge.asn1.Asn1 => seq([oidNode(identifier), nullNode()]);

/** RSASSA-PSS parameters: SHA-256, MGF1 over `maskHash`, and `salt` bytes of salt. */
function pssParameters(salt: number, maskHash: string): forge.asn1.Asn1 {
  return seq([
    tagged(0, [algorithm(OID.sha256)]),
    tagged(1, [seq([oidNode(OID.mgf1), algorithm(maskHash)])]),
    tagged(2, [integer(salt.toString(16).padStart(2, '0'))]),
  ]);
}

interface Scheme {
  readonly keys: () => { readonly publicKey: KeyObject; readonly privateKey: KeyObject };
  /** How the certificate is itself signed — PKCS#1 for an RSA key, ECDSA for an EC one. */
  readonly certificateAlgorithm: () => forge.asn1.Asn1;
  readonly signerAlgorithm: () => forge.asn1.Asn1;
  readonly padding?: number;
  readonly saltLength?: number;
}

const SCHEMES = {
  ecdsa: {
    keys: () => generateKeyPairSync('ec', { namedCurve: 'P-256' }),
    certificateAlgorithm: () => seq([oidNode(OID.ecdsaSha256)]),
    signerAlgorithm: () => seq([oidNode(OID.ecdsaSha256)]),
  },
  'rsa-pss': {
    keys: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
    certificateAlgorithm: () => algorithm(OID.sha256WithRsa),
    signerAlgorithm: () => seq([oidNode(OID.rsaPss), pssParameters(32, OID.sha256)]),
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  },
  'rsa-pkcs1': {
    keys: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
    certificateAlgorithm: () => algorithm(OID.sha256WithRsa),
    signerAlgorithm: () => algorithm(OID.rsaEncryption),
  },
} satisfies Record<string, Scheme>;

type SchemeName = keyof typeof SCHEMES;
const NAMES: readonly SchemeName[] = ['ecdsa', 'rsa-pss', 'rsa-pkcs1'];

function subjectName(): forge.asn1.Asn1 {
  return seq([
    set([seq([oidNode(OID.commonName), utf8('Probe Signer')])]),
    set([seq([oidNode(OID.organisation), utf8(ORGANISATION)])]),
  ]);
}

function certificate(scheme: Scheme, keys: ReturnType<Scheme['keys']>): forge.asn1.Asn1 {
  const utc = (date: Date): forge.asn1.Asn1 =>
    asn1.create(UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(date));
  const tbs = seq([
    tagged(0, [integer('02')]),
    integer(SERIAL),
    scheme.certificateAlgorithm(),
    subjectName(),
    seq([utc(new Date(Date.now() - 86_400_000)), utc(new Date(Date.now() + 86_400_000))]),
    subjectName(),
    asn1.fromDer(latin1(keys.publicKey.export({ type: 'spki', format: 'der' }))),
  ]);
  const signature = sign('sha256', Buffer.from(der(tbs), 'latin1'), keys.privateKey);
  return seq([
    tbs,
    scheme.certificateAlgorithm(),
    asn1.create(UNIVERSAL, asn1.Type.BITSTRING, false, String.fromCharCode(0) + latin1(signature)),
  ]);
}

/** What a case may change about the SignedData, one thing at a time. */
interface Twist {
  /** The algorithm the SignerInfo DECLARES, while the signature is made as the scheme makes it. */
  readonly declaredAlgorithm?: forge.asn1.Asn1;
  /** The serial the SignerInfo names, which no certificate in the bag may carry. */
  readonly namedSerial?: string;
  /** The content signed, as latin-1; a sentence naming the scheme when absent. */
  readonly content?: string;
}

interface Built {
  readonly blob: string;
  readonly content: string;
}

function built(name: SchemeName, twist: Twist = {}): Built {
  const scheme: Scheme = SCHEMES[name];
  const keys = scheme.keys();
  const content = twist.content ?? `the covered bytes of a document signed with ${name}`;
  const digest = forge.md.sha256.create();
  digest.update(content);
  const attributes = [
    seq([oidNode(OID.contentType), set([oidNode(OID.data)])]),
    seq([
      oidNode(OID.messageDigest),
      set([asn1.create(UNIVERSAL, asn1.Type.OCTETSTRING, false, digest.digest().getBytes())]),
    ]),
  ];
  const signature = sign('sha256', Buffer.from(der(set(attributes)), 'latin1'), {
    key: keys.privateKey,
    ...(scheme.padding === undefined ? {} : { padding: scheme.padding }),
    ...(scheme.saltLength === undefined ? {} : { saltLength: scheme.saltLength }),
  });
  const signerInfo = seq([
    integer('01'),
    seq([subjectName(), integer(twist.namedSerial ?? SERIAL)]),
    algorithm(OID.sha256),
    tagged(0, attributes),
    twist.declaredAlgorithm ?? scheme.signerAlgorithm(),
    asn1.create(UNIVERSAL, asn1.Type.OCTETSTRING, false, latin1(signature)),
  ]);
  const body = seq([
    integer('01'),
    set([algorithm(OID.sha256)]),
    seq([oidNode(OID.data)]),
    tagged(0, [certificate(scheme, keys)]),
    set([signerInfo]),
  ]);
  return { blob: der(seq([oidNode(OID.signedData), tagged(0, [body])])), content };
}

function check(signature: Built, content: string = signature.content): SignerCheck {
  const read = readContentInfo(asn1.fromDer(signature.blob));
  if (read === null) throw new Error('the fixture is not a SignedData');
  return checkSigner(read, content);
}

describe('checkSigner — every scheme a PDF signer uses (GGGGGG-2)', () => {
  it.each(NAMES)('VERIFIES a %s signature, with the key OpenSSL read from its certificate', (name) => {
    const result = check(built(name));
    expect(result).toMatchObject({ verified: true, refusal: null });
    expect(result.certificate?.x509?.publicKey.asymmetricKeyType).toBe(name === 'ecdsa' ? 'ec' : 'rsa');
  });

  it('reads an EC certificate node-forge cannot, which is where an ECDSA signature used to become unreadable', () => {
    const result = check(built('ecdsa'));
    expect(result.certificate?.forge).toBeNull();
    expect(result.certificate?.x509).not.toBeNull();
  });

  it.each(NAMES)('CONTROL: a %s signature over CHANGED content is a digest mismatch', (name) => {
    const signature = built(name);
    expect(check(signature, `X${signature.content.slice(1)}`)).toMatchObject({
      verified: false,
      refusal: 'digest-mismatch',
    });
  });

  it.each(NAMES)('CONTROL: a %s signature with its last byte changed does not verify', (name) => {
    // THE SIGNATURE IS THE BLOB'S LAST ELEMENT — the SignerInfo is last in its SET, which
    // is last in the SignedData — so the last byte is the signature's own.
    const signature = built(name);
    const last = signature.blob.charCodeAt(signature.blob.length - 1);
    const blob = signature.blob.slice(0, -1) + String.fromCharCode(last ^ 0x01);
    expect(check({ ...signature, blob })).toMatchObject({ verified: false, refusal: 'signature' });
  });

  it('READS the PSS parameters: the same signature declared with a salt of 20 does not verify', () => {
    // Made with a salt of 32 and declared as 20. A check that assumed a salt would
    // verify this; one that read the declaration refuses it.
    const signature = built('rsa-pss', {
      declaredAlgorithm: seq([oidNode(OID.rsaPss), pssParameters(20, OID.sha256)]),
    });
    expect(check(signature)).toMatchObject({ verified: false, refusal: 'signature' });
  });

  it('refuses PSS whose MASK names another hash as UNSUPPORTED, never as a signature that fails', () => {
    const signature = built('rsa-pss', {
      declaredAlgorithm: seq([oidNode(OID.rsaPss), pssParameters(32, OID.sha1)]),
    });
    expect(check(signature)).toMatchObject({ verified: false, refusal: 'unsupported-algorithm' });
  });

  it('refuses a SignerInfo naming a serial no certificate in the bag carries as NO-SIGNER', () => {
    expect(check(built('rsa-pkcs1', { namedSerial: '0a1b2d' }))).toMatchObject({
      certificate: null,
      verified: false,
      refusal: 'no-signer',
    });
  });
});

/**
 * THE PANEL, on a real PDF: a document signed by this build, whose `/Contents` is then
 * replaced by an ECDSA or RSA-PSS signature over the SAME covered bytes.
 *
 * The ranges and every other byte are the signed file's, so what changes is only the
 * scheme — which is the finding: before GGGGGG-2 the ECDSA signature read as
 * unreadable and the RSA-PSS one as *the document has changed*. The organisation is
 * asserted because the P12 this build signed with names a different one, so a panel
 * still reading the first certificate cannot pass.
 */
describe('readSignatures — an ECDSA and an RSA-PSS signature in a real PDF (GGGGGG-2)', () => {
  const PASSPHRASE = 'probe-passphrase';
  const REASON = 'I approve this document';
  let unsigned: Uint8Array;
  let p12: Uint8Array;

  beforeAll(async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([400, 600]).drawText('A document to sign', { font, size: 18, x: 20, y: 540 });
    unsigned = await document.save();

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86_400_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    const names = [
      { name: 'commonName', value: 'Monstera Test' },
      { name: 'organizationName', value: 'Tenslor Inc.' },
    ];
    cert.setSubject(names);
    cert.setIssuer(names);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const bag = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, { algorithm: '3des' });
    p12 = Uint8Array.from(der(bag), (character) => character.charCodeAt(0));
  }, 60_000);

  /** A freshly signed file, and its `/ByteRange`'s four numbers. */
  async function signedFile(): Promise<{ readonly bytes: Uint8Array; readonly range: readonly number[] }> {
    const bytes = await applySignDocument(unsigned, {
      kind: 'signDocument',
      bytes: p12,
      passphrase: PASSPHRASE,
      reason: REASON,
    });
    const found = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/u.exec(latin1(bytes));
    if (found === null) throw new Error('the signed file carries no resolved byte range');
    return { bytes, range: [Number(found[1]), Number(found[2]), Number(found[3]), Number(found[4])] };
  }

  /** `bytes` with its `/Contents` replaced by `name`'s signature over the same covered bytes. */
  function resigned(bytes: Uint8Array, range: readonly number[], name: SchemeName): Uint8Array {
    const [a = 0, b = 0, c = 0, d = 0] = range;
    const text = latin1(bytes);
    const covered = text.slice(a, a + b) + text.slice(c, c + d);
    const hex = Buffer.from(built(name, { content: covered }).blob, 'latin1').toString('hex');
    // THE HOLE IS `<`, THE HEX, `>`, zero-padded — the same bytes, so every offset holds.
    const holeDigits = c - b - 2;
    expect(hex.length, 'the new signature fits the hole').toBeLessThanOrEqual(holeDigits);
    const out = Uint8Array.from(bytes);
    out.set(Buffer.from(hex.padEnd(holeDigits, '0'), 'latin1'), b + 1);
    return out;
  }

  async function panel(bytes: Uint8Array): Promise<Awaited<ReturnType<typeof readSignatures>>> {
    const session = await mupdfWriter.open(bytes);
    try {
      return await readSignatures(session, bytes);
    } finally {
      await mupdfWriter.close(session);
    }
  }

  it.each(['ecdsa', 'rsa-pss'] as const)(
    'reads a %s signature as COVERING the document, with its own certificate’s organisation',
    async (name) => {
      const { bytes, range } = await signedFile();
      const read = await panel(resigned(bytes, range, name));
      expect(read).toHaveLength(1);
      expect(read[0]).toMatchObject({ coversDocument: true, coversWholeFile: true, organisation: ORGANISATION });
    },
    60_000,
  );

  it.each(['ecdsa', 'rsa-pss'] as const)(
    'CONTROL: the same %s signature over a document CHANGED after signing does not cover it',
    async (name) => {
      const { bytes, range } = await signedFile();
      const changed = resigned(bytes, range, name);
      const at = Buffer.from(changed).indexOf(REASON);
      expect(at, 'the reason string is in the covered bytes').toBeGreaterThan(-1);
      changed[at] = 'X'.charCodeAt(0);
      const read = await panel(changed);
      expect(read[0]).toMatchObject({ coversDocument: false, organisation: ORGANISATION });
    },
    60_000,
  );
});
