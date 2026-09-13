import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { CommandOfKind, TimestampAuthority } from '@monstera/contract';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { applySignDocument, type RequestTimestamp, signDocumentWith } from './documentSign.js';
import { mupdfWriter } from './mupdfWriter.js';
import { pkcs7Asn1, readSignatures } from './signatureRead.js';
import { TimestampRefusedError, TimestampUnreachableError } from './signingRefusals.js';
import { acceptTimestampReply, timestampQuery, type TimestampQuery } from './timestampToken.js';

/**
 * Accepting a timestamp reply — ADR-0058 Decision 3 and its correction, check by
 * check, against an authority minted in memory.
 *
 * ## THE TOKEN IS BUILT BY HAND, and the reason is a limit of the library
 *
 * node-forge's signer writes three attribute types and not a signing-certificate
 * one (node-forge 1.4.0, `lib/pkcs7.js`, `_attributeToAsn1`), and check 7 needs
 * that attribute SIGNED. So the SignedData here is assembled node by node and
 * signed with the key directly — which is also what lets every negative case
 * change exactly one thing.
 *
 * ## EVERY NEGATIVE CASE IS THE PASSING TOKEN WITH ONE THING CHANGED
 *
 * The first case accepts the unmodified token. Each refusal after it takes the
 * same fixture and alters one field, so a refusal cannot come from the fixture
 * being wrong in some other way — which is the only way a refusal case separates
 * anything.
 *
 * ## B10: nothing here is a committed credential
 *
 * The authority's key and certificates are minted per run.
 */

const { asn1 } = forge;
const OID = {
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
} as const;

/** An OID from node-forge's table, refusing an absent name. */
function oid(name: string): string {
  const found = forge.pki.oids[name];
  if (found === undefined) throw new Error(`node-forge has no OID named ${name}`);
  return found;
}

const seq = (children: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children);
const set = (children: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, children);
const oidNode = (value: string): forge.asn1.Asn1 =>
  asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(value).getBytes());
const octets = (value: string): forge.asn1.Asn1 =>
  asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, value);
const integer = (value: string): forge.asn1.Asn1 =>
  asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, value);
const sha256Algorithm = (): forge.asn1.Asn1 =>
  seq([oidNode(oid('sha256')), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')]);
const der = (node: forge.asn1.Asn1): string => asn1.toDer(node).getBytes();

let keys: forge.pki.rsa.KeyPair;
/** A certificate whose only extended key usage is timestamping, marked critical. */
let timestamping: forge.pki.Certificate;
/** The same key, the usage present but NOT critical. */
let notCritical: forge.pki.Certificate;
/** The same key, no extended key usage at all. */
let noUsage: forge.pki.Certificate;

function mint(serial: string, extensions: object[]): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const names = [{ name: 'commonName', value: 'Monstera Test TSA' }];
  cert.setSubject(names);
  cert.setIssuer(names);
  cert.setExtensions(extensions);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return cert;
}

beforeAll(() => {
  keys = forge.pki.rsa.generateKeyPair(2048);
  timestamping = mint('01', [{ name: 'extKeyUsage', critical: true, timeStamping: true }]);
  notCritical = mint('02', [{ name: 'extKeyUsage', critical: false, timeStamping: true }]);
  noUsage = mint('03', []);
}, 60_000);

/** What a case may change about the token the authority answers. */
interface Twist {
  readonly status?: number;
  readonly nonce?: string;
  readonly imprint?: string;
  readonly certificate?: forge.pki.Certificate;
  /** The certificate the v2 signing-certificate attribute identifies; `null` omits it. */
  readonly identified?: forge.pki.Certificate | null;
  /**
   * ALSO a v1 SigningCertificate (SHA-1), identifying this certificate — the shape a
   * live authority's token had, measured 2026-09-13: both attributes, signed.
   */
  readonly alsoIdentifiedV1?: forge.pki.Certificate;
  /**
   * A chain certificate node-forge cannot read beside the readable signer — a key
   * algorithm it refuses. Only the signer's certificate must be readable.
   */
  readonly unreadableChainCertificate?: boolean;
  /**
   * The SIGNER'S certificate carries a key algorithm node-forge refuses — the shape a
   * live authority's ECDSA token had, measured 2026-09-13.
   */
  readonly unreadableSigner?: boolean;
  /** Alter the TSTInfo AFTER its digest is attested. */
  readonly tamperAfterSigning?: boolean;
}

/**
 * A certificate node with its key algorithm changed to `id-ecPublicKey`.
 *
 * node-forge refuses any key but RSA — *Cannot read public key. OID is not RSA.* —
 * so this makes a certificate it cannot read without needing an EC key or any
 * library beyond it. The clone is by DER round trip, so the original is untouched.
 */
function withEcKeyAlgorithm(node: forge.asn1.Asn1): forge.asn1.Asn1 {
  const clone = asn1.fromDer(der(node));
  const tbs = (clone.value as forge.asn1.Asn1[])[0]?.value as forge.asn1.Asn1[];
  const versioned = tbs[0]?.tagClass === asn1.Class.CONTEXT_SPECIFIC;
  const spki = tbs[versioned ? 6 : 5]?.value as forge.asn1.Asn1[];
  const algorithm = spki[0]?.value as forge.asn1.Asn1[];
  algorithm[0] = oidNode('1.2.840.10045.2.1');
  return clone;
}

/** The reply an authority would send for `query`, changed by `twist`. */
function reply(query: TimestampQuery, twist: Twist = {}): Uint8Array {
  const certificate = twist.certificate ?? timestamping;
  const readableNode = forge.pki.certificateToAsn1(certificate);
  const certificateNode = twist.unreadableSigner === true ? withEcKeyAlgorithm(readableNode) : readableNode;
  const certificateNodes =
    twist.unreadableChainCertificate === true
      ? [certificateNode, withEcKeyAlgorithm(forge.pki.certificateToAsn1(noUsage))]
      : [certificateNode];

  const tstInfo = seq([
    integer(asn1.integerToDer(1).getBytes()),
    oidNode('1.2.3.4.5'),
    seq([sha256Algorithm(), octets(twist.imprint ?? query.imprint)]),
    integer(asn1.integerToDer(42).getBytes()),
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.GENERALIZEDTIME,
      false,
      asn1.dateToGeneralizedTime(new Date()),
    ),
    integer(twist.nonce ?? query.nonce),
  ]);
  const tstInfoDer = der(tstInfo);

  const contentDigest = forge.md.sha256.create();
  contentDigest.update(tstInfoDer);
  const attributes: forge.asn1.Asn1[] = [
    seq([oidNode(oid('contentType')), set([oidNode(OID.tstInfo)])]),
    seq([oidNode(oid('messageDigest')), set([octets(contentDigest.digest().getBytes())])]),
  ];
  const identified = twist.identified === undefined ? certificate : twist.identified;
  if (identified !== null) {
    const certHash = forge.md.sha256.create();
    certHash.update(der(forge.pki.certificateToAsn1(identified)));
    // SigningCertificateV2 { certs SEQUENCE OF ESSCertIDv2 { certHash } } — the
    // hash algorithm is the SHA-256 default, so it is omitted.
    attributes.push(
      seq([
        oidNode(OID.signingCertificateV2),
        set([seq([seq([seq([octets(certHash.digest().getBytes())])])])]),
      ]),
    );
  }
  if (twist.alsoIdentifiedV1 !== undefined) {
    const certHash = forge.md.sha1.create();
    certHash.update(der(forge.pki.certificateToAsn1(twist.alsoIdentifiedV1)));
    // SigningCertificate { certs SEQUENCE OF ESSCertID { certHash } } — SHA-1, RFC 2634.
    attributes.push(
      seq([
        oidNode(OID.signingCertificate),
        set([seq([seq([seq([octets(certHash.digest().getBytes())])])])]),
      ]),
    );
  }
  const signed = forge.md.sha256.create();
  signed.update(der(set(attributes)));
  const signature = keys.privateKey.sign(signed);

  const signedTstInfo = twist.tamperAfterSigning === true ? `${tstInfoDer.slice(0, -1)}\x7f` : tstInfoDer;
  const signerInfo = seq([
    integer(asn1.integerToDer(1).getBytes()),
    seq([
      forge.pki.distinguishedNameToAsn1(certificate.issuer),
      integer(forge.util.hexToBytes(certificate.serialNumber)),
    ]),
    sha256Algorithm(),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, attributes),
    seq([oidNode(oid('rsaEncryption')), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')]),
    octets(signature),
  ]);
  const signedData = seq([
    integer(asn1.integerToDer(3).getBytes()),
    set([sha256Algorithm()]),
    seq([
      oidNode(OID.tstInfo),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [octets(signedTstInfo)]),
    ]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, certificateNodes),
    set([signerInfo]),
  ]);
  const token = seq([
    oidNode(oid('signedData')),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);
  const response = seq([seq([integer(asn1.integerToDer(twist.status ?? 0).getBytes())]), token]);
  return forge.util.binary.raw.decode(der(response));
}

/** A query for a fixed signature value. */
const query = (): TimestampQuery => timestampQuery('the signature value this timestamps');

/** The refusal `reply` produces, asserting it is one. */
function refusal(query: TimestampQuery, twist: Twist): TimestampRefusedError {
  try {
    acceptTimestampReply(reply(query, twist), query);
  } catch (error) {
    if (error instanceof TimestampRefusedError) return error;
    throw error;
  }
  throw new Error('the reply was accepted');
}

describe('timestampQuery', () => {
  it('asks for the certificate and sends a positive nonce', () => {
    const asked = timestampQuery('value', () => '\xff'.repeat(8));
    const parsed = asn1.fromDer(forge.util.binary.raw.encode(asked.der));
    const fields = parsed.value as forge.asn1.Asn1[];
    // version, messageImprint, nonce, certReq — no policy.
    expect(fields).toHaveLength(4);
    // A high first byte would make the INTEGER negative, so a zero byte leads it.
    expect(fields[2]?.value).toBe(`\0${'\xff'.repeat(8)}`);
    expect(fields[3]?.type).toBe(asn1.Type.BOOLEAN);
    expect(fields[3]?.value).toBe('\xff');
  });
});

describe('acceptTimestampReply', () => {
  it('THE CONTROL: accepts the unmodified token, and reports its time', () => {
    const asked = query();
    const accepted = acceptTimestampReply(reply(asked), asked);
    expect(Math.abs(accepted.genTime.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('refuses a status other than granted as REFUSED, not unverifiable', () => {
    expect(refusal(query(), { status: 2 }).reason).toBe('refused');
  });

  it('check 3: refuses an imprint that is not this signature’s', () => {
    const error = refusal(query(), { imprint: 'a different signature value hash' });
    expect(error.reason).toBe('unverifiable');
    expect(error.message).toContain('imprint');
  });

  it('check 4: refuses a nonce that is not the request’s', () => {
    const error = refusal(query(), { nonce: '\x01\x02\x03' });
    expect(error.reason).toBe('unverifiable');
    expect(error.message).toContain('nonce');
  });

  it('check 5: refuses a TSTInfo changed after its digest was attested', () => {
    const error = refusal(query(), { tamperAfterSigning: true });
    expect(error.reason).toBe('unverifiable');
    expect(error.message).toContain('does not verify');
  });

  it('check 6: refuses a certificate whose timestamping usage is not critical', () => {
    const error = refusal(query(), { certificate: notCritical });
    expect(error.message).toContain('timestamping alone');
  });

  it('check 6: refuses a certificate with no extended key usage', () => {
    const error = refusal(query(), { certificate: noUsage });
    expect(error.message).toContain('timestamping alone');
  });

  it('check 7: refuses a token with no signing-certificate attribute', () => {
    const error = refusal(query(), { identified: null });
    expect(error.message).toContain('carries no signing-certificate attribute');
  });

  it('check 7: refuses an identifier for a DIFFERENT certificate than the one that signed', () => {
    // THE SHARP CASE: the signature verifies and the usage is right, and the
    // attribute names another certificate — exactly the binding check 7 exists
    // for, and one the six checks before the correction all passed.
    const error = refusal(query(), { identified: notCritical });
    expect(error.message).toContain('does not match the certificate that signed');
  });

  /**
   * THE SHAPES LIVE AUTHORITIES SENT, measured 2026-09-13 by `npm run probe:tsa`.
   * Every token above was built from the RFCs; these four are what two real
   * authorities' tokens looked like, and the first two runs refused both — one
   * correctly for the wrong reason, one wrongly.
   */
  it('LIVE SHAPE: accepts a token carrying BOTH signing-certificate attributes, each naming the signer', () => {
    // A live token signed v1 AND v2. The first draft required exactly one and
    // refused it — a correct token, refused by a rule stricter than RFC 5816.
    const asked = query();
    const accepted = acceptTimestampReply(reply(asked, { alsoIdentifiedV1: timestamping }), asked);
    expect(accepted.genTime).toBeInstanceOf(Date);
  });

  it('CONTROL: refuses BOTH attributes when the v1 names a different certificate', () => {
    // Without this, a rule that checked only the v2 — and let a present v1 say
    // anything — passes the case above.
    const error = refusal(query(), { alsoIdentifiedV1: notCritical });
    expect(error.message).toContain('does not match the certificate that signed');
  });

  it('LIVE SHAPE: accepts a token whose CHAIN carries a certificate node-forge cannot read', () => {
    // Only the signer's certificate must be readable. The first draft parsed every
    // certificate in the token and refused on any failure.
    const asked = query();
    const accepted = acceptTimestampReply(reply(asked, { unreadableChainCertificate: true }), asked);
    expect(accepted.genTime).toBeInstanceOf(Date);
  });

  it('LIVE SHAPE: refuses a signer whose key this build cannot verify, BY THAT NAME', () => {
    // A live token was signed with ECDSA, and node-forge verifies RSA only. The first
    // run's refusal said *a certificate in the token could not be read*, which named
    // a symptom; a person choosing an authority needs the reason.
    const error = refusal(query(), { unreadableSigner: true });
    expect(error.reason).toBe('unverifiable');
    expect(error.message).toContain('key type this build does not verify');
  });
});

/**
 * SIGNING WITH A TIMESTAMP, end to end — the row's own claim, and the one a
 * decorative implementation fails: the token is IN the signature.
 *
 * Here rather than in `documentSign.test.ts` because the authority above is the
 * only one this build has, and a second copy of it would be two authorities that
 * could disagree about what a correct token is.
 */
describe('signing with a timestamp', () => {
  let unsigned: Uint8Array;
  let certificate: Uint8Array;
  const PASSPHRASE = 'timestamp-case';

  beforeAll(async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([400, 600]).drawText('A document to timestamp', { font, size: 18, x: 20, y: 540 });
    unsigned = await document.save();

    // THE SIGNER'S OWN CERTIFICATE, minted on the key above — a separate
    // certificate from the authority's, with no timestamping usage.
    const signer = mint('10', []);
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [signer], PASSPHRASE, {
      algorithm: '3des',
    });
    certificate = forge.util.binary.raw.decode(der(p12));
  }, 60_000);

  /** The command every case signs with. */
  const command = (): CommandOfKind<'signDocument'> => ({
    kind: 'signDocument',
    bytes: certificate,
    passphrase: PASSPHRASE,
    timestamp: 'digicert',
  });

  /** A port that answers as the in-memory authority, reading the query it was sent. */
  function answering(twist: Twist = {}): {
    readonly port: RequestTimestamp;
    readonly asked: TimestampAuthority[];
  } {
    const asked: TimestampAuthority[] = [];
    const port: RequestTimestamp = (authority, queryDer) => {
      asked.push(authority);
      const fields = asn1.fromDer(forge.util.binary.raw.encode(queryDer)).value as forge.asn1.Asn1[];
      const imprintFields = fields[1]?.value as forge.asn1.Asn1[];
      const sent: TimestampQuery = {
        der: queryDer,
        imprint: imprintFields[1]?.value as string,
        nonce: fields[2]?.value as string,
      };
      return Promise.resolve(reply(sent, twist));
    };
    return { port, asked };
  }

  /** The SignerInfo nodes of the one PKCS#7 in a signed file. */
  function signerInfoOf(signed: Uint8Array): forge.asn1.Asn1[] {
    const text = Buffer.from(signed).toString('latin1');
    const hole = /\/Contents <([0-9A-Fa-f]+)>/u.exec(text)?.[1];
    if (hole === undefined) throw new Error('the signed file carries no /Contents');
    const contentInfo = pkcs7Asn1(Buffer.from(hole, 'hex'));
    const signedData = (contentInfo.value as forge.asn1.Asn1[])[1]?.value as forge.asn1.Asn1[];
    const fields = signedData[0]?.value as forge.asn1.Asn1[];
    const signerInfos = fields.at(-1)?.value as forge.asn1.Asn1[];
    return signerInfos[0]?.value as forge.asn1.Asn1[];
  }

  it('THE CLAIM: the signature carries the accepted token, over THIS signature value, and still covers the document', async () => {
    const { port, asked } = answering();

    const signed = await signDocumentWith(port)(unsigned, command());

    // THE AUTHORITY THE COMMAND NAMED was the one asked, once.
    expect(asked).toStrictEqual(['digicert']);

    const fields = signerInfoOf(signed);
    const unsignedAttributes = fields.find(
      (field) => field.tagClass === asn1.Class.CONTEXT_SPECIFIC && field.type === (1 as typeof field.type),
    );
    expect(unsignedAttributes, 'the SignerInfo carries unsigned attributes').toBeDefined();
    const attributes = unsignedAttributes?.value as forge.asn1.Asn1[];
    expect(attributes).toHaveLength(1);
    const [typeNode, values] = attributes[0]?.value as forge.asn1.Asn1[];
    expect(asn1.derToOid(typeNode?.value as string)).toBe('1.2.840.113549.1.9.16.2.14');

    // THE TOKEN IS ACCEPTED AGAIN, against a query rebuilt from the signature
    // value the file actually carries — so a token over some other value, or one
    // embedded without its checks, fails here rather than passing on its presence.
    const signatureValue = fields.find(
      (field) => field.tagClass === asn1.Class.UNIVERSAL && field.type === asn1.Type.OCTETSTRING,
    )?.value as string;
    const token = (values?.value as forge.asn1.Asn1[])[0];
    if (token === undefined) throw new Error('the attribute carries no token');
    const tokenFields = token.value as forge.asn1.Asn1[];
    const signedData = (tokenFields[1]?.value as forge.asn1.Asn1[])[0];
    const eContent = ((signedData?.value as forge.asn1.Asn1[])[2]?.value as forge.asn1.Asn1[])[1];
    const tstInfo = asn1.fromDer(((eContent?.value as forge.asn1.Asn1[])[0]?.value as string));
    const imprint = ((tstInfo.value as forge.asn1.Asn1[])[2]?.value as forge.asn1.Asn1[])[1]?.value;
    const expected = forge.md.sha256.create();
    expected.update(signatureValue);
    expect(imprint).toBe(expected.digest().getBytes());

    // AND THE SIGNATURE STILL VERIFIES over the document: an unsigned attribute is
    // outside the signed attributes, so adding one must not change what is signed.
    const session = await mupdfWriter.open(signed);
    try {
      const [read] = await readSignatures(session, signed);
      expect(read?.coversDocument).toBe(true);
      expect(read?.coversWholeFile).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 120_000);

  it('CONTROL: without a timestamp, no authority is asked and no unsigned attribute is written', async () => {
    const { port, asked } = answering();
    const { timestamp: _omitted, ...plain } = command();

    const signed = await signDocumentWith(port)(unsigned, plain);

    expect(asked).toStrictEqual([]);
    expect(
      signerInfoOf(signed).some(
        (field) => field.tagClass === asn1.Class.CONTEXT_SPECIFIC && field.type === (1 as typeof field.type),
      ),
    ).toBe(false);
  }, 120_000);

  it('an unreachable authority refuses the signing — nothing is signed without the timestamp', async () => {
    const port: RequestTimestamp = () => Promise.reject(new Error('no network in the case'));
    await expect(signDocumentWith(port)(unsigned, command())).rejects.toBeInstanceOf(
      TimestampUnreachableError,
    );
  }, 120_000);

  it('a token that fails a check refuses the signing as UNVERIFIABLE', async () => {
    const { port } = answering({ nonce: '\x01' });
    const refused = signDocumentWith(port)(unsigned, command());
    await expect(refused).rejects.toBeInstanceOf(TimestampRefusedError);
    await expect(refused).rejects.toMatchObject({ reason: 'unverifiable' });
  }, 120_000);

  it('the writer with NO transport refuses a timestamp rather than signing without one', async () => {
    // `applySignDocument` is the spec table's apply, with no port. A command asking
    // for a timestamp through it must never produce a signature — which is the
    // decorative defect ADR-0058 exists to rule out.
    await expect(applySignDocument(unsigned, command())).rejects.toBeInstanceOf(
      TimestampUnreachableError,
    );
  }, 120_000);
});
