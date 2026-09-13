import forge from 'node-forge';

import { attributeValues, bytesOf, checkSigner, DIGESTS } from './signedDataCheck.js';
import type { ForgeCertificate, ForgeMessage } from './signedDataCheck.js';
import { TimestampRefusedError } from './signingRefusals.js';

/**
 * RFC 3161 timestamps: the request this build sends, and the only reply it accepts
 * ([ADR-0058](../../../docs/DECISIONS/0058-a-timestamp-authority-is-verified-not-trusted-and-its-request-may-be-plain-http.md),
 * with its same-day correction).
 *
 * ## THE REPLY IS VERIFIED, NOT TRUSTED — and that is the whole row
 *
 * The founding record's rule for this feature is *implemented correctly or not
 * offered*: a flow that requests a timestamp and discards what came back is
 * decorative. So {@link acceptTimestampReply} is the one place a reply becomes a
 * token, and it answers a token only when every check below held. There is no
 * partial answer and no warning: a token that fails any check is refused, and the
 * signature is not written.
 *
 * 1. The status is `granted` or `grantedWithMods`, and a token is present.
 * 2. The token is a SignedData whose `eContentType` is `id-ct-TSTInfo`.
 * 3. The TSTInfo's `messageImprint` is SHA-256 of THIS signature value.
 * 4. The TSTInfo's `nonce` is the request's.
 * 5. The token's signer verifies over the TSTInfo — by `signedDataCheck.ts`, the
 *    same module that verifies a document signature (B3a).
 * 6. That certificate's only extended key usage is `id-kp-timeStamping`, critical.
 * 7. Exactly one signed SigningCertificate or SigningCertificateV2 attribute, whose
 *    first identifier hashes to that certificate's exact DER.
 *
 * The request sets `certReq`, so RFC 3161 §2.4.1 obliges the authority to put the
 * certificate in the token and nothing here fetches a second thing.
 *
 * ## Read with node-forge's VALIDATOR, because its reader refuses a token
 *
 * `forge.pkcs7.messageFromAsn1` throws *Only wrapped ContentType Data supported*
 * (node-forge 1.4.0, `lib/pkcs7.js`), and a token's content is a TSTInfo. The
 * validator that reader runs, `forge.pkcs7.asn1.signedDataValidator`, has no such
 * restriction and captures the same fields — so this is the same library's
 * reading of the same structure, not a second parser.
 */

/** The OIDs node-forge's table does not name, as the RFCs define them. */
const OIDS = {
  /** RFC 3161 §2.4.2, `id-ct-TSTInfo`. */
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  /** RFC 3161 Appendix A, `id-aa-timeStampToken`. */
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  /** RFC 2634, `id-aa-signingCertificate` (ESSCertID, SHA-1). */
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  /** RFC 5035, `id-aa-signingCertificateV2` (ESSCertIDv2). */
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
} as const;

/** The unsigned attribute a timestamp token is carried in on a signature. */
export const TIMESTAMP_TOKEN_ATTRIBUTE_OID = OIDS.timeStampToken;

/** How many random bytes the nonce carries — RFC 3161 §2.4.1's *e.g., a 64 bit integer*. */
const NONCE_BYTES = 8;

/** A request, and what its reply must echo. */
export interface TimestampQuery {
  /** The DER-encoded TimeStampReq, as sent. */
  readonly der: Uint8Array;
  /** SHA-256 of the signature value, as raw bytes in a binary string. */
  readonly imprint: string;
  /** The nonce's DER INTEGER content, as raw bytes in a binary string. */
  readonly nonce: string;
}

/** An accepted token. */
export interface AcceptedTimestamp {
  /** The TimeStampToken — a ContentInfo — ready to carry as an unsigned attribute. */
  readonly token: forge.asn1.Asn1;
  /** The TSTInfo's `genTime`. */
  readonly genTime: Date;
}

const { asn1 } = forge;

/** A primitive UNIVERSAL node. */
function primitive(type: forge.asn1.Type, value: string): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, type, false, value);
}

/** A constructed UNIVERSAL SEQUENCE. */
function sequence(children: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children);
}

/** An OID from node-forge's table, refusing a name the table does not hold. */
function known(name: string): string {
  const found = forge.pki.oids[name];
  if (found === undefined) throw new Error(`node-forge has no OID named ${name}`);
  return found;
}

/**
 * Random bytes as a minimal, POSITIVE DER INTEGER content.
 *
 * DER forbids a leading zero byte unless the next byte's high bit is set, and an
 * INTEGER whose first byte has its high bit set is negative. A nonce is compared
 * byte for byte against the one the authority echoes, so it is made canonical
 * here rather than normalised at the comparison.
 */
function positiveInteger(bytes: string): string {
  let content = bytes.replace(/^\0+/u, '');
  if (content === '') content = '\0';
  if (content.charCodeAt(0) >= 0x80) content = `\0${content}`;
  return content;
}

/**
 * The TimeStampReq for a signature value (RFC 3161 §2.4.1).
 *
 * @param signatureValue the SignerInfo's `signature` OCTET STRING content — what
 *   RFC 3161 Appendix A says a signature timestamp's imprint hashes.
 * @param random injected so a case can fix the nonce; the application never passes it.
 */
export function timestampQuery(
  signatureValue: string,
  random: (count: number) => string = (count) => forge.random.getBytesSync(count),
): TimestampQuery {
  const digest = forge.md.sha256.create();
  digest.update(signatureValue);
  const imprint = digest.digest().getBytes();
  const nonce = positiveInteger(random(NONCE_BYTES));

  const request = sequence([
    primitive(asn1.Type.INTEGER, asn1.integerToDer(1).getBytes()),
    sequence([
      sequence([
        primitive(asn1.Type.OID, asn1.oidToDer(known('sha256')).getBytes()),
        primitive(asn1.Type.NULL, ''),
      ]),
      primitive(asn1.Type.OCTETSTRING, imprint),
    ]),
    primitive(asn1.Type.INTEGER, nonce),
    // certReq TRUE: the authority must include its certificate (§2.4.1).
    primitive(asn1.Type.BOOLEAN, String.fromCharCode(0xff)),
  ]);
  return {
    der: forge.util.binary.raw.decode(asn1.toDer(request).getBytes()),
    imprint,
    nonce,
  };
}

/** Throws the one refusal every failed check answers with. */
function unverifiable(why: string, cause?: unknown): never {
  throw new TimestampRefusedError(
    'unverifiable',
    `the timestamp token was refused: ${why}`,
    cause === undefined ? undefined : { cause },
  );
}

/** The children of a constructed node, or a refusal naming what was expected. */
function childrenOf(node: forge.asn1.Asn1 | undefined, what: string): forge.asn1.Asn1[] {
  if (node === undefined || !Array.isArray(node.value)) unverifiable(`${what} is not a structure`);
  return node.value;
}

/**
 * The half of node-forge's DER validator this module calls.
 *
 * `@types/node-forge` declares neither `asn1.validate` nor `pkcs7.asn1`; both exist
 * at runtime in node-forge 1.4.0 (`lib/asn1.js`, `lib/pkcs7asn1.js`). A typed
 * adapter over those two members rather than an `any`.
 */
interface ForgeValidation {
  readonly asn1: {
    validate(
      node: forge.asn1.Asn1,
      validator: unknown,
      capture: Record<string, unknown>,
      errors: unknown[],
    ): boolean;
  };
  readonly pkcs7: { readonly asn1: { readonly signedDataValidator: unknown } };
}

/**
 * The reply, as a token — or a refusal. See the module header for every check.
 *
 * @param reply the body the authority answered, already bounded by the caller.
 * @param query the request it answers.
 */
export function acceptTimestampReply(reply: Uint8Array, query: TimestampQuery): AcceptedTimestamp {
  let response: forge.asn1.Asn1;
  try {
    response = asn1.fromDer(forge.util.binary.raw.encode(reply));
  } catch (cause) {
    unverifiable('the reply is not DER', cause);
  }

  // 1 — THE STATUS, and a token beside it.
  const [statusInfo, token] = childrenOf(response, 'the TimeStampResp');
  const status = bytesOf(childrenOf(statusInfo, 'the PKIStatusInfo')[0]);
  if (status === null) unverifiable('the PKIStatus is not an INTEGER');
  const granted = asn1.derToInteger(status);
  if (granted !== 0 && granted !== 1) {
    throw new TimestampRefusedError('refused', `the authority answered PKIStatus ${String(granted)}`);
  }
  if (token === undefined) unverifiable('a granted reply carried no token');

  // 2 — A SignedData whose content is a TSTInfo.
  const [contentType, explicit] = childrenOf(token, 'the TimeStampToken');
  const outerType = bytesOf(contentType);
  if (outerType === null || asn1.derToOid(outerType) !== known('signedData')) {
    unverifiable('the token is not a SignedData');
  }
  const signedData = childrenOf(explicit, 'the token content')[0];
  if (signedData === undefined) unverifiable('the token carries no SignedData');

  const capture: Record<string, unknown> = {};
  const validation = forge as unknown as ForgeValidation;
  if (!validation.asn1.validate(signedData, validation.pkcs7.asn1.signedDataValidator, capture, [])) {
    unverifiable('the SignedData does not have the shape RFC 5652 gives it');
  }
  const eContentType = capture['contentType'];
  if (typeof eContentType !== 'string' || asn1.derToOid(eContentType) !== OIDS.tstInfo) {
    unverifiable('the SignedData does not carry a TSTInfo');
  }
  const eContent = childrenOf(capture['content'] as forge.asn1.Asn1 | undefined, 'the eContent')[0];
  if (
    eContent?.type !== asn1.Type.OCTETSTRING ||
    eContent.constructed ||
    typeof eContent.value !== 'string'
  ) {
    unverifiable('the TSTInfo is not one primitive OCTET STRING');
  }
  const tstInfoDer = eContent.value;

  // THE CERTIFICATES, parsed and kept beside the nodes they came from: check 7
  // hashes the certificate's own DER, and a re-encoding of a parsed certificate is
  // a different question.
  const certificateNodes = childrenOf(
    capture['certificates'] as forge.asn1.Asn1 | undefined,
    'the certificates field',
  );
  let certificates: ForgeCertificate[];
  try {
    certificates = certificateNodes.map(
      (node) => forge.pki.certificateFromAsn1(node) as unknown as ForgeCertificate,
    );
  } catch (cause) {
    unverifiable('a certificate in the token could not be read', cause);
  }

  // 5 — THE SIGNER, by the one verifier.
  const message: ForgeMessage = {
    certificates,
    rawCapture: capture,
  };
  const signer = checkSigner(message, tstInfoDer);
  if (!signer.verified || signer.certificate === null) {
    unverifiable('the token’s signature does not verify');
  }
  const certificate = signer.certificate;
  const certificateNode = certificateNodes[certificates.indexOf(certificate)];
  if (certificateNode === undefined) unverifiable('the verifying certificate has no node');

  // 6 — ONE PURPOSE, TIMESTAMPING, CRITICAL.
  const usage = certificate.getExtension('extKeyUsage');
  const purposes =
    usage === null
      ? []
      : Object.entries(usage)
          .filter(([key, value]) => value === true && key !== 'critical')
          .map(([key]) => key);
  if (usage?.['critical'] !== true || purposes.length !== 1 || purposes[0] !== 'timeStamping') {
    unverifiable('the certificate is not for timestamping alone, marked critical');
  }

  // 7 — THE CERTIFICATE IDENTIFIER.
  acceptCertificateIdentifier(
    capture['authenticatedAttributes'] as readonly forge.asn1.Asn1[] | undefined,
    certificate,
    asn1.toDer(certificateNode).getBytes(),
  );

  // 3 and 4 — THE TSTInfo ITSELF.
  let tstInfo: forge.asn1.Asn1;
  try {
    tstInfo = asn1.fromDer(tstInfoDer);
  } catch (cause) {
    unverifiable('the TSTInfo is not DER', cause);
  }
  const [, , messageImprint, , genTimeNode, ...optional] = childrenOf(tstInfo, 'the TSTInfo');
  const [algorithm, hashed] = childrenOf(messageImprint, 'the messageImprint');
  const algorithmOid = bytesOf(childrenOf(algorithm, 'the imprint algorithm')[0]);
  if (algorithmOid === null || asn1.derToOid(algorithmOid) !== known('sha256')) {
    unverifiable('the imprint is not SHA-256, which is what was asked for');
  }
  if (bytesOf(hashed) !== query.imprint) unverifiable('the imprint is not this signature’s');

  // THE NONCE IS THE ONLY INTEGER AFTER genTime: accuracy is a SEQUENCE, ordering
  // a BOOLEAN, and tsa and extensions are context-tagged.
  const nonce = optional.find(
    (node) => node.tagClass === asn1.Class.UNIVERSAL && node.type === asn1.Type.INTEGER,
  );
  if (bytesOf(nonce) !== query.nonce) unverifiable('the nonce is not the one this request sent');

  const genTime = bytesOf(genTimeNode);
  if (genTime === null || genTimeNode?.type !== asn1.Type.GENERALIZEDTIME) {
    unverifiable('genTime is not a GeneralizedTime');
  }
  return { token, genTime: asn1.generalizedTimeToDate(genTime) };
}

/**
 * Check 7: exactly one SigningCertificate or SigningCertificateV2 attribute among
 * the SIGNED attributes, whose first identifier matches the verifying certificate.
 *
 * ESSCertID hashes with SHA-1 (RFC 2634). ESSCertIDv2 hashes with its own
 * `hashAlgorithm`, SHA-256 when absent — RFC 5035's text says SHA-1 and its
 * verified erratum 2364 corrects that to *the algorithm specified by
 * hashAlgorithm*. A present `issuerSerial`'s serial must be the certificate's.
 */
function acceptCertificateIdentifier(
  attributes: readonly forge.asn1.Asn1[] | undefined,
  certificate: ForgeCertificate,
  certificateDer: string,
): void {
  if (attributes === undefined) unverifiable('the token carries no signed attributes');
  const v1 = attributeValues(attributes, OIDS.signingCertificate);
  const v2 = attributeValues(attributes, OIDS.signingCertificateV2);
  if (v1.length + v2.length !== 1) {
    unverifiable('the token does not carry exactly one signing-certificate attribute');
  }
  const isV2 = v2.length === 1;
  const certs = childrenOf(childrenOf(isV2 ? v2[0] : v1[0], 'the signing-certificate attribute')[0], 'its certs');
  const first = childrenOf(certs[0], 'the first certificate identifier');

  let makeDigest: (() => forge.md.MessageDigest) | undefined = () => forge.md.sha1.create();
  let rest = first;
  if (isV2) {
    makeDigest = DIGESTS[known('sha256')];
    const head = first[0];
    if (head?.type === asn1.Type.SEQUENCE) {
      const oid = bytesOf(childrenOf(head, 'the identifier’s hash algorithm')[0]);
      makeDigest = oid === null ? undefined : DIGESTS[asn1.derToOid(oid)];
      rest = first.slice(1);
    }
  }
  if (makeDigest === undefined) unverifiable('the identifier names a hash this build does not verify');

  const [certHash, issuerSerial] = rest;
  const digest = makeDigest();
  digest.update(certificateDer);
  if (bytesOf(certHash) !== digest.digest().getBytes()) {
    unverifiable('the signing-certificate identifier does not match the certificate that signed');
  }
  if (issuerSerial !== undefined) {
    const serial = bytesOf(childrenOf(issuerSerial, 'the issuerSerial')[1]);
    if (serial === null || forge.util.createBuffer(serial).toHex() !== certificate.serialNumber) {
      unverifiable('the identifier’s serial is not the certificate’s');
    }
  }
}
