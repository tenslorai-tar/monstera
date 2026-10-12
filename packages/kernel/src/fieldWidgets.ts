import { FIELD_FAMILY_MARKER } from './fieldFamily.js';
import { borderStyleOf, fieldDictionaryOf, nearest } from './fieldRules.js';
import type { PDFDocument, PDFObject, PDFWidget } from './mupdfRaw.js';
import { redraw } from './pageAnnotations.js';

/**
 * Every widget of one field, on whichever page each sits, and the redraw a field in a real family needs after its value
 * changes ([ADR-0229](../../../docs/DECISIONS/0229-a-form-field-in-a-real-font-has-an-appearance-monstera-draws.md)).
 *
 * ## Why a marked field is redrawn now and not at the save
 *
 * MuPDF's value setters mark a widget, and MuPDF redraws a marked widget when the session is saved (measured 2026-10-10,
 * `writeShown`'s note). That redraw is the engine's alone, so a value it draws is in Helvetica: a field carrying the family
 * is redrawn here, through `redraw`, whose finishing step draws it in its family and which leaves no mark behind.
 */

/** Every page's object number and its index: how a widget's `/P` is turned into a page to load. */
function pageNumbers(document: PDFDocument): ReadonlyMap<number, number> {
  const numbers = new Map<number, number>();
  for (let at = 0; at < document.countPages(); at += 1) {
    const page = document.findPage(at);
    if (page.isIndirect()) numbers.set(page.asIndirect(), at);
  }
  return numbers;
}

/** The same object, by number: two handles on one indirect dictionary. */
function same(one: PDFObject, other: PDFObject): boolean {
  return one.isIndirect() && other.isIndirect() && one.asIndirect() === other.asIndirect();
}

/**
 * The widgets of the field `widget` belongs to: its field's kids, or the field itself where the two are one dictionary, each
 * found on the page its `/P` names. `widget` is always among them, so a kid with no `/P` costs only itself.
 */
export function widgetsOfField(document: PDFDocument, widget: PDFWidget): PDFWidget[] {
  const field = fieldDictionaryOf(widget.getObject());
  const kids = field.get('Kids');
  const dictionaries = kids.isArray() ? Array.from({ length: kids.length }, (_unused, at) => kids.get(at)) : [field];
  const pageOf = dictionaries.length > 1 ? pageNumbers(document) : new Map<number, number>();
  const found: PDFWidget[] = [widget];
  for (const dictionary of dictionaries) {
    if (same(dictionary, widget.getObject())) continue;
    const page = dictionary.get('P');
    const number = page.isIndirect() ? pageOf.get(page.asIndirect()) : undefined;
    if (number === undefined) continue;
    const sibling = document
      .loadPage(number)
      .getWidgets()
      .find((each) => same(each.getObject(), dictionary));
    if (sibling !== undefined) found.push(sibling);
  }
  return found;
}

/**
 * Whether Monstera draws this field (ADR-0229, ADR-0230, ADR-0231): it carries a real family, read up the field's ancestry as
 * every inherited key is, or it is a list box, whose options MuPDF never draws, or a text field or a dropdown whose border is
 * not solid. `fieldFaces.ts`' `setAside` decides the drawing by the same three facts.
 */
export function drawnByMonstera(widget: PDFWidget): boolean {
  if (nearest(widget.getObject(), FIELD_FAMILY_MARKER).isString() || widget.isListBox()) return true;
  return (widget.isText() || widget.isComboBox()) && borderStyleOf(widget.getObject()) !== 'solid';
}

/** Redraws every widget of `widget`'s field where Monstera draws it; any other field is left to MuPDF. */
export function redrawFamily(document: PDFDocument, widget: PDFWidget): boolean {
  if (!drawnByMonstera(widget)) return false;
  for (const each of widgetsOfField(document, widget)) redraw(each, document);
  return true;
}
