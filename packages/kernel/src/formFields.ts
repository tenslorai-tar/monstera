import type {
  AnnotationRect,
  CommandOfKind,
  FieldActionTrigger,
  FieldFill,
  FieldFormat,
  FieldLook,
  FieldRange,
  FieldScript,
  FormFieldKind,
} from '@monstera/contract';
import { MAX_FIELD_VALUE } from '@monstera/contract/host';
import type { PDFDocument, PDFObject, PDFPage, PDFWidget } from './mupdfRaw.js';

import { BoundedList } from './boundedList.js';
import { type CalculatedValue, calculatedValues, recalculate, restoreCalculated, writeShown } from './fieldCalculation.js';
import { kindOf } from './fieldKind.js';
import { choiceLookOf } from './fieldLook.js';
import { redrawFamily, remaskBeforeBake } from './fieldWidgets.js';
import { actionRuns, triggersOf } from './buttonActions.js';
import {
  MAX_FIELD_ANCESTRY,
  actionNodeAt,
  buttonStepsOf,
  fieldDictionaryOf,
  fieldRulesOf,
  nearest,
  qualifiedNameOf,
} from './fieldRules.js';
import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { ENGINE_FORM_FIELDS_MAX } from './host/engineChannels.js';
import { withDocument, withDocumentRemoving } from './mupdfWriter.js';
import { frameOf, pageAt, readRect, redraw, redrawPage } from './pageAnnotations.js';

/**
 * Reading a document's AcroForm fields — Stage 4's foundation.
 *
 * ## A BUTTON'S VALUE IS NOT A STRING A CALLER SHOULD READ
 *
 * MuPDF's `PDFWidget.getValue()` answers the **field's** value as a string, for
 * every type. For a text or choice field that is what a person typed or chose.
 * For a checkbox it is `"Yes"`, and for a radio it is the selected option's
 * export value — `"0"` on the fixture, against options labelled
 * `["first","second"]`. Two vocabularies, corresponding by index, and a surface
 * that matched one against the other would never match.
 *
 * So {@link ListedField} splits the two questions rather than documenting the
 * hazard: `value` is the text of a field that has text, and `on` is the state
 * of a field that has a state. A button's `value` is empty **by construction**,
 * so there is no string here for a caller to mistake for a tick (B5 over a
 * comment). {@link onState} carries how `on` is computed and why the obvious
 * reading of it is wrong.
 *
 * ## Two walks, two index spaces
 *
 * [ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
 * measured `getAnnotations()` answering 3 where `/Annots` held 4, because
 * widgets are filtered. This is the same fact from the other side, measured on
 * the same day: a page carrying seven widgets and nothing else answers **0**
 * annotations and **7** widgets. The two walks share no entries, so a field's
 * index is a position in **this** walk and an annotation handle can never name
 * one — which is exactly what that ADR said it was declining to do.
 *
 * ## The name does not identify a widget
 *
 * `getName()` answers the fully-qualified field name, and a **radio group is
 * one field with several widgets**: measured, both radios on the fixture answer
 * `applicant.post`. So the name is reported because a person reads it, and the
 * index is what points.
 */

/**
 * How many fields cross in one answer: the host answer's own bound, derived from the answer ceiling and past any real
 * form (ADR-0130 Decision 3). It was 4,096, and a generated form pack passes that. The renderer receives the list in
 * parts.
 */
const MAX_LISTED_FIELDS = ENGINE_FORM_FIELDS_MAX;

/** How much of a field's value or name crosses. `MAX_LISTED_CONTENTS`' reason. */
const MAX_FIELD_TEXT = 512;

/** How many options of a choice field cross. */
const MAX_FIELD_OPTIONS = 512;

/**
 * How many values one field may carry across.
 *
 * A multi-select list's `/V` is an array a hostile document controls, so it is
 * bounded where no real form reaches it — the same argument
 * {@link MAX_LISTED_FIELDS} makes about the list of fields itself.
 */
const MAX_FIELD_VALUES = 256;

/** How far up a `/Parent` chain an inherited key is looked for: `fieldRules.ts`', the one reader of a field's inherited rules. */
export { MAX_FIELD_ANCESTRY };

/**
 * What this field's `/V` holds, as a list — the ONE answer to *what value does
 * this field have*, and the reason it is not `getValue()`.
 *
 * ## `getValue()` ANSWERS AN EMPTY STRING FOR A FIELD HOLDING TWO VALUES
 *
 * Measured 2026-09-08 (`scripts/research/formDataExport.mjs` question 9), on a
 * listbox whose `/V` was built as an array of two strings:
 *
 * | `/V` | `isArray()` | `length` | `getValue()` |
 * |---|---|---|---|
 * | `[ (en) (de) ]` | `true` | 2 | **`""`** |
 *
 * So the accessor does not truncate the list, it reports the field as **empty**
 * — which is the reassuring direction. A panel shows nothing, an export writes
 * nothing, and an undo restores nothing, all agreeing with each other and none
 * of them agreeing with the document.
 *
 * That shape is not exotic and this build simply could not produce one to look
 * at: `@cantoo/pdf-lib`'s second `select()` **overwrites**, measured in the same
 * run (`/V` a plain `(de)` after selecting `en` then `de`), so the fixture had
 * to be built by hand. A form filled by any tool that writes the multi-select
 * bit arrives with it.
 *
 * ## It is a REPLACEMENT for the accessor, not a second opinion beside it
 *
 * B3a is about two modules holding two views of what an authority said. Here
 * the authority's accessor has a return type that cannot express the answer, so
 * the choice is not *which reading* but *whether the shape is representable at
 * all* — and everything in this module that asks what a field holds asks this,
 * including {@link onState}, so there is one reading and not two.
 *
 * A name is answered without its slash, which is what `getValue()` does for a
 * tick box's `/Yes` and what the on-state comparison below needs. A signature's
 * `/V` is a dictionary and answers **no values**, which is the honest reading:
 * it holds a signature, not text.
 *
 * ## WHOLE, and the listing's bound is the listing's
 *
 * Each value is answered as long as the document holds it. A listing crosses to a panel in a bounded answer and cuts
 * there ({@link listedValues}, which says so); an export writes the field into a file and an undo puts it back, and a
 * value cut for either is text taken out of the document. This read cut every value at the listing's 512 characters
 * until 2026-10-04, so an export wrote a long field cut and an undo of a fill restored the cut value.
 */
export function fieldValues(widget: PDFWidget): readonly string[] {
  const stored = storedValues(widget);
  if (!widget.isChoice()) return stored;
  // A LIST WHOSE CHOICE IS RECORDED ONLY BY PLACE (`/I`, ISO 32000-1 table 231), with no `/V`, is a list with that choice
  // made: other viewers show its rows selected, and this read answered it empty (the owner's F3, *"Italian highlighted
  // on the page, nothing selected in the Fields list"*). `/V` wins where both are there, as the standard says.
  const chosen = stored.length > 0 ? stored : chosenByPlace(widget);
  return chosen.map((value) => choiceTextOf(widget, value));
}

/** The values a choice field's `/I` names by their places in `/Opt`, inherited as `/V` is; none where it has none. */
function chosenByPlace(widget: PDFWidget): readonly string[] {
  let object: PDFObject = widget.getObject();
  let places = object.get('I');
  for (let hop = 0; places.isNull() && hop < MAX_FIELD_ANCESTRY; hop += 1) {
    const parent = object.get('Parent');
    if (!parent.isDictionary()) break;
    object = parent;
    places = object.get('I');
  }
  if (!places.isArray()) return [];
  const options = widget.getOptions(true);
  const found: string[] = [];
  for (let index = 0; index < Math.min(places.length, MAX_FIELD_VALUES); index += 1) {
    const place = places.get(index);
    const option = place.isNumber() ? options[place.asNumber()] : undefined;
    if (option !== undefined) found.push(option);
  }
  return found;
}

/**
 * The text a person reads for a value a choice field STORES, or the value itself where the field lists no such choice.
 *
 * `/Opt` may list each choice as [value, text] (ISO 32000-1, 12.7.4.4) and `/V` holds the VALUE. Everything in this
 * module offers, compares and records a choice by its text, so the one place a stored value is turned into one is here,
 * and {@link choiceStoredOf} is its inverse: a form written by another program reads as its choices, and a choice
 * written here is stored as that program stores it.
 */
export function choiceTextOf(widget: PDFWidget, stored: string): string {
  const at = widget.getOptions(true).indexOf(stored);
  return at < 0 ? stored : (widget.getOptions(false)[at] ?? stored);
}

/** {@link choiceTextOf}'s inverse: the value a form stores for the choice a person reads as `shown`. */
export function choiceStoredOf(widget: PDFWidget, shown: string): string {
  const at = widget.getOptions(false).indexOf(shown);
  return at < 0 ? shown : (widget.getOptions(true)[at] ?? shown);
}

function storedValues(widget: PDFWidget): readonly string[] {
  let object: PDFObject = widget.getObject();
  let value = object.get('V');
  // `/V` IS INHERITABLE and pdf-lib puts it on the parent, which is where the
  // create row found `/T` on the same day. A merged field carries it on the
  // widget itself, so both shapes are walked rather than one assumed.
  for (let hop = 0; value.isNull() && hop < MAX_FIELD_ANCESTRY; hop += 1) {
    const parent = object.get('Parent');
    if (!parent.isDictionary()) break;
    object = parent;
    value = object.get('V');
  }

  if (value.isArray()) {
    const found: string[] = [];
    const length = Math.min(value.length, MAX_FIELD_VALUES);
    for (let index = 0; index < length; index += 1) {
      const entry = value.get(index);
      // A NAME INSIDE THE ARRAY is legal and rare; reading it as a string would
      // answer `null` and drop the entry, which is this function's own subject.
      const text = entry.isName() ? entry.asName() : entry.isString() ? entry.asString() : null;
      if (text !== null) found.push(text);
    }
    return found;
  }
  if (value.isName()) return [value.asName()];
  if (value.isString()) return [value.asString()];
  // NULL, A DICTIONARY OR A STREAM. The first is a field nobody filled; the
  // second is a signature; the third is not a value any reader would take.
  return [];
}

/**
 * A field's values as a listing carries them: each cut to {@link MAX_FIELD_TEXT}, and `cut` where one was, so a
 * surface can tell a value it may start an edit from from a slice of one. An edit started from a slice writes the
 * slice back over the whole.
 */
function listedValues(widget: PDFWidget): { readonly values: readonly string[]; readonly cut: boolean } {
  const whole = fieldValues(widget);
  return {
    values: whole.map((value) => value.slice(0, MAX_FIELD_TEXT)),
    cut: whole.some((value) => value.length > MAX_FIELD_TEXT),
  };
}

/** One AcroForm field's widget, as a surface may show it. */
export interface ListedField {
  /** Zero-based, so a panel can hand it straight to a jump. */
  readonly page: number;
  /**
   * Its position in the WIDGET walk on that page — not in `/Annots`, and not in
   * the annotation walk, which shares no entries with this one.
   */
  readonly index: number;
  readonly kind: FormFieldKind;
  /**
   * The fully-qualified field name. **Not unique**: every widget of a radio
   * group answers the same one, so this is what a person reads and the index is
   * what points.
   */
  readonly name: string;
  /**
   * The text of a field that has text — a text field's contents, a choice
   * field's selected options.
   *
   * **Empty for every button kind**, which is the whole of the trap above made
   * structural: there is no string here for a caller to mistake for a state.
   *
   * **A LIST, because a multi-select choice field holds several.** It was a
   * string until 2026-09-08, and `getValue()` answers `""` for a `/V` that is
   * an array — so a field holding two options was reported as one holding none.
   * {@link fieldValues} carries the reading. Nearly every field has zero or one
   * entry here; the list is what makes the third case sayable rather than
   * silently rounded to the second.
   */
  readonly values: readonly string[];
  /**
   * Whether THIS widget is the one that is on, or `null` for a field that has
   * no on-state.
   *
   * The field's value compared with this widget's own on-state name, which is
   * the only reading that answers a radio group and a checkbox alike and the
   * only one that survives a stale `/AS`. {@link onState} carries the
   * measurement.
   */
  readonly on: boolean | null;
  /** A choice field's options, in the document's order. Empty for the rest. */
  readonly options: readonly string[];
  /** Whether the document forbids filling it. */
  readonly readOnly: boolean;
  /** Whether a text field takes line breaks (`/Ff` bit 13); false for every other kind. */
  readonly multiline: boolean;
  /** Where it is, in PDF user space, or `null` for a page that displays none. */
  readonly rect: AnnotationRect | null;
  /** Present and true where a value in {@link values} is a slice of a longer one — {@link listedValues}. */
  readonly cut?: true;
  /** What filling it must respect, read by `fieldRules.ts` (ADR-0226 Decision 4): bounded scalars, never a tooltip. */
  readonly required: boolean;
  readonly maxLength: number | null;
  readonly comb: boolean;
  readonly masked: boolean;
  readonly multiSelect: boolean;
  readonly editable: boolean;
  /** Its value is worked out from other fields', by a calculation of ours or a script that is never run. */
  readonly calculated: boolean;
  readonly format: FieldFormat | null;
  /** The number range it accepts, checked where it is filled (ADR-0230); absent where it has none. */
  readonly range?: FieldRange;
  /** A radio option's own value ({@link radioOptionOf}); present only on a radio widget that names one. */
  readonly option?: string;
  /** A push button's triggers that run something and that hold something kept (ADR-0259); present only where any has. */
  readonly actions?: { readonly runs: readonly FieldActionTrigger[]; readonly kept: readonly FieldActionTrigger[] };
  /** How a dropdown or a list box is drawn ({@link choiceLookOf}); present only on one (the owner's F1). */
  readonly look?: FieldLook;
  /** A signature field that holds a signature; present only on one (the owner's F8). */
  readonly signed?: true;
  /** The scripts it carries that are never run (`scriptsNotRunOf`); present only where there is one. */
  readonly scripts?: readonly FieldScript[];
}

/**
 * A radio widget's own option: the group's `/Opt` entry at this widget's place among its kids (ISO 32000-1, 12.7.4.2.4),
 * else the widget's own name for *on*. Every widget of a group answers the group's name and the group's options, which
 * is why the Fields list showed every option as the first one (the owner's F9).
 */
function optionOf(kind: FormFieldKind, widget: PDFWidget): { readonly option?: string } {
  const option = kind === 'radio' ? radioOptionOf(widget.getObject()) : null;
  return option === null ? {} : { option: option.slice(0, MAX_FIELD_TEXT) };
}

export function radioOptionOf(object: PDFObject): string | null {
  const own = onStateKeyOf(object) ?? null;
  const parent = object.get('Parent');
  if (!parent.isDictionary() || !object.isIndirect()) return own;
  const listed = parent.get('Opt');
  const kids = parent.get('Kids');
  if (!listed.isArray() || !kids.isArray()) return own;
  for (let at = 0; at < kids.length; at += 1) {
    const kid = kids.get(at);
    if (!kid.isIndirect() || kid.asIndirect() !== object.asIndirect()) continue;
    const entry = listed.get(at);
    return entry.isString() ? entry.asString() : entry.isName() ? entry.asName() : own;
  }
  return own;
}

// WHAT KIND OF FIELD A WIDGET IS lives in `fieldKind.ts`, which the field appearance's finishing step reads too.
export { kindOf } from './fieldKind.js';

/**
 * Whether this widget is the one the field's value names.
 *
 * ## `/AS` IS WHAT IS DRAWN AND `/V` IS THE DATA, and they disagree in the wild
 *
 * The first spelling of this read `/AS !== /Off`, which is what a viewer paints
 * — and it answered **false for a box `@cantoo/pdf-lib` had just checked**.
 * Measured 2026-09-07, one checkbox straight out of `createCheckBox().check()`:
 *
 * | | `/V` (on the field) | `/AS` (on the widget) |
 * |---|---|---|
 * | after `check()` | `/Yes` | **`/Off`** |
 *
 * pdf-lib writes the field's value and leaves the widget's appearance state
 * stale, and it is a library this project ships. So a reader keyed on `/AS`
 * reports a filled form as empty, on documents this build itself produces.
 *
 * ## So the reading is the field's value against THIS widget's on-state
 *
 * A widget's `/AP` `/N` holds one appearance per state — `Off` and one other,
 * which is that widget's own name for *on*. Measured on the radio group: the
 * two widgets carry `["0", "Off"]` and `["1", "Off"]` against a field value of
 * `/0`, so comparing each widget's own key with the field's value answers `on`
 * for the first and `off` for the second. The same comparison answers a
 * checkbox, whose key is `Yes`.
 *
 * That is the only reading that works for both, and it is robust to the stale
 * `/AS` above rather than being confused by it.
 */
export function onState(widget: PDFWidget): boolean {
  const key = onStateKey(widget);
  // THE FIELD'S VALUE, not the widget's — measured, and it is what makes this
  // comparison meaningful: both widgets of a group answer the same string, and
  // only one of them has a key equal to it. Through {@link fieldValues} rather
  // than `getValue()` so this module holds one reading of `/V` and not two; a
  // button's is a name, so the list has exactly one entry or none.
  return key !== undefined && key === fieldValues(widget)[0];
}

/**
 * This widget's own name for *on* — the non-`Off` key of its `/AP` `/N`.
 *
 * Separated from {@link onState} because an IMPORT needs the key itself rather
 * than the comparison: a file names the state it wants (`Yes`, `1`), and which
 * widget of a radio group that is cannot be decided by asking each one whether
 * it is currently on.
 */
export function onStateKey(widget: PDFWidget): string | undefined {
  return onStateKeyOf(widget.getObject());
}

/** {@link onStateKey} over a widget's object, which is what reading a group's OTHER widgets has in hand. */
export function onStateKeyOf(object: PDFObject): string | undefined {
  const normal = object.get('AP', 'N');
  // A STREAM ANSWERS `isDictionary()` TOO, measured 2026-09-07: `/AP` `/N` is a
  // state dictionary on a checkbox or radio and a STREAM on every other kind,
  // and a walk over a stream's keys yields `BBox`, `Matrix`, `Resources` — any
  // of which would be taken as this widget's name for *on*. The caller reaches
  // here only for a stateful button, so this is the second line of defence
  // rather than the only one; it is here because the reading it prevents is
  // plausible-looking rather than obviously wrong.
  if (normal.isStream() || !normal.isDictionary()) return undefined;
  let name: string | undefined;
  normal.forEach((_appearance, key) => {
    // THE FIRST NON-`Off` KEY. The format allows several on-states and no
    // document here has one; taking the first is stated rather than assumed
    // unique, because a second would otherwise be silently ignored.
    if (name === undefined && String(key) !== 'Off') name = String(key);
  });
  return name;
}

/** The members of a listed field that say how it is filled, from the one reader of a field's rules. */
function listedRules(
  widget: PDFWidget,
): Pick<ListedField, 'required' | 'maxLength' | 'comb' | 'masked' | 'multiSelect' | 'editable' | 'calculated' | 'format' | 'range' | 'scripts'> {
  const rules = fieldRulesOf(widget);
  return {
    ...(rules.scripts.length === 0 ? {} : { scripts: rules.scripts }),
    required: rules.required,
    maxLength: rules.maxLength,
    comb: rules.comb,
    masked: rules.masked,
    multiSelect: rules.multiSelect,
    editable: rules.editable,
    calculated: rules.calculation !== null || rules.customCalculation,
    format: rules.format,
    ...(rules.validation === null ? {} : { range: rules.validation }),
  };
}

/**
 * Every AcroForm field in the document, in page order.
 *
 * `readAnnotations`' shape and its reasons: the index is reset per page and
 * counted from the walk rather than from the accumulator, so a future skip
 * cannot silently shift every handle after it; the transform is resolved once
 * per page because it is the page's; and a page that displays no region gives
 * `null` rectangles rather than dropping its fields. Bounded through `BoundedList`.
 *
 * @param bound every caller passes none; a case passes a small one to reach the stop on a small document
 */
export function readFormFields(
  session: MupdfSession,
  bound = MAX_LISTED_FIELDS,
): Promise<{ readonly fields: readonly ListedField[]; readonly truncated: boolean }> {
  return withDocument(session, (document) => {
    const found = new BoundedList<ListedField>(bound);
    const fieldsOf = (): { readonly fields: readonly ListedField[]; readonly truncated: boolean } => {
      const { items, truncated } = found.answer();
      return { fields: items, truncated };
    };
    const pages = document.countPages();
    for (let page = 0; page < pages; page += 1) {
      let index = 0;
      const loaded = document.loadPage(page);
      const transform = frameOf(loaded);
      for (const widget of loaded.getWidgets()) {
        if (!found.room()) return fieldsOf();
        const kind = kindOf(widget);
        // A PUSH BUTTON IS A BUTTON WITH NO STATE, and the two questions came
        // apart on 2026-09-07: it was reported `on: false`, which reads as *a
        // box that is unticked* rather than *a control that has no tick*. It
        // reached that answer through the `/AP` `/N` hazard {@link onState}
        // records — a stream whose first key is `BBox`. Both halves are fixed:
        // the caller no longer asks, and the reader no longer answers.
        const stateful = kind === 'checkbox' || kind === 'radio';
        const listed = stateful || kind === 'button' ? { values: [], cut: false } : listedValues(widget);
        found.add({
          page,
          index: index++,
          kind,
          name: widget.getName().slice(0, MAX_FIELD_TEXT),
          // EMPTY FOR EVERY BUTTON KIND, which is the trap made unrepresentable
          // rather than described: `/V` would answer the on-state name here,
          // and a push button's is meaningless in a different way again.
          values: listed.values,
          on: stateful ? onState(widget) : null,
          options: widget.getOptions().slice(0, MAX_FIELD_OPTIONS),
          readOnly: widget.isReadOnly(),
          // ONLY A TEXT FIELD: bit 13 of `/Ff` is Multiline in the text-field flags (ISO 32000-1, Table 228) and is
          // not a multiline flag for any other field type, so it is read by kind rather than for every widget.
          multiline: kind === 'text' && widget.isMultiline(),
          rect: transform === null ? null : readRect(widget, transform),
          ...(listed.cut ? { cut: true as const } : {}),
          ...listedRules(widget),
          ...optionOf(kind, widget),
          ...(kind === 'button' ? actionsListed(document, widget) : {}),
          ...(kind === 'dropdown' || kind === 'listbox' ? { look: choiceLookOf(document, widget.getObject()) } : {}),
          // A SIGNATURE FIELD HOLDING ONE, whose value is the signature dictionary: never offered for signing again.
          ...(kind === 'signature' && nearest(widget.getObject(), 'V').isDictionary() ? { signed: true as const } : {}),
        });
      }
    }
    return fieldsOf();
  });
}

/**
 * The widget a handle names, or a refusal that says which walk it was counting.
 *
 * `annotationAt`'s shape and deliberately its own sentence: the two walks share
 * no entries, so *there is no annotation there* and *there is no widget there*
 * are different facts about the same page, and one message covering both would
 * send a reader to the wrong list.
 */
function widgetAt(loaded: PDFPage, index: number): PDFWidget {
  const walked = loaded.getWidgets();
  const found = walked[index];
  if (found === undefined) {
    throw new RangeError(
      `Form field ${String(index)} is outside this page, which has ${String(walked.length)} ` +
        'widget(s). The index is a position in the widget walk that document.formFields answers ' +
        'with — not the annotation walk, which shares no entries with it, and not the page ' +
        '/Annots array.',
    );
  }
  return found;
}

/**
 * What the document must permit before a fill is attempted.
 *
 * ## EVERY RULE HERE IS OURS, because the engine applies none
 *
 * Measured 2026-09-07 (`scripts/research/formFieldFill.mjs`), six attempts and
 * six successes with no throw: `setTextValue` lands on a read-only field and on
 * a push button; `setChoiceValue` stores an option the document does not offer,
 * and lands on a text field; `setTextValue` lands on a listbox; and `toggle()`
 * on a text field silently does nothing. MuPDF will write whatever it is asked.
 *
 * So this is not defensive validation over a library that would have refused —
 * it is the whole of the type discipline, and its cases are what stand between
 * a form and a document whose dropdown holds a value it does not offer.
 *
 * ## The empty option is a real value, not a missing one
 *
 * Measured the same day: a dropdown built with no selection reads `""`, and
 * `setChoiceValue('')` clears one that has a selection, on a combobox and a
 * listbox alike. So `''` passes the membership test deliberately — it is how a
 * choice is cleared, and it is what an inverse restoring an untouched field
 * has to be able to say.
 */
export function refuseUnfillable(widget: PDFWidget, value: FieldFill): void {
  if (widget.isReadOnly()) {
    throw new Error(
      `The field "${widget.getName()}" is marked read-only by the document, so this build does ` +
        'not fill it. MuPDF writes it anyway if asked — measured — so the refusal is here.',
    );
  }
  const kind = kindOf(widget);
  if (value.set === 'text') {
    if (!widget.isText()) {
      throw new Error(`A text value cannot fill a ${kind} field ("${widget.getName()}").`);
    }
    return;
  }
  if (value.set === 'choice') {
    if (!widget.isChoice()) {
      throw new Error(`A chosen option cannot fill a ${kind} field ("${widget.getName()}").`);
    }
    // A DROPDOWN THAT TAKES TYPING (`/Ff` Edit) holds what was typed, offered or not: the document says it may.
    const typed = widget.isComboBox() && fieldRulesOf(widget).editable;
    if (!typed && value.option !== '' && !widget.getOptions().includes(value.option)) {
      throw new Error(
        `The field "${widget.getName()}" does not offer the option ${JSON.stringify(value.option)}. ` +
          'The document decides what a choice field may hold, and MuPDF stores an unlisted value ' +
          'without complaint — measured — so the refusal is here.',
      );
    }
    return;
  }
  if (value.set === 'choices') {
    // SEVERAL VALUES ONLY WHERE THE DOCUMENT TAKES SEVERAL (ADR-0226 Decision 5): a list whose `/Ff` says multiple
    // selection. A one-value list given two would hold a state its own reader says it cannot.
    if (!widget.isListBox() || !fieldRulesOf(widget).multiSelect) {
      throw new Error(`Several options cannot fill a ${kind} field that takes one ("${widget.getName()}").`);
    }
    const offered = widget.getOptions();
    const unlisted = value.options.find((option) => !offered.includes(option));
    if (unlisted !== undefined) {
      throw new Error(`The field "${widget.getName()}" does not offer the option ${JSON.stringify(unlisted)}.`);
    }
    return;
  }
  if (!widget.isCheckbox() && !widget.isRadioButton()) {
    throw new Error(`An on-state cannot fill a ${kind} field ("${widget.getName()}").`);
  }
}

/**
 * Puts several options into a list that takes several (ADR-0226 Decision 5). MuPDF's own setter names one value, so
 * the field's `/V` is written as an array of the stored values, and `/I` as their places in `/Opt`, on the dictionary
 * that holds `/T`: measured 2026-10-10, written on the widget of a field pdf-lib made, the array is where no reader
 * looks, and written on the field pdf-lib reads both values back. Then each widget of the field is redrawn.
 */
function setChoices(document: PDFDocument, widget: PDFWidget, options: readonly string[]): void {
  const shown = widget.getOptions(false);
  // THE DOCUMENT'S ORDER, whatever order the person picked them in, and each once.
  const picked = shown.flatMap((option, at) => (options.includes(option) ? [at] : []));
  const field = fieldDictionaryOf(widget.getObject());
  if (picked.length === 0) {
    field.delete('V');
    field.delete('I');
  } else {
    const values = document.newArray();
    const places = document.newArray();
    for (const at of picked) {
      values.push(document.newString(choiceStoredOf(widget, shown[at] ?? '')));
      places.push(document.newInteger(at));
    }
    field.put('V', picked.length === 1 ? document.newString(choiceStoredOf(widget, shown[picked[0] ?? 0] ?? '')) : values);
    field.put('I', places);
  }
  redraw(widget, document);
}


/**
 * How many toggles it can take to reach a requested state.
 *
 * **Two, and it is a measurement rather than a margin.** `toggle()` is keyed on
 * `/AS` — what a viewer paints — and it writes both entries, so a widget is
 * consistent after one call whatever it was before. A widget already consistent
 * needs at most one; a widget whose `/V` and `/AS` disagree needs the first to
 * make them agree and the second to move them, and there is no third state to
 * reach. Measured 2026-09-07 on a box `@cantoo/pdf-lib`'s `check()` left with
 * `/V /Yes` and `/AS /Off`.
 */
const MAX_TOGGLES = 2;

/**
 * Puts a button widget into a named state, through the only mutator there is.
 *
 * ## A toggle is not a setter, and this is what closes the gap
 *
 * `mupdf.d.ts:812-834` declares three mutators and none of them names a state.
 * `toggle()` reads `/AS`, which the reader deliberately does not trust — so
 * *set this box to on* is one call on a consistent document and two on one
 * whose entries disagree, and a command that toggled once would do different
 * things to two documents that hold the same data.
 *
 * So the state is READ BACK through {@link onState} between calls, which is the
 * same reading `readFormFields` reports. The loop is bounded and the result is
 * **verified**: a MuPDF whose toggle changed meaning would be refused here
 * rather than silently leaving a field holding the opposite of what was asked.
 */
function setButton(widget: PDFWidget, on: boolean): void {
  for (let attempt = 0; attempt < MAX_TOGGLES && onState(widget) !== on; attempt += 1) {
    widget.toggle();
  }
  if (onState(widget) !== on) {
    throw new Error(
      `The field "${widget.getName()}" did not reach the requested state after ` +
        `${String(MAX_TOGGLES)} toggles. MuPDF offers no setter that names a state, so this ` +
        'build reaches one by toggling and reading back; a widget that will not settle is ' +
        'refused rather than left holding the opposite of what was asked.',
    );
  }
}

/**
 * Puts one value into one widget, having refused everything the document
 * forbids.
 *
 * **Exported for the import**, which is the second caller of *what filling
 * means* and must not be a second implementation of it (B3a): every type rule
 * in {@link refuseUnfillable}, the toggle-and-read-back in {@link setButton}
 * and the read-only refusal are the fill row's, and an import that wrote values
 * its own way would agree with them until a document disagreed.
 */
export function fillWidget(document: PDFDocument, widget: PDFWidget, value: FieldFill): void {
  fill(document, widget, value);
}

/**
 * Puts one value into one widget, having refused everything the document forbids. A text field with a format this
 * application reads shows its value formatted, as a reader shows it, and stores it as typed (`writeShown`).
 */
function fill(document: PDFDocument, widget: PDFWidget, value: FieldFill): void {
  refuseUnfillable(widget, value);
  if (value.set === 'text') writeShown(document, [widget], value.text, fieldRulesOf(widget).format);
  else if (value.set === 'choice') {
    widget.setChoiceValue(choiceStoredOf(widget, value.option));
    // A DROPDOWN IN A REAL FAMILY is drawn now, in its family, rather than by MuPDF at the save (ADR-0229).
    redrawFamily(document, widget);
  } else if (value.set === 'choices') setChoices(document, widget, value.options);
  else setButton(widget, value.on);
}

/**
 * Fills the field a handle names.
 *
 * The version is **not** checked here, for `applyRemoveAnnotation`'s reason:
 * the bus holds the document's version and refuses a stale target before this
 * runs, and an apply re-deriving it would be a second opinion about a question
 * the declaration table answers (B3a).
 */
export const applyFillFormField: Apply<'mupdf', 'fillFormField'> = (session, command) =>
  withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    fill(document, widgetAt(loaded, command.index), command.value);
    // THE FORM'S CALCULATIONS IN THE SAME COMMAND (ADR-0226 Decision 6), so a fill and the totals it moves are one
    // undo step: a total worked out by a second command would be a second step a person never took.
    recalculate(document);
  });

/**
 * How many widgets the field this widget belongs to has, across the document.
 *
 * The field's `/Kids`, read through the widget's `/Parent` where there is one.
 * Measured 2026-09-07: a lone text field and a lone checkbox each report 1, and
 * both widgets of a two-page radio group report 2. A document that merges the
 * field and its widget into one dictionary has neither key and is 1, which is
 * the same answer by a different route.
 *
 * It exists so the capture can tell *this page's walk is the whole field* from
 * *the field reaches past this page*, and pay for a document-wide walk only in
 * the second case.
 */
function fieldWidgetCount(widget: PDFWidget): number {
  const object = widget.getObject();
  const parent = object.get('Parent');
  const kids = parent.isNull() ? object.get('Kids') : parent.get('Kids');
  return kids.isArray() ? kids.length : 1;
}

/** How many widgets of this field sit on this page. */
function onThisPage(loaded: PDFPage, name: string): number {
  return loaded.getWidgets().filter((candidate) => candidate.getName() === name).length;
}

/** Where the lit widget of this field is in this page's walk, if it is here. */
function litWidget(loaded: PDFPage, name: string): number | undefined {
  const at = loaded
    .getWidgets()
    .findIndex((candidate) => candidate.getName() === name && onState(candidate));
  return at === -1 ? undefined : at;
}

/** The lit widget of this field anywhere in the document, page and all. */
function litInDocument(
  document: PDFDocument,
  name: string,
): { readonly page: number; readonly index: number } | undefined {
  const pages = document.countPages();
  for (let page = 0; page < pages; page += 1) {
    const at = litWidget(document.loadPage(page), name);
    if (at !== undefined) return { page, index: at };
  }
  return undefined;
}

/**
 * What a fill has to put back, and **which widget puts it back**.
 *
 * The index is part of it because a radio group's inverse acts on a different
 * widget from the one the command named — see `CommandPrior.fillFormField`.
 */
export interface PriorFieldValue {
  readonly page: number;
  readonly index: number;
  readonly value: FieldFill;
  /**
   * Every calculated field's value before the fill worked it out again (ADR-0226 Decision 6), written back exactly by
   * the inverse rather than worked out from the restored value: a total that arrived out of date comes back out of date.
   */
  readonly calculated: readonly CalculatedValue[];
}

/**
 * The state a fill is about to replace.
 *
 * ## It validates first, so the bus cannot checkpoint a doomed command
 *
 * `captureRemoveAnnotation`'s care: the page, the index and every rule
 * {@link refuseUnfillable} states are checked here, so a command that is about
 * to refuse does so before the log holds an entry for it.
 *
 * ## A RADIO GROUP'S PRIOR IS THE GROUP'S, not this widget's
 *
 * Measured 2026-09-07: toggling the second radio of a group moves the field to
 * it and turns the first off. So the inverse of *select the second* is *select
 * the first*, and an inverse spelt *unset what was set* would leave the group
 * deselected — a document the user never had. The prior therefore names
 * whichever widget of this field was on, or this one with `on: false` when none
 * was.
 *
 * ## The search widens to the document only when the field reaches past the page
 *
 * A group's widgets may sit on different pages, and the lit one is then not in
 * this page's walk at all — where *nothing is lit here* and *the selection is
 * elsewhere* are the same reading. The field's own `/Kids` count separates
 * them: measured 2026-09-07, a lone text field and a lone checkbox each report
 * 1 and a two-page radio group reports 2 from either widget. So the page walk
 * is known to be complete for the field when the counts agree, and only a field
 * that reaches past this page pays for a document-wide walk.
 */
export function captureFillFormField(
  session: MupdfSession,
  command: CommandOfKind<'fillFormField'>,
): Promise<CaptureResult<PriorFieldValue>> {
  return withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    const widget = widgetAt(loaded, command.index);
    refuseUnfillable(widget, command.value);
    const calculated = calculatedValues(document);
    if (calculated === undefined) {
      return {
        captured: false,
        reason: 'the form works out more fields than a prior carries, so a checkpoint restores them instead',
      };
    }

    // A LIST THAT TAKES SEVERAL holds a prior one fill can say: the options it held, in its own order.
    if (command.value.set === 'choices' || (widget.isListBox() && fieldRulesOf(widget).multiSelect && command.value.set === 'choice')) {
      return {
        captured: true,
        prior: { page: command.page, index: command.index, value: { set: 'choices', options: fieldValues(widget) }, calculated },
      };
    }

    if (command.value.set !== 'button') {
      const holds = fieldValues(widget);
      if (holds.length > 1) {
        // THE PRIOR CANNOT BE SAID IN ONE FILL, and this is the same refusal as
        // the one below with a different cause: `FieldFill` carries one option,
        // so an inverse built from a field holding two would put back the first
        // and delete the second — an undo that loses data, which is worse than
        // no inverse. A checkpoint restores it exactly. Reachable only from a
        // document another tool filled, because this build writes one value.
        return {
          captured: false,
          reason:
            `the field holds ${String(holds.length)} values, and a fill carries one — so an ` +
            'inverse built from it would discard the rest rather than restore them',
        };
      }
      const held = holds[0] ?? '';
      if (held.length > MAX_FIELD_VALUE) {
        // THE PRIOR IS LONGER THAN A FILL CAN CARRY, so an inverse would put back its first part and drop the rest. A
        // checkpoint restores it exactly — `holds.length`'s refusal above, with a different cause.
        return {
          captured: false,
          reason:
            `the field holds ${String(held.length)} characters and a fill carries ${String(MAX_FIELD_VALUE)}, so an ` +
            'inverse built from it would cut the rest rather than restore it',
        };
      }
      if (command.value.set === 'choice' && held !== '' && !widget.getOptions().includes(held)) {
        // THE DOCUMENT ARRIVED HOLDING SOMETHING IT DOES NOT OFFER, which
        // MuPDF permits and this build refuses to write. Recording it as a
        // prior would produce an inverse that this build's own apply rejects —
        // an undo that throws, at the moment a person presses undo. A
        // checkpoint restores it exactly and says so.
        return {
          captured: false,
          reason:
            `the field holds ${JSON.stringify(held)}, which is not among the options the ` +
            'document offers, so the inverse would be a fill this build refuses to apply',
        };
      }
      return {
        captured: true,
        prior: {
          page: command.page,
          index: command.index,
          value:
            command.value.set === 'text'
              ? { set: 'text', text: held }
              : { set: 'choice', option: held },
          calculated,
        },
      };
    }

    const name = widget.getName();
    const here = litWidget(loaded, name);
    const found =
      here === undefined && onThisPage(loaded, name) < fieldWidgetCount(widget)
        ? litInDocument(document, name)
        : here === undefined
          ? undefined
          : { page: command.page, index: here };

    return {
      captured: true,
      prior:
        found === undefined
          ? // NOTHING OF THIS FIELD IS ON, so the inverse turns off whatever the
            // command turned on — which for a checkbox is this widget and for a
            // group is the one that ends up lit, both reached by the same write.
            { page: command.page, index: command.index, value: { set: 'button', on: false }, calculated }
          : { page: found.page, index: found.index, value: { set: 'button', on: true }, calculated },
    };
  });
}

/**
 * Puts a field back the way {@link captureFillFormField} found it.
 *
 * **The prior is a whole instruction rather than a value**, so this is the same
 * write the apply performs and there is no second implementation of *what
 * filling means* (B3a). It reaches `fill` rather than repeating its refusals,
 * which also means an inverse the document has since forbidden — a field made
 * read-only by another command — refuses here instead of writing.
 */
export const invertFillFormField: Invert<'mupdf', 'fillFormField'> = (session, inverse) =>
  withDocument(session, (document) => {
    const loaded = pageAt(document, inverse.page, document.countPages());
    fill(document, widgetAt(loaded, inverse.index), inverse.value);
    restoreCalculated(document, inverse.calculated);
  });

/**
 * Removes from the field tree every field the deletion has emptied.
 *
 * ## What the engine does and does not do, measured
 *
 * 2026-09-07: `deleteAnnotation` removes a widget from `/Annots` **and** from
 * wherever the field tree references it — a split field's `/Kids` 1 → 0, a
 * radio group's 2 → 1 — so there is never a dangling reference to repair. What
 * it leaves is a field dictionary with an empty `/Kids`, which `@cantoo/pdf-lib`
 * still lists by name. So a document is left in two states: this build's reader
 * walks widgets and reports the field gone, every other reader reports it there
 * and unfillable.
 *
 * The merged shape needs none of this: a field and its one widget in a single
 * dictionary leaves `/Fields` on its own, measured.
 *
 * ## It prunes UPWARDS, because emptying a child can empty its parent
 *
 * `applicant.name` losing its widget leaves `applicant` with two children
 * rather than none, so nothing more happens. Deleting all three would empty
 * `applicant` too, and a pass that pruned only the leaves would leave the
 * parent — the same half-state one level up. So the walk repeats while it is
 * still removing something, which terminates because each pass removes at
 * least one entry from a finite tree.
 *
 * ## A field that never had `/Kids` is NOT pruned
 *
 * Absence and emptiness are different states here: a field with no `/Kids` at
 * all is either a merged field/widget — already gone if it was deleted, still
 * live if it was not — or a value-only parent the format allows. Only an array
 * that is present and empty says *this field's widgets have been removed*.
 *
 * **Exported for the redaction burn-in** (ADR-0079), which deletes the widgets under
 * a mark and is the first caller to reach this on documents with no form at all.
 * `get` on the shared Null THROWS, so `/AcroForm` is checked as a dictionary before
 * it is asked for `/Fields`.
 */
export function pruneEmptyFields(document: PDFDocument): void {
  const acroForm = document.getTrailer().get('Root').get('AcroForm');
  if (!acroForm.isDictionary()) return;
  const fields = acroForm.get('Fields');
  if (!fields.isArray()) return;

  const emptied = (field: PDFObject): boolean => {
    const kids = field.get('Kids');
    // PRESENT AND EMPTY, never merely absent — see the note above.
    return kids.isArray() && kids.length === 0;
  };

  /** One pass over one array, answering whether it removed anything. */
  const sweep = (array: PDFObject): boolean => {
    let removed = false;
    for (let index = array.length - 1; index >= 0; index -= 1) {
      const field = array.get(index);
      const kids = field.get('Kids');
      // DESCEND FIRST, so a parent emptied by this pass is seen by it rather
      // than by the next one. The reverse order is what makes deleting by index
      // safe while iterating.
      if (kids.isArray() && sweep(kids)) removed = true;
      if (emptied(field)) {
        array.delete(index);
        removed = true;
      }
    }
    return removed;
  };

  while (sweep(fields)) {
    // REPEATS WHILE IT IS STILL REMOVING. `sweep` descends before it prunes, so
    // one pass usually suffices; the loop is what makes that an observation
    // rather than an assumption about tree depth.
  }

  // THE CALCULATION ORDER NAMES FIELDS TOO, and a field it still names is written with its answer however far it left
  // the tree: measured 2026-10-04, a deleted page's field listed in `/CO` kept its value in the saved file
  // (ADR-0155). So `/CO` keeps only the fields the tree still holds.
  const order = acroForm.get('CO');
  if (!order.isArray()) return;
  const held = new Set<number>();
  const hold = (array: PDFObject): void => {
    for (let index = 0; index < array.length; index += 1) {
      const field = array.get(index);
      if (!field.isIndirect() || held.has(field.asIndirect())) continue;
      held.add(field.asIndirect());
      const kids = field.get('Kids');
      if (kids.isArray()) hold(kids);
    }
  };
  hold(fields);
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const field = order.get(index);
    if (field.isIndirect() && !held.has(field.asIndirect())) order.delete(index);
  }
}

/**
 * Takes the form fields off pages that are about to leave the document: each widget on them is deleted and the
 * field tree pruned, by the calls {@link applyDeleteFormFields} makes.
 *
 * **Called by every command that removes pages, BEFORE the page tree is rewritten**, while the indices still name the
 * pages ([ADR-0151](../../../docs/DECISIONS/0151-every-full-save-collects-and-a-deleted-page-takes-its-fields.md)).
 * Rewriting `/Kids` alone leaves `/AcroForm` naming the widgets, and each widget's `/P` keeps the page itself
 * reachable, so the field stays in the form and no collecting save can drop the page — measured 2026-10-03, the
 * owner's item 12a. A field with widgets on pages that stay keeps them and its value: only an emptied `/Kids` is
 * pruned.
 */
export function removeFieldsOnPages(document: PDFDocument, pages: Iterable<number>): void {
  for (const page of pages) {
    const loaded = document.loadPage(page);
    for (const widget of loaded.getWidgets()) loaded.deleteAnnotation(widget);
  }
  pruneEmptyFields(document);
}

/**
 * Keeps only the form fields whose widgets sit on this document's own pages, and removes the form when none is left.
 *
 * **For a document BUILT from another one's pages** — an extract, a split, a page sent to another application — whose
 * `/AcroForm` was grafted whole (`pageExtract.ts`). Grafted whole, it held every field of the source with its answer,
 * and each widget's `/P` brought the page it sat on: measured 2026-10-03, extracting page 1 alone wrote the answers
 * from page 4 and page 4 itself (the owner's item 12b).
 *
 * The rule is one sentence: a field node with no `/Kids` stays only when it is a widget on one of the pages, and
 * {@link pruneEmptyFields} then takes away every parent that rule emptied. A value-only field, which the format allows
 * and which no page shows, does not stay either: in a file built from some pages it is an answer with nowhere to be
 * seen.
 */
export function keepFieldsOnPages(document: PDFDocument): void {
  const root = document.getTrailer().get('Root');
  const acroForm = root.get('AcroForm');
  if (!acroForm.isDictionary()) return;
  const fields = acroForm.get('Fields');
  if (fields.isArray()) {
    const onPages = new Set<number>();
    for (let page = 0; page < document.countPages(); page += 1) {
      const annots = document.findPage(page).get('Annots');
      if (!annots.isArray()) continue;
      for (let at = 0; at < annots.length; at += 1) {
        const entry = annots.get(at);
        if (entry.isIndirect()) onPages.add(entry.asIndirect());
      }
    }
    const shown = (node: PDFObject): boolean => node.isIndirect() && onPages.has(node.asIndirect());
    const sweep = (array: PDFObject): void => {
      for (let index = array.length - 1; index >= 0; index -= 1) {
        const node = array.get(index);
        const kids = node.get('Kids');
        if (kids.isArray()) sweep(kids);
        else if (!shown(node)) array.delete(index);
      }
    };
    sweep(fields);
    pruneEmptyFields(document);
  }
  // NO FIELD LEFT IS NO FORM: an `/AcroForm` with empty `/Fields` is a form a reader offers to fill with nothing in it.
  const left = acroForm.get('Fields');
  if (!left.isArray() || left.length === 0) root.delete('AcroForm');
}

/**
 * Deletes the fields a handle names, and tidies the tree they leave behind.
 *
 * ## Descending order, for `applyRemoveAnnotation`'s reason
 *
 * The indices are positions in one walk, and removing a widget shifts every
 * position after it. Deleting from the highest index down means no surviving
 * index has moved by the time it is used — the alternative is arithmetic on the
 * caller's numbers, which is the shape that deletes the wrong thing when a
 * document is not the simple one.
 *
 * ## Every index is validated BEFORE anything is deleted
 *
 * A refusal on the fourth of five, after three have gone, is a document nobody
 * asked for and no undo entry describes correctly.
 */
export const applyDeleteFormFields: Apply<'mupdf', 'deleteFormFields'> = (session, command) =>
  withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    for (const index of command.indices) widgetAt(loaded, index);

    const descending = [...new Set(command.indices)].sort((a, b) => b - a);
    for (const index of descending) loaded.deleteAnnotation(widgetAt(loaded, index));
    pruneEmptyFields(document);
  });

/**
 * Reports that a deleted field's prior state is not recorded, and validates.
 *
 * **`captureRemoveAnnotation`'s reason, strictly larger.** A removed
 * annotation's prior state is its whole object graph — a dictionary that may
 * reference an appearance stream, which references fonts and images — and a
 * deleted field adds the field dictionary and every ancestor pruned with it.
 * That is unbounded and has no serialisation here, and the bytes would sit in a
 * log whose `retainedBytes` counts checkpoints only.
 *
 * So this is a *never* rather than a *not yet*, and the handle ADR-0041 built
 * does not change it: the handle says which field, and the difficulty was never
 * naming one.
 */
export function captureDeleteFormFields(
  session: MupdfSession,
  command: CommandOfKind<'deleteFormFields'>,
): Promise<CaptureResult<never>> {
  return withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    // EVERY index, not the first: a capture that validated one of five would
    // let the bus checkpoint a command that is about to refuse on the fourth.
    for (const index of command.indices) widgetAt(loaded, index);
    return {
      captured: false,
      reason:
        'a deleted form field cannot be recorded as prior state: its prior state is the widget’s ' +
        'whole object graph, the field dictionary that held it and every ancestor pruned with ' +
        'it, which is unbounded and has no serialisation here',
    };
  });
}

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * `CommandPrior['deleteFormFields']` is `never`, so nothing can construct an
 * argument. It throws rather than resolving for `invertRemoveAnnotation`'s
 * reason: a reachable path here would mean the type had been widened, and a
 * quiet resolve would land that as an undo that silently did nothing.
 */
export const invertDeleteFormFields: Invert<'mupdf', 'deleteFormFields'> = (): Promise<void> => {
  throw new Error(
    'a deleted form field has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
};

/**
 * Burns every field's appearance into the page and removes the form.
 *
 * ## `bake(false, true)`, and the two arguments are not one decision
 *
 * `docs/ENGINE-SPIKE.md` H2 corrects the founding matrix — MuPDF *can* flatten
 * — and `docs/ARCHITECTURE.md` §3 names this call, so the writer of record was
 * settled before this row existed. What H2 asked for and never ran was the
 * verification, executed 2026-09-07:
 *
 * | reading | before | after |
 * |---|---|---|
 * | widgets on the page | 9 | **0** |
 * | fields pdf-lib lists | 8 | **0** |
 * | ink from the page's own content stream | 0 | **8337** |
 *
 * Per rectangle, all nine came across — text 1159, checkbox 60, radio 129 and
 * 77, dropdown 329, listbox 2810, read-only 798, push button 1200, signature
 * 203, each from zero. **Both halves of the radio group**, which is the case a
 * bake working at field level rather than widget level would have got wrong.
 *
 * `bakeAnnots` stays **false**. `bake(true, false)` leaves widgets and fields
 * untouched, so the two arguments are genuinely separate and *flatten the form,
 * keep the comments editable* is what this row promises. Flattening annotations
 * is D7's *sanitize / flatten document* and is not smuggled in here.
 *
 * ## The engine bakes whatever it is shown
 *
 * `bake` takes no page and no field list. A per-field flatten that drew each
 * appearance itself would be this build re-deriving *which objects make up
 * this field's appearance*, which is the engine's rule (B3a). So the selected
 * fields' flatten (ADR-0226 Decision 16) changes what the bake is shown, in
 * {@link flattenSome}, and never how it bakes.
 *
 * ## It is a REMOVAL, and that is why it uses the other helper
 *
 * [ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md).
 * Measured: the bake unlinks the widgets and a plain save writes all nine back
 * out, with the object count **growing** 49 to 55 — so every flattened field's
 * value stays readable to anything walking the cross-reference table rather
 * than the catalog. {@link withDocumentRemoving} records the fact on the
 * session, and `serialise` collects from then on.
 */
export const applyFlattenFormFields: Apply<'mupdf', 'flattenFormFields'> = (session, command) =>
  withDocumentRemoving(session, (document) => {
    if (command.fields === 'all') {
      remaskBeforeBake(document);
      document.bake(false, true);
      return;
    }
    flattenSome(document, command.fields);
  });

/**
 * Bakes the named widgets and no other (ADR-0226 Decision 16).
 *
 * MuPDF's bake walks each page's `/Annots` and then deletes `/AcroForm` whole, so: every widget not named is put aside
 * from its page's `/Annots` for the bake, the form is put back after it, each page's array is put back without the
 * baked widgets in the order it had, and the baked widgets leave the field tree — {@link pruneEmptyFields} taking a
 * parent no widget is left under, and the calculation order with it. A field that is a value only, on no page, is not
 * in any `/Annots` and is not touched. A place no widget holds is refused (`widgetAt`) before anything changes; a walk
 * that moved is the version's to refuse, at the bus, as it is for the delete.
 */
function flattenSome(document: PDFDocument, places: readonly { readonly page: number; readonly index: number }[]): void {
  const chosen = new Set<number>();
  for (const place of places) {
    const widget = widgetAt(pageAt(document, place.page, document.countPages()), place.index);
    const object = widget.getObject();
    // A WIDGET IS AN INDIRECT OBJECT in every file a reader accepts (`/Annots` and `/Kids` must both reach it).
    if (object.isIndirect()) chosen.add(object.asIndirect());
  }
  const isChosen = (entry: PDFObject): boolean => entry.isIndirect() && chosen.has(entry.asIndirect());

  const pages = document.countPages();
  const kept: (PDFObject[] | undefined)[] = [];
  for (let page = 0; page < pages; page += 1) {
    const found = document.findPage(page);
    const annots = found.get('Annots');
    if (!annots.isArray()) {
      kept.push(undefined);
      continue;
    }
    const all: PDFObject[] = [];
    for (let at = 0; at < annots.length; at += 1) all.push(annots.get(at));
    kept.push(all.filter((entry) => !isChosen(entry)));
    // ONLY THE CHOSEN for the bake: a widget the bake cannot see is a widget it leaves as a field.
    const only = document.newArray();
    for (const entry of all.filter(isChosen)) only.push(entry);
    found.put('Annots', only);
  }

  const root = document.getTrailer().get('Root');
  const form = root.get('AcroForm');
  remaskBeforeBake(document, (widget) => isChosen(widget.getObject()));
  document.bake(false, true);
  if (!form.isNull()) root.put('AcroForm', form);
  for (let page = 0; page < pages; page += 1) {
    const back = kept[page];
    if (back === undefined) continue;
    const array = document.newArray();
    for (const entry of back) array.push(entry);
    document.findPage(page).put('Annots', array);
  }

  // THE BAKED WIDGETS LEAVE THE TREE: a merged field and widget from `/Fields`, a widget from its parent's `/Kids`.
  const fields = form.isNull() ? form : form.get('Fields');
  if (!fields.isArray()) return;
  const sweep = (array: PDFObject): void => {
    for (let index = array.length - 1; index >= 0; index -= 1) {
      const node = array.get(index);
      if (isChosen(node)) {
        array.delete(index);
        continue;
      }
      const kids = node.get('Kids');
      if (kids.isArray()) sweep(kids);
    }
  };
  sweep(fields);
  pruneEmptyFields(document);
}

/**
 * Reports that a flatten's prior state is not recorded, and validates nothing.
 *
 * **{@link captureDeleteFormFields}'s reason, larger again.** Deleting fields
 * loses the widgets a payload named; this loses every widget in the document
 * *and* rewrites the content stream of every page one sat on. There is no
 * bounded prior state to serialise, and the checkpoint the bus mints is the
 * whole of the undo.
 *
 * **Nothing to validate**, unlike its two neighbours, and that is the payload
 * rather than an omission: a fill and a delete name positions in a walk and can
 * name one that is not there, while this names nothing. A flatten of a document
 * with no fields is a no-op rather than a refusal — MuPDF bakes nothing and the
 * session is marked, which costs a collecting save and removes nothing, which
 * is exactly what was asked for.
 */
export const captureFlattenFormFields = (session: MupdfSession): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason:
      'a flattened form cannot be recorded as prior state: every widget in the document is gone ' +
      'and the content stream of every page one sat on has been rewritten, which is unbounded ' +
      'and has no serialisation here',
  }));

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * {@link invertDeleteFormFields}'s reason exactly: `CommandPrior` is `never`
 * here, so nothing can construct an argument, and throwing rather than
 * resolving keeps a widened type from landing as an undo that did nothing.
 */
/** A push button's listing summary: its triggers that run and that hold kept actions, or nothing where it has none. */
function actionsListed(document: PDFDocument, widget: PDFWidget): Pick<ListedField, 'actions'> {
  const steps = buttonStepsOf(document, widget.getObject());
  return steps.length === 0 ? {} : { actions: triggersOf(steps) };
}

/**
 * Which fields a reset takes, by fully qualified name: those named, each with its descendants, or with `exclude` every
 * field but those. A Reset form action's `/Fields` and `/Flags` read as this (ISO 32000-1, table 238).
 */
export interface FieldsChosen {
  readonly names: readonly string[];
  readonly exclude: boolean;
}

/**
 * THE ONE RESET: every field `chosen` takes, or every field in the form where it is absent, back to its default (`/DV`,
 * else empty or off), with the widgets redrawn and the form's calculations run. A button's Reset form action
 * ({@link applyResetForm}) and *Reset form* on the ribbon ({@link applyResetWholeForm}) both call this, so the two cannot
 * clear a form differently (B3a).
 *
 * ## The values are MuPDF's; the appearances are this build's
 *
 * MuPDF's `resetForm` writes the values: `/DV` into `/V` where there is one, `/V` removed where there is none, and a box
 * or a radio's appearance state to match. The widgets are then redrawn page by page through {@link redrawPage}, so a
 * field this build draws (a real family, a list, a border) is drawn as this build draws it, and the form's calculations
 * run, as a fill's do, in the same command.
 *
 * ## A SIGNATURE IS NEVER RESET
 *
 * A signature field's `/V` IS the signature, and MuPDF's reset removes `/V` from a field with no `/DV` — so resetting one
 * deletes a signature the person did not ask about, and a Reset form button meaning *clear what I typed* would unsign the
 * document. Nothing a reset is for is in a signature, so a `/Sig` field is never chosen (the owner's R23).
 *
 * ## The fields are handed to MuPDF as references, chosen here
 *
 * MuPDF 1.28.0 (`pdf-form.c`, read in its source) cannot be given names: `specified_fields` keeps a field only if its name
 * equals `pdf_load_field_name` of an entry, and a string entry has none, so a button naming `applicant.name` reset
 * nothing (measured). With the exclude bit and a list it resets nothing where the standard resets every OTHER field. And
 * its every-field path has no way to leave a signature out. References work, so the choice is made here, by this build's
 * one reading of a fully qualified name (`qualifiedNameOf`), over every field a page's widget belongs to.
 */
export function resetFields(document: PDFDocument, chosen?: FieldsChosen): void {
  const listed = (name: string): boolean =>
    chosen === undefined || chosen.names.some((each) => each !== '' && (name === each || name.startsWith(`${each}.`))) !== chosen.exclude;
  const fields = document.newArray();
  const seen = new Set<number>();
  for (let page = 0; page < document.countPages(); page += 1) {
    for (const widget of document.loadPage(page).getWidgets()) {
      const field = fieldDictionaryOf(widget.getObject());
      if (!field.isIndirect() || seen.has(field.asIndirect())) continue;
      seen.add(field.asIndirect());
      const type = nearest(field, 'FT');
      if (type.isName() && type.asName() === 'Sig') continue;
      if (listed(qualifiedNameOf(field))) fields.push(field);
    }
  }
  document.resetForm(fields, false);
  for (let page = 0; page < document.countPages(); page += 1) {
    const each = document.loadPage(page);
    const widgets = each.getWidgets();
    if (widgets.length > 0) redrawPage(each, widgets, document);
  }
  recalculate(document);
}

/**
 * Carries out one Reset form step of the button a handle names (the owner's F7, ADR-0259): the fields its `/Fields` and
 * `/Flags` choose, through {@link resetFields}.
 *
 * A step that is not a Reset form the listing said runs is refused: the page sends this only for one that is, so another
 * means the document moved under the press, and running it would carry out something nobody asked for.
 */
export const applyResetForm: Apply<'mupdf', 'resetForm'> = (session, command) =>
  withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    const button = widgetAt(loaded, command.index);
    const at = actionNodeAt(document, button.getObject(), command.trigger, command.step);
    const resets = at !== undefined && actionRuns(at.action) && at.node.get('S').isName() && at.node.get('S').asName() === 'ResetForm';
    if (at === undefined || !resets) {
      throw new Error(`step ${String(command.step)} of "${button.getName()}" is not a Reset form action, so nothing was reset`);
    }
    const named = at.node.get('Fields');
    resetFields(document, named.isArray() ? fieldsNamed(named, at.node.get('Flags')) : undefined);
  });

/** *Reset form* on the ribbon (the owner's R23): every field, through {@link resetFields}. */
export const applyResetWholeForm: Apply<'mupdf', 'resetWholeForm'> = (session) =>
  withDocument(session, (document) => {
    resetFields(document);
  });

/** A Reset form action's `/Fields` and `/Flags`, read: each entry a name string or a field object, and the exclude bit. */
function fieldsNamed(named: PDFObject, flags: PDFObject): FieldsChosen {
  const names: string[] = [];
  for (let at = 0; at < Math.min(named.length, MAX_FIELD_VALUES); at += 1) {
    const entry = named.get(at);
    names.push(entry.isString() ? entry.asString() : qualifiedNameOf(entry));
  }
  return { names, exclude: flags.isNumber() && (Math.trunc(flags.asNumber()) & 1) === 1 };
}

/**
 * Not recorded: the prior is every value the action names, across the document, and the checkpoint the bus takes
 * restores it exactly (`importFormData`'s reason).
 */
export const captureResetForm = (session: MupdfSession): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason: 'a reset form is undone from the checkpoint the bus took: its prior is every value the action names',
  }));

/** Unreachable, and required by `CommandSpec`'s shape: undo restores the checkpoint (ADR-0037). */
export const invertResetForm: Invert<'mupdf', 'resetForm'> = (): Promise<void> => {
  throw new Error('a reset form has no inverse; undo restores the checkpoint the bus took (ADR-0037)');
};

/** Not recorded, {@link captureResetForm}'s reason: the prior is every value in the form. */
export const captureResetWholeForm = (session: MupdfSession): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason: 'a reset form is undone from the checkpoint the bus took: its prior is every value in the form',
  }));

/** Unreachable, {@link invertResetForm}'s reason. */
export const invertResetWholeForm: Invert<'mupdf', 'resetWholeForm'> = (): Promise<void> => {
  throw new Error('a reset form has no inverse; undo restores the checkpoint the bus took (ADR-0037)');
};

export const invertFlattenFormFields: Invert<'mupdf', 'flattenFormFields'> = (): Promise<void> => {
  throw new Error(
    'a flattened form has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
};
