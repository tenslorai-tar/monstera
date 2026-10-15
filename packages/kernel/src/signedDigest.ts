import forge from 'node-forge';

/**
 * The PKCS#7 detached signature `@signpdf/signer-p12`'s `P12Signer` writes, made from a DIGEST of the signed bytes
 * rather than from the bytes ([ADR-0248](../../../docs/DECISIONS/0248-a-signature-is-made-over-a-digest-read-from-the-prepared-file.md)).
 *
 * ## Why this exists beside `P12Signer`
 *
 * `P12Signer.sign` takes the content as one `Buffer`, and node-forge's `pkcs7.sign` serialises that content and hashes
 * it itself, overwriting any `messageDigest` it is given. So a signature through it holds the document in `main` two or
 * three times over (the bytes outside the hole, forge's binary string, its DER). Here the content's SHA-256 is
 * computed elsewhere, a read at a time, and this module builds the same structure around it from forge's own pieces:
 * its PKCS#12 parse, its key, its ASN.1 and its RSA signature.
 *
 * ## The same bytes as `P12Signer`, or a red case
 *
 * RSASSA-PKCS1-v1_5 is deterministic, so for one credential, one content and one signing time `P12Signer` answers one
 * byte string. `signedDigest.test.ts` requires {@link signedDataOverDigest} to answer that same string, for several
 * contents. This file is a transcription of `P12Signer.sign` and forge's `SignedData.toAsn1`, and that case is what keeps
 * it one: a field written differently here is a failed comparison, not a second opinion about where a signature goes.
 */

const { asn1, pki } = forge;

/** One of forge's own OIDs by its name, read once; a name forge does not know is a defect, not a missing value. */
function oidNamed(name: string): string {
  const value = pki.oids[name];
  if (value === undefined) throw new Error(`node-forge names no OID ${name}`);
  return value;
}

const OID = {
  certBag: oidNamed('certBag'),
  pkcs8ShroudedKeyBag: oidNamed('pkcs8ShroudedKeyBag'),
  contentType: oidNamed('contentType'),
  data: oidNamed('data'),
  signingTime: oidNamed('signingTime'),
  messageDigest: oidNamed('messageDigest'),
  sha256: oidNamed('sha256'),
  rsaEncryption: oidNamed('rsaEncryption'),
  signedData: oidNamed('signedData'),
} as const;

/** A credential opened as `P12Signer` opens it: the key, the certificate that matches it, and every certificate. */
export interface SigningCredential {
  readonly key: forge.pki.rsa.PrivateKey;
  readonly certificate: forge.pki.Certificate;
  readonly certificates: readonly forge.pki.Certificate[];
}

/**
 * Opens a PKCS#12 credential, as `P12Signer.sign` does: forge's parse, not strict, the first shrouded key, and the
 * certificate whose public key matches it. Anything that does not open throws, and the caller names it the credential's
 * refusal.
 */
export function openCredential(p12: Uint8Array, passphrase: string): SigningCredential {
  const parsed = forge.pkcs12.pkcs12FromAsn1(
    asn1.fromDer(forge.util.createBuffer(Buffer.from(p12).toString('binary'))),
    false,
    passphrase,
  );
  const certBags = parsed.getBags({ bagType: OID.certBag })[OID.certBag] ?? [];
  const keyBags = parsed.getBags({ bagType: OID.pkcs8ShroudedKeyBag })[OID.pkcs8ShroudedKeyBag] ?? [];
  const key = keyBags[0]?.key;
  if (key === undefined) throw new Error('the credential holds no private key');
  const certificates: forge.pki.Certificate[] = [];
  let certificate: forge.pki.Certificate | undefined;
  for (const bag of certBags) {
    if (bag.cert === undefined) continue;
    certificates.push(bag.cert);
    const publicKey = bag.cert.publicKey as forge.pki.rsa.PublicKey;
    if (key.n.compareTo(publicKey.n) === 0 && key.e.compareTo(publicKey.e) === 0) certificate = bag.cert;
  }
  if (certificate === undefined) throw new Error('Failed to find a certificate that matches the private key.');
  return { key, certificate, certificates };
}

/** The PKCS#7 `Attribute` forge writes: the type, and a SET holding the one value. */
function attribute(type: string, value: forge.asn1.Asn1): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(type).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [value]),
  ]);
}

/** RFC 2985's signing time, as forge writes it: UTCTime from 1950 to 2049, GeneralizedTime outside. */
function signingTimeValue(date: Date): forge.asn1.Asn1 {
  const utc = date >= new Date('1950-01-01T00:00:00Z') && date < new Date('2050-01-01T00:00:00Z');
  return utc
    ? asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(date))
    : asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(date));
}

/** An `AlgorithmIdentifier` with NULL parameters. */
function algorithm(oid: string): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
  ]);
}

/**
 * The detached PKCS#7 `SignedData` over content whose SHA-256 is `contentDigest`, signed at `signingTime`: exactly what
 * `P12Signer.sign(content, signingTime)` answers for that content, as DER.
 */
export function signedDataOverDigest(credential: SigningCredential, contentDigest: Uint8Array, signingTime: Date): Buffer {
  if (contentDigest.byteLength !== 32) throw new Error(`a SHA-256 digest is 32 bytes, not ${String(contentDigest.byteLength)}`);
  const { key, certificate, certificates } = credential;
  const attributes = (): forge.asn1.Asn1[] => [
    attribute(OID.contentType, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID.data).getBytes())),
    attribute(OID.signingTime, signingTimeValue(signingTime)),
    attribute(
      OID.messageDigest,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, Buffer.from(contentDigest).toString('binary')),
    ),
  ];

  // THE ATTRIBUTES ARE SIGNED AS A SET (RFC 2315 9.3), and carried as [0] IMPLICIT.
  const md = forge.md.sha256.create();
  md.update(asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, attributes())).getBytes());
  const signature = key.sign(md, 'RSASSA-PKCS1-V1_5');

  const signerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      pki.distinguishedNameToAsn1(certificate.issuer),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(certificate.serialNumber)),
    ]),
    algorithm(OID.sha256),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, attributes()),
    algorithm(OID.rsaEncryption),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, signature),
  ]);

  const signedFields: forge.asn1.Asn1[] = [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [algorithm(OID.sha256)]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID.data).getBytes()),
    ]),
  ];
  if (certificates.length > 0) {
    signedFields.push(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, certificates.map((each) => pki.certificateToAsn1(each))));
  }
  signedFields.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signerInfo]));

  const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID.signedData).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, signedFields)]),
  ]);
  return Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');
}
