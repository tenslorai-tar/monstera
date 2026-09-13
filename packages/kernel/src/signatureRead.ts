import type * as mupdf from 'mupdf';
import forge from 'node-forge';

import { withDocument } from './mupdfWriter.js';
import type { MupdfSession } from './engineSeam.js';
import { checkSigner } from './signedDataCheck.js';
import type { ForgeCertificate, ForgeMessage } from './signedDataCheck.js';

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
 *
 * ## WHETHER THE SIGNER SIGNED is `signedDataCheck.ts`'s answer, not this file's
 *
 * This module compared the `messageDigest` attribute with a digest of the
 * covered bytes and stopped there until 2026-09-13. That attribute lives in
 * `/Contents`, the one span the ranges do not cover, so a document edited and
 * given a rewritten attribute read as unchanged since it was signed —
 * `documentSign.test.ts`' forgery case, which failed against that reader.
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
   * Whether the signer's signature verifies over bytes identical to these.
   *
   * **This is the question**, and it is the one a reader most often answers
   * with a green tick it did not earn. `true` needs both halves: the attested
   * digest matches the covered bytes, AND the signer's signature over that
   * attestation verifies with the certificate the signature names. `false` means
   * the document changed after it was signed, the attestation was altered, or it
   * was signed in a way this build cannot check.
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
    const seen = new Set<number>();
    const take = (field: mupdf.PDFObject, inheritedType: string): void => {
      const type = field.get('FT').isNull() ? inheritedType : String(field.get('FT'));
      if (type !== '/Sig') return;
      const signature = field.get('V');
      if (!signature.isDictionary()) return;
      // ONE SIGNATURE ONCE, however many routes reach it: a field reached through
      // the form tree and again through its widget on a page is the same `/V`.
      if (signature.isIndirect()) {
        if (seen.has(signature.asIndirect())) return;
        seen.add(signature.asIndirect());
      }
      const read = readOne(signature, bytes);
      if (read !== null) found.push(read);
    };

    // THE FORM TREE FIRST (GGGGGG-4). This walked page widgets only until
    // 2026-09-13, so a `/Sig` field in `/AcroForm /Fields` whose widget sits on
    // no page's `/Annots` — an invisible signature, which the format allows — was
    // never reported, and the panel said the document carried none. `/FT` is
    // inheritable, so a kid takes its parent's type unless it names its own.
    const walk = (fields: mupdf.PDFObject, inheritedType: string, depth: number): void => {
      if (!fields.isArray() || depth > MAX_FIELD_DEPTH) return;
      for (let index = 0; index < fields.length; index += 1) {
        const field = fields.get(index);
        if (!field.isDictionary()) continue;
        take(field, inheritedType);
        const type = field.get('FT').isNull() ? inheritedType : String(field.get('FT'));
        walk(field.get('Kids'), type, depth + 1);
      }
    };
    // STEP BY STEP, because a document with no form has no `/AcroForm`, and
    // MuPDF's binding throws on a `get` from the null object it answers for one.
    const root = document.getTrailer().get('Root');
    const acroForm = root.isDictionary() ? root.get('AcroForm') : null;
    if (acroForm?.isDictionary() === true) walk(acroForm.get('Fields'), '', 0);

    // AND EVERY PAGE WIDGET, for a document whose signature widget is not in
    // `/Fields` at all — malformed, and still a signature a reader should see.
    for (let index = 0; index < document.countPages(); index += 1) {
      for (const widget of document.loadPage(index).getWidgets()) {
        take(widget.getObject(), '');
      }
    }
    return found;
  });
}

/**
 * How deep the form tree is walked. A `/Kids` cycle is legal to write and never
 * ends; real forms nest a handful of levels.
 */
const MAX_FIELD_DEPTH = 32;

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
  // THE PADDING IS NOT TRIMMED HERE. `/Contents` is a fixed-size hole — the
  // signature plus zero bytes out to the reserved length — and stripping trailing
  // zeros also strips a DER encoding's own final zero byte, about one signature
  // in 256. `pkcs7Asn1` reads the element to the length its header declares.
  const contentBytes = contents.asByteString();
  const checked = verify(contentBytes, bytes, [a, b, c, d]);
  const subject = checked.certificate?.subject;
  // `/Name` FIRST, then the certificate's CN. A signature dictionary's own
  // name is what the signer chose to display; the CN is what their certificate
  // says they are, and the second is the fallback rather than the answer.
  const stated = signature.get('Name').asString();
  return {
    signer: stated === '' ? (subject?.getField('CN')?.value ?? '') : stated,
    organisation: subject?.getField('O')?.value ?? '',
    reason: signature.get('Reason').asString(),
    location: signature.get('Location').asString(),
    notBefore: checked.certificate?.validity.notBefore.toISOString() ?? '',
    notAfter: checked.certificate?.validity.notAfter.toISOString() ?? '',
    coversDocument: checked.verified,
    coversWholeFile: rangeCoversWholeFile([a, b, c, d], contentBytes, bytes),
  };
}

const LESS_THAN = 0x3c;
const GREATER_THAN = 0x3e;

/** A hex digit's value, or `null` for any other byte. */
function hexValue(byte: number | undefined): number | null {
  if (byte === undefined) return null;
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return null;
}

/**
 * Whether `/ByteRange [a b c d]` signs every byte of the file except this
 * signature's own `/Contents` string.
 *
 * **ALL FOUR NUMBERS ARE HELD, because each one is a way to leave bytes out.**
 * This answered `c + d === length` until 2026-09-13 (finding GGGGGG-3) — written
 * as `b + d + (c − b)`, which reduces to that — so `a` was never held to 0 and
 * the gap was never held to be the signature. A range starting at 1, or a gap
 * slid off `/Contents` onto document bytes, read as covering the whole file.
 *
 * - `a` is 0: nothing before the first span is unsigned.
 * - `c + d` is the length: nothing after the second span is unsigned.
 * - bytes `b` to `c` are exactly `<`, the hex of `contents`, and `>` — the
 *   `/Contents` value the object model read, and nothing more. A signature
 *   cannot cover its own value, so the one span it may leave out is that value.
 *
 * @param contents `/Contents` as the engine decoded it, padding included.
 * @param bytes the serialised file the range indexes into.
 */
export function rangeCoversWholeFile(
  [a, b, c, d]: readonly [number, number, number, number],
  contents: Uint8Array,
  bytes: Uint8Array,
): boolean {
  if (![a, b, c, d].every((value) => Number.isSafeInteger(value) && value >= 0)) return false;
  if (a !== 0 || c + d !== bytes.byteLength) return false;
  if (c - b !== 2 + 2 * contents.byteLength) return false;
  if (bytes[b] !== LESS_THAN || bytes[c - 1] !== GREATER_THAN) return false;
  for (let index = 0; index < contents.byteLength; index += 1) {
    const high = hexValue(bytes[b + 1 + 2 * index]);
    const low = hexValue(bytes[b + 2 + 2 * index]);
    if (high === null || low === null || high * 16 + low !== contents[index]) return false;
  }
  return true;
}

/**
 * Parses one PKCS#7 blob and checks its signer against the bytes its ranges name.
 *
 * Split out of {@link readOne} so the parse's refusal has one place to become
 * {@link SignaturesUnreadable}, and the check itself stays `signedDataCheck.ts`'s.
 */
function verify(
  contents: Uint8Array,
  bytes: Uint8Array,
  [a, b, c, d]: readonly [number, number, number, number],
): { readonly certificate: ForgeCertificate | null; readonly verified: boolean } {
  let message: ForgeMessage;
  try {
    // ONE CAST, to a typed adapter rather than to `any`: `@types/node-forge`
    // types `messageFromAsn1` as a union whose PKCS#7 half carries neither
    // `certificates` nor `rawCapture`, and both are what a verification reads.
    message = forge.pkcs7.messageFromAsn1(pkcs7Asn1(contents)) as unknown as ForgeMessage;
  } catch (error) {
    throw new SignaturesUnreadable(
      `a signature in this document is not a PKCS#7 this build can read: ${String(error)}`,
    );
  }
  const covered = latin1(bytes.subarray(a, a + b)) + latin1(bytes.subarray(c, c + d));
  return checkSigner(message, covered);
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

/**
 * `Uint8Array` as latin-1, which is how node-forge spells raw bytes.
 *
 * **`import forge from 'node-forge'` is STATIC**, not dynamic, and that is
 * `withDocument`'s shape rather than a size decision: the callback it runs is
 * synchronous because the engine's document handle is valid for the duration of
 * one call, and awaiting an import inside it would be awaiting across a native
 * reference. This module is imported only by the contained host's handler
 * wiring, which already carries MuPDF's WASM — `main` never loads it.
 */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
