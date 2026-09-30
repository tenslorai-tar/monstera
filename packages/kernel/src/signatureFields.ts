import type * as mupdf from './mupdfRaw.js';

/**
 * How deep the form tree is walked. A `/Kids` cycle is legal to write and never
 * ends; real forms nest a handful of levels.
 */
const MAX_FIELD_DEPTH = 32;

/**
 * Every signature dictionary — each `/Sig` field's `/V` — the document carries, each once.
 *
 * THE ONE WALK: `signatureRead.ts` verifies what it finds, and the writer asks it when it decides how a save is written
 * (`mupdfWriter.serialise`), so *is this document signed* has one answer rather than a second opinion there (B3a). In
 * a module of its own because the writer is what the reader opens documents through, and the two would otherwise
 * import each other.
 */
export function signatureValues(document: mupdf.PDFDocument): mupdf.PDFObject[] {
  const found: mupdf.PDFObject[] = [];
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
    found.push(signature);
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
}
