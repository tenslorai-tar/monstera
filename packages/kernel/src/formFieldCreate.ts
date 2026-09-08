import { PDFRadioGroup, StandardFonts, degrees } from '@cantoo/pdf-lib';
import type { PDFDocument, PDFFont, PDFPage } from '@cantoo/pdf-lib';

import type { AnnotationRect, CommandOfKind, CreatedField } from '@monstera/contract';
import { snapRotation } from '@monstera/shared';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage, Invert } from './engineSeam.js';
import { openForWriting } from './pdfLibSession.js';

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
 * where 0 writes `[40 500 160 524]` and 6 writes `[37 497 163 527]`. Every
 * `addToPage` here passes {@link NO_BORDER}.
 *
 * **It turns the box about the anchor.** See {@link preImage}.
 */

/**
 * The border width every field is created with, and why it is zero.
 *
 * Not a style choice. pdf-lib's default of 1 makes `/Rect` the drawn box outset
 * by half a point, so a person's rectangle and the document's rectangle differ
 * by an amount nobody asked for and nobody can see — which is worse than a
 * visible difference, because there is nothing to notice.
 *
 * A field's border is an appearance a *style* control would choose, and the
 * FEATURES row for that is where it becomes a value a person picks. This
 * follows the shape the watermark and background rows took: a command field that
 * exists and a control that does not, rather than a schema that has to grow.
 */
const NO_BORDER = 0;

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

/**
 * The page a command names, or a named refusal.
 *
 * `applyWatermarkPages`' shape and its wording, because a page index out of
 * range is one refusal whatever the command does with the page.
 */
function pageAt(document: PDFDocument, index: number): PDFPage {
  const pages = document.getPages();
  const page = pages[index];
  if (!Number.isInteger(index) || index < 0 || page === undefined) {
    throw new RangeError(
      `Page ${String(index)} is outside this document, which has ${String(pages.length)} ` +
        'page(s). Page indices are zero-based.',
    );
  }
  return page;
}

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
  for (const field of form.getFields()) {
    const existing = field.getName();
    if (
      existing === wanted ||
      existing.startsWith(`${wanted}.`) ||
      wanted.startsWith(`${existing}.`)
    ) {
      return existing;
    }
  }
  return undefined;
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
): void {
  const placement = { ...at, borderWidth: NO_BORDER, rotate: degrees(rotation) };
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
  image: ByteImage,
  command: CommandOfKind<'createFormField'>,
) => Promise<CaptureResult<never>> = (_image, _command) =>
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
    put(form, page, font, placement.name, placement.field, preImage(placement.rect, rotation), rotation);
  }

  // NO APPEARANCE PASS. `updateFieldAppearances` regenerates every field in the
  // form, and `addToPage` has already built this one's: measured 2026-09-08,
  // 720 marked pixels inside the field's own box either way, against 576 for a
  // field created with no value — so the count can see the text and the pass
  // changes nothing. Running it anyway would put this command's font in front of
  // fields it never named.
  //
  // NO SAVE OPTIONS either, for `applyWatermarkPages`' reason: `updateMetadata`
  // is a load option and `openForWriting` is where it is pinned.
  return document.save();
};
