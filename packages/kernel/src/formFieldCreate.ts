import { PDFRadioGroup, PDFString, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import type { PDFDocument, PDFFont, PDFPage } from '@cantoo/pdf-lib';

import type { AnnotationRect, CommandOfKind, CreatedField } from '@monstera/contract';
import { fieldNameClash, snapRotation } from '@monstera/shared';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert } from './engineSeam.js';
import { setFormat } from './formFieldEdit.js';
import { pageAt } from './pdfLibPages.js';
import { appendRevision, openForWriting } from './pdfLibSession.js';

/**
 * Creating one AcroForm field where a person drew it.
 *
 * ## Why this is pdf-lib and every other form command is MuPDF
 *
 * `docs/ARCHITECTURE.md`:388 assigns *Form fields: create* to
 * `@cantoo/pdf-lib` — *"the one concern MuPDF has no API for"* — while fill,
 * delete and flatten sit on MuPDF two rows above. That is the matrix splitting a
 * concern by **operation**, which is its own granularity rather than an
 * exception: fill and create both write field dictionaries, under different
 * writers, and each row names the writer that has the API for it.
 *
 * ## THE COORDINATE BOUNDARY, and it is the opposite of `pageAnnotations.ts`'
 *
 * That module's subject is that MuPDF's `setRect` does **not** take PDF user
 * space: it takes the page's displayed space, y down and after rotation, so
 * every rectangle crossing it converts through `PageTransform`.
 *
 * Measured 2026-09-08 (`scripts/research/formFieldCreate.mjs`), pdf-lib is the
 * other way round. `addToPage` writes `/Rect` in **raw PDF user space,
 * verbatim** — `[39.5 499.5 160.5 524.5]` for the same argument on an upright
 * page, on a `/Rotate 90` page and on one cropped to `[30 70 380 560]`,
 * identical in all three. So {@link AnnotationRect}'s frame reaches this writer
 * unchanged and **the conversion is the identity**.
 *
 * That is a fact that had to be measured on the two page shapes which could
 * falsify it. An upright page whose boxes start at the origin is the fixture on
 * which every candidate answer agrees, and it is the one an unhurried author
 * writes.
 *
 * ## Two things pdf-lib does that a caller has to undo
 *
 * **It grows the box by the border.** `PDFField.js`:258 adds the border width
 * to the requested size and re-centres, so pdf-lib's default of 1 writes a
 * rectangle outset by half a point on every side — measured across four widths,
 * where 0 writes `[40 500 160 524]` and 6 writes `[37 497 163 527]`. The
 * rectangle handed to `addToPage` is therefore inset by half the border on every
 * side ({@link insetForBorder}), so `/Rect` is the box that was drawn.
 *
 * **It turns the box about the anchor.** See {@link preImage}.
 */

/**
 * The border width every field is created with, in points.
 *
 * A new field has to be SEEN. With a width of 0 and no colours pdf-lib writes an appearance that paints nothing
 * (measured 2026-10-07: 0 dark pixels inside a new text field, tick box, radio and dropdown, and only the option text of
 * a list box), so a field was created, listed and invisible on the page. One point in dark grey is what PDF-XChange
 * draws a new field with, and the Properties pane changes it afterwards.
 */
const FIELD_BORDER = 1;

/** The border's colour: dark enough to read on white paper and on a tint. */
const FIELD_BORDER_COLOUR = rgb(0.2, 0.2, 0.2);

/** A tick box and a radio are small, so each also takes a white fill: a box the page shows through reads as nothing. */
const FIELD_FILL = rgb(1, 1, 1);

/**
 * The rectangle with the border's outset taken off, so that pdf-lib's own growth by the border lands `/Rect` on what
 * was drawn. A box too small to hold a border keeps its size and takes the largest border it can.
 */
function insetForBorder(rect: AnnotationRect, border: number): AnnotationRect {
  const half = border / 2;
  const x0 = Math.min(rect.x0, rect.x1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const y1 = Math.max(rect.y0, rect.y1);
  const dx = Math.min(half, (x1 - x0) / 4);
  const dy = Math.min(half, (y1 - y0) / 4);
  return { x0: x0 + dx, y0: y0 + dy, x1: x1 - dx, y1: y1 - dy };
}

/**
 * The `addToPage` arguments that land a widget on `rect` with its content
 * turned to match the page.
 *
 * ## Why an argument is not the rectangle
 *
 * pdf-lib rotates a widget's box **about the anchor point it is given**, so
 * passing the rectangle and a rotation writes neither. Measured 2026-09-08:
 * `{x: 40, y: 380, width: 24, height: 120}` at 90 degrees writes
 * `/Rect [-80 380 40 404]` — off the page entirely.
 *
 * ## And the rotation is not optional, which the rectangle cannot say
 *
 * A rectangle says where a field is and nothing about which way up its content
 * is drawn. On a `/Rotate 90` page a field created with no rotation lays its
 * text out along user space, which is a quarter turn from what the reader sees.
 * Measured on the rect a **landscape drag** actually produces there — `toPdf`
 * turns a 120 by 24 drag into a portrait 24 by 120 rect — with a long value so
 * the two shapes cannot tie:
 *
 * | `rotate` | ink as displayed |
 * |---|---|
 * | 0 | 3 × 22 — clipped, and lying on its side |
 * | 90 | 111 × 8 — upright |
 * | 180 | 3 × 22 |
 * | 270 | 111 × 8 |
 *
 * Three pixels of ink where 111 belong, on rotated pages only, which is exactly
 * the fixture the stage audit's item 2 says almost nobody writes.
 *
 * ## The four cases were CHECKED, not extrapolated
 *
 * They were written from the one 90-degree reading above and then run against
 * all four turns, each asserting the resulting `/Rect` equals the target. A
 * formula derived from a single turn is three assumptions wearing a
 * measurement's clothes.
 */
function preImage(
  rect: AnnotationRect,
  rotation: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const x0 = Math.min(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y1 = Math.max(rect.y0, rect.y1);
  const width = x1 - x0;
  const height = y1 - y0;
  switch (rotation) {
    case 90:
      return { x: x1, y: y0, width: height, height: width };
    case 180:
      return { x: x1, y: y1, width, height };
    case 270:
      return { x: x0, y: y1, width: height, height: width };
    default:
      // 0, AND EVERY VALUE `snapRotation` CANNOT PRODUCE. The resolver answers
      // one of four, so this is the fourth rather than a fallback — and a page
      // whose `/Rotate` is malformed arrives here as 0 because that is what the
      // engine renders it at, not because this line chose.
      return { x: x0, y: y0, width, height };
  }
}

/** The page a command names, or a named refusal: `pdfLibPages.ts`', re-exported for the callers that took it here. */
export { pageAt };

/**
 * The existing field name that stops `wanted` being created, or `undefined`.
 *
 * ## Why `getFieldMaybe` is not this question
 *
 * It answers *is there a field with exactly this name*, and that is not what
 * collides. A dot makes a **parent**: measured 2026-09-08, creating `owner`
 * beside an existing `owner.first` is refused by pdf-lib, and so is the reverse.
 * So two names collide when either is a path prefix of the other.
 *
 * **This was found by a mutation, and by tightening one assertion.** The first
 * spelling of the guard used `getFieldMaybe` alone, and the case covering the
 * prefix passed anyway — because pdf-lib refused it a moment later with a
 * message that also said *already exists*. Matching on a clause only this
 * build's message carries turned that green into a red, which is the whole of
 * why the case is written that way.
 *
 * The refusal stays here rather than being left to pdf-lib because the prefix
 * case is the one nobody expects: pdf-lib says *a field already exists with the
 * specified name: "owner"* when the name asked for was `owner` and the field in
 * the way is `owner.first`, which reads like a bug in the caller's own code.
 */
function collidingName(form: ReturnType<PDFDocument['getForm']>, wanted: string): string | undefined {
  // THE SHARED RULE (`fieldNameClash`): the surface asks it before it sends a name, and this refuses with it.
  return fieldNameClash(
    form.getFields().map((field) => field.getName()),
    wanted,
  );
}

/**
 * Puts one field of the named kind on the page.
 *
 * ## A RADIO GROUP IS FOUND OR CREATED, and the other four are always new
 *
 * A radio group is one field with several widgets, so drawing its second option
 * is this command again with the same name — which must extend the existing
 * group rather than collide with it. `getFieldMaybe` is what makes that
 * expressible without a second command kind, and the kind check beside it is
 * what stops *add an option to `applicant.name`* silently doing something.
 *
 * Every other kind refuses a name already in the form, because pdf-lib does:
 * measured, a duplicate and a name that is a **prefix** of an existing one both
 * throw, since a dot makes a parent in the field tree. Refusing here rather than
 * letting that surface means the message names the command's own problem.
 *
 * **No value is ever set.** §3's matrix puts *Form fields: fill* on MuPDF, so a
 * create that also wrote a value would be a second writer for that concern in
 * the one place it would be invisible — the document would look right.
 */
function put(
  form: ReturnType<PDFDocument['getForm']>,
  page: PDFPage,
  font: PDFFont,
  name: string,
  field: CreatedField,
  at: ReturnType<typeof preImage>,
  rotation: number,
  /** The rectangle in user space, inset for the border: what a kind built from its dictionary is written at. */
  rect: AnnotationRect,
): void {
  const drawn ={ ...at, borderWidth: FIELD_BORDER, borderColor: FIELD_BORDER_COLOUR, rotate: degrees(rotation) };
  // THE SMALL, TWO-STATE KINDS ALSO TAKE A FILL; a text field, a dropdown and a list box are drawn as an outlined box.
  const placement = field.type === 'checkbox' || field.type === 'radio' ? { ...drawn, backgroundColor: FIELD_FILL } : drawn;
  const existing = form.getFieldMaybe(name);

  if (field.type === 'radio') {
    // `instanceof`, NOT a constructor name. A name comparison is a string that
    // a bundler's mangling can change without anything failing to compile, and
    // the failure would be *every existing group refuses its second option*.
    if (existing !== undefined && !(existing instanceof PDFRadioGroup)) {
      throw new Error(
        `A field called "${name}" already exists and is not a radio group, so this option ` +
          'cannot join it. Radio options share one field; every other kind needs a name of ' +
          'its own.',
      );
    }
    const group = existing === undefined ? form.createRadioGroup(name) : form.getRadioGroup(name);
    group.addOptionToPage(field.option, page, placement);
    return;
  }

  const clash = collidingName(form, name);
  if (clash !== undefined) {
    throw new Error(
      `A field called "${name}" cannot be created because this document already has ` +
        `"${clash}". A dot in a name makes a parent in the field tree, so two names collide ` +
        'when either is a path prefix of the other, not only when they are equal.',
    );
  }

  switch (field.type) {
    case 'text':
      form.createTextField(name).addToPage(page, { ...placement, font });
      return;
    case 'date': {
      // A TEXT FIELD THAT CARRIES A DATE FORMAT, written by the edit writer's own `setFormat` (B3a), so a reader shows
      // the date in the pattern and this application checks it where it is filled.
      const date = form.createTextField(name);
      date.addToPage(page, { ...placement, font });
      setFormat(date, { kind: 'date', pattern: field.pattern });
      return;
    }
    case 'button':
      // NO ACTION: what a button does is a script or a submission, neither of which this application writes.
      form.createButton(name).addToPage(field.label, page, { ...placement, font });
      return;
    case 'signature':
      putSignatureField(form, page, name, rect, rotation);
      return;
    case 'checkbox':
      form.createCheckBox(name).addToPage(page, placement);
      return;
    case 'dropdown': {
      const dropdown = form.createDropdown(name);
      dropdown.addOptions([...field.options]);
      dropdown.addToPage(page, { ...placement, font });
      return;
    }
    case 'listbox': {
      const listbox = form.createOptionList(name);
      listbox.addOptions([...field.options]);
      listbox.addToPage(page, { ...placement, font });
      return;
    }
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

/**
 * A signature field: the empty place a signature is later put (ADR-0226 Decision 13).
 *
 * pdf-lib has a reader for one (`PDFSignature`) and no factory, so it is built from the dictionary as ISO 32000-1
 * 12.7.4.5 writes it: a widget merged with its field, `/FT /Sig`, its name, its place and the page it is on, added to
 * `/AcroForm /Fields` and to the page's `/Annots`. It is DRAWN, with the border and white fill every new field has,
 * because a field without an appearance is one a reader shows nowhere (measured for the other kinds on 2026-10-07),
 * and its `/MK /R` says how far it is turned, as pdf-lib writes it for the kinds it makes.
 */
function putSignatureField(
  form: ReturnType<PDFDocument['getForm']>,
  page: PDFPage,
  name: string,
  rect: AnnotationRect,
  rotation: number,
): void {
  const context = form.doc.context;
  const x0 = Math.min(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const width = Math.abs(rect.x1 - rect.x0);
  const height = Math.abs(rect.y1 - rect.y0);
  const half = FIELD_BORDER / 2;
  // A WHITE BOX AND ITS BORDER, drawn in the rectangle's own space: it looks the same at every turn of the page, so no
  // turning matrix is owed, where text drawn in it would need one.
  const drawing =
    `q 1 1 1 rg 0 0 ${String(width)} ${String(height)} re f ` +
    `0.2 0.2 0.2 RG ${String(FIELD_BORDER)} w ${String(half)} ${String(half)} ${String(width - FIELD_BORDER)} ${String(height - FIELD_BORDER)} re S Q`;
  const appearance = context.stream(drawing, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, width, height] });
  const widget = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of(name),
    Rect: [x0, y0, x0 + width, y0 + height],
    F: 4,
    P: page.ref,
    BS: { W: FIELD_BORDER },
    MK: { BC: [0.2, 0.2, 0.2], BG: [1, 1, 1], R: rotation },
    AP: { N: context.register(appearance) },
  });
  const ref = context.register(widget);
  form.acroForm.addField(ref);
  page.node.addAnnot(ref);
}

/**
 * Capture — nothing to capture, and the reason is not the watermark's.
 *
 * A page that has been drawn on has no recordable prior state because restoring
 * it means restoring its whole content stream. A create is smaller than that:
 * the prior state is *this field did not exist*, and an inverse spelt *remove
 * the field called N* would be four words on the wire.
 *
 * **It is still not invertible, and the measurement is why.** A create on a
 * document with no `/AcroForm` mints one — measured 2026-09-08, `/Fields` gains
 * the field and the catalog gains the form — so removing the field afterwards
 * leaves a document that is not the one this command was handed. An inverse
 * that restores *almost* the prior state is worse than none, because undo is
 * where a person expects exactness.
 *
 * `commandDeclarations.ts` anticipated this axis in prose: `watermarkPages`
 * records that the byte-image family is *"deliberately NOT a type constraint:
 * §3's matrix assigns form-field creation to pdf-lib, and that is plausibly
 * invertible."* It is plausible and it is not free, and the checkpoint the bus
 * already holds costs nothing.
 */
export const captureCreateFormField: (
  command: CommandOfKind<'createFormField'>,
) => Promise<CaptureResult<never>> = (_command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a create on a document with no /AcroForm mints one, so removing the field afterwards ' +
      'leaves a document that is not the one this command was handed; undo restores the ' +
      'checkpoint instead',
  });

/**
 * Invert — **unreachable by the type**, and present because the table's shape
 * requires it.
 *
 * `CommandPrior['createFormField']` is `never`, so nothing can construct an
 * argument for the `inverse` parameter. `invertWatermarkPages` is the same shape
 * for the same reason; the throw is what a function with an uninhabited
 * parameter has instead of a body.
 */
export const invertCreateFormField: Invert<'pdf-lib', 'createFormField'> = (_image, _inverse) => {
  throw new Error(
    'createFormField has no inverse and this is unreachable: its prior state is `never`, so no ' +
      'caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Creates the field and returns the new document.
 *
 * The rotation is read from the page and snapped through the **one resolver**
 * (`snapRotation`, `@monstera/shared`), rather than taken from pdf-lib's
 * `getRotation`, which answers the raw `/Rotate`. A page carrying `45` is
 * rendered at 90 by the engine, and a field placed as though it were 0 would sit
 * a quarter turn away from everything else on the page.
 */
export const applyCreateFormField: Apply<'pdf-lib', 'createFormField'> = async (image, command) => {
  const document = await openForWriting(image);
  const page = pageAt(document, command.page);
  const rotation = snapRotation(page.getRotation().angle);
  const font = await document.embedFont(StandardFonts.Helvetica);

  // ONE FORM, RESOLVED ONCE, and the loop is what makes accepting twenty
  // detected candidates one decision rather than twenty. `put` refuses a
  // colliding name against the form as it stands, so a batch naming the same
  // field twice is refused on the second — mid-way through, which is safe here
  // and not by luck: this apply builds a **new byte image** from the one it was
  // handed, so a throw leaves the caller's bytes untouched by construction.
  const form = document.getForm();
  for (const placement of command.fields) {
    const inset = insetForBorder(placement.rect, FIELD_BORDER);
    put(form, page, font, placement.name, placement.field, preImage(inset, rotation), rotation, inset);
  }

  // NO APPEARANCE PASS. `updateFieldAppearances` regenerates every field in the
  // form, and `addToPage` has already built this one's: measured 2026-09-08,
  // 720 marked pixels inside the field's own box either way, against 576 for a
  // field created with no value — so the count can see the text and the pass
  // changes nothing. Running it anyway would put this command's font in front of
  // fields it never named.
  //
  // AND THE APPENDED ROUTE RUNS NONE (ADR-0127): pdf-lib turns the pass off for an
  // incremental save, which is what this command already wanted.
  return appendRevision(document);
};
