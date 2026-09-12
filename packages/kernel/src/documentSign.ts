import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import type { PDFDocument, PDFPage } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage } from './engineSeam.js';
import { openForWriting } from './pdfLibSession.js';

/**
 * Digitally signing a document — Stage 7's PKCS#7 row, over a placeholder this
 * build writes
 * ([ADR-0054](../../../docs/DECISIONS/0054-the-signing-core-ships-and-the-placeholder-is-ours.md)).
 *
 * ## Two libraries, one command, and that is not two writers of one concern
 *
 * §3's matrix names the writer of record for signatures as *`@signpdf/signpdf` +
 * `@signpdf/signer-p12`, **over a placeholder THIS BUILD writes***. The two
 * halves are one row in that table because they are one operation with a seam
 * down the middle: `@cantoo/pdf-lib` produces a document with a hole in it, and
 * `@signpdf` fills the hole. Neither can do the other's half.
 *
 * The placeholder helpers that would have removed the seam are refused, with
 * the measurement, in ADR-0054 Decision 2: `@signpdf/placeholder-plain` takes
 * the tree from 4 packages to **125**, seven of them shipping no licence text
 * and one deprecated with weak crypto.
 *
 * ## THE LITERAL TOKEN SHAPE IS THE CONTRACT
 *
 * ADR-0054 Decision 3, measured. `findByteRange` requires the array to be
 * exactly `/ByteRange [0 /********** /********** /**********]` — slot 0 the
 * **number** zero, slots 1 to 3 PDF **name** objects of ten asterisks. Four
 * numbers, which is the obvious shape, is refused with *"No ByteRangeStrings
 * found within PDF buffer"* — a message that names the wrong thing, because
 * they were found and were not the shape it wanted.
 */

/** ADR-0054 Decision 3's slot: a `/**********` name, ten asterisks. */
const BYTE_RANGE_SLOT = '*'.repeat(10);

/**
 * How many bytes of `/Contents` the placeholder reserves for the signature.
 *
 * Measured 2026-09-12 in the gate's own run: a self-signed P12 produced a
 * **1,295-byte** PKCS#7 blob. This is the gate's 8,192, which leaves room for a
 * chain of several certificates and a timestamp token later — and the number
 * matters in one direction only, because the signed file must be **exactly** as
 * long as the placeholder. Too small and the signature does not fit; too large
 * costs padding.
 */
const SIGNATURE_BYTES = 8192;

/**
 * `/DocMDP`'s `/P`, by the word the payload carries.
 *
 * ISO 32000-2 table 257. Keyed on the contract's own enum, so a level added
 * there without a number here is a compile error rather than a certification
 * that silently permits everything.
 */
const DOC_MDP_LEVELS: Readonly<Record<'no-changes' | 'form-fill' | 'form-fill-and-annotate', number>> =
  {
    'no-changes': 1,
    'form-fill': 2,
    'form-fill-and-annotate': 3,
  };

/** `/Filter` and `/SubFilter`, the two names a reader dispatches on. */
const ADOBE_PPKLITE = 'Adobe.PPKLite';
const DETACHED_PKCS7 = 'adbe.pkcs7.detached';

/**
 * Writes an empty signature dictionary, its widget, and the `/AcroForm` entry.
 *
 * Three objects, which is what a signature placeholder is. The widget is
 * **invisible** — a zero-size `/Rect` with the hidden flag clear and `/F 132`
 * (print + locked) — because a visible appearance is its own row and a widget
 * drawn without one renders as a black box in some readers.
 *
 * @returns the document, mutated; the caller serialises.
 */
function placeSignature(
  document: PDFDocument,
  page: PDFPage,
  command: CommandOfKind<'signDocument'>,
): void {
  const context = document.context;

  const byteRange = context.obj([
    PDFNumber.of(0),
    PDFName.of(BYTE_RANGE_SLOT),
    PDFName.of(BYTE_RANGE_SLOT),
    PDFName.of(BYTE_RANGE_SLOT),
  ]);

  // THE HOLE, as a hex string of `SIGNATURE_BYTES` zero bytes. `@signpdf`
  // locates it by its length in the raw file and overwrites it in place, which
  // is why the placeholder's size is the signature's ceiling.
  const contents = PDFHexString.of('0'.repeat(SIGNATURE_BYTES * 2));

  const signature = context.obj({
    Type: PDFName.of('Sig'),
    Filter: PDFName.of(ADOBE_PPKLITE),
    SubFilter: PDFName.of(DETACHED_PKCS7),
    ByteRange: byteRange,
    Contents: contents,
    M: PDFString.fromDate(new Date()),
  });
  // OPTIONAL FIELDS ARE OMITTED, never written empty: a `/Reason ()` is a
  // reason a reader displays as blank, which is worse than no reason at all.
  if (command.name !== undefined) signature.set(PDFName.of('Name'), PDFString.of(command.name));
  if (command.reason !== undefined) {
    signature.set(PDFName.of('Reason'), PDFString.of(command.reason));
  }
  if (command.location !== undefined) {
    signature.set(PDFName.of('Location'), PDFString.of(command.location));
  }
  if (command.contactInfo !== undefined) {
    signature.set(PDFName.of('ContactInfo'), PDFString.of(command.contactInfo));
  }
  // CERTIFICATION, which is a different claim from a signature.
  //
  // An approval signature says *I signed this*. A certifying one says *I am
  // the author, and this is what may change* — written as a `/DocMDP`
  // transform on the signature's own `/Reference`, plus a `/Perms /DocMDP`
  // entry in the catalogue pointing back at it. ISO 32000-2: there may be at
  // most ONE, and it must be the first signature in the document.
  //
  // The two halves are written together because a reader honours neither
  // alone: `/Reference` without `/Perms` is a transform nothing points at, and
  // `/Perms` without `/Reference` names a signature that makes no claim.
  if (command.certify !== undefined) {
    const reference = context.obj({
      Type: PDFName.of('SigRef'),
      TransformMethod: PDFName.of('DocMDP'),
      TransformParams: context.obj({
        Type: PDFName.of('TransformParams'),
        V: PDFName.of('1.2'),
        P: PDFNumber.of(DOC_MDP_LEVELS[command.certify]),
      }),
    });
    signature.set(PDFName.of('Reference'), context.obj([context.register(reference)]));
  }
  const signatureRef = context.register(signature);
  if (command.certify !== undefined) {
    document.catalog.set(
      PDFName.of('Perms'),
      context.obj({ DocMDP: signatureRef }),
    );
  }

  const widget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    Rect: context.obj([0, 0, 0, 0]),
    V: signatureRef,
    T: PDFString.of(`Signature${String(Date.now())}`),
    // 132 = print (bit 3) + locked (bit 8). Not hidden: a hidden widget is one
    // some readers refuse to treat as a signature field at all.
    F: 132,
    P: page.ref,
  });
  const widgetRef = context.register(widget);
  page.node.addAnnot(widgetRef);

  // `/AcroForm` WITH `/SigFlags 3` — append-only plus signatures-exist, which
  // is what tells a reader the document has a signature to check.
  const catalogue = document.catalog;
  const existing = catalogue.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const acroForm = existing ?? context.obj({});
  if (existing === undefined) catalogue.set(PDFName.of('AcroForm'), context.register(acroForm));
  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray) ?? context.obj([]);
  fields.push(widgetRef);
  acroForm.set(PDFName.of('Fields'), fields);
}

/**
 * The document with a signature placeholder in it, serialised.
 *
 * **`useObjectStreams: false`**, ADR-0054 Decision 3's second constraint: the
 * signer locates the `/Contents` hole in the raw bytes, so a signature
 * dictionary compressed into an object stream is invisible to it. This is the
 * one save in the codebase that must not compress.
 *
 * Exported so the row's proof can assert the placeholder's shape without
 * signing — the byte range's four slots are the whole contract with `@signpdf`,
 * and a case that only ever saw a signed file could not tell a correct
 * placeholder from one the signer happened to tolerate.
 */
export async function withSignaturePlaceholder(
  image: ByteImage,
  command: CommandOfKind<'signDocument'>,
): Promise<ByteImage> {
  const document = await openForWriting(image);
  const page = document.getPage(0);
  placeSignature(document, page, command);
  return document.save({ useObjectStreams: false });
}

/**
 * Signs the document, over a placeholder this build wrote.
 *
 * ## THE CLASS, NOT THE DEFAULT INSTANCE, and the measurement is why
 *
 * ADR-0054 Decision 3's third constraint says `@signpdf/signpdf` is CommonJS
 * with a `default` export and *the instance is one level in*. Measured
 * 2026-09-12, it is **two**: the namespace's `default` is `module.exports`,
 * whose own `default` is the singleton — `namespace.default.sign` is
 * `undefined` and `namespace.default.default.sign` is a function. That is the
 * shape the ADR's sentence describes from one side.
 *
 * So this constructs `SignPdf`, which the namespace exports directly and which
 * needs no interop reasoning at all. It also avoids the singleton's
 * `lastSignature`, which is per-instance state two concurrent signs would
 * share.
 *
 * The import is dynamic so main pays for `node-forge` only when somebody signs
 * something — the same reason `nspell` is behind one.
 */
export const applySignDocument: Apply<'signpdf', 'signDocument'> = async (image, command) => {
  const placed = await withSignaturePlaceholder(image, command);

  const [{ SignPdf }, { P12Signer }] = await Promise.all([
    import('@signpdf/signpdf'),
    import('@signpdf/signer-p12'),
  ]);

  // THE PASSPHRASE REACHES ONE CALL. Nothing here records it, and the error
  // below carries none of it.
  const signer = new P12Signer(command.bytes, { passphrase: command.passphrase });
  const signed = await new SignPdf().sign(Buffer.from(placed), signer);

  // THE LENGTH IS THE PROPERTY THE WHOLE SCHEME RESTS ON, asserted rather than
  // assumed: `@signpdf` overwrites the hole in place and rewrites the ranges to
  // describe the file they are in, so a signed document is byte-for-byte as
  // long as its placeholder. A length that moved means the ranges describe
  // something else, and every reader would report the signature as invalid over
  // bytes that are in fact intact.
  if (signed.byteLength !== placed.byteLength) {
    throw new Error(
      `the signed document is ${String(signed.byteLength)} bytes where its placeholder was ` +
        `${String(placed.byteLength)}: the byte ranges no longer describe the file they are in`,
    );
  }
  // COPIED INTO AN ARRAY THAT OWNS ITS BUFFER. `Buffer` is a view onto a pooled
  // allocation, so `new Uint8Array(buffer)` would share it — the same hazard
  // `mupdfWriter.ts` records for `asUint8Array()`, from a different allocator.
  // `ByteImage` is what the service holds across commands.
  return Uint8Array.from(signed);
};

/**
 * Reports that a signature's prior state is not recorded.
 *
 * The prior state is the unsigned document, which is the whole file. A
 * checkpoint holds exactly that, and it is the right place for it.
 */
export const captureSignDocument = (): Promise<CaptureResult<never>> =>
  Promise.resolve({
    captured: false,
    reason:
      'a signature cannot be recorded as prior state: the prior state is the unsigned document, ' +
      'which is the whole file, and the checkpoint holds it',
  });

/** Refuses to invert, for {@link captureSignDocument}'s reason. */
export const invertSignDocument = (): never => {
  throw new Error('signDocument is declared non-invertible. Undo restores the checkpoint.');
};
