import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import type { PDFDocument, PDFPage, PDFRef } from '@cantoo/pdf-lib';

import type { ByteImage } from './engineSeam.js';
import { PngPixelsRefused, checkPngPixels } from './imageDimensions.js';
import { openWhole } from './pdfLibSession.js';
import { type DrawableMark, drawSignature, signatureBox } from './signatureDrawing.js';
import { type PlaceholderRequest, type PreparedSignature, reservedSignatureBytes } from './signatureHole.js';
import { SignatureAppearanceRefusedError } from './signingRefusals.js';

/**
 * A signature's placeholder, written where the document is: the MuPDF host, beside the session
 * ([ADR-0148](../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md)).
 *
 * Writing one loads the whole document with pdf-lib and decodes the signature's picture, which is a parse, and §9.17's
 * `main` never parses. So this module is the host's, loaded on the first signature by a literal `import()`, and
 * `main`'s signer (`documentSign.ts`) reaches neither it nor pdf-lib — `proof:hostload` says so from the emit.
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
 * How a visible signature looks, as the command carries it.
 */
type SignatureAppearance = NonNullable<PlaceholderRequest['appearance']>;
type SignatureMark = SignatureAppearance['mark'];

/**
 * A picture, embedded so the drawing can name it — and its size, which is what the drawing scales by.
 *
 * `applyInsertImagePage`'s two calls and its rule that the media type chooses
 * the decoder. The decoder refusing is what validates the bytes, and it is
 * named here because main would otherwise report it as a wrong passphrase.
 */
async function embeddedPicture(
  document: PDFDocument,
  mark: Extract<SignatureMark, { kind: 'image' }>,
): Promise<{ readonly ref: PDFRef; readonly width: number; readonly height: number }> {
  // THE PIXEL RULE BEFORE THE DECODER. `embedPng` decodes every pixel. Bytes with no PNG header ARE an unreadable
  // picture, and are named so; a picture with too many pixels is a valid picture, so that refusal propagates for
  // main to answer as one — naming it unreadable would blame the file.
  if (mark.mediaType === 'image/png') {
    try {
      checkPngPixels(mark.bytes);
    } catch (error) {
      if (error instanceof PngPixelsRefused && error.reason === 'no-header') {
        throw new SignatureAppearanceRefusedError(
          'unreadable-image',
          'the signature picture has no PNG header this build can read',
          { cause: error },
        );
      }
      throw error;
    }
  }
  let embedded;
  try {
    embedded =
      mark.mediaType === 'image/png'
        ? await document.embedPng(mark.bytes)
        : await document.embedJpg(mark.bytes);
  } catch (cause) {
    throw new SignatureAppearanceRefusedError(
      'unreadable-image',
      `the signature picture is not a ${mark.mediaType} this build can decode`,
      { cause },
    );
  }
  return { ref: embedded.ref, width: embedded.width, height: embedded.height };
}

/** A visible widget's rectangle and the appearance stream drawn for it. */
interface PlacedAppearance {
  readonly rect: readonly [number, number, number, number];
  readonly form: PDFRef;
}

/**
 * Draws the appearance for a placement, upright as the page is seen.
 *
 * **What is drawn is `signatureDrawing.ts`'s** (ADR-0133): the box, the matrix that keeps the mark upright, the content
 * stream and the names it uses. This function turns those names into pdf-lib objects of this document — the base-14
 * font as a Type 1 dictionary, the picture as the XObject pdf-lib embedded — and wraps the stream as the widget's form.
 * MuPDF's placed signature takes the same drawing, so a mark looks the same with a certificate and without.
 */
async function appearanceFor(
  document: PDFDocument,
  page: PDFPage,
  appearance: SignatureAppearance,
): Promise<PlacedAppearance> {
  // `getRotation` reads the inheritable `/Rotate`; `signatureBox` snaps it through the shared function every other
  // reader of it agrees on.
  const box = signatureBox(appearance.rect, page.getRotation().angle);
  const { mark } = appearance;
  let picture: Awaited<ReturnType<typeof embeddedPicture>> | undefined;
  let drawable: DrawableMark;
  if (mark.kind === 'image') {
    picture = await embeddedPicture(document, mark);
    drawable = { kind: 'picture', width: picture.width, height: picture.height };
  } else {
    drawable = mark;
  }
  const drawing = await drawSignature(drawable, box.seenWide, box.seenTall);

  const context = document.context;
  const resources: Record<string, Record<string, PDFRef>> = {};
  if (drawing.font !== undefined) {
    const font = context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: drawing.font.baseFont,
      Encoding: 'WinAnsiEncoding',
    });
    resources['Font'] = { [drawing.font.name]: context.register(font) };
  }
  if (drawing.picture !== undefined && picture !== undefined) {
    resources['XObject'] = { [drawing.picture.name]: picture.ref };
  }
  const form = context.stream(drawing.content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, box.seenWide, box.seenTall],
    Matrix: [...box.matrix],
    Resources: resources,
  });
  return { rect: box.rect, form: context.register(form) };
}

/**
 * Writes an empty signature dictionary, its widget, and the `/AcroForm` entry.
 *
 * Three objects, which is what a signature placeholder is — four with a visible
 * appearance. Without one the widget is **invisible**: a zero-size `/Rect` with
 * the hidden flag clear and `/F 132` (print + locked). With one it carries the
 * placement's rectangle and an `/AP /N` stream, because a widget given a
 * rectangle and no appearance renders as a black box in some readers.
 *
 * @returns the document, mutated; the caller serialises.
 */
function placeSignature(
  document: PDFDocument,
  page: PDFPage,
  request: PlaceholderRequest,
  placed: PlacedAppearance | undefined,
): void {
  const context = document.context;

  const byteRange = context.obj([
    PDFNumber.of(0),
    PDFName.of(BYTE_RANGE_SLOT),
    PDFName.of(BYTE_RANGE_SLOT),
    PDFName.of(BYTE_RANGE_SLOT),
  ]);

  // THE HOLE, as a hex string of the reserved number of zero bytes. `@signpdf`
  // locates it by its length in the raw file and overwrites it in place, which
  // is why the placeholder's size is the signature's ceiling.
  const contents = PDFHexString.of('0'.repeat(reservedSignatureBytes(request) * 2));

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
  if (request.name !== undefined) signature.set(PDFName.of('Name'), PDFString.of(request.name));
  if (request.reason !== undefined) {
    signature.set(PDFName.of('Reason'), PDFString.of(request.reason));
  }
  if (request.location !== undefined) {
    signature.set(PDFName.of('Location'), PDFString.of(request.location));
  }
  if (request.contactInfo !== undefined) {
    signature.set(PDFName.of('ContactInfo'), PDFString.of(request.contactInfo));
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
  if (request.certify !== undefined) {
    const reference = context.obj({
      Type: PDFName.of('SigRef'),
      TransformMethod: PDFName.of('DocMDP'),
      TransformParams: context.obj({
        Type: PDFName.of('TransformParams'),
        V: PDFName.of('1.2'),
        P: PDFNumber.of(DOC_MDP_LEVELS[request.certify]),
      }),
    });
    signature.set(PDFName.of('Reference'), context.obj([context.register(reference)]));
  }
  const signatureRef = context.register(signature);
  if (request.certify !== undefined) {
    document.catalog.set(
      PDFName.of('Perms'),
      context.obj({ DocMDP: signatureRef }),
    );
  }

  const widget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    Rect: context.obj([...(placed?.rect ?? [0, 0, 0, 0])]),
    V: signatureRef,
    T: PDFString.of(`Signature${String(Date.now())}`),
    // 132 = print (bit 3) + locked (bit 8). Not hidden: a hidden widget is one
    // some readers refuse to treat as a signature field at all.
    F: 132,
    P: page.ref,
  });
  // THE APPEARANCE IS WRITTEN BEFORE THE SIGNER RUNS, so it lies inside the
  // covered byte ranges: replacing the picture afterwards is a change to the
  // signed bytes, and every reader reports it as one.
  if (placed !== undefined) widget.set(PDFName.of('AP'), context.obj({ N: placed.form }));
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
export async function withSignaturePlaceholder(image: ByteImage, request: PlaceholderRequest): Promise<ByteImage> {
  // WHOLE, the signer's own route (`openWhole`), never the pdf-lib commands' appended one (ADR-0127).
  const document = await openWhole(image);
  // THE FIRST PAGE FOR AN INVISIBLE SIGNATURE, which has no page a person
  // chose; the placement's page for a visible one, refused rather than clamped
  // when the document does not have it — a signature drawn on a different page
  // from the one somebody pointed at is a signature in the wrong place.
  const index = request.appearance?.page ?? 0;
  const total = document.getPageCount();
  if (index >= total) {
    throw new RangeError(
      `Page ${String(index)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  const page = document.getPage(index);
  const placed =
    request.appearance === undefined
      ? undefined
      : await appearanceFor(document, page, request.appearance);
  placeSignature(document, page, request, placed);
  return document.save({ useObjectStreams: false });
}

/**
 * The placeholder, and then `@signpdf`'s own range step: everything signing does that needs no key.
 *
 * ## `SignPdf.sign` with a signer that answers NO BYTES
 *
 * `SignPdf.sign` finds the placeholder, finds the hole after it, writes the four numbers over the placeholder and asks
 * its signer for a signature, which it hexes and pads with zeros to the hole's length. Asked for none, it pads the
 * whole hole: the file comes back with its ranges written and the hole exactly as the placeholder left it. That is the
 * keyless half by the library's own rule, unmodified, and `main` does the other half over the four numbers.
 *
 * ## The numbers are READ BACK, by the same reader that found the placeholder
 *
 * `findByteRange` lists every `/ByteRange` in the file in order, which matters once a document carries a signature
 * already; ours is the one that held the placeholder, and the same index in the prepared file is where `SignPdf` wrote
 * its numbers. `extractSignature` is not used: it reads the FIRST `/ByteRange`, which is another signature's in a
 * document signed before.
 */
export async function prepareSignature(image: ByteImage, request: PlaceholderRequest): Promise<PreparedSignature> {
  return preparePlaced(await withSignaturePlaceholder(image, request));
}

/**
 * {@link prepareSignature}'s range step alone, on a document that already carries the placeholder — so the fill's proof
 * can hand `@signpdf` the same placed bytes this prepared.
 */
export async function preparePlaced(image: ByteImage): Promise<PreparedSignature> {
  const placed = Buffer.from(image);
  const [{ SignPdf }, { Signer, findByteRange }] = await Promise.all([
    import('@signpdf/signpdf'),
    import('@signpdf/utils'),
  ]);

  const before = findByteRange(placed);
  const index = before.byteRangePlaceholder === undefined ? -1 : before.byteRangeStrings.indexOf(before.byteRangePlaceholder);
  if (index === -1) {
    throw new Error('the placeholder this build wrote has no /ByteRange placeholder @signpdf can find');
  }

  class NoSignature extends Signer {
    override sign(): Promise<Buffer> {
      return Promise.resolve(Buffer.alloc(0));
    }
  }
  const prepared = await new SignPdf().sign(placed, new NoSignature());

  // THE STRING, NOT THE PARSED LIST: `findByteRange` answers both, and its declaration names the list `byteRange:
  // string[]` where the code answers `byteRanges: string[][]` (`@signpdf/utils` 3.x, read 2026-10-03). The string is
  // declared as it is, and its pattern is `extractSignature`'s, the library's own reader of a written range.
  const text = findByteRange(prepared).byteRangeStrings[index] ?? '';
  const numbers = /^\/ByteRange \[(\d+) +(\d+) +(\d+) +(\d+) *\]$/u.exec(text)?.slice(1).map(Number) ?? [];
  const [start, holeStart, holeEnd, rest] = numbers;
  if (start === undefined || holeStart === undefined || holeEnd === undefined || rest === undefined) {
    throw new Error(`@signpdf wrote a /ByteRange this build cannot read back: ${JSON.stringify(text)}`);
  }
  // COPIED INTO AN ARRAY THAT OWNS ITS BUFFER: a `Buffer` may be a view onto a pooled allocation.
  return { bytes: Uint8Array.from(prepared), byteRange: [start, holeStart, holeEnd, rest] };
}
