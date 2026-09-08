import type { AnnotationRect, CommandOfKind, FieldFill, FormFieldKind } from '@monstera/contract';
import type { PDFDocument, PDFObject, PDFPage, PDFWidget } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument, withDocumentRemoving } from './mupdfWriter.js';
import { frameOf, pageAt, readRect } from './pageAnnotations.js';

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
 * How many fields cross in one answer.
 *
 * `ENGINE_ANNOTATIONS_MAX`' number and its argument: a bound on a list a
 * hostile document controls, set where no real form reaches it. The largest
 * government form anyone has put in front of this build is in the hundreds.
 */
export const MAX_LISTED_FIELDS = 4096;

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

/** How far up a `/Parent` chain an inherited key is looked for. */
const MAX_FIELD_ANCESTRY = 32;

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
 */
export function fieldValues(widget: PDFWidget): readonly string[] {
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
      if (text !== null) found.push(text.slice(0, MAX_FIELD_TEXT));
    }
    return found;
  }
  if (value.isName()) return [value.asName().slice(0, MAX_FIELD_TEXT)];
  if (value.isString()) return [value.asString().slice(0, MAX_FIELD_TEXT)];
  // NULL, A DICTIONARY OR A STREAM. The first is a field nobody filled; the
  // second is a signature; the third is not a value any reader would take.
  return [];
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
  /** Where it is, in PDF user space, or `null` for a page that displays none. */
  readonly rect: AnnotationRect | null;
}

/**
 * What kind of field a widget is, asked through MuPDF's own predicates.
 *
 * **The predicates rather than `getFieldType()`'s string**, because the
 * classification is MuPDF's rule and re-deriving it from a name would be a
 * second opinion about it (B3a) — one that agrees until a version spells a type
 * differently. The string is still what answers `signature`, which has no
 * predicate of its own.
 *
 * **Push button before checkbox**, because `isButton()` covers all three and
 * the order is what separates them. Measured names, 2026-09-07: `text`,
 * `checkbox`, `radiobutton`, `combobox`, `listbox`, `signature`.
 */
function kindOf(widget: PDFWidget): FormFieldKind {
  if (widget.isPushButton()) return 'button';
  if (widget.isCheckbox()) return 'checkbox';
  if (widget.isRadioButton()) return 'radio';
  if (widget.isText()) return 'text';
  if (widget.isComboBox()) return 'dropdown';
  if (widget.isListBox()) return 'listbox';
  // `'other'` IS THE HONEST ANSWER for a type this build cannot name — and it
  // is UNREACHABLE against MuPDF 1.28.0, measured 2026-09-07 while auditing.
  // A widget whose `/FT` is `/Xx`, and a widget with no `/FT` at all, both
  // resolve to `getFieldType() === 'button'` with `isPushButton()` true: the
  // engine defaults an unknown or absent type to push button, so every widget
  // it hands us matches a predicate above.
  //
  // KEPT RATHER THAN DELETED, for JJJ-1's reason. The fact it encodes is true,
  // and removing it would leave this function with no fallback the day a
  // version answers with a string these predicates do not cover — which is a
  // false positive manufactured to tidy away a branch. `formFields.test.ts`
  // carries the reading, so the claim expires with the version rather than
  // sitting here as an assertion nobody can date.
  return widget.getFieldType() === 'signature' ? 'signature' : 'other';
}

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
function onState(widget: PDFWidget): boolean {
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
  const normal = widget.getObject().get('AP').get('N');
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

/**
 * Every AcroForm field in the document, in page order.
 *
 * `readAnnotations`' shape and its reasons: the index is reset per page and
 * counted from the walk rather than from the accumulator, so a future skip
 * cannot silently shift every handle after it; the transform is resolved once
 * per page because it is the page's; and a page that displays no region gives
 * `null` rectangles rather than dropping its fields.
 */
export function readFormFields(
  session: MupdfSession,
): Promise<{ readonly fields: readonly ListedField[]; readonly truncated: boolean }> {
  return withDocument(session, (document) => {
    const found: ListedField[] = [];
    const pages = document.countPages();
    for (let page = 0; page < pages; page += 1) {
      let index = 0;
      const loaded = document.loadPage(page);
      const transform = frameOf(loaded);
      for (const widget of loaded.getWidgets()) {
        if (found.length >= MAX_LISTED_FIELDS) return { fields: found, truncated: true };
        const kind = kindOf(widget);
        // A PUSH BUTTON IS A BUTTON WITH NO STATE, and the two questions came
        // apart on 2026-09-07: it was reported `on: false`, which reads as *a
        // box that is unticked* rather than *a control that has no tick*. It
        // reached that answer through the `/AP` `/N` hazard {@link onState}
        // records — a stream whose first key is `BBox`. Both halves are fixed:
        // the caller no longer asks, and the reader no longer answers.
        const stateful = kind === 'checkbox' || kind === 'radio';
        found.push({
          page,
          index: index++,
          kind,
          name: widget.getName().slice(0, MAX_FIELD_TEXT),
          // EMPTY FOR EVERY BUTTON KIND, which is the trap made unrepresentable
          // rather than described: `/V` would answer the on-state name here,
          // and a push button's is meaningless in a different way again.
          values: stateful || kind === 'button' ? [] : fieldValues(widget),
          on: stateful ? onState(widget) : null,
          options: widget.getOptions().slice(0, MAX_FIELD_OPTIONS),
          readOnly: widget.isReadOnly(),
          rect: transform === null ? null : readRect(widget, transform),
        });
      }
    }
    return { fields: found, truncated: false };
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
    if (value.option !== '' && !widget.getOptions().includes(value.option)) {
      throw new Error(
        `The field "${widget.getName()}" does not offer the option ${JSON.stringify(value.option)}. ` +
          'The document decides what a choice field may hold, and MuPDF stores an unlisted value ' +
          'without complaint — measured — so the refusal is here.',
      );
    }
    return;
  }
  if (!widget.isCheckbox() && !widget.isRadioButton()) {
    throw new Error(`An on-state cannot fill a ${kind} field ("${widget.getName()}").`);
  }
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
export function fillWidget(widget: PDFWidget, value: FieldFill): void {
  fill(widget, value);
}

/** Puts one value into one widget, having refused everything the document forbids. */
function fill(widget: PDFWidget, value: FieldFill): void {
  refuseUnfillable(widget, value);
  if (value.set === 'text') widget.setTextValue(value.text);
  else if (value.set === 'choice') widget.setChoiceValue(value.option);
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
    fill(widgetAt(loaded, command.index), command.value);
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
            { page: command.page, index: command.index, value: { set: 'button', on: false } }
          : { page: found.page, index: found.index, value: { set: 'button', on: true } },
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
    fill(widgetAt(loaded, inverse.index), inverse.value);
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
 */
function pruneEmptyFields(document: PDFDocument): void {
  const acroForm = document.getTrailer().get('Root').get('AcroForm');
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
 * ## The whole document, because that is what the engine offers
 *
 * `bake` takes no page and no field list. A per-field flatten would be this
 * build re-deriving *which objects make up this field's appearance*, which is
 * the engine's rule (B3a) — and the payload says so by having no members at
 * all beyond its kind.
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
export const applyFlattenFormFields: Apply<'mupdf', 'flattenFormFields'> = (session) =>
  withDocumentRemoving(session, (document) => {
    document.bake(false, true);
  });

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
export const invertFlattenFormFields: Invert<'mupdf', 'flattenFormFields'> = (): Promise<void> => {
  throw new Error(
    'a flattened form has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
};
