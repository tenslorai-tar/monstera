import {
  MAX_CALCULATED_NAME,
  MAX_CALCULATED_PRIORS,
  MAX_CALCULATED_TEXT,
  calculate,
  calculatedText,
  fieldNumber,
  formatFieldValue,
} from '@monstera/contract/host';
import type { FieldCalculation, FieldFormat } from '@monstera/contract';

import { fieldDictionaryOf, fieldRulesOf, qualifiedNameOf } from './fieldRules.js';
import type { PDFDocument, PDFWidget } from './mupdfRaw.js';
import { redraw } from './pageAnnotations.js';

/**
 * A form's calculations, worked out by this application's own code while it is filled (ADR-0226 Decision 6), and a
 * formatted field's shown text, drawn by it (ADR-0193 Decision 6). No script is run: a calculation is the
 * `AFSimple_Calculate` this application reads as data, and one it cannot read is a script, which keeps its value.
 */

/** One calculated field's value before a fill worked it out again: what an undo writes back, exactly. */
export interface CalculatedValue {
  readonly name: string;
  readonly text: string;
}

/** One field of the form as calculation sees it: its widgets, its value, its format, and its calculation of ours. */
interface FormField {
  readonly widgets: PDFWidget[];
  readonly format: FieldFormat | null;
  readonly calculation: FieldCalculation | null;
}

/** Every field of the form by its full name, each with all its widgets across pages, in the walk's order. */
function fieldsByName(document: PDFDocument): Map<string, FormField> {
  const found = new Map<string, FormField>();
  const pages = document.countPages();
  for (let page = 0; page < pages; page += 1) {
    for (const widget of document.loadPage(page).getWidgets()) {
      const name = widget.getName();
      const known = found.get(name);
      if (known !== undefined) {
        known.widgets.push(widget);
        continue;
      }
      const rules = fieldRulesOf(widget);
      found.set(name, { widgets: [widget], format: rules.format, calculation: rules.calculation });
    }
  }
  return found;
}

/** A field's stored text: its value, or empty. A button's value is its state's name, which no calculation reads as a number. */
function valueOf(field: FormField): string {
  const widget = field.widgets[0];
  if (widget === undefined) return '';
  const value = widget.getValue();
  return typeof value === 'string' ? value : '';
}

/**
 * The calculated fields of ours, in the form's calculation order: `/AcroForm /CO` first, as every reader works them, and
 * after it any calculation of ours the order does not name, in the walk's order, so none is left out.
 */
function calculatedInOrder(document: PDFDocument, fields: ReadonlyMap<string, FormField>): string[] {
  const ordered: string[] = [];
  const order = document.getTrailer().get('Root', 'AcroForm', 'CO');
  if (order.isArray()) {
    for (let at = 0; at < order.length; at += 1) {
      const name = qualifiedNameOf(order.get(at));
      if (fields.get(name)?.calculation !== null && fields.has(name) && !ordered.includes(name)) ordered.push(name);
    }
  }
  for (const [name, field] of fields) if (field.calculation !== null && !ordered.includes(name)) ordered.push(name);
  return ordered;
}

/** What every calculated field of ours holds now, for a fill's prior; `undefined` where there are more than a prior carries. */
export function calculatedValues(document: PDFDocument): readonly CalculatedValue[] | undefined {
  const fields = fieldsByName(document);
  const names = calculatedInOrder(document, fields);
  if (names.length > MAX_CALCULATED_PRIORS) return undefined;
  const values: CalculatedValue[] = [];
  for (const name of names) {
    const field = fields.get(name);
    if (field === undefined) continue;
    const text = valueOf(field);
    // A PRIOR THAT WOULD BE CUT is no prior: an undo would write back a part of what was there.
    if (name.length > MAX_CALCULATED_NAME || text.length > MAX_CALCULATED_TEXT) return undefined;
    values.push({ name, text });
  }
  return values;
}

/**
 * Writes a text into a field and draws what it shows: the formatted text where the field has a format this application
 * reads, which is how Acrobat writes a formatted field (the appearance shows `£1,234.50` and `/V` keeps `1234.5`). The
 * appearance is drawn from the shown text by MuPDF, then `/V` is put back to the stored text on the field's own
 * dictionary, with no redraw after it.
 */
export function writeShown(document: PDFDocument, widgets: readonly PDFWidget[], text: string, format: FieldFormat | null): void {
  const shown = format === null ? text : formatFieldValue(text, format);
  for (const widget of widgets) widget.setTextValue(shown);
  if (shown === text) return;
  // DRAWN NOW, from the shown text: a setter marks the widget for redrawing, and MuPDF redraws a marked widget when the
  // session is saved, from `/V` as it is then (measured 2026-10-10: the saved stream showed `1234.5`). A redraw here
  // clears the mark, and `/V` put back on the dictionary below sets none.
  for (const widget of widgets) redraw(widget, document);
  const first = widgets[0];
  if (first === undefined) return;
  fieldDictionaryOf(first.getObject()).put('V', document.newString(text));
}

/**
 * Works every calculation of ours out once, in the form's calculation order, each reading the values as the ones before
 * it left them; a field whose result is what it holds is not written. A source that is not a number counts as nothing.
 */
export function recalculate(document: PDFDocument): void {
  const fields = fieldsByName(document);
  for (const name of calculatedInOrder(document, fields)) {
    const field = fields.get(name);
    if (field?.calculation === null || field === undefined) continue;
    const numbers = field.calculation.fields.map((source) => {
      const from = fields.get(source);
      return from === undefined ? undefined : fieldNumber(valueOf(from), from.format);
    });
    const text = calculatedText(calculate(field.calculation.operation, numbers));
    if (text !== valueOf(field)) writeShown(document, field.widgets, text, field.format);
  }
}

/** Puts every calculated field back to what a fill's prior recorded, exactly, with nothing worked out again. */
export function restoreCalculated(document: PDFDocument, prior: readonly CalculatedValue[]): void {
  const fields = fieldsByName(document);
  for (const { name, text } of prior) {
    const field = fields.get(name);
    if (field !== undefined && valueOf(field) !== text) writeShown(document, field.widgets, text, field.format);
  }
}
