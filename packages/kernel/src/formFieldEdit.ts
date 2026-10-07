import {
  EncryptedPDFError,
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFTextField,
  StandardFonts,
} from '@cantoo/pdf-lib';
import type { PDFDocument, PDFField, PDFFont, PDFPage } from '@cantoo/pdf-lib';

import { choiceLabelOf, choiceValueOf } from '@monstera/contract/host';
import type { AnnotationRect, CommandOfKind, FieldChoice, FieldFormat, FormFieldHandle, FormFieldProperties } from '@monstera/contract';
import { type FieldEditReason, fieldNameClash } from '@monstera/shared';

import type { FieldFace } from './fieldActions.js';
import {
  calculationScript,
  faceOfFont,
  formatScripts,
  parseCalculation,
  parseDefaultAppearance,
  parseFormat,
  withFontSize,
} from './fieldActions.js';
import { type PageFrame, placeOnPage, rotationOf } from './fieldPlacement.js';
import { pageAt } from './formFieldCreate.js';
import { pagesOf } from './pageScope.js';
import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert } from './engineSeam.js';
import { appendRevision, openForWriting } from './pdfLibSession.js';

/**
 * Changing a form field that already exists, copying one onto other pages, and setting the order the Tab key walks
 * a page's fields (ADR-0193).
 *
 * ## Written by pdf-lib for `createFormField`'s reason
 *
 * The field's own dictionary is the concern. MuPDF has setters for a value and for few of the properties named here, and
 * the fill stays MuPDF's: the one place the two meet is a DEFAULT value, which is `/DV` and never `/V`.
 *
 * ## A change is the members it names (a handle is a position and a name)
 *
 * Every member of {@link FormFieldProperties} is optional and a member that is present is set. A handle is a CHECK and not
 * a key: the widget is found by its position in the page's widget walk, and the field that owns it must still carry the
 * name the renderer read, so a walk that has moved under the person is refused and never edited.
 *
 * ## Appearances are rebuilt only for what changes how a field LOOKS
 *
 * A field whose tooltip alone changed keeps its appearance stream byte for byte (preserve, never drop). A face, a size, a
 * border, a fill, a size of box or a list of choices regenerates THAT field's appearance and no other's: pdf-lib's
 * form-wide pass would put this command's font in front of fields it never named.
 */

/** Why an edit was refused, each the person's to act on and none a defect: the one list `@monstera/shared` holds. */
export type FieldEditRefusal = FieldEditReason;

/** A refusal of one of the three commands, carrying the code the surface reads. */
export class FieldEditRefusedError extends Error {
  public constructor(
    public readonly reason: FieldEditRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'FieldEditRefusedError';
  }
}

/**
 * The document, opened for writing, or the refusal that says why it cannot be.
 *
 * pdf-lib cannot read an encrypted file and says so by throwing, which crosses the engine host's boundary as an
 * unexplained failure. An encrypted document is one this writer cannot change, and a person is told so in words rather
 * than being shown an incident.
 */
async function open(image: Parameters<typeof openForWriting>[0]): Promise<PDFDocument> {
  try {
    return await openForWriting(image);
  } catch (thrown) {
    if (thrown instanceof EncryptedPDFError) {
      throw new FieldEditRefusedError('encrypted', 'This document is encrypted, and form fields cannot be changed in an encrypted document.');
    }
    throw thrown;
  }
}

const WIDGET = PDFName.of('Widget');
const SUBTYPE = PDFName.of('Subtype');
const AA = PDFName.of('AA');

/** The widget at `index` of the page's widget walk, in the order the engine walks them: the `/Annots` order, widgets only. */
function widgetAt(page: PDFPage, index: number): PDFDict | undefined {
  const annots = page.node.Annots();
  if (annots === undefined) return undefined;
  let seen = 0;
  for (let at = 0; at < annots.size(); at += 1) {
    const dict = annots.lookupMaybe(at, PDFDict);
    if (dict === undefined) continue;
    if (dict.lookup(SUBTYPE) !== WIDGET) continue;
    if (seen === index) return dict;
    seen += 1;
  }
  return undefined;
}

/** A located handle: the field that owns the widget, and the widget. */
interface Located {
  readonly field: PDFField;
  readonly widget: PDFDict;
  readonly page: PDFPage;
}

function locate(document: PDFDocument, handle: FormFieldHandle): Located {
  const pages = document.getPages();
  const page = pages[handle.page];
  const widget = page === undefined ? undefined : widgetAt(page, handle.index);
  if (page === undefined || widget === undefined) {
    throw new FieldEditRefusedError('not-found', `Page ${String(handle.page)} has no field at position ${String(handle.index)}.`);
  }
  const field = document
    .getForm()
    .getFields()
    .find((candidate) => candidate.acroField.getWidgets().some((each) => each.dict === widget));
  if (field?.getName() !== handle.name) {
    throw new FieldEditRefusedError(
      'not-found',
      `The field at position ${String(handle.index)} of page ${String(handle.page)} is not "${handle.name}", so the document has moved since the list was read.`,
    );
  }
  return { field, widget, page };
}

/** A text string as the file stores it: UTF-16 with a byte order mark where it is not plain, so any character is kept. */
function text(value: string): PDFHexString {
  return PDFHexString.fromText(value);
}

type Face = FieldFace;

/** The standard face a default appearance names, read through the form's resources, or Helvetica for anything else. */
function faceOf(form: ReturnType<PDFDocument['getForm']>, da: string | undefined): Face {
  const resource = parseDefaultAppearance(da)?.resource;
  return faceOfFont(resource === undefined ? undefined : fontNamed(form, resource), resource);
}

function fontNamed(form: ReturnType<PDFDocument['getForm']>, resource: string): string | undefined {
  const fonts = form.acroForm.dict.lookupMaybe(PDFName.of('DR'), PDFDict)?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const dict = fonts?.lookupMaybe(PDFName.of(resource), PDFDict);
  return dict?.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText();
}

const FACE_FONT: Readonly<Record<Face, StandardFonts>> = {
  helvetica: StandardFonts.Helvetica,
  times: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
};

/** Puts the font in the AcroForm's default resources under its own name, so a default appearance that names it resolves. */
function registerFont(form: ReturnType<PDFDocument['getForm']>, font: PDFFont): void {
  const context = form.acroForm.dict.context;
  let resources = form.acroForm.dict.lookupMaybe(PDFName.of('DR'), PDFDict);
  if (resources === undefined) {
    resources = context.obj({});
    form.acroForm.dict.set(PDFName.of('DR'), resources);
  }
  let fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (fonts === undefined) {
    fonts = context.obj({});
    resources.set(PDFName.of('Font'), fonts);
  }
  fonts.set(PDFName.of(font.name), font.ref);
}

function sizeOf(da: string | undefined): number {
  return parseDefaultAppearance(da)?.size ?? 0;
}

function colourArray(colour: readonly [number, number, number]): number[] {
  return [colour[0], colour[1], colour[2]];
}

/** The member a person's change reaches in a widget's `/MK`, set or taken away. */
function setCharacteristic(widget: PDFDict, key: 'BC' | 'BG', colour: readonly [number, number, number] | null): void {
  const context = widget.context;
  let mk = widget.lookupMaybe(PDFName.of('MK'), PDFDict);
  if (colour === null) {
    mk?.delete(PDFName.of(key));
    return;
  }
  if (mk === undefined) {
    mk = context.obj({});
    widget.set(PDFName.of('MK'), mk);
  }
  mk.set(PDFName.of(key), context.obj(colourArray(colour)));
}

function setBorderWidth(widget: PDFDict, width: number): void {
  const context = widget.context;
  let bs = widget.lookupMaybe(PDFName.of('BS'), PDFDict);
  if (bs === undefined) {
    bs = context.obj({});
    widget.set(PDFName.of('BS'), bs);
  }
  bs.set(PDFName.of('W'), PDFNumber.of(width));
}

function rectOf(rect: AnnotationRect): { x: number; y: number; width: number; height: number } {
  const x = Math.min(rect.x0, rect.x1);
  const y = Math.min(rect.y0, rect.y1);
  return { x, y, width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) };
}

/** A JavaScript action dictionary holding `script`, which is DATA here and is never run (invariant 24). */
function scriptAction(context: PDFDict['context'], script: string): PDFDict {
  return context.obj({ S: PDFName.of('JavaScript'), JS: text(script) });
}

function scriptOf(action: PDFDict | undefined): string | undefined {
  const js = action?.lookup(PDFName.of('JS'));
  if (js instanceof PDFString || js instanceof PDFHexString) return js.decodeText();
  return undefined;
}

/** The terminal field's additional-actions dictionary, made if it is absent. */
function additionalActions(field: PDFField): PDFDict {
  const dict = field.acroField.dict;
  let aa = dict.lookupMaybe(AA, PDFDict);
  if (aa === undefined) {
    aa = dict.context.obj({});
    dict.set(AA, aa);
  }
  return aa;
}

/**
 * Writes or removes a field's format.
 *
 * `null` removes only a format this application wrote: a custom script a person's own tooling put there is not one it can
 * show, and taking it away because a pane said *none* would drop what the file held.
 */
function setFormat(field: PDFField, format: FieldFormat | null): void {
  const aa = additionalActions(field);
  if (format === null) {
    const existing = scriptOf(aa.lookupMaybe(PDFName.of('F'), PDFDict));
    if (existing !== undefined && parseFormat(existing) !== undefined) {
      aa.delete(PDFName.of('F'));
      aa.delete(PDFName.of('K'));
    }
    return;
  }
  const scripts = formatScripts(format);
  aa.set(PDFName.of('F'), scriptAction(aa.context, scripts.format));
  aa.set(PDFName.of('K'), scriptAction(aa.context, scripts.keystroke));
}

function calculationOrder(form: ReturnType<PDFDocument['getForm']>): PDFArray {
  const dict = form.acroForm.dict;
  let order = dict.lookupMaybe(PDFName.of('CO'), PDFArray);
  if (order === undefined) {
    order = dict.context.obj([]);
    dict.set(PDFName.of('CO'), order);
  }
  return order;
}

function orderIndexOf(order: PDFArray, ref: PDFRef): number {
  for (let at = 0; at < order.size(); at += 1) {
    const entry = order.get(at);
    if (entry instanceof PDFRef && entry.tag === ref.tag) return at;
  }
  return -1;
}

function setCalculation(
  form: ReturnType<PDFDocument['getForm']>,
  field: PDFField,
  calculation: FormFieldProperties['calculation'],
): void {
  const aa = additionalActions(field);
  const order = calculationOrder(form);
  const at = orderIndexOf(order, field.ref);
  if (calculation === null || calculation === undefined) {
    const existing = scriptOf(aa.lookupMaybe(PDFName.of('C'), PDFDict));
    if (existing !== undefined && parseCalculation(existing) !== undefined) {
      aa.delete(PDFName.of('C'));
      if (at >= 0) order.remove(at);
    }
    return;
  }
  aa.set(PDFName.of('C'), scriptAction(aa.context, calculationScript(calculation)));
  if (at < 0) order.push(field.ref);
}

function moveInCalculationOrder(form: ReturnType<PDFDocument['getForm']>, field: PDFField, position: number): void {
  const order = calculationOrder(form);
  const at = orderIndexOf(order, field.ref);
  if (at < 0) return;
  order.remove(at);
  order.insert(Math.min(position, order.size()), field.ref);
}

function setDefault(field: PDFField, value: string | null): void {
  const dict = field.acroField.dict;
  if (value === null) {
    dict.delete(PDFName.of('DV'));
    return;
  }
  // A tick box's and a radio group's default is the NAME of a state and a text or a choice's is a string.
  const isButton = field instanceof PDFCheckBox || field instanceof PDFRadioGroup;
  dict.set(PDFName.of('DV'), isButton ? PDFName.of(value) : text(value));
}

function setOptions(field: PDFField, choices: readonly FieldChoice[]): void {
  const options = choices.map(choiceValueOf);
  if (new Set(options).size !== options.length) {
    throw new FieldEditRefusedError('options-duplicate', 'Two choices carry the same value, so a reader could not tell them apart.');
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    // EACH CHOICE KEEPS ITS TEXT: `/Opt` is written as [value, text] pairs, as the acroform layer writes them, where the
    // field's own `setOptions` takes strings and would write the value twice, dropping every text a document listed apart.
    field.acroField.setOptions(
      choices.map((choice) => ({
        value: text(choiceValueOf(choice)),
        display: text(choiceLabelOf(choice)),
      })),
    );
    return;
  }
  if (field instanceof PDFRadioGroup) {
    if (choices.some((choice) => typeof choice !== 'string')) {
      throw new FieldEditRefusedError(
        'options-radio-labels',
        'A radio group names its options by value alone, so a separate text to show for one cannot be kept.',
      );
    }
    const widgets = field.acroField.getWidgets();
    if (widgets.length !== options.length) {
      throw new FieldEditRefusedError(
        'options-count',
        `This group has ${String(widgets.length)} options and ${String(options.length)} values were given.`,
      );
    }
    // A GROUP WITH `/Opt` NAMES ITS EXPORT VALUES THERE, by position, and its widgets' state names are the file's own
    // (`formFieldRead.ts` reads the same entry): the values are replaced and no appearance is touched.
    const listed = field.acroField.dict.lookupMaybe(PDFName.of('Opt'), PDFArray);
    if (listed !== undefined) {
      field.acroField.dict.set(PDFName.of('Opt'), field.acroField.dict.context.obj(options.map((value) => text(value))));
      return;
    }
    // Two passes, so an option given the value another one holds is not read as already renamed.
    const was = widgets.map((widget) => widget.getOnValue());
    widgets.forEach((widget, at) => {
      const old = was[at];
      const wanted = options[at];
      if (old === undefined || wanted === undefined || old.decodeText() === wanted) return;
      renameOnState(widget.dict, old, PDFName.of(wanted));
      const current = field.acroField.dict.get(PDFName.of('V'));
      if (current instanceof PDFName && current.decodeText() === old.decodeText()) field.acroField.dict.set(PDFName.of('V'), PDFName.of(wanted));
    });
    return;
  }
  throw new FieldEditRefusedError('not-found', `A ${field.constructor.name} has no choices to set.`);
}

/** Renames the appearance state a widget turns on to, in its normal and down appearance dictionaries and its `/AS`. */
function renameOnState(widget: PDFDict, old: PDFName, wanted: PDFName): void {
  const ap = widget.lookupMaybe(PDFName.of('AP'), PDFDict);
  for (const key of ['N', 'D']) {
    const states = ap?.lookupMaybe(PDFName.of(key), PDFDict);
    const entry = states?.get(old);
    if (states === undefined || entry === undefined) continue;
    states.delete(old);
    states.set(wanted, entry);
  }
  const state = widget.get(PDFName.of('AS'));
  if (state instanceof PDFName && state.decodeText() === old.decodeText()) widget.set(PDFName.of('AS'), wanted);
}

/** Renames a field, keeping the parent it already has. */
function rename(form: ReturnType<PDFDocument['getForm']>, field: PDFField, wanted: string): void {
  const current = field.getName();
  if (current === wanted) return;
  const others = form
    .getFields()
    .filter((each) => each !== field)
    .map((each) => each.getName());
  const clash = fieldNameClash(others, wanted);
  if (clash !== undefined) {
    throw new FieldEditRefusedError('name-taken', `A field called "${wanted}" cannot be named, because this document already has "${clash}".`);
  }
  const parent = field.acroField.getParent()?.getFullyQualifiedName();
  const prefix = parent === undefined ? '' : `${parent}.`;
  const partial = wanted.startsWith(prefix) ? wanted.slice(prefix.length) : undefined;
  if (partial === undefined || partial === '' || partial.includes('.')) {
    throw new FieldEditRefusedError(
      'name-parent',
      `"${wanted}" would move this field into another group, which a rename does not do. Keep ${prefix === '' ? 'a name without a dot' : `the start "${prefix}"`}.`,
    );
  }
  field.acroField.setPartialName(partial);
}

/** What changing a field's members asks of its appearance. */
function changesLook(set: FormFieldProperties): boolean {
  return (
    set.font !== undefined ||
    set.fontSize !== undefined ||
    set.borderColour !== undefined ||
    set.fillColour !== undefined ||
    set.borderWidth !== undefined ||
    set.options !== undefined ||
    set.multiline !== undefined ||
    set.rect !== undefined
  );
}

function regenerate(field: PDFField, font: PDFFont, da: { readonly size: number }): void {
  if (field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList) {
    field.updateAppearances(font);
    // pdf-lib writes the size it FITTED into the default appearance, which turns the reader's automatic size (0) into a
    // fixed one. A field that was automatic stays automatic.
    if (da.size === 0) {
      for (const widget of field.acroField.getWidgets()) {
        const own = widget.getDefaultAppearance();
        if (own !== undefined) widget.setDefaultAppearance(withFontSize(own, 0));
      }
      field.acroField.setDefaultAppearance(withFontSize(field.acroField.getDefaultAppearance(), 0));
    }
    return;
  }
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) field.updateAppearances();
}

/** Applies each edit and returns the new document. */
export const applyEditFormFields: Apply<'pdf-lib', 'editFormFields'> = async (image, command) => {
  const document = await open(image);
  const form = document.getForm();

  // EVERY HANDLE IS RESOLVED BEFORE ANYTHING CHANGES: a rename or a move must not shift what a later handle names.
  const edits: readonly { readonly field: FormFieldHandle; readonly set: FormFieldProperties }[] = command.edits;
  const located = edits.map((edit) => ({ edit, at: locate(document, edit.field) }));
  const fonts = new Map<Face, PDFFont>();
  const embed = async (face: Face): Promise<PDFFont> => {
    const held = fonts.get(face);
    if (held !== undefined) return held;
    const made = await document.embedFont(FACE_FONT[face]);
    registerFont(form, made);
    fonts.set(face, made);
    return made;
  };
  const regenerated = new Map<PDFField, { face: Face; size: number }>();

  for (const { edit, at } of located) {
    const { set } = edit;
    const { field, widget } = at;
    const before = widget.lookupMaybe(PDFName.of('DA'), PDFString)?.asString() ?? field.acroField.getDefaultAppearance();
    const face = set.font ?? faceOf(form, before);
    const size = set.fontSize ?? sizeOf(before);

    if (set.name !== undefined) rename(form, field, set.name);
    if (set.tooltip !== undefined) {
      if (set.tooltip === null) field.acroField.dict.delete(PDFName.of('TU'));
      else field.acroField.dict.set(PDFName.of('TU'), text(set.tooltip));
    }
    if (set.required !== undefined) {
      if (set.required) field.enableRequired();
      else field.disableRequired();
    }
    if (set.readOnly !== undefined) {
      if (set.readOnly) field.enableReadOnly();
      else field.disableReadOnly();
    }
    if (set.defaultValue !== undefined) setDefault(field, set.defaultValue);
    if (set.options !== undefined) setOptions(field, set.options);
    if (set.multiline !== undefined && field instanceof PDFTextField) {
      if (set.multiline) field.enableMultiline();
      else field.disableMultiline();
    }
    if (set.fontSize !== undefined || set.font !== undefined) {
      field.acroField.setDefaultAppearance(withFontSize(field.acroField.getDefaultAppearance(), size));
      const own = widget.lookupMaybe(PDFName.of('DA'), PDFString);
      if (own !== undefined) widget.set(PDFName.of('DA'), PDFString.of(withFontSize(own.asString(), size)));
    }
    if (set.borderColour !== undefined) setCharacteristic(widget, 'BC', set.borderColour);
    if (set.fillColour !== undefined) setCharacteristic(widget, 'BG', set.fillColour);
    if (set.borderWidth !== undefined) setBorderWidth(widget, set.borderWidth);
    if (set.rect !== undefined) {
      const box = rectOf(set.rect);
      widget.set(PDFName.of('Rect'), document.context.obj([box.x, box.y, box.x + box.width, box.y + box.height]));
    }
    if (set.format !== undefined) setFormat(field, set.format);
    if (set.calculation !== undefined) setCalculation(form, field, set.calculation);
    if (set.calculationPosition !== undefined) moveInCalculationOrder(form, field, set.calculationPosition);

    if (changesLook(set) && !(field instanceof PDFSignature)) regenerated.set(field, { face, size });
  }

  for (const [field, look] of regenerated) {
    regenerate(field, await embed(look.face), { size: look.size });
  }
  return appendRevision(document);
};

/** Shallow-copies a dictionary and deep-copies the inline dictionaries and arrays inside it, so the copy shares no mutable part. */
function copyDict(source: PDFDict): PDFDict {
  const copy = source.clone();
  for (const [key, value] of copy.entries()) {
    if (value instanceof PDFDict) copy.set(key, copyDict(value));
    else if (value instanceof PDFArray) copy.set(key, copyArray(value));
  }
  return copy;
}

function copyArray(source: PDFArray): PDFArray {
  const copy = source.clone();
  for (let at = 0; at < copy.size(); at += 1) {
    const value = copy.get(at);
    if (value instanceof PDFDict) copy.set(at, copyDict(value));
    else if (value instanceof PDFArray) copy.set(at, copyArray(value));
  }
  return copy;
}

/** The first name `base` makes that no field in the form clashes with. */
function freeName(taken: readonly string[], base: string): string {
  let candidate = base;
  for (let attempt = 2; fieldNameClash(taken, candidate) !== undefined; attempt += 1) candidate = `${base}_${String(attempt)}`;
  return candidate;
}

/** A page's visible area and how it is turned, as {@link placeOnPage} reads it. */
function visibleFrameOf(page: PDFPage): PageFrame {
  const box = page.getCropBox();
  return { x: box.x, y: box.y, width: box.width, height: box.height, rotation: rotationOf(page.getRotation().angle) };
}

/** A widget's `/Rect` as a rectangle with its corners in order, or `undefined` where the file gives none. */
function widgetRectOf(widget: PDFDict): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | undefined {
  const listed = widget.lookupMaybe(PDFName.of('Rect'), PDFArray);
  const [a, b, c, d] = [0, 1, 2, 3].map((at) => listed?.lookupMaybe(at, PDFNumber)?.asNumber());
  if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
  return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
}

/** Copies one field onto each named page, at the same PLACE on it (see {@link placeOnPage}), each copy a new field of its own. */
export const applyDuplicateFormField: Apply<'pdf-lib', 'duplicateFormField'> = async (image, command) => {
  const document = await open(image);
  const form = document.getForm();
  const { field, widget, page: source } = locate(document, command.field);
  if (field instanceof PDFRadioGroup) {
    throw new FieldEditRefusedError('duplicate-radio', 'A radio option belongs to its group, so it cannot be copied on its own.');
  }
  if (field instanceof PDFSignature) {
    throw new FieldEditRefusedError('duplicate-signature', 'A signature field is signed once, so it cannot be copied.');
  }
  const context = document.context;
  const taken = form.getFields().map((each) => each.getName());
  const sourceNumber = document.getPages().indexOf(source);
  const sourceRect = widgetRectOf(widget);

  for (const target of pagesOf(command.pages, document.getPageCount())) {
    if (target === sourceNumber) throw new RangeError('A field is copied onto other pages, and page ' + String(target) + ' is its own.');
    const page = pageAt(document, target);
    const name = freeName(taken, `${field.getName().replaceAll('.', '_')}_p${String(target + 1)}`);
    taken.push(name);

    const merged = field.acroField.dict === widget;
    const fieldDict = copyDict(field.acroField.dict);
    fieldDict.delete(PDFName.of('Parent'));
    fieldDict.set(PDFName.of('T'), text(name));
    // A COPY STARTS EMPTY: the value belongs to the field it was read from, and the default travels.
    fieldDict.delete(PDFName.of('V'));
    fieldDict.delete(PDFName.of('RV'));
    const widgetDict = merged ? fieldDict : copyDict(widget);
    widgetDict.delete(PDFName.of('V'));
    if (widgetDict.get(PDFName.of('AS')) !== undefined) widgetDict.set(PDFName.of('AS'), PDFName.of('Off'));
    widgetDict.set(PDFName.of('P'), page.ref);
    widgetDict.delete(PDFName.of('Parent'));
    // THE SAME PLACE, NOT THE SAME NUMBERS: a page of another size, origin or turn would put the copy elsewhere or off it.
    if (sourceRect !== undefined) {
      const placed = placeOnPage(sourceRect, visibleFrameOf(source), visibleFrameOf(page));
      widgetDict.set(PDFName.of('Rect'), context.obj([placed.x0, placed.y0, placed.x1, placed.y1]));
    }
    const fieldRef = context.register(fieldDict);
    if (!merged) {
      const widgetRef = context.register(widgetDict);
      widgetDict.set(PDFName.of('Parent'), fieldRef);
      fieldDict.set(PDFName.of('Kids'), context.obj([widgetRef]));
      page.node.addAnnot(widgetRef);
    } else {
      page.node.addAnnot(fieldRef);
    }
    form.acroForm.addField(fieldRef);
  }
  return appendRevision(document);
};

const TAB_NAME = { row: 'R', column: 'C', structure: 'S' } as const;

/** Sets `/Tabs` on each named page. */
export const applySetTabOrder: Apply<'pdf-lib', 'setTabOrder'> = async (image, command) => {
  const document = await open(image);
  for (const index of pagesOf(command.pages, document.getPageCount())) {
    pageAt(document, index).node.set(PDFName.of('Tabs'), PDFName.of(TAB_NAME[command.order]));
  }
  return appendRevision(document);
};

/** Nothing to capture, `createFormField`'s reason: the prior state is whole dictionaries and the bus holds the checkpoint. */
export const captureFieldEdit: (
  command: CommandOfKind<'editFormFields' | 'duplicateFormField' | 'setTabOrder'>,
) => Promise<CaptureResult<never>> = (_command) =>
  Promise.resolve({
    captured: false,
    reason: 'a field edit changes whole dictionaries, a rename moves an identity and a copy adds widgets; undo restores the checkpoint instead',
  });

/** Unreachable by the type: the prior state of all three is `never`, so no caller can build an argument. */
export const invertFieldEdit: Invert<'pdf-lib', 'editFormFields'> = (_image, _inverse) => {
  throw new Error('a field edit has no inverse and this is unreachable: its prior state is `never`. Undo restores the checkpoint the bus took.');
};
