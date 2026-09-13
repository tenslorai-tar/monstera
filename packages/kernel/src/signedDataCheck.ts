import { X509Certificate, constants, verify, type KeyObject } from 'node:crypto';

import forge from 'node-forge';

/**
 * Whether a CMS SignedData's signer signed the content — the ONE place this build
 * answers that question.
 *
 * ## The digest comparison alone verifies nothing a forger cannot rewrite
 *
 * A detached PDF signature's `messageDigest` attribute lives inside `/Contents`,
 * and `/Contents` is the one span the byte ranges do not cover. So a reader that
 * compares that attribute with a digest of the covered bytes is comparing the
 * document with a number anyone editing the document can also edit. What binds
 * the attribute to the signer is the signature over the signed attributes, and
 * that is the check this module exists to make (RFC 5652 §5.4 and §5.6).
 *
 * ## One module because TWO callers need exactly this answer
 *
 * Reading a document's signatures, and accepting a timestamp token — which is a
 * SignedData whose content is the TSTInfo. Two copies of "verify a signer" would
 * be B3a's second opinion about RFC 5652, and the one written later is the one
 * that skips a step. The certificate bag is read here too, for the same reason.
 *
 * ## The SIGNATURE is Node's to check, and no certificate is node-forge's to refuse
 *
 * node-forge verifies RSA PKCS#1 v1.5 alone, and its PKCS#7 reader converts every
 * certificate in the bag and throws on any key that is not RSA — *Cannot read public
 * key. OID is not RSA.* So a valid ECDSA signature read as *unreadable* and a valid
 * RSA-PSS one as *the document has changed* (finding GGGGGG-2). node-forge still does
 * what it does here: the DER walk and RFC 5652's shape. The two questions it cannot
 * answer go to Node's OpenSSL — a certificate's key (`X509Certificate`) and the
 * signature (`crypto.verify`).
 *
 * Measured 2026-09-13 with certificates and SignedData built in-process for ECDSA
 * P-256, RSA-PSS and RSA PKCS#1 v1.5: all three verify this way, a changed content
 * byte and a changed signature byte each fail, and `openssl cms -verify` (OpenSSL
 * 3.5.4) accepts the same three (JOURNAL 2026-09-13).
 *
 * ## What it does NOT check
 *
 * Trust: chain building, revocation and anchors are a different question, and the
 * signatures panel says so on screen. The certificate this answers is the one the
 * SignerInfo names by issuer and serial, never simply the first in the bag.
 */

/** A distinguished-name field, as node-forge answers one. */
export interface ForgeSubject {
  getField: (name: string) => { readonly value: string } | null | undefined;
}

/** The half of an X.509 certificate node-forge's reading is used for. */
export interface ForgeCertificate {
  readonly subject: ForgeSubject;
  /** The serial number as hex, as node-forge computes it on parse. */
  readonly serialNumber: string;
  readonly validity: { readonly notBefore: Date; readonly notAfter: Date };
  /**
   * An extension by name, as node-forge parses one: `id`, `critical`, `value`,
   * `name`, and for `extKeyUsage` one `true` member per purpose — named where
   * node-forge knows the OID, keyed by the OID where it does not (node-forge
   * 1.4.0, `lib/x509.js`).
   *
   * **`null` when the certificate has no such extension, NOT `undefined`** —
   * `var rval = null`, returned unchanged when nothing matches (`lib/x509.js`
   * 1109 and 1119). This read `| undefined` for its first hour, and a certificate
   * with no extended key usage then threw a `TypeError` inside the timestamp check
   * instead of being refused by name: `timestampToken.test.ts`' no-usage case.
   */
  getExtension: (name: string) => Readonly<Record<string, unknown>> | null;
}

/** One certificate from a SignedData's bag, as each reader could read it. */
export interface CmsCertificate {
  /** The certificate's DER, as latin-1 — what a certificate identifier hashes. */
  readonly der: string;
  /** The TBS issuer's DER and the serial's content bytes, read from the tree itself. */
  readonly issuerDer: string;
  readonly serial: string;
  /** OpenSSL's reading, which reads RSA and EC certificates; `null` when it refused this one. */
  readonly x509: X509Certificate | null;
  /** node-forge's reading, which reads RSA keys only; `null` for every other key. */
  readonly forge: ForgeCertificate | null;
}

/** What node-forge's `signedDataValidator` captures, as this module reads it. */
export interface SignedDataCapture {
  /** `eContentType`'s OID, as DER bytes. */
  readonly contentType?: string;
  readonly content?: forge.asn1.Asn1;
  readonly certificates?: forge.asn1.Asn1;
  readonly signerInfos?: readonly forge.asn1.Asn1[];
  readonly issuer?: forge.asn1.Asn1;
  readonly serial?: string;
  /** The signer's digest algorithm OID, as DER bytes. */
  readonly digestAlgorithm?: string;
  readonly authenticatedAttributes?: readonly forge.asn1.Asn1[];
  /** The `digestEncryptionAlgorithm` SEQUENCE's elements. */
  readonly signatureAlgorithm?: readonly forge.asn1.Asn1[];
  readonly signature?: string;
}

/**
 * A SignedData, validated and with its certificates read.
 *
 * `rawCapture` is node-forge's validator capture: the signer fields are captured from
 * the SignerInfo, so they describe ONE signer, and `signerInfos` is how that is checked.
 */
export interface SignedData {
  readonly capture: SignedDataCapture;
  readonly certificates: readonly CmsCertificate[];
}

/** Why a signer did not verify. */
export type SignerRefusal =
  /** No single SignerInfo, or no certificate in the bag with its issuer and serial. */
  | 'no-signer'
  /** The signed attributes, digest algorithm or content type are not RFC 5652's. */
  | 'attributes'
  /** The attested digest is not the content's. */
  | 'digest-mismatch'
  /** A signature algorithm, or RSA-PSS parameters, this build does not check. */
  | 'unsupported-algorithm'
  /** The signer's certificate names a key OpenSSL cannot decode. */
  | 'unreadable-key'
  /** Everything was readable, and the signature does not verify. */
  | 'signature';

/** What a signer check answers. */
export interface SignerCheck {
  /** The certificate the SignerInfo names by issuer and serial, or `null`. */
  readonly certificate: CmsCertificate | null;
  /**
   * `true` only when the attested digest matches the content AND the signer's
   * signature over the signed attributes verifies with that certificate's key.
   */
  readonly verified: boolean;
  /** Why it did not verify; `null` exactly when it did. */
  readonly refusal: SignerRefusal | null;
}

/** An OID from node-forge's table, refusing a name the table does not hold. */
function oid(name: string): string {
  const found = forge.pki.oids[name];
  // A MISSING NAME IS A DEFECT HERE, not a mismatch: `oids` is an index
  // signature, so a mistyped key reads as `undefined` and compares unequal to
  // every attribute — which would report every signature as unverified.
  if (found === undefined) throw new Error(`node-forge has no OID named ${name}`);
  return found;
}

/** The digests a signer may name, by OID. An algorithm not here does not verify. */
const DIGESTS: Readonly<Record<string, () => forge.md.MessageDigest>> = {
  [oid('sha1')]: () => forge.md.sha1.create(),
  [oid('sha256')]: () => forge.md.sha256.create(),
  [oid('sha384')]: () => forge.md.sha384.create(),
  [oid('sha512')]: () => forge.md.sha512.create(),
};

/** The same four digests, by the name `crypto.verify` takes. */
const NODE_DIGESTS: ReadonlyMap<string, string> = new Map([
  [oid('sha1'), 'sha1'],
  [oid('sha256'), 'sha256'],
  [oid('sha384'), 'sha384'],
  [oid('sha512'), 'sha512'],
]);

/**
 * Signature algorithms checked with PKCS#1 v1.5 and with ECDSA, and the digest each
 * fixes — `null` where the algorithm names only the key, and the SignerInfo's own
 * digest applies. RFC 3370 §3.2 and RFC 5754 §3.2 for RSA; RFC 5758 §3.2 and RFC 5753
 * §2.1.1 for ECDSA, whose `id-ecPublicKey` form takes the SignerInfo's digest.
 */
const RSA_PKCS1: ReadonlyMap<string, string | null> = new Map([
  ['1.2.840.113549.1.1.1', null],
  ['1.2.840.113549.1.1.5', 'sha1'],
  ['1.2.840.113549.1.1.11', 'sha256'],
  ['1.2.840.113549.1.1.12', 'sha384'],
  ['1.2.840.113549.1.1.13', 'sha512'],
]);
const ECDSA: ReadonlyMap<string, string | null> = new Map([
  ['1.2.840.10045.2.1', null],
  ['1.2.840.10045.4.1', 'sha1'],
  ['1.2.840.10045.4.3.2', 'sha256'],
  ['1.2.840.10045.4.3.3', 'sha384'],
  ['1.2.840.10045.4.3.4', 'sha512'],
]);

/** `id-RSASSA-PSS` and `id-mgf1`, RFC 4055 §3.1. */
const RSASSA_PSS = '1.2.840.113549.1.1.10';
const MGF1 = '1.2.840.113549.1.1.8';

/** How one signature is checked: the digest `crypto.verify` takes, and its padding. */
interface Scheme {
  readonly digest: string;
  readonly padding?: number;
  readonly saltLength?: number;
}

/** Each value of every attribute of `type`, in order. */
function attributeValues(attributes: readonly forge.asn1.Asn1[], type: string): forge.asn1.Asn1[] {
  const values: forge.asn1.Asn1[] = [];
  for (const attribute of attributes) {
    // Attribute ::= SEQUENCE { attrType OBJECT IDENTIFIER, attrValues SET OF }.
    const [typeNode, set] = Array.isArray(attribute.value) ? attribute.value : [];
    if (typeNode === undefined || set === undefined || typeof typeNode.value !== 'string') continue;
    if (forge.asn1.derToOid(typeNode.value) !== type) continue;
    if (Array.isArray(set.value)) values.push(...set.value);
  }
  return values;
}

/** The raw bytes of a primitive node, or `null` for a constructed one. */
function bytesOf(node: forge.asn1.Asn1 | undefined): string | null {
  return node !== undefined && typeof node.value === 'string' ? node.value : null;
}

/** The children of a constructed node, or none. */
function childrenOf(node: forge.asn1.Asn1 | undefined): forge.asn1.Asn1[] {
  return node !== undefined && Array.isArray(node.value) ? node.value : [];
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
 * A SignedData node, validated against RFC 5652's shape, with its certificates read —
 * or `null` for a node that does not have that shape.
 *
 * node-forge's validator CAPTURES the certificate bag as nodes (`captureAsn1`), so
 * nothing here converts a certificate the way `messageFromAsn1` does.
 */
export function readSignedDataBody(node: forge.asn1.Asn1): SignedData | null {
  const captured: Record<string, unknown> = {};
  const validation = forge as unknown as ForgeValidation;
  if (!validation.asn1.validate(node, validation.pkcs7.asn1.signedDataValidator, captured, [])) {
    return null;
  }
  const capture = captured as SignedDataCapture;
  return { capture, certificates: readCertificates(capture.certificates) };
}

/** A ContentInfo carrying a SignedData — what a PDF's `/Contents` holds — or `null`. */
export function readContentInfo(node: forge.asn1.Asn1): SignedData | null {
  const [type, explicit] = childrenOf(node);
  const typeOid = bytesOf(type);
  if (typeOid === null || forge.asn1.derToOid(typeOid) !== oid('signedData')) return null;
  const body = childrenOf(explicit)[0];
  return body === undefined ? null : readSignedDataBody(body);
}

/**
 * Every certificate in a bag, each read by both readers.
 *
 * Issuer and serial come from the certificate's own tree, so a signer is found by the
 * bytes the SignerInfo names whichever reader can read its key. A certificate neither
 * reader reads is still in the list: a SignerInfo naming it is then refused as
 * `unreadable-key`, by that name, rather than as a signer nobody sent.
 */
function readCertificates(bag: forge.asn1.Asn1 | undefined): CmsCertificate[] {
  const read: CmsCertificate[] = [];
  for (const node of childrenOf(bag)) {
    const fields = childrenOf(childrenOf(node)[0]);
    // `version` is an explicit [0] and may be absent, so the serial is first or second.
    const versioned = fields[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC;
    const serial = bytesOf(fields[versioned ? 1 : 0]);
    const issuer = fields[versioned ? 3 : 2];
    if (serial === null || issuer === undefined) continue;
    const der = forge.asn1.toDer(node).getBytes();
    read.push({
      der,
      issuerDer: forge.asn1.toDer(issuer).getBytes(),
      serial,
      x509: x509Of(der),
      forge: forgeOf(node),
    });
  }
  return read;
}

/** OpenSSL's reading of a certificate, or `null` when OpenSSL refuses its DER. */
function x509Of(der: string): X509Certificate | null {
  try {
    return new X509Certificate(Buffer.from(der, 'latin1'));
  } catch {
    // OPENSSL'S REFUSAL IS THE ANSWER — this certificate is not one it reads — and
    // `checkSigner` names that as `unreadable-key` if the signer is this one.
    return null;
  }
}

/** node-forge's reading of a certificate, or `null` for a key that is not RSA. */
function forgeOf(node: forge.asn1.Asn1): ForgeCertificate | null {
  try {
    // ONE CAST, to a typed adapter: `@types/node-forge`'s certificate type does not
    // carry `getExtension`'s `null` return, which the timestamp check relies on.
    return forge.pki.certificateFromAsn1(node) as unknown as ForgeCertificate;
  } catch {
    // node-forge reads RSA keys only, and says so by throwing. Nothing that verifies
    // needs its reading; the timestamp check's extension read does, and refuses there.
    return null;
  }
}

/** The certificate's public key, or `null` for one OpenSSL cannot decode. */
function publicKeyOf(certificate: CmsCertificate): KeyObject | null {
  if (certificate.x509 === null) return null;
  try {
    return certificate.x509.publicKey;
  } catch {
    // A KEY OPENSSL CANNOT DECODE — a curve it does not know, or bytes that are not
    // the key their algorithm names. Named `unreadable-key`, never answered as a
    // signature that does not verify.
    return null;
  }
}

/** The digest an `AlgorithmIdentifier` names, by `crypto.verify`'s name, or `null`. */
function digestOfAlgorithm(node: forge.asn1.Asn1 | undefined): string | null {
  const identifier = bytesOf(childrenOf(node)[0]);
  return identifier === null ? null : (NODE_DIGESTS.get(forge.asn1.derToOid(identifier)) ?? null);
}

/**
 * RSASSA-PSS parameters (RFC 4055 §3.1), with the standard's defaults: SHA-1, MGF1
 * with SHA-1, a salt of 20, trailer field 1.
 *
 * **Node's PSS uses MGF1 with the signature's own hash** and takes no parameter for
 * another, so parameters naming a different mask hash are `null` — a signature this
 * build does not check, answered as unsupported and never as a mismatch.
 */
function pssScheme(parameters: forge.asn1.Asn1 | undefined): Scheme | null {
  let hash: string | null = 'sha1';
  let maskHash: string | null = 'sha1';
  let saltLength = 20;
  let trailer = 1;
  for (const field of childrenOf(parameters)) {
    const inner = field.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? childrenOf(field)[0] : undefined;
    if (inner === undefined) return null;
    // A CONTEXT TAG'S NUMBER, not a UNIVERSAL type: node-forge stores both in `type`,
    // typed as its universal enum, and RFC 4055 numbers these fields [0] to [3].
    const tag: number = field.type;
    switch (tag) {
      case 0:
        hash = digestOfAlgorithm(inner);
        break;
      case 1: {
        const [mask, maskParameters] = childrenOf(inner);
        const maskOid = bytesOf(mask);
        if (maskOid === null || forge.asn1.derToOid(maskOid) !== MGF1) return null;
        maskHash = digestOfAlgorithm(maskParameters);
        break;
      }
      case 2: {
        const value = bytesOf(inner);
        if (value === null) return null;
        saltLength = forge.asn1.derToInteger(value);
        break;
      }
      case 3: {
        const value = bytesOf(inner);
        if (value === null) return null;
        trailer = forge.asn1.derToInteger(value);
        break;
      }
      default:
        return null;
    }
  }
  if (hash === null || maskHash !== hash || trailer !== 1) return null;
  return { digest: hash, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength };
}

/** How the SignerInfo's signature is checked, or `null` for an algorithm this build does not check. */
function signatureScheme(capture: SignedDataCapture): Scheme | null {
  const identifier = bytesOf(capture.signatureAlgorithm?.[0]);
  if (identifier === null) return null;
  const algorithm = forge.asn1.derToOid(identifier);
  const own =
    capture.digestAlgorithm === undefined
      ? undefined
      : NODE_DIGESTS.get(forge.asn1.derToOid(capture.digestAlgorithm));
  for (const table of [RSA_PKCS1, ECDSA]) {
    if (!table.has(algorithm)) continue;
    const digest = table.get(algorithm) ?? own;
    return digest === undefined ? null : { digest };
  }
  return algorithm === RSASSA_PSS ? pssScheme(capture.signatureAlgorithm?.[1]) : null;
}

/**
 * Checks the one signer of `signed` against `content`.
 *
 * @param signed a SignedData, read by {@link readSignedDataBody} or {@link readContentInfo}.
 * @param content the signed content, as latin-1 — for a detached PDF signature,
 *   the two covered spans concatenated.
 */
export function checkSigner(signed: SignedData, content: string): SignerCheck {
  const capture = signed.capture;

  // THE CERTIFICATE THE SIGNER NAMES, by the issuer's DER and the serial's bytes,
  // compared as the bytes both sides carry rather than as either reader's rendering.
  const wantedIssuer = capture.issuer === undefined ? null : forge.asn1.toDer(capture.issuer).getBytes();
  const certificate =
    wantedIssuer === null || capture.serial === undefined
      ? null
      : (signed.certificates.find(
          (candidate) => candidate.issuerDer === wantedIssuer && candidate.serial === capture.serial,
        ) ?? null);
  const refuse = (refusal: SignerRefusal): SignerCheck => ({ certificate, verified: false, refusal });

  // ONE SIGNER. node-forge captures SignerInfo fields into one flat object, so a
  // second signer would silently overwrite the first's — a check against a
  // mixture of two signers answers nothing true.
  if (capture.signerInfos?.length !== 1 || certificate === null) return refuse('no-signer');

  const attributes = capture.authenticatedAttributes;
  const makeDigest =
    capture.digestAlgorithm === undefined ? undefined : DIGESTS[forge.asn1.derToOid(capture.digestAlgorithm)];
  if (
    attributes === undefined ||
    makeDigest === undefined ||
    capture.signature === undefined ||
    capture.contentType === undefined
  ) {
    return refuse('attributes');
  }

  // THE CONTENT TYPE the attributes attest must be the one the SignedData carries
  // (RFC 5652 §5.6), and there must be exactly one of it.
  const contentTypes = attributeValues(attributes, oid('contentType'));
  const attestedType = bytesOf(contentTypes[0]);
  if (
    contentTypes.length !== 1 ||
    attestedType === null ||
    forge.asn1.derToOid(attestedType) !== forge.asn1.derToOid(capture.contentType)
  ) {
    return refuse('attributes');
  }

  // THE ATTESTED DIGEST, exactly one, equal to the content's under the signer's
  // own algorithm — never a hard-coded one.
  const digests = attributeValues(attributes, oid('messageDigest'));
  const attested = bytesOf(digests[0]);
  const contentDigest = makeDigest();
  contentDigest.update(content);
  if (digests.length !== 1 || attested !== contentDigest.digest().getBytes()) {
    return refuse('digest-mismatch');
  }

  const scheme = signatureScheme(capture);
  if (scheme === null) return refuse('unsupported-algorithm');
  const key = publicKeyOf(certificate);
  if (key === null) return refuse('unreadable-key');

  // THE SIGNATURE, over the signed attributes re-tagged as a UNIVERSAL SET OF.
  // RFC 5652 §5.4: they are carried IMPLICIT [0] and signed as the EXPLICIT SET
  // OF encoding, so hashing the captured bytes as they sit in the file would
  // hash a different first byte and fail every genuine signature.
  const signedAttributes = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
    ...attributes,
  ]);
  let verified: boolean;
  try {
    verified = verify(
      scheme.digest,
      Buffer.from(forge.asn1.toDer(signedAttributes).getBytes(), 'latin1'),
      {
        key,
        ...(scheme.padding === undefined ? {} : { padding: scheme.padding }),
        ...(scheme.saltLength === undefined ? {} : { saltLength: scheme.saltLength }),
      },
      Buffer.from(capture.signature, 'latin1'),
    );
  } catch {
    // OpenSSL throws for a signature it cannot decode under this key — an ECDSA value
    // that is not DER, a PSS block of the wrong size — which is a signature that does
    // not verify, and is answered as exactly that.
    verified = false;
  }
  return verified ? { certificate, verified: true, refusal: null } : refuse('signature');
}

// EXPORTED FOR THE TIMESTAMP TOKEN, which reads the same attributes, the same
// digests and the same primitive values from a SignedData this module verifies.
// A second attribute walk there would be a second opinion about RFC 5652 (B3a).
export { attributeValues, bytesOf, DIGESTS };
