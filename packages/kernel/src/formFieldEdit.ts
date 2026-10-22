import {
  EncryptedPDFError,
  PDFArray,
  PDFBool,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFTextField,
  StandardFonts,
  TextAlignment,
} from '@cantoo/pdf-lib';
import type { PDFDocument, PDFField, PDFFont, PDFObject, PDFPage } from '@cantoo/pdf-lib';

import {
  BORDER_STYLE_FIELD_KINDS,
  MAX_ACTION_CHAIN,
  MAX_ACTION_FIELDS,
  choiceLabelOf,
  choiceValueOf,
} from '@monstera/contract/host';
import type {
  AnnotationRect,
  ButtonAction,
  FieldAction,
  FieldActionTrigger,
  CommandOfKind,
  FIELD_BORDER_STYLES,
  FIELD_CHECK_STYLES,
  FieldChoice,
  FieldFormat,
  FieldRange,
  FormFieldHandle,
  FormFieldProperties,
} from '@monstera/contract';
import { fieldNameClash } from '@monstera/shared';

import type { FieldFace } from './fieldActions.js';
import { FieldEditRefusedError } from './fieldEditRefusal.js';
import { type ActionHeads, type ActionModel, type PlainAction, SUBMIT_FLAGS, buttonSteps, holdsKept } from './buttonActions.js';
import { MAX_FIELD_ANCESTRY } from './fieldRules.js';
import { FIELD_FAMILY_MARKER, drawsFieldFamily, familyOfMarker, fieldFontOf } from './fieldFamily.js';
import { base14Of } from './base14Families.js';
import { checkBoxAppearance, namesButtonStyle, radioAppearance } from './buttonAppearance.js';
import {
  BORDER_STYLE_NAME,
  CHECK_CHARACTER,
  calculationScript,
  faceOfFont,
  formatScripts,
  parseCalculation,
  parseDefaultAppearance,
  parseFormat,
  parseRange,
  rangeScript,
  withFontSize,
  withTextColour,
} from './fieldActions.js';
import { type PageFrame, placeOnPage, rotationOf, seenAt } from './fieldPlacement.js';
import { pageAt } from './pdfLibPages.js';
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

/** The words a push button shows (`/MK /CA`); its appearance is drawn again from them by {@link regenerate}. */
function setButtonLabel(widget: PDFDict, label: string): void {
  let mk = widget.lookupMaybe(PDFName.of('MK'), PDFDict);
  if (mk === undefined) {
    mk = widget.context.obj({});
    widget.set(PDFName.of('MK'), mk);
  }
  mk.set(PDFName.of('CA'), text(label));
}

/** An action dictionary as pdf-lib holds it: the dictionary, and the reference it was reached through, if any. */
interface PdfLibAction {
  readonly dict: PDFDict;
  readonly ref: PDFRef | undefined;
}

/** A value that is an action dictionary, directly or through a reference, as {@link PdfLibAction}; else `undefined`. */
function actionNode(document: PDFDocument, value: PDFObject | undefined): PdfLibAction | undefined {
  if (value instanceof PDFRef) {
    const dict = document.context.lookup(value);
    return dict instanceof PDFDict ? { dict, ref: value } : undefined;
  }
  return value instanceof PDFDict ? { dict: value, ref: undefined } : undefined;
}

/** A field dictionary's fully qualified name, each `/T` from the root down: `fieldRules.ts`' `qualifiedNameOf` for pdf-lib. */
function qualifiedNameOfDict(document: PDFDocument, dict: PDFDict): string {
  const parts: string[] = [];
  let at: PDFDict | undefined = dict;
  for (let hop = 0; hop < MAX_FIELD_ANCESTRY && at !== undefined; hop += 1) {
    const partial = at.lookup(PDFName.of('T'));
    if (partial instanceof PDFString || partial instanceof PDFHexString) parts.unshift(partial.decodeText());
    const parent: PDFObject | undefined = at.lookup(PDFName.of('Parent'));
    at = parent instanceof PDFDict ? parent : undefined;
  }
  return parts.join('.');
}

/**
 * pdf-lib's object model as `buttonActions.ts` reads it (ADR-0259): the adapter, never a second classifier, so the edit
 * refuses exactly the buttons the Properties read called kept.
 */
function pdfLibActions(document: PDFDocument): ActionModel<PdfLibAction> {
  return {
    plain: ({ dict }) => {
      const subtype = dict.lookup(PDFName.of('S'));
      const flags = dict.lookup(PDFName.of('Flags'));
      const fields = dict.lookup(PDFName.of('Fields'));
      let listed: PlainAction['fields'] = null;
      if (fields instanceof PDFArray) {
        const names: string[] = [];
        for (let at = 0; at < Math.min(fields.size(), MAX_ACTION_FIELDS + 1) && listed !== 'unreadable'; at += 1) {
          const entry = fields.lookup(at);
          if (entry instanceof PDFString || entry instanceof PDFHexString) names.push(entry.decodeText());
          else if (entry instanceof PDFDict) names.push(qualifiedNameOfDict(document, entry));
          else listed = 'unreadable';
        }
        if (listed !== 'unreadable') listed = names;
      } else if (fields !== undefined) {
        listed = 'unreadable';
      }
      return {
        subtype: subtype instanceof PDFName ? subtype.decodeText() : null,
        fields: listed,
        flags: flags instanceof PDFNumber ? Math.trunc(flags.asNumber()) : 0,
        destination: destinationOfDict(document, dict.lookup(PDFName.of('D'))),
        uri: textOfValue(dict.lookup(PDFName.of('URI'))),
        named: nameOfValue(dict.lookup(PDFName.of('N'))),
        file: fileOfValue(dict.lookup(PDFName.of('F'))),
        targets: targetsOfValue(document, dict.lookup(PDFName.of('T'))),
        hide: hideOfValue(dict.lookup(PDFName.of('H'))),
      };
    },
    next: ({ dict }) => {
      const next = dict.get(PDFName.of('Next'));
      const resolved = next instanceof PDFRef ? document.context.lookup(next) : next;
      if (!(resolved instanceof PDFArray)) {
        const one = actionNode(document, next);
        return one === undefined ? [] : [one];
      }
      const nodes: PdfLibAction[] = [];
      for (let at = 0; at < Math.min(resolved.size(), MAX_ACTION_CHAIN); at += 1) {
        const one = actionNode(document, resolved.get(at));
        if (one !== undefined) nodes.push(one);
      }
      return nodes;
    },
    identity: ({ ref }) => ref?.objectNumber,
  };
}

/** A string value as text, or `null` where it is not a string. */
function textOfValue(value: PDFObject | undefined): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

/** A name value as text, or `null` where it is not a name. */
function nameOfValue(value: PDFObject | undefined): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

/** `fieldRules.ts`' `fileOf`, over pdf-lib's objects: a string, or a file specification's `/UF`, else its `/F`. */
function fileOfValue(value: PDFObject | undefined): string | null {
  if (!(value instanceof PDFDict)) return textOfValue(value);
  return textOfValue(value.lookup(PDFName.of('UF'))) ?? textOfValue(value.lookup(PDFName.of('F')));
}

/** `fieldRules.ts`' `targetsListed`, over pdf-lib's objects: each entry a name string or a field's dictionary. */
function targetsOfValue(document: PDFDocument, value: PDFObject | undefined): PlainAction['targets'] {
  if (value === undefined || value === PDFNull) return null;
  const entries: (PDFObject | undefined)[] =
    value instanceof PDFArray ? Array.from({ length: Math.min(value.size(), MAX_ACTION_FIELDS + 1) }, (_, at) => value.lookup(at)) : [value];
  const names: string[] = [];
  for (const entry of entries) {
    const name = entry instanceof PDFDict ? qualifiedNameOfDict(document, entry) : (textOfValue(entry) ?? '');
    if (name === '') return 'unreadable';
    names.push(name);
  }
  return names;
}

/** `fieldRules.ts`' `hideOf`, over pdf-lib's objects: `true` where absent, and `null` where it is not a boolean. */
function hideOfValue(value: PDFObject | undefined): boolean | null {
  if (value === undefined || value === PDFNull) return true;
  return value instanceof PDFBool ? value.asBoolean() : null;
}

/** `fieldRules.ts`' `destinationOf`, over pdf-lib's objects: the page by its reference among this document's pages. */
function destinationOfDict(document: PDFDocument, value: PDFObject | undefined): PlainAction['destination'] {
  if (value instanceof PDFName || value instanceof PDFString || value instanceof PDFHexString) return 'named';
  if (!(value instanceof PDFArray) || value.size() === 0) return null;
  const target = value.get(0);
  const pages = document.getPages();
  let page: number | null = null;
  if (target instanceof PDFRef) {
    const found = pages.findIndex((each) => each.ref.objectNumber === target.objectNumber);
    page = found === -1 ? null : found;
  } else if (target instanceof PDFNumber && Number.isInteger(target.asNumber()) && target.asNumber() >= 0 && target.asNumber() < pages.length) {
    page = target.asNumber();
  }
  const fit = value.lookup(1);
  const numbers: (number | null)[] = [];
  for (let at = 2; at < Math.min(value.size(), 6); at += 1) {
    const each = value.lookup(at);
    numbers.push(each instanceof PDFNumber ? each.asNumber() : null);
  }
  return { page, fit: fit instanceof PDFName ? fit.decodeText() : null, numbers };
}

/** The widget's `/AA`, or `undefined` where it has none. */
function additionalActionsOf(document: PDFDocument, widget: PDFDict): PDFDict | undefined {
  const value = widget.get(PDFName.of('AA'));
  const resolved = value instanceof PDFRef ? document.context.lookup(value) : value;
  return resolved instanceof PDFDict ? resolved : undefined;
}

/** `fieldRules.ts`' `actionHeadsOf`, over pdf-lib's objects. */
function pdfLibHeads(document: PDFDocument, widget: PDFDict): ActionHeads<PdfLibAction> {
  const aa = additionalActionsOf(document, widget);
  return {
    up: actionNode(document, widget.get(PDFName.of('A'))),
    upAgain: actionNode(document, aa?.get(PDFName.of('U'))),
    down: actionNode(document, aa?.get(PDFName.of('D'))),
    enter: actionNode(document, aa?.get(PDFName.of('E'))),
    exit: actionNode(document, aa?.get(PDFName.of('X'))),
  };
}

/** The `/AA` key each trigger past mouse up is written under (ISO 32000-1, table 194). */
const ADDITIONAL_KEY: Readonly<Record<Exclude<FieldActionTrigger, 'up'>, string>> = { down: 'D', enter: 'E', exit: 'X' };

/** One action, as the standard writes it (ADR-0259 Decision 2). */
function actionDictOf(document: PDFDocument, action: FieldAction): PDFDict {
  switch (action.kind) {
    case 'goTo': {
      // THE PAGE BY ITS REFERENCE, which an explicit destination to a page of this document must be (ISO 32000-1,
      // 12.3.2.2): an index there names a page of ANOTHER document.
      const target = document.getPages()[action.page];
      if (target === undefined) throw new Error(`this document has no page ${String(action.page + 1)} for the button to go to`);
      const at = action.at;
      const view =
        action.view === 'fit'
          ? [PDFName.of('Fit')]
          : action.view === 'fit-width'
            ? [PDFName.of('FitH'), numberOrNull(at?.top ?? null)]
            : [PDFName.of('XYZ'), numberOrNull(at?.left ?? null), numberOrNull(at?.top ?? null), numberOrNull(at?.zoom ?? null)];
      return document.context.obj({ S: 'GoTo', D: [target.ref, ...view] });
    }
    case 'link':
      // AN ASCII STRING, as `/URI` must be (ISO 32000-1, table 206): the URL parser's own form, which percent-encodes
      // what is not ASCII. Every address the contract takes has a scheme, so it parses.
      return document.context.obj({ S: 'URI', URI: PDFString.of(URL.canParse(action.address) ? new URL(action.address).href : action.address) });
    case 'print':
      return document.context.obj({ S: 'Named', N: 'Print' });
    case 'importData':
      return document.context.obj({ S: 'ImportData', F: fileSpecOf(document, action.file) });
    case 'openFile':
      // THE FIRST PAGE, WHOLE, IN A NEW WINDOW (ISO 32000-1, table 202): a remote destination names its page by number,
      // since this document holds no reference into another.
      return document.context.obj({
        S: 'GoToR',
        F: fileSpecOf(document, action.file),
        D: [PDFNumber.of(0), PDFName.of('Fit')],
        NewWindow: PDFBool.True,
      });
    case 'reset':
      return document.context.obj({
        S: 'ResetForm',
        ...(action.fields === null ? {} : { Fields: action.fields.map((name) => PDFHexString.fromText(name)) }),
      });
    case 'submit':
      // A URL FILE SPECIFICATION (ISO 32000-1, 7.11.5): `/FS /URL` and the address in `/F`, which `/SubmitForm`'s `/F`
      // must be, and which `fileOfValue` and MuPDF's `fileOf` both read back. The flags are the one table's.
      return document.context.obj({
        S: 'SubmitForm',
        F: document.context.obj({ FS: 'URL', F: PDFString.of(action.address) }),
        Flags: SUBMIT_FLAGS[action.format],
        // NO `/Fields` FOR THE WHOLE DOCUMENT: the schema holds a whole-document submission to `null` fields (ADR-0261).
        ...(action.fields === null ? {} : { Fields: action.fields.map((name) => PDFHexString.fromText(name)) }),
      });
    case 'showHide':
      return document.context.obj({
        S: 'Hide',
        T: action.fields.map((name) => PDFHexString.fromText(name)),
        H: action.hide ? PDFBool.True : PDFBool.False,
      });
  }
}

/**
 * A file specification for one file beside the document (ISO 32000-1, 7.11.3): `/F` for every reader and `/UF` in
 * Unicode, so a name that is not ASCII reads back as typed.
 */
function fileSpecOf(document: PDFDocument, name: string): PDFDict {
  return document.context.obj({ Type: 'Filespec', F: PDFString.of(name), UF: PDFHexString.fromText(name) });
}

/** A destination's number, or the `null` the standard writes for *keep what the reader has*. */
function numberOrNull(value: number | null): PDFNumber | typeof PDFNull {
  return value === null ? PDFNull : PDFNumber.of(value);
}

/**
 * Writes what a push button does, whole (ADR-0259 Decision 1): each trigger's actions as a chain linked by `/Next`, mouse
 * up as `/A` and the others under `/AA`, whose other keys are left as they are. A trigger with none loses its key.
 *
 * A button holding any action this build does not write keeps it: overwriting it would drop the document's own content,
 * and the Properties pane offers no editing for one, so a command that asks is a defect and is thrown as one.
 */
function setButtonActions(document: PDFDocument, widget: PDFDict, actions: readonly ButtonAction[]): void {
  if (holdsKept(buttonSteps(pdfLibActions(document), pdfLibHeads(document, widget)))) {
    throw new Error('this button runs an action Monstera does not write (a script or a launch), and it is kept as it is');
  }
  const chained = (trigger: FieldActionTrigger): PDFRef | undefined => {
    let next: PDFRef | undefined;
    const list = actions.filter((each) => each.trigger === trigger);
    for (let at = list.length - 1; at >= 0; at -= 1) {
      const entry = list[at];
      if (entry === undefined) continue;
      const dict = actionDictOf(document, entry.action);
      if (next !== undefined) dict.set(PDFName.of('Next'), next);
      next = document.context.register(dict);
    }
    return next;
  };
  const up = chained('up');
  if (up === undefined) widget.delete(PDFName.of('A'));
  else widget.set(PDFName.of('A'), up);
  const aa = additionalActionsOf(document, widget) ?? document.context.obj({});
  for (const [trigger, key] of Object.entries(ADDITIONAL_KEY) as [Exclude<FieldActionTrigger, 'up'>, string][]) {
    const head = chained(trigger);
    if (head === undefined) aa.delete(PDFName.of(key));
    else aa.set(PDFName.of(key), head);
  }
  if (aa.keys().length === 0) widget.delete(PDFName.of('AA'));
  else if (!(widget.get(PDFName.of('AA')) instanceof PDFRef)) widget.set(PDFName.of('AA'), aa);
}

/** The annotation flags that decide whether a widget shows (PDF 32000-1 table 165): Hidden, Print, NoView. */
const FLAG_HIDDEN = 1 << 1;
const FLAG_PRINT = 1 << 2;
const FLAG_NO_VIEW = 1 << 5;

/** Shown, hidden, or shown and left off a print: one flag word, the other flags it holds kept as they were. */
function setVisibility(widget: PDFDict, visibility: NonNullable<FormFieldProperties['visibility']>): void {
  const held = widget.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
  const cleared = held & ~(FLAG_HIDDEN | FLAG_PRINT | FLAG_NO_VIEW);
  const flags = visibility === 'hidden' ? cleared | FLAG_HIDDEN : visibility === 'visible' ? cleared | FLAG_PRINT : cleared;
  widget.set(PDFName.of('F'), PDFNumber.of(flags));
}

/**
 * A text field's alignment, length, cells and masking, through pdf-lib's own setters, which write `/Q`, `/MaxLen` and
 * the `/Ff` bits as the format defines them. Cells need a length to divide the field by, so cells on a field with no
 * length is refused in words rather than written as a flag no reader can draw.
 */
function setTextRules(field: PDFTextField, set: FormFieldProperties): void {
  // CELLS EXCLUDE LINE BREAKS AND MASKING (PDF 32000-1 table 228), and pdf-lib's `enableCombing` turns the other two off
  // without a word. So the field's state after this edit is worked out first, and cells beside either is refused, never
  // written as one of them quietly undone.
  const comb = set.comb ?? field.isCombed();
  if (comb && ((set.multiline ?? field.isMultiline()) || (set.masked ?? field.isPassword()))) {
    throw new FieldEditRefusedError('comb-excludes', 'A field with one character per cell cannot also take line breaks or hide what is typed.');
  }
  if (set.alignment !== undefined) field.setAlignment(ALIGNMENT[set.alignment]);
  if (set.maxLength !== undefined) field.setMaxLength(set.maxLength ?? undefined);
  if (set.masked !== undefined) {
    if (set.masked) field.enablePassword();
    else field.disablePassword();
  }
  if (set.comb !== undefined) {
    if (!set.comb) field.disableCombing();
    else if (field.getMaxLength() === undefined) {
      throw new FieldEditRefusedError('comb-without-length', 'A field shows one character per cell only when it has a most characters.');
    } else field.enableCombing();
  }
}

const ALIGNMENT = { left: TextAlignment.Left, centre: TextAlignment.Center, right: TextAlignment.Right } as const;

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
export function setFormat(field: PDFField, format: FieldFormat | null): void {
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

/**
 * Writes or removes a text field's number range (ADR-0230 Decision 5), `setFormat`'s rule: `null` removes only a range this
 * application wrote, and a custom validation script is kept.
 */
function setValidation(field: PDFField, range: FieldRange | null): void {
  const aa = additionalActions(field);
  if (range === null) {
    const existing = scriptOf(aa.lookupMaybe(PDFName.of('V'), PDFDict));
    if (existing !== undefined && parseRange(existing) !== undefined) aa.delete(PDFName.of('V'));
    return;
  }
  aa.set(PDFName.of('V'), scriptAction(aa.context, rangeScript(range)));
}

/** How a widget's border is drawn (`/BS /S`, ADR-0230): a dash is written for a dashed one, and taken away otherwise. */
function setBorderStyle(widget: PDFDict, style: (typeof FIELD_BORDER_STYLES)[number]): void {
  let bs = widget.lookupMaybe(PDFName.of('BS'), PDFDict);
  if (bs === undefined) {
    bs = widget.context.obj({ W: PDFNumber.of(1) });
    widget.set(PDFName.of('BS'), bs);
  }
  bs.set(PDFName.of('S'), PDFName.of(BORDER_STYLE_NAME[style]));
  if (style === 'dashed') bs.set(PDFName.of('D'), widget.context.obj([3]));
  else bs.delete(PDFName.of('D'));
}

/** The mark a tick box or a radio shows when on (`/MK /CA`, ADR-0230): Acrobat's ZapfDingbats character for the style. */
function setCheckStyle(widget: PDFDict, style: (typeof FIELD_CHECK_STYLES)[number]): void {
  let mk = widget.lookupMaybe(PDFName.of('MK'), PDFDict);
  if (mk === undefined) {
    mk = widget.context.obj({});
    widget.set(PDFName.of('MK'), mk);
  }
  mk.set(PDFName.of('CA'), PDFString.of(CHECK_CHARACTER[style]));
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

/** A field dictionary's partial name (`/T`), or `undefined` where it has none. */
function partialNameOf(dict: PDFDict): string | undefined {
  const named = dict.lookup(PDFName.of('T'));
  return named instanceof PDFString || named instanceof PDFHexString ? named.decodeText() : undefined;
}

/** Whether a dictionary is a group of fields rather than one field: it has kids, and a kid is itself named. */
function isGroup(dict: PDFDict): boolean {
  const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids === undefined) return false;
  for (let at = 0; at < kids.size(); at += 1) {
    const kid = kids.lookupMaybe(at, PDFDict);
    if (kid !== undefined && (kid.has(PDFName.of('T')) || kid.has(PDFName.of('Kids')))) return true;
  }
  return false;
}

/** The array of fields a node holds: a group's `/Kids`, or the form's `/Fields` for the root. */
function listOf(form: ReturnType<PDFDocument['getForm']>, group: PDFDict | undefined): PDFArray {
  const holder = group ?? form.acroForm.dict;
  const key = PDFName.of(group === undefined ? 'Fields' : 'Kids');
  const existing = holder.lookupMaybe(key, PDFArray);
  if (existing !== undefined) return existing;
  const made = holder.context.obj([]);
  holder.set(key, made);
  return made;
}

/** The reference a group is stored under: a field's `/Parent` names it, so a group held inline could not be one. */
function objectRefOf(group: PDFDict): PDFRef {
  const ref = group.context.getObjectRef(group);
  if (ref === undefined) {
    throw new FieldEditRefusedError('not-found', 'A group of this form is not stored as an object of its own, so a field cannot be moved under it.');
  }
  return ref;
}

function indexOfRef(list: PDFArray, ref: PDFRef): number {
  for (let at = 0; at < list.size(); at += 1) if (list.get(at).toString() === ref.toString()) return at;
  return -1;
}

/**
 * What a field inherits from its groups, written onto the field itself before it leaves them: its type, flags, value,
 * default, text settings and choices (ISO 32000-1, 12.7.3.1, Table 220). A field that took its type from a group it is
 * leaving would be left typeless in the new one.
 */
const INHERITED: readonly string[] = ['FT', 'Ff', 'V', 'DV', 'DA', 'Q', 'MaxLen', 'Opt', 'TI', 'I'];

function keepInherited(field: PDFDict): void {
  let above = field.lookupMaybe(PDFName.of('Parent'), PDFDict);
  for (let hop = 0; above !== undefined && hop < 32; hop += 1) {
    for (const key of INHERITED) {
      const name = PDFName.of(key);
      const value = above.get(name);
      if (!field.has(name) && value !== undefined) field.set(name, value);
    }
    above = above.lookupMaybe(PDFName.of('Parent'), PDFDict);
  }
}

/**
 * Moves a field under the groups its new name spells, making the groups it needs, and takes it out of the ones it left.
 *
 * `a.b` renamed `c.b` is the field `b` under a group `c`, and `c` is the group that already has that name or a new one
 * (a name is how a form addresses a field, and the tree is only how it is stored). A group the move empties is removed,
 * so the document is not left holding a name with nothing under it. A name another FIELD holds, or one that runs
 * through one, is refused before this runs ({@link rename}), since a group cannot be made where a field is.
 */
function moveField(form: ReturnType<PDFDocument['getForm']>, field: PDFField, wanted: string): void {
  const parts = wanted.split('.');
  const dict = field.acroField.dict;
  const context = dict.context;
  keepInherited(dict);

  // Out of the old group, and every group that leaves empty.
  let leaving = dict.lookupMaybe(PDFName.of('Parent'), PDFDict);
  const from = listOf(form, leaving);
  const was = indexOfRef(from, field.ref);
  if (was >= 0) from.remove(was);
  let emptied: PDFDict | undefined = leaving;
  while (emptied !== undefined && listOf(form, emptied).size() === 0) {
    leaving = emptied.lookupMaybe(PDFName.of('Parent'), PDFDict);
    const parentList = listOf(form, leaving);
    const ref = context.getObjectRef(emptied);
    const at = ref === undefined ? -1 : indexOfRef(parentList, ref);
    if (at >= 0) parentList.remove(at);
    emptied = leaving;
  }

  // Into the new one, through each group the name spells.
  let group: PDFDict | undefined;
  for (const part of parts.slice(0, -1)) {
    const list = listOf(form, group);
    let next: PDFDict | undefined;
    for (let at = 0; at < list.size() && next === undefined; at += 1) {
      const candidate = list.lookupMaybe(at, PDFDict);
      if (candidate !== undefined && partialNameOf(candidate) === part && isGroup(candidate)) next = candidate;
    }
    if (next === undefined) {
      next = context.obj({ T: text(part), Kids: [] });
      if (group !== undefined) next.set(PDFName.of('Parent'), objectRefOf(group));
      list.push(context.register(next));
    }
    group = next;
  }
  const last = parts[parts.length - 1] ?? wanted;
  dict.set(PDFName.of('T'), text(last));
  if (group === undefined) dict.delete(PDFName.of('Parent'));
  else dict.set(PDFName.of('Parent'), objectRefOf(group));
  listOf(form, group).push(field.ref);
}

/**
 * Renames a field, and moves it into another group where the name says so (`a.b` to `c.b`), the way a form editor does.
 *
 * A name another field holds, or one that starts with another field's whole name or is the start of one, is refused as
 * taken; a name with an empty part is refused by name. A calculation of ours that names the field follows it, since a
 * script left naming the old name would add up a field that is not there.
 */
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
  if (wanted.split('.').some((part) => part === '')) {
    throw new FieldEditRefusedError('name-parent', `"${wanted}" has an empty part between its dots, so no group can be named for it.`);
  }
  const parent = field.acroField.getParent()?.getFullyQualifiedName();
  const prefix = parent === undefined ? '' : `${parent}.`;
  const partial = wanted.startsWith(prefix) ? wanted.slice(prefix.length) : undefined;
  if (partial === undefined || partial.includes('.')) moveField(form, field, wanted);
  else field.acroField.setPartialName(partial);
  followCalculations(form, current, wanted);
}

/** Every calculation this application wrote that names `was` names `now` instead; a script it did not write is left as it is. */
function followCalculations(form: ReturnType<PDFDocument['getForm']>, was: string, now: string): void {
  for (const each of form.getFields()) {
    const aa = each.acroField.dict.lookupMaybe(PDFName.of('AA'), PDFDict);
    const action = aa?.lookupMaybe(PDFName.of('C'), PDFDict);
    const script = scriptOf(action);
    const parsed = script === undefined ? undefined : parseCalculation(script);
    if (aa === undefined || !parsed?.fields.includes(was)) continue;
    aa.set(PDFName.of('C'), scriptAction(aa.context, calculationScript({ ...parsed, fields: parsed.fields.map((name) => (name === was ? now : name)) })));
  }
}

/** The kind a pdf-lib field is, in the contract's words, as far as which kinds take a family, a style or a range. */
function kindOfField(field: PDFField): string {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  return 'other';
}

/**
 * Writes a border style, a check style and a range (ADR-0230), each refused on a kind that does not take it, so nothing
 * stores a style nothing draws: a border style other than solid on a text field, a dropdown or a tick box; a check style
 * on a tick box or a radio, on every widget of it, since the mark is the field's; a range on a text field.
 */
function setStyles(field: PDFField, widget: PDFDict, set: FormFieldProperties): void {
  const kind = kindOfField(field);
  const refuse = (what: string): never => {
    throw new FieldEditRefusedError('style-kind', `A ${kind} field does not take ${what}.`);
  };
  if (set.borderStyle !== undefined) {
    if (set.borderStyle !== 'solid' && !(BORDER_STYLE_FIELD_KINDS as readonly string[]).includes(kind)) refuse('a border style');
    setBorderStyle(widget, set.borderStyle);
  }
  if (set.checkStyle !== undefined) {
    if (kind !== 'checkbox' && kind !== 'radio') refuse('a check style');
    for (const each of field.acroField.getWidgets()) setCheckStyle(each.dict, set.checkStyle);
  }
  if (set.validation !== undefined) {
    if (kind !== 'text') refuse('a range');
    setValidation(field, set.validation);
  }
}

/**
 * Writes or takes away the field's real family (ADR-0229 Decision 1): the private marker on the field dictionary, which
 * Monstera's appearance draws the value in. A standard face sent alone, or a family that IS one, takes it away, since `/DA`
 * then says the whole of it. Refused on a kind that appearance does not draw, so nothing stores a family nothing draws.
 */
function setFamily(field: PDFField, set: FormFieldProperties): void {
  const marker = PDFName.of(FIELD_FAMILY_MARKER);
  if (set.family === undefined) {
    if (set.font !== undefined) field.acroField.dict.delete(marker);
    return;
  }
  const kind = kindOfField(field);
  if (set.family !== null && base14Of(set.family) === undefined && !drawsFieldFamily(kind)) {
    throw new FieldEditRefusedError('family-kind', `A ${kind} field is drawn in the standard faces alone.`);
  }
  const family = set.family === null ? null : familyOfMarker(set.family, kind);
  if (family === null) field.acroField.dict.delete(marker);
  else field.acroField.dict.set(marker, PDFHexString.fromText(family));
}

/** What changing a field's members asks of its appearance: also what the real family's finishing step asks (ADR-0229). */
export function changesLook(set: FormFieldProperties): boolean {
  return (
    set.font !== undefined ||
    set.family !== undefined ||
    set.borderStyle !== undefined ||
    set.checkStyle !== undefined ||
    set.fontSize !== undefined ||
    set.borderColour !== undefined ||
    set.fillColour !== undefined ||
    set.borderWidth !== undefined ||
    set.options !== undefined ||
    set.multiline !== undefined ||
    set.rect !== undefined ||
    set.alignment !== undefined ||
    set.comb !== undefined ||
    set.masked !== undefined ||
    set.buttonLabel !== undefined ||
    set.textColour !== undefined
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
  // A BUTTON THAT NAMES A STYLE is drawn by Monstera's provider, which draws it; one that names none keeps pdf-lib's own
  // drawing, so a form nobody styled is drawn as it always was (ADR-0230 Decision 3).
  const styled = field.acroField.getWidgets().some(namesButtonStyle);
  if (field instanceof PDFCheckBox) field.updateAppearances(styled ? checkBoxAppearance : undefined);
  if (field instanceof PDFRadioGroup) field.updateAppearances(styled ? radioAppearance : undefined);
  // A BUTTON'S WORDS are drawn from `/MK /CA`, so a new label is a new appearance.
  if (field instanceof PDFButton) field.updateAppearances(font);
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
    // A REAL FAMILY decides the standard face `/DA` falls back to (ADR-0229 Decision 1), as `font` does where it is sent alone.
    const face = set.family === undefined || set.family === null ? (set.font ?? faceOf(form, before)) : fieldFontOf(set.family);
    const size = set.fontSize ?? sizeOf(before);
    setFamily(field, set);

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
    // THE TEXT'S COLOUR, in the default appearance at both levels a reader looks, as the size is: pdf-lib's appearance
    // providers read the colour from there when the field is drawn again below.
    if (set.textColour !== undefined) {
      field.acroField.setDefaultAppearance(withTextColour(field.acroField.getDefaultAppearance(), set.textColour));
      const own = widget.lookupMaybe(PDFName.of('DA'), PDFString);
      if (own !== undefined) widget.set(PDFName.of('DA'), PDFString.of(withTextColour(own.asString(), set.textColour)));
    }
    if (set.editable !== undefined && field instanceof PDFDropdown) {
      if (set.editable) field.enableEditing();
      else field.disableEditing();
    }
    if (set.multiSelect !== undefined && field instanceof PDFOptionList) {
      if (set.multiSelect) field.enableMultiselect();
      else field.disableMultiselect();
    }
    if (set.spellCheck !== undefined && (field instanceof PDFTextField || field instanceof PDFDropdown)) {
      if (set.spellCheck) field.enableSpellChecking();
      else field.disableSpellChecking();
    }
    if (set.borderColour !== undefined) setCharacteristic(widget, 'BC', set.borderColour);
    if (set.fillColour !== undefined) setCharacteristic(widget, 'BG', set.fillColour);
    if (set.borderWidth !== undefined) setBorderWidth(widget, set.borderWidth);
    setStyles(field, widget, set);
    if (set.rect !== undefined) {
      const box = rectOf(set.rect);
      widget.set(PDFName.of('Rect'), document.context.obj([box.x, box.y, box.x + box.width, box.y + box.height]));
    }
    if (field instanceof PDFTextField) setTextRules(field, set);
    if (set.visibility !== undefined) setVisibility(widget, set.visibility);
    if (set.buttonLabel !== undefined && field instanceof PDFButton) setButtonLabel(widget, set.buttonLabel);
    if (set.buttonActions !== undefined && field instanceof PDFButton) setButtonActions(document, widget, set.buttonActions);
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

  // ONE PLACE, its own page allowed (a paste or a duplicate), or THE SAME PLACE on each of several other pages.
  const targets =
    command.to.kind === 'place' ? [command.to.page] : pagesOf(command.to.pages, document.getPageCount());
  for (const target of targets) {
    if (command.to.kind === 'pages' && target === sourceNumber) {
      throw new RangeError('A field is copied onto other pages, and page ' + String(target) + ' is its own.');
    }
    const page = pageAt(document, target);
    const base = field.getName().replaceAll('.', '_');
    const name = freeName(taken, command.to.kind === 'place' ? base : `${base}_p${String(target + 1)}`);
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
    if (command.to.kind === 'place') {
      const box = rectOf(command.to.rect);
      widgetDict.set(PDFName.of('Rect'), context.obj([box.x, box.y, box.x + box.width, box.y + box.height]));
    } else if (sourceRect !== undefined) {
      // THE SAME PLACE, NOT THE SAME NUMBERS: a page of another size, origin or turn would put the copy elsewhere or off it.
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

/** A widget's place on its page as a person sees it, and its place in the walk, for ordering. */
interface Placed {
  readonly ref: PDFRef | PDFDict;
  readonly dict: PDFDict;
  readonly seen: { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number } | undefined;
}

/**
 * The page's widgets in reading order: by ROWS, top to bottom and each row left to right, or by COLUMNS, left to right
 * and each column top to bottom. A widget is in a row when its middle is level with the row's first widget, so two
 * fields a point apart in height are one row. A widget with no `/Rect` keeps its place after the ones that have one.
 */
function readingOrder(widgets: readonly Placed[], by: 'row' | 'column'): Placed[] {
  const across = (box: NonNullable<Placed['seen']>): readonly [number, number] => (by === 'row' ? [box.u0, box.u1] : [box.v0, box.v1]);
  const down = (box: NonNullable<Placed['seen']>): readonly [number, number] => (by === 'row' ? [box.v0, box.v1] : [box.u0, box.u1]);
  const placed = widgets.filter((widget) => widget.seen !== undefined);
  const lines: Placed[][] = [];
  for (const widget of [...placed].sort((a, b) => down(a.seen ?? ZERO)[0] - down(b.seen ?? ZERO)[0])) {
    const [top, bottom] = down(widget.seen ?? ZERO);
    const middle = (top + bottom) / 2;
    const line = lines.find((each) => {
      const first = each[0]?.seen;
      if (first === undefined) return false;
      const [start, end] = down(first);
      return middle >= start && middle <= end;
    });
    if (line === undefined) lines.push([widget]);
    else line.push(widget);
  }
  return [
    ...lines.flatMap((line) => line.sort((a, b) => across(a.seen ?? ZERO)[0] - across(b.seen ?? ZERO)[0])),
    ...widgets.filter((widget) => widget.seen === undefined),
  ];
}
const ZERO = { u0: 0, v0: 0, u1: 0, v1: 0 } as const;

/**
 * Puts each named page's widgets in the order asked, in its `/Annots`, and sets `/Tabs` (ADR-0226 Decision 15).
 *
 * The widgets move among the places widgets hold in the array, so every other annotation keeps its place, and the
 * array keeps its members: nothing is added or dropped. A given order names its fields by handle, each checked against
 * the field it was read as (`locate`); the page's other widgets follow them in the order they had. A given order's page
 * carries no `/Tabs`, which every reader takes as the array's order; a row, column or structure order names its own.
 */
export const applySetTabOrder: Apply<'pdf-lib', 'setTabOrder'> = async (image, command) => {
  const document = await open(image);
  const order = command.order;
  const given = typeof order === 'string' ? undefined : order.given;
  const pages =
    given === undefined ? pagesOf(command.pages, document.getPageCount()) : [...new Set(given.map((handle) => handle.page))];
  for (const index of pages) {
    const page = pageAt(document, index);
    const annots = page.node.Annots();
    const frame = visibleFrameOf(page);
    const slots: number[] = [];
    const widgets: Placed[] = [];
    for (let at = 0; at < (annots?.size() ?? 0); at += 1) {
      const dict = annots?.lookupMaybe(at, PDFDict);
      const ref = annots?.get(at);
      if (dict?.lookup(SUBTYPE) !== WIDGET || !(ref instanceof PDFRef || ref instanceof PDFDict)) continue;
      const rect = widgetRectOf(dict);
      slots.push(at);
      widgets.push({ ref, dict, seen: rect === undefined ? undefined : seenAt(rect, frame) });
    }
    let ordered: Placed[];
    if (given === undefined) {
      ordered = order === 'structure' ? widgets : readingOrder(widgets, order === 'column' ? 'column' : 'row');
      page.node.set(PDFName.of('Tabs'), PDFName.of(TAB_NAME[order === 'column' ? 'column' : order === 'structure' ? 'structure' : 'row']));
    } else {
      const named = given
        .filter((handle) => handle.page === index)
        .map((handle) => locate(document, handle).widget);
      const first = widgets.filter((widget) => named.includes(widget.dict));
      first.sort((a, b) => named.indexOf(a.dict) - named.indexOf(b.dict));
      ordered = [...first, ...widgets.filter((widget) => !named.includes(widget.dict))];
      page.node.delete(PDFName.of('Tabs'));
    }
    // THE SAME PLACES, NEW OCCUPANTS: only the slots widgets held are written, so a comment between two fields stays
    // where it was in the page's drawing order.
    slots.forEach((slot, at) => {
      const widget = ordered[at];
      if (widget !== undefined) annots?.set(slot, widget.ref);
    });
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
