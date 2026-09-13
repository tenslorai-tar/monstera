import {
  beginText,
  concatTransformationMatrix,
  drawObject,
  endText,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveText,
  moveTo,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  setFillingGrayscaleColor,
  setFontAndSize,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingGrayscaleColor,
  showText,
  StandardFonts,
  stroke,
} from '@cantoo/pdf-lib';
import type { PDFDocument, PDFOperator, PDFPage, PDFRef } from '@cantoo/pdf-lib';
import type { AnnotationRect, CommandOfKind, TimestampAuthority } from '@monstera/contract';
import { snapRotation } from '@monstera/shared';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage } from './engineSeam.js';
import { openForWriting } from './pdfLibSession.js';
import {
  SignatureAppearanceRefusedError,
  SignatureCredentialRefusedError,
  SignatureTooLargeError,
  TimestampUnreachableError,
} from './signingRefusals.js';

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
 * How many bytes the placeholder reserves when a timestamp is asked for.
 *
 * **A bound, not a measurement**, and chosen from the one direction that matters:
 * a token carries the authority's certificate — RFC 3161 §2.4.1 obliges it when
 * `certReq` is set, which this build sets — and often its chain, so the 8,192
 * above is not a ceiling a timestamped signature can be held to. Too large costs
 * zero padding and nothing else; too small refuses a signature by name
 * (`SignatureTooLargeError`), which is how a figure that proves wrong announces
 * itself.
 */
const TIMESTAMPED_SIGNATURE_BYTES = 32_768;

/** The space the placeholder reserves for this command's signature. */
function reservedSignatureBytes(command: CommandOfKind<'signDocument'>): number {
  return command.timestamp === undefined ? SIGNATURE_BYTES : TIMESTAMPED_SIGNATURE_BYTES;
}

/**
 * The PKCS#7 `P12Signer` produced, with an accepted timestamp token added to its
 * one SignerInfo as the unsigned attribute `id-aa-timeStampToken` (RFC 3161
 * Appendix A).
 *
 * **The imprint hashes the SignerInfo's `signature` value** — Appendix A's rule,
 * which is what makes the token a timestamp of THIS signature rather than of the
 * document. The reply is judged by `acceptTimestampReply` and nothing else; a
 * transport failure is named unreachable, and a reply that fails a check is named
 * by that module.
 *
 * node-forge and the token module load here, dynamically, for `applySignDocument`'s
 * reason: main pays for them only when somebody asks for a timestamp.
 */
async function timestamped(
  raw: Buffer,
  authority: TimestampAuthority,
  requestTimestamp: RequestTimestamp,
): Promise<Buffer> {
  const [{ default: forge }, { acceptTimestampReply, TIMESTAMP_TOKEN_ATTRIBUTE_OID, timestampQuery }] =
    await Promise.all([import('node-forge'), import('./timestampToken.js')]);
  const { asn1 } = forge;

  const contentInfo = asn1.fromDer(raw.toString('binary'));
  // ContentInfo → [0] → SignedData, whose LAST element is `signerInfos`.
  const signedData = Array.isArray(contentInfo.value) ? contentInfo.value[1] : undefined;
  const signedFields = Array.isArray(signedData?.value) ? signedData.value[0]?.value : undefined;
  const signerInfos = Array.isArray(signedFields) ? signedFields.at(-1)?.value : undefined;
  const signerInfo = Array.isArray(signerInfos) && signerInfos.length === 1 ? signerInfos[0] : undefined;
  const fields = Array.isArray(signerInfo?.value) ? signerInfo.value : undefined;
  if (signerInfo === undefined || fields === undefined) {
    throw new Error('the signer produced a PKCS#7 without exactly one SignerInfo');
  }
  // A DEFECT, not a refusal: `P12Signer` writes no unsigned attributes, so one
  // already present means the signer changed underneath this code.
  // `[1]` IS TAG NUMBER 1 IN THE CONTEXT CLASS. `@types/node-forge` types every
  // node's tag as `asn1.Type`, whose members name the UNIVERSAL types, so the
  // number is given the field's own type at the comparison. The enum member that
  // is also 1 is `BOOLEAN`, and writing it here would describe a context tag as a
  // boolean.
  if (
    fields.some(
      (field) =>
        field.tagClass === asn1.Class.CONTEXT_SPECIFIC && field.type === (1 as typeof field.type),
    )
  ) {
    throw new Error('the SignerInfo already carries unsigned attributes');
  }
  const signature = fields.find(
    (field) => field.tagClass === asn1.Class.UNIVERSAL && field.type === asn1.Type.OCTETSTRING,
  );
  if (signature === undefined || typeof signature.value !== 'string') {
    throw new Error('the SignerInfo carries no signature value');
  }

  const query = timestampQuery(signature.value);
  let reply: Uint8Array;
  try {
    reply = await requestTimestamp(authority, query.der);
  } catch (cause) {
    throw new TimestampUnreachableError({ cause });
  }
  const accepted = acceptTimestampReply(reply, query);

  fields.push(
    // [1] IMPLICIT UnsignedAttributes — a SET OF Attribute, tagged in place.
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(TIMESTAMP_TOKEN_ATTRIBUTE_OID).getBytes(),
        ),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [accepted.token]),
      ]),
    ]),
  );
  return Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');
}

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
type SignatureAppearance = NonNullable<CommandOfKind<'signDocument'>['appearance']>;
type SignatureMark = SignatureAppearance['mark'];

/**
 * Each typed face's standard font, keyed on the contract's own list.
 *
 * A `Record` over the payload's member type, so a face added to
 * `SIGNATURE_FONTS` without an entry here is a compile error rather than a
 * signature set in whatever the default happened to be.
 */
const STANDARD_FACES: Readonly<Record<Extract<SignatureMark, { kind: 'typed' }>['font'], StandardFonts>> =
  {
    helvetica: StandardFonts.Helvetica,
    'times-roman': StandardFonts.TimesRoman,
    'times-italic': StandardFonts.TimesRomanItalic,
    courier: StandardFonts.Courier,
  };

/** How much of the box the mark may fill, on its tighter axis. */
const FILL = 0.9;

/** The pen's width as a share of the box's shorter side, for a drawn mark. */
const PEN_SHARE = 0.03;

/**
 * The form matrix that draws an appearance UPRIGHT on a page turned by
 * `/Rotate`.
 *
 * A reader maps an appearance into its widget's `/Rect` by transforming the
 * `/BBox` through `/Matrix` and fitting the result (ISO 32000-2 §12.5.5), and it
 * then shows the whole page turned clockwise by `/Rotate`. Counter-rotating the
 * form by the same angle is what makes a signature read left to right as the
 * page is SEEN — and on a quarter turn the box a person drew is the rectangle's
 * height wide, which is why {@link appearanceFor} swaps the two before drawing.
 */
const UPRIGHT: Readonly<Record<number, readonly number[]>> = {
  0: [1, 0, 0, 1, 0, 0],
  90: [0, 1, -1, 0, 0, 0],
  180: [-1, 0, 0, -1, 0, 0],
  270: [0, -1, 1, 0, 0, 0],
};

/** What a mark draws, and the resources its operators name. */
interface Drawing {
  readonly operators: PDFOperator[];
  readonly resources: Record<string, Record<string, PDFRef>>;
}

/**
 * Typed text, set in a standard font and centred in the box.
 *
 * **The font's character set is the authority on what it can draw.** A
 * standard font encodes WinAnsi, and `encodeText` given anything outside it
 * throws a message about glyphs that a person could not act on — so the check
 * is made against `getCharacterSet()` first and refused by name.
 */
async function typedDrawing(
  document: PDFDocument,
  mark: Extract<SignatureMark, { kind: 'typed' }>,
  width: number,
  height: number,
): Promise<Drawing> {
  const font = await document.embedFont(STANDARD_FACES[mark.font]);
  const encodable = new Set(font.getCharacterSet());
  for (const character of mark.text) {
    if (!encodable.has(character.codePointAt(0) ?? -1)) {
      throw new SignatureAppearanceRefusedError(
        'unencodable-text',
        'the signature text holds a character the chosen standard font cannot encode',
      );
    }
  }
  const across = font.widthOfTextAtSize(mark.text, 1);
  // TEXT THAT ADVANCES NOTHING DRAWS NOTHING, and a visible signature with no
  // ink is the display-only defect on the page. The dialog trims, so this is
  // not reachable from the surface that sends the command.
  if (across <= 0) throw new RangeError('the signature text draws nothing');
  const size = Math.min(height * FILL * 0.75, (width * FILL) / across);
  const rise = font.heightAtSize(size, { descender: false });
  return {
    operators: [
      setFillingGrayscaleColor(0),
      beginText(),
      setFontAndSize('F0', size),
      moveText((width - across * size) / 2, (height - rise) / 2),
      showText(font.encodeText(mark.text)),
      endText(),
    ],
    resources: { Font: { F0: font.ref } },
  };
}

/**
 * Drawn strokes, their ink fitted into the box.
 *
 * **The ink's own bounding box is what is fitted, not the pad's**, so where on
 * the pad a person started and what shape the pad was decide nothing. Both pad
 * coordinates share one unit (the contract's point schema says so), which is
 * what lets one scale serve both axes without turning a circle into an ellipse.
 */
function drawnDrawing(
  mark: Extract<SignatureMark, { kind: 'drawn' }>,
  width: number,
  height: number,
): Drawing {
  // A LOOP AND NOT `Math.min(...points)`: a drawn signature may carry 65,536
  // points, and spreading that many arguments is a stack limit waiting for the
  // person with the longest name.
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const line of mark.strokes) {
    for (const [x, y] of line) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const pen = Math.max(1, Math.min(width, height) * PEN_SHARE);
  const inkWide = right - left;
  const inkTall = bottom - top;
  // A DOT HAS NO EXTENT ON EITHER AXIS, so neither ratio exists; it is drawn at
  // the centre, where the round cap makes it a mark.
  const fits = [inkWide > 0 ? (width * FILL - pen) / inkWide : Infinity, inkTall > 0 ? (height * FILL - pen) / inkTall : Infinity];
  const scale = Number.isFinite(Math.min(...fits)) ? Math.max(0, Math.min(...fits)) : 0;
  const originX = (width - inkWide * scale) / 2;
  const originY = (height - inkTall * scale) / 2;

  const operators: PDFOperator[] = [
    setStrokingGrayscaleColor(0),
    setLineWidth(pen),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  ];
  for (const line of mark.strokes) {
    line.forEach(([x, y], index) => {
      // THE PAD IS Y-DOWN and a form is y-up, so a point's distance from the
      // ink's BOTTOM edge is its height in the form.
      const across = originX + (x - left) * scale;
      const up = originY + (bottom - y) * scale;
      operators.push(index === 0 ? moveTo(across, up) : lineTo(across, up));
    });
    operators.push(stroke());
  }
  return { operators, resources: {} };
}

/**
 * A picture, scaled to fit the box without distortion and centred.
 *
 * `applyInsertImagePage`'s two calls and its rule that the media type chooses
 * the decoder. The decoder refusing is what validates the bytes, and it is
 * named here because main would otherwise report it as a wrong passphrase.
 */
async function imageDrawing(
  document: PDFDocument,
  mark: Extract<SignatureMark, { kind: 'image' }>,
  width: number,
  height: number,
): Promise<Drawing> {
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
  const scale = Math.min((width * FILL) / embedded.width, (height * FILL) / embedded.height);
  const wide = embedded.width * scale;
  const tall = embedded.height * scale;
  return {
    operators: [
      pushGraphicsState(),
      concatTransformationMatrix(wide, 0, 0, tall, (width - wide) / 2, (height - tall) / 2),
      drawObject('Im0'),
      popGraphicsState(),
    ],
    resources: { XObject: { Im0: embedded.ref } },
  };
}

/** A visible widget's rectangle and the appearance stream drawn for it. */
interface PlacedAppearance {
  readonly rect: readonly [number, number, number, number];
  readonly form: PDFRef;
}

/**
 * Draws the appearance for a placement, upright as the page is seen.
 *
 * **The rectangle is ordered here**, `placedRect`'s rule: a drag runs whichever
 * way the pointer went and the schema leaves ordering to the kernel. One with no
 * area is refused rather than drawn, because a signature nobody can see placed
 * as a visible one is the defect this row exists to not have.
 */
async function appearanceFor(
  document: PDFDocument,
  page: PDFPage,
  appearance: SignatureAppearance,
): Promise<PlacedAppearance> {
  const rect: AnnotationRect = appearance.rect;
  const x0 = Math.min(rect.x0, rect.x1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const y1 = Math.max(rect.y0, rect.y1);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) {
    throw new RangeError('a visible signature needs a rectangle with an area');
  }

  // THE EFFECTIVE ROTATION, snapped through the shared function — pdf-lib's
  // `getRotation` reads the inheritable `/Rotate`, and `snapRotation` is what
  // every other reader of it in this build agrees on.
  const rotation = snapRotation(page.getRotation().angle);
  const turned = rotation === 90 || rotation === 270;
  const seenWide = turned ? y1 - y0 : x1 - x0;
  const seenTall = turned ? x1 - x0 : y1 - y0;

  const { mark } = appearance;
  const drawing =
    mark.kind === 'typed'
      ? await typedDrawing(document, mark, seenWide, seenTall)
      : mark.kind === 'drawn'
        ? drawnDrawing(mark, seenWide, seenTall)
        : await imageDrawing(document, mark, seenWide, seenTall);

  const context = document.context;
  const form = context.formXObject(drawing.operators, {
    BBox: [0, 0, seenWide, seenTall],
    Matrix: [...(UPRIGHT[rotation] ?? [1, 0, 0, 1, 0, 0])],
    Resources: drawing.resources,
  });
  return { rect: [x0, y0, x1, y1], form: context.register(form) };
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
  command: CommandOfKind<'signDocument'>,
  placed: PlacedAppearance | undefined,
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
  const contents = PDFHexString.of('0'.repeat(reservedSignatureBytes(command) * 2));

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
export async function withSignaturePlaceholder(
  image: ByteImage,
  command: CommandOfKind<'signDocument'>,
): Promise<ByteImage> {
  const document = await openForWriting(image);
  // THE FIRST PAGE FOR AN INVISIBLE SIGNATURE, which has no page a person
  // chose; the placement's page for a visible one, refused rather than clamped
  // when the document does not have it — a signature drawn on a different page
  // from the one somebody pointed at is a signature in the wrong place.
  const index = command.appearance?.page ?? 0;
  const total = document.getPageCount();
  if (index >= total) {
    throw new RangeError(
      `Page ${String(index)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  const page = document.getPage(index);
  const placed =
    command.appearance === undefined
      ? undefined
      : await appearanceFor(document, page, command.appearance);
  placeSignature(document, page, command, placed);
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
export const applySignDocument: Apply<'signpdf', 'signDocument'> = (image, command) =>
  signDocumentWith(NO_TIMESTAMPS)(image, command);

/**
 * Asks a timestamp authority, by id, with a DER TimeStampReq, and answers the
 * reply's body — already bounded by the transport.
 *
 * **A port, supplied by the composition root** (ADR-0058 Decision 4): the kernel
 * holds no network code, and its cases drive the whole flow with an authority
 * minted in memory. Anything it throws is the authority being unreachable; what
 * it answers is judged by `acceptTimestampReply` alone.
 */
export type RequestTimestamp = (authority: TimestampAuthority, query: Uint8Array) => Promise<Uint8Array>;

/**
 * The port for a writer built without one — unit cases, and the spec table's own
 * apply. A command that asks for a timestamp through it is refused as unreachable
 * rather than signed without one, which is the decorative defect ADR-0058 exists
 * to rule out.
 */
const NO_TIMESTAMPS: RequestTimestamp = () =>
  Promise.reject(new Error('no timestamp transport is registered with this writer'));

/**
 * The signing apply, over a timestamp port.
 *
 * `applySignDocument` is this with {@link NO_TIMESTAMPS}, so the spec table keeps
 * one apply per kind and the writer the composition registers passes the real
 * port — one function, parameterised, rather than two bodies that could drift.
 */
export function signDocumentWith(
  requestTimestamp: RequestTimestamp,
): Apply<'signpdf', 'signDocument'> {
  return async (image, command) => {
    const placed = await withSignaturePlaceholder(image, command);
    const reserved = reservedSignatureBytes(command);

    const [{ SignPdf }, { P12Signer }, { Signer }] = await Promise.all([
      import('@signpdf/signpdf'),
      import('@signpdf/signer-p12'),
      import('@signpdf/utils'),
    ]);

    /**
     * `P12Signer`, then the timestamp, then the length — inside the signer, so
     * each failure is named WHERE it happens.
     *
     * The credential's refusal is only what `P12Signer` itself throws. This apply
     * used to wrap all of `SignPdf.sign` in that name, so a signature too large for
     * its hole — `@signpdf` refuses one with a `SignPdfError` of `TYPE_INPUT`, the
     * same type as its other input refusals — would have been reported to a person
     * as a wrong password. The type cannot separate them; the call site can.
     */
    class TimestampingSigner extends Signer {
      override async sign(pdfBuffer: Buffer, signingTime?: Date): Promise<Buffer> {
        let raw: Buffer;
        try {
          // THE PASSPHRASE REACHES ONE CALL. Nothing here records it, and the
          // error carries none of it.
          raw = await new P12Signer(command.bytes, { passphrase: command.passphrase }).sign(
            pdfBuffer,
            signingTime,
          );
        } catch (cause) {
          throw new SignatureCredentialRefusedError({ cause });
        }
        const withToken =
          command.timestamp === undefined ? raw : await timestamped(raw, command.timestamp, requestTimestamp);
        if (withToken.byteLength > reserved) {
          throw new SignatureTooLargeError(withToken.byteLength, reserved);
        }
        return withToken;
      }
    }

    // NOTHING HERE IS RE-NAMED. The signer names its own refusals, and anything
    // else `SignPdf` throws — a placeholder it cannot find — is a defect, which
    // propagates and is reported as one.
    const signed = await new SignPdf().sign(Buffer.from(placed), new TimestampingSigner());

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
}

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
