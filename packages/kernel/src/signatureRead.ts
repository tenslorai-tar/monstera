import type * as mupdf from 'mupdf';
import forge from 'node-forge';

import { withDocument } from './mupdfWriter.js';
import type { MupdfSession } from './engineSeam.js';

/**
 * Reading the signatures a document already carries — Stage 7's verification
 * row.
 *
 * ## node-forge is the reader, and MuPDF's binding does not offer one
 *
 * Measured 2026-09-12: `PDFWidget` exposes no signature member at all, and
 * `PDFDocument` exposes only `validateChangeHistory`. The native library has
 * `pdf_check_signature`; the JS binding does not bind it. So §3's matrix line —
 * *node-forge (verify)* — is the answer for a reason sharper than the founding
 * record could have known, and ADR-0054 Decision 4 already says the useful half
 * of it: **verifying a signature this build did not write needs no `@signpdf`
 * at all.**
 *
 * ## It runs in the CONTAINED HOST, and that is invariant 25 rather than habit
 *
 * Parsing a stranger's PKCS#7 is parsing a document, and invariant 25 names the
 * process a document is parsed in. `main` holds the bytes and serves ranges out
 * of them without ever reading their structure; putting an ASN.1 parser there
 * would be the first thing to change that.
 *
 * ## THE BYTE RANGE IS READ FROM THE OBJECT MODEL, never from the raw bytes
 *
 * A regular expression over the file would be a second parser for a question
 * the engine already answers — and the one that disagrees on a document whose
 * `/ByteRange` appears twice, which is what an incrementally-signed document
 * looks like. `getWidgets()` walks `/AcroForm`, and each signature's `/V` is
 * its dictionary.
 */

/** What one signature in a document says about itself. */
export interface ReadSignature {
  /** `/Name` from the signature dictionary, or the certificate's CN. */
  readonly signer: string;
  /** The certificate's organisation, or an empty string. */
  readonly organisation: string;
  /** `/Reason`, or an empty string. */
  readonly reason: string;
  /** `/Location`, or an empty string. */
  readonly location: string;
  /** The certificate's validity window, as ISO dates. */
  readonly notBefore: string;
  readonly notAfter: string;
  /**
   * Whether the signature's own digest matches the bytes it covers.
   *
   * **This is the question**, and it is the one a reader most often answers
   * with a green tick it did not earn. `false` means the document changed
   * after it was signed, or was never signed over these bytes.
   */
  readonly coversDocument: boolean;
  /**
   * Whether the ranges describe the whole file.
   *
   * Separate from {@link coversDocument} because they fail differently: a
   * digest mismatch is *these bytes changed*, and a range that stops short is
   * *something was appended that the signature says nothing about*. A reader
   * that folded them would report an intact signature over half a document.
   */
  readonly coversWholeFile: boolean;
}

/** Why a document's signatures could not be read at all. */
export class SignaturesUnreadable extends Error {
  override readonly name = 'SignaturesUnreadable';
}

/** The four numbers a `/ByteRange` holds, or `null` if it is not four numbers. */
function byteRangeOf(signature: mupdf.PDFObject): [number, number, number, number] | null {
  const range = signature.get('ByteRange');
  if (range.isNull()) return null;
  const values: number[] = [];
  range.forEach((value) => {
    values.push(value.asNumber());
  });
  if (values.length !== 4) return null;
  const [a, b, c, d] = values;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

/**
 * Every signature the document carries, with what each one covers.
 *
 * @param session the document to read.
 * @param bytes its serialised form — the ranges index into these.
 */
export function readSignatures(
  session: MupdfSession,
  bytes: Uint8Array,
): Promise<readonly ReadSignature[]> {
  return withDocument(session, (document) => {
    const found: ReadSignature[] = [];
    for (let index = 0; index < document.countPages(); index += 1) {
      for (const widget of document.loadPage(index).getWidgets()) {
        const object = widget.getObject();
        if (String(object.get('FT')) !== '/Sig') continue;
        const signature = object.get('V');
        if (!signature.isDictionary()) continue;
        const read = readOne(signature, bytes);
        if (read !== null) found.push(read);
      }
    }
    return found;
  });
}

/** One signature dictionary, verified against `bytes`. */
function readOne(signature: mupdf.PDFObject, bytes: Uint8Array): ReadSignature | null {
  const range = byteRangeOf(signature);
  if (range === null) return null;
  const [a, b, c, d] = range;

  const contents = signature.get('Contents');
  if (contents.isNull()) return null;
  // `asByteString`, NEVER `asString`, and the difference is the whole read.
  // `asString` is `pdf_to_text_string`, which decodes a PDF **text** string —
  // PDFDocEncoding or UTF-16 — and a PKCS#7 blob is neither. Measured
  // 2026-09-12: it answers bytes node-forge's DER reader refuses with *Only 8,
  // 16, 24, or 32 bits supported*, which names a bit width and not the
  // encoding that produced it.
  //
  //
  // THE PADDING IS NOT TRIMMED HERE. `/Contents` is a fixed-size hole — the
  // signature plus zero bytes out to the reserved length — and stripping trailing
  // zeros also strips a DER encoding's own final zero byte, about one signature
  // in 256. `pkcs7Asn1` reads the element to the length its header declares.
  const verified = verify(contents.asByteString(), bytes, [a, b, c, d]);
  const subject = verified.certificate?.subject;
  const digestMatches = verified.digestMatches;
  // `/Name` FIRST, then the certificate's CN. A signature dictionary's own
  // name is what the signer chose to display; the CN is what their certificate
  // says they are, and the second is the fallback rather than the answer.
  const stated = signature.get('Name').asString();
  return {
    signer: stated === '' ? (subject?.getField('CN')?.value ?? '') : stated,
    organisation: subject?.getField('O')?.value ?? '',
    reason: signature.get('Reason').asString(),
    location: signature.get('Location').asString(),
    notBefore: verified.certificate?.validity.notBefore.toISOString() ?? '',
    notAfter: verified.certificate?.validity.notAfter.toISOString() ?? '',
    coversDocument: digestMatches,
    // THE WHOLE FILE, asserted separately: `b + d` plus the hole is the file
    // when nothing was appended after the signature.
    coversWholeFile: b + d + (c - b) === bytes.byteLength,
  };
}

/**
 * Parses one PKCS#7 blob and checks it against the bytes its ranges name.
 *
 * Split out of {@link readOne} so the two `let`s it needed become returns —
 * a value assigned in a `try` and read after it is a value whose initialiser
 * the compiler reports as unused, and the honest shape is a function that
 * answers both halves at once.
 */
function verify(
  contents: Uint8Array,
  bytes: Uint8Array,
  [a, b, c, d]: readonly [number, number, number, number],
): { readonly certificate: ForgeCertificate | null; readonly digestMatches: boolean } {
  try {
    // TWO CASTS IN THIS MODULE, each to a typed adapter rather than to `any`:
    // this one, and `pkcs7Asn1`'s DER reader. `@types/node-forge` types
    // `messageFromAsn1` as a union whose PKCS#7 half carries neither
    // `certificates` nor `rawCapture`, and both are what a verification reads.
    const message = forge.pkcs7.messageFromAsn1(pkcs7Asn1(contents)) as unknown as ForgeMessage;
    const covered = latin1(bytes.subarray(a, a + b)) + latin1(bytes.subarray(c, c + d));
    const digest = forge.md.sha256.create();
    digest.update(covered);

    // THE ATTESTED DIGEST, out of the signature's own authenticated attributes.
    // Comparing against anything this module computed twice would be comparing
    // a value with itself.
    const attested = attestedDigest(message);
    return {
      certificate: message.certificates[0] ?? null,
      digestMatches: attested !== null && attested === digest.digest().getBytes(),
    };
  } catch (error) {
    throw new SignaturesUnreadable(
      `a signature in this document is not a PKCS#7 this build can read: ${String(error)}`,
    );
  }
}

/** The `messageDigest` attribute's value, or `null` if there is none. */
function attestedDigest(message: ForgeMessage): string | null {
  const oid = forge.asn1.oidToDer(forge.pki.oids['messageDigest'] ?? '').getBytes();
  for (const attribute of message.rawCapture.authenticatedAttributes) {
    const der = forge.asn1.toDer(attribute).getBytes();
    if (!der.includes(oid)) continue;
    // THE LAST 32 BYTES of a SHA-256 attribute's DER are the digest itself.
    // Read by length rather than by walking the structure, because the walk
    // would be a third opinion about ASN.1 in a module that already has two.
    return der.slice(-32);
  }
  return null;
}

/**
 * `asn1.fromDer` with the options object node-forge 1.x reads.
 *
 * `@types/node-forge` declares the second argument as a `strict` boolean; the
 * library's own reader takes `{ strict, parseAllBytes, decodeBitStrings }`
 * (node-forge 1.4.0, `lib/asn1.js`). A typed adapter over that one call rather
 * than an `any` one.
 */
interface ForgeDerReader {
  fromDer(bytes: string, options: { readonly parseAllBytes: boolean }): forge.asn1.Asn1;
}

/**
 * The PKCS#7 element at the start of `/Contents`, read to its OWN declared length.
 *
 * `/Contents` is a fixed-size hole: the DER signature, then zero bytes out to the
 * reserved length. This used to strip every trailing zero byte before parsing —
 * and a DER encoding may END in a zero byte. Measured 2026-09-12: a freshly
 * signed document read as *not a PKCS#7 this build can read — Too few bytes to
 * read ASN.1 value* in one full-suite run and not in isolation, because the key
 * is minted per run and a signature's last byte is zero about once in 256. A
 * valid signature reported unreadable is the display-only defect in the one
 * panel whose whole job is to be believed.
 *
 * The DER reader already knows where the element ends — its length is in its
 * own header — so it is asked to stop there (`parseAllBytes: false`) rather
 * than handed a guess about where the padding starts (B3a).
 *
 * Exported so the control can drive it with a constructed element whose final
 * byte is zero: a real signature cannot be made to end in one on purpose.
 */
export function pkcs7Asn1(contents: Uint8Array): forge.asn1.Asn1 {
  return (forge.asn1 as unknown as ForgeDerReader).fromDer(latin1(contents), {
    parseAllBytes: false,
  });
}

/** `Uint8Array` as latin-1, which is how node-forge spells raw bytes. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/**
 * The two shapes `@types/node-forge` does not describe.
 *
 * `pkcs7.messageFromAsn1` is typed as returning a union whose PKCS#7 half
 * carries neither `certificates` nor `rawCapture`, and both are what a
 * verification reads. These two aliases are this module's confined widening —
 * B7's *one typed adapter module per boundary* applied to a typings gap rather
 * than to a native library, and narrower than a file-level disable.
 *
 * **`import forge from 'node-forge'` is STATIC**, not dynamic, and that is
 * `withDocument`'s shape rather than a size decision: the callback it runs is
 * synchronous because the engine's document handle is valid for the duration of
 * one call, and awaiting an import inside it would be awaiting across a native
 * reference. This module is imported only by the contained host's handler
 * wiring, which already carries MuPDF's WASM — `main` never loads it.
 */
/** A distinguished-name field, as node-forge answers one. */
interface ForgeSubject {
  getField: (name: string) => { readonly value: string } | null | undefined;
}

/** The half of an X.509 certificate this row reads. */
interface ForgeCertificate {
  readonly subject: ForgeSubject;
  readonly validity: { readonly notBefore: Date; readonly notAfter: Date };
}

/** The half of a PKCS#7 message this row reads. */
interface ForgeMessage {
  readonly certificates: readonly ForgeCertificate[];
  readonly rawCapture: { readonly authenticatedAttributes: readonly forge.asn1.Asn1[] };
}
