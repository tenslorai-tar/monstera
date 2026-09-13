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
 * that skips a step.
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

/** The half of an X.509 certificate a verification reads. */
export interface ForgeCertificate {
  readonly subject: ForgeSubject;
  /** SHA-1 of the issuer name's DER, as hex — node-forge computes it on parse. */
  readonly issuer: { readonly hash: unknown };
  /** The serial number as hex, as node-forge computes it on parse. */
  readonly serialNumber: string;
  readonly validity: { readonly notBefore: Date; readonly notAfter: Date };
  readonly publicKey: { verify: (digest: string, signature: string) => boolean };
}

/**
 * The half of a parsed PKCS#7 SignedData a verification reads.
 *
 * `rawCapture` is node-forge's validator capture: the signer fields are
 * captured from the SignerInfo, so they describe ONE signer, and `signerInfos`
 * is how that is checked.
 */
export interface ForgeMessage {
  readonly certificates: readonly ForgeCertificate[];
  readonly rawCapture: {
    /** `eContentType`'s OID, as DER bytes. */
    readonly contentType?: string;
    readonly signerInfos?: readonly forge.asn1.Asn1[];
    readonly issuer?: forge.asn1.Asn1;
    readonly serial?: string;
    /** The signer's digest algorithm OID, as DER bytes. */
    readonly digestAlgorithm?: string;
    readonly authenticatedAttributes?: readonly forge.asn1.Asn1[];
    /** The `digestEncryptionAlgorithm` SEQUENCE's elements. */
    readonly signatureAlgorithm?: readonly forge.asn1.Asn1[];
    readonly signature?: string;
  };
}

/** What a signer check answers. */
export interface SignerCheck {
  /** The certificate the SignerInfo names by issuer and serial, or `null`. */
  readonly certificate: ForgeCertificate | null;
  /**
   * `true` only when the attested digest matches the content AND the signer's
   * signature over the signed attributes verifies with that certificate's key.
   */
  readonly verified: boolean;
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

/**
 * The RSA PKCS#1 v1.5 signature algorithms. node-forge's `verify` implements that
 * scheme; a PSS or ECDSA signer is answered unverified rather than guessed at.
 */
const RSA_SIGNATURES: ReadonlySet<string> = new Set(
  ['rsaEncryption', 'sha1WithRSAEncryption', 'sha256WithRSAEncryption', 'sha384WithRSAEncryption', 'sha512WithRSAEncryption'].map(oid),
);

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

/**
 * Checks the one signer of `message` against `content`.
 *
 * @param message a SignedData node-forge parsed.
 * @param content the signed content, as latin-1 — for a detached PDF signature,
 *   the two covered spans concatenated.
 */
export function checkSigner(message: ForgeMessage, content: string): SignerCheck {
  const capture = message.rawCapture;

  // THE CERTIFICATE THE SIGNER NAMES, by issuer and serial — and computed the way
  // node-forge computes the certificate's own two values, so both sides are one
  // library's reading of the same DER (B3a).
  let certificate: ForgeCertificate | null = null;
  if (capture.issuer !== undefined && capture.serial !== undefined) {
    const issuerHash = forge.md.sha1.create();
    issuerHash.update(forge.asn1.toDer(capture.issuer).getBytes());
    const wantedIssuer = issuerHash.digest().toHex();
    const wantedSerial = forge.util.createBuffer(capture.serial).toHex();
    certificate =
      message.certificates.find(
        (candidate) =>
          candidate.issuer.hash === wantedIssuer && candidate.serialNumber === wantedSerial,
      ) ?? null;
  }
  const unverified = { certificate, verified: false } as const;

  // ONE SIGNER. node-forge captures SignerInfo fields into one flat object, so a
  // second signer would silently overwrite the first's — a check against a
  // mixture of two signers answers nothing true.
  if (capture.signerInfos?.length !== 1 || certificate === null) return unverified;

  const attributes = capture.authenticatedAttributes;
  const makeDigest =
    capture.digestAlgorithm === undefined
      ? undefined
      : DIGESTS[forge.asn1.derToOid(capture.digestAlgorithm)];
  const algorithm = bytesOf(capture.signatureAlgorithm?.[0]);
  if (
    attributes === undefined ||
    makeDigest === undefined ||
    algorithm === null ||
    !RSA_SIGNATURES.has(forge.asn1.derToOid(algorithm)) ||
    capture.signature === undefined ||
    capture.contentType === undefined
  ) {
    return unverified;
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
    return unverified;
  }

  // THE ATTESTED DIGEST, exactly one, equal to the content's under the signer's
  // own algorithm — never a hard-coded one.
  const digests = attributeValues(attributes, oid('messageDigest'));
  const attested = bytesOf(digests[0]);
  const contentDigest = makeDigest();
  contentDigest.update(content);
  if (digests.length !== 1 || attested !== contentDigest.digest().getBytes()) return unverified;

  // THE SIGNATURE, over the signed attributes re-tagged as a UNIVERSAL SET OF.
  // RFC 5652 §5.4: they are carried IMPLICIT [0] and signed as the EXPLICIT SET
  // OF encoding, so hashing the captured bytes as they sit in the file would
  // hash a different first byte and fail every genuine signature.
  const signedAttributes = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SET,
    true,
    [...attributes],
  );
  const attributesDigest = makeDigest();
  attributesDigest.update(forge.asn1.toDer(signedAttributes).getBytes());
  let verified: boolean;
  try {
    verified = certificate.publicKey.verify(attributesDigest.digest().getBytes(), capture.signature);
  } catch {
    // node-forge THROWS for a signature whose PKCS#1 padding or DigestInfo does
    // not decode under this key — "Encryption block is invalid" — which is a
    // signature that does not verify, and is answered as exactly that.
    verified = false;
  }
  return { certificate, verified };
}
