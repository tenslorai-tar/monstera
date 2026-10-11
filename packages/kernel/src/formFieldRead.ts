import { MAX_FIELD_OPTION, MAX_READ_FIELDS, choiceOf } from '@monstera/contract/host';
import type { AnnotationColour, FieldChoice, FormFieldHandle, FormFieldRead } from '@monstera/contract';
import type { PDFDocument, PDFObject, PDFWidget } from './mupdfRaw.js';

import type { MupdfSession } from './engineSeam.js';
import { faceOfFont, parseDefaultAppearance } from './fieldActions.js';
import { fieldRulesOf, nearest, qualifiedNameOf } from './fieldRules.js';
import { kindOf, onStateKeyOf } from './formFields.js';
import { withDocument } from './mupdfWriter.js';
import { frameOf, readRect } from './pageAnnotations.js';

/**
 * What a form field's properties are, read for the Properties pane (ADR-0193).
 *
 * The writer is `formFieldEdit.ts` and the grammar of a format and a calculation is `fieldActions.ts`, which both take:
 * a format written is a format read because one module holds the rule (B3a). This reads through MuPDF, as the field list
 * does, so the handle's walk position is the same walk.
 *
 * ## A HANDLE THAT NO LONGER NAMES ITS FIELD ANSWERS `null`
 *
 * The position is a place in a walk read at one version, and the name beside it is the check. A field that moved is
 * `null` here, never another field's properties, so the pane shows nothing rather than the wrong thing.
 */

/** How many characters of a tooltip or a default value cross. Past `MAX_FIELD_TOOLTIP` and `MAX_FIELD_DEFAULT`. */
const MAX_TOOLTIP = 1024;
const MAX_DEFAULT = 4096;

/** A string entry, or `null` where it is absent or not a string. */
function textOf(object: PDFObject): string | null {
  return object.isString() ? object.asString() : null;
}

/** A colour array as red, green and blue: a grey, a red-green-blue or a cyan-magenta-yellow-black, or `null` for none. */
function colourOf(array: PDFObject): AnnotationColour | null {
  if (!array.isArray()) return null;
  const parts: number[] = [];
  for (let at = 0; at < array.length; at += 1) {
    const part = array.get(at);
    parts.push(part.isNumber() ? Math.min(1, Math.max(0, part.asNumber())) : 0);
  }
  if (parts.length === 1) return [parts[0] ?? 0, parts[0] ?? 0, parts[0] ?? 0];
  if (parts.length === 3) return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (parts.length === 4) {
    const k = parts[3] ?? 0;
    return [(1 - (parts[0] ?? 0)) * (1 - k), (1 - (parts[1] ?? 0)) * (1 - k), (1 - (parts[2] ?? 0)) * (1 - k)];
  }
  return null;
}

/** The border width a widget draws with: `/BS /W`, else the third number of `/Border`, else the format's own default of 1. */
function borderWidthOf(object: PDFObject): number {
  const width = object.get('BS', 'W');
  if (width.isNumber()) return width.asNumber();
  const border = object.get('Border');
  if (border.isArray() && border.length >= 3) {
    const third = border.get(2);
    if (third.isNumber()) return third.asNumber();
  }
  return 1;
}

/**
 * The export values of a radio group's options in the order the widgets sit, or the choices of a choice field: each a
 * string, or the value AND the text shown where a document lists the two apart (`/Opt` pairs), so an edit that sends
 * them back keeps both.
 */
function optionsOf(widget: PDFWidget, object: PDFObject): readonly FieldChoice[] {
  if (widget.isRadioButton()) {
    // The group is the nearest object holding `/Kids`: the widget's parent for a group, and nothing for a lone button.
    const parent = object.get('Parent');
    const group = parent.isDictionary() ? parent : object;
    // THE GROUP'S `/Opt` IS ITS EXPORT VALUES, by position (ISO 32000-1, 12.7.4.2.4); the keys of each widget's
    // appearance are the file's own state names and are what a group carries only where it has no `/Opt`.
    const listed = group.get('Opt');
    if (listed.isArray()) {
      const named: string[] = [];
      for (let at = 0; at < listed.length; at += 1) named.push(textOf(listed.get(at)) ?? '');
      return named;
    }
    const kids = group.get('Kids');
    const values: string[] = [];
    if (kids.isArray()) {
      for (let at = 0; at < kids.length; at += 1) {
        const key = onStateKeyOf(kids.get(at));
        if (key !== undefined) values.push(key);
      }
    }
    return values;
  }
  // The engine answers the two lists apart, by position: the values a form stores, and the text a person reads.
  const values = widget.getOptions(true);
  const labels = widget.getOptions(false);
  return values.map((value, at) => choiceOf(value, labels[at] ?? value));
}

/** An entry of the AcroForm dictionary, by path. A path form, because a step off a null object has no document to ask. */
function acroForm(document: PDFDocument, ...path: [string, ...string[]]): PDFObject {
  return document.getTrailer().get('Root', 'AcroForm', ...path);
}

/** Where this field's name sits in the form's calculation order (`/CO`), by name. */
function calculationPositionOf(document: PDFDocument, name: string): number | null {
  const order = acroForm(document, 'CO');
  if (!order.isArray()) return null;
  for (let at = 0; at < order.length; at += 1) {
    if (qualifiedNameOf(order.get(at)) === name) return at;
  }
  return null;
}

/** One widget's properties. */
function readOne(document: PDFDocument, widget: PDFWidget, page: number, index: number, rect: FormFieldRead['rect']): FormFieldRead {
  const object = widget.getObject();
  const kind = kindOf(widget);
  const name = widget.getName();
  const da = textOf(nearest(object, 'DA')) ?? textOf(acroForm(document, 'DA')) ?? undefined;
  const font = parseDefaultAppearance(da);
  const baseFont = font === undefined ? undefined : acroForm(document, 'DR', 'Font', font.resource, 'BaseFont');
  const rules = fieldRulesOf(widget);
  const { format, calculation } = rules;
  const dv = nearest(object, 'DV');
  const tooltip = textOf(nearest(object, 'TU'));
  return {
    page,
    index,
    kind,
    name,
    tooltip: tooltip === null ? null : tooltip.slice(0, MAX_TOOLTIP),
    required: rules.required,
    readOnly: widget.isReadOnly(),
    defaultValue: dv.isName() ? dv.asName() : dv.isString() ? dv.asString().slice(0, MAX_DEFAULT) : null,
    font: faceOfFont(baseFont?.isName() ? baseFont.asName() : undefined, font?.resource),
    fontSize: font?.size ?? 0,
    borderColour: colourOf(object.get('MK', 'BC')),
    fillColour: colourOf(object.get('MK', 'BG')),
    borderWidth: Math.min(12, Math.max(0, borderWidthOf(object))),
    options: optionsOf(widget, object),
    multiline: kind === 'text' && widget.isMultiline(),
    rect,
    format,
    // A script is there and is not one of ours: shown as a script, kept as it is, never run (invariant 24).
    customFormat: rules.customFormat,
    calculation,
    customCalculation: rules.customCalculation,
    calculationPosition: calculation === null && !rules.customCalculation ? null : calculationPositionOf(document, name),
    alignment: alignmentOf(nearest(object, 'Q')),
    maxLength: rules.maxLength,
    comb: rules.comb,
    masked: rules.masked,
    visibility: visibilityOf(object.get('F')),
    buttonLabel: kind === 'button' ? textOf(object.get('MK', 'CA'))?.slice(0, MAX_FIELD_OPTION) ?? null : null,
  };
}

/** `/Q` as a word: 0 left, 1 centre, 2 right, and the format's default (left) for anything else. */
function alignmentOf(object: PDFObject): FormFieldRead['alignment'] {
  const quadding = object.isNumber() ? object.asNumber() : 0;
  return quadding === 1 ? 'centre' : quadding === 2 ? 'right' : 'left';
}

/** The annotation flags that decide whether a widget shows: Hidden (bit 2) wins over Print (bit 3). */
const HIDDEN = 1 << 1;
const PRINT = 1 << 2;

/** `/F` as one of the three a person chooses between. */
function visibilityOf(object: PDFObject): FormFieldRead['visibility'] {
  const flags = object.isNumber() ? object.asNumber() : 0;
  if ((flags & HIDDEN) !== 0) return 'hidden';
  return (flags & PRINT) !== 0 ? 'visible' : 'no-print';
}

/**
 * The properties of each named field, in the order named, `null` for a handle that no longer names its field.
 *
 * @param handles at most {@link MAX_READ_FIELDS}; the caller's schema bounds it, and this takes the first that many
 */
export function readFieldProperties(
  session: MupdfSession,
  handles: readonly FormFieldHandle[],
): Promise<readonly (FormFieldRead | null)[]> {
  return withDocument(session, (document) => {
    const answered: (FormFieldRead | null)[] = [];
    const pages = new Map<number, { readonly widgets: readonly PDFWidget[]; readonly rect: (widget: PDFWidget) => FormFieldRead['rect'] }>();
    for (const handle of handles.slice(0, MAX_READ_FIELDS)) {
      let loaded = pages.get(handle.page);
      if (loaded === undefined) {
        if (handle.page >= document.countPages()) {
          answered.push(null);
          continue;
        }
        const page = document.loadPage(handle.page);
        const transform = frameOf(page);
        loaded = { widgets: page.getWidgets(), rect: (widget) => (transform === null ? null : readRect(widget, transform)) };
        pages.set(handle.page, loaded);
      }
      const widget = loaded.widgets[handle.index];
      if (widget?.getName() !== handle.name) {
        answered.push(null);
        continue;
      }
      answered.push(readOne(document, widget, handle.page, handle.index, loaded.rect(widget)));
    }
    return answered;
  });
}
