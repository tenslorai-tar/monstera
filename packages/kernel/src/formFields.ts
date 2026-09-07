import type { AnnotationRect, CommandOfKind, FieldFill, FormFieldKind } from '@monstera/contract';
import type { PDFDocument, PDFPage, PDFWidget } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
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
   * field's selected option.
   *
   * **Empty for every button kind**, which is the whole of the trap above made
   * structural: there is no string here for a caller to mistake for a state.
   */
  readonly value: string;
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
  // `'other'` IS THE HONEST ANSWER for a type this build cannot name, and the
  // field is listed rather than dropped — a panel that silently omitted a
  // document's own fields is worse than one that names them vaguely.
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
  const normal = widget.getObject().get('AP').get('N');
  // A STREAM ANSWERS `isDictionary()` TOO, measured 2026-09-07: `/AP` `/N` is a
  // state dictionary on a checkbox or radio and a STREAM on every other kind,
  // and a walk over a stream's keys yields `BBox`, `Matrix`, `Resources` — any
  // of which would be taken as this widget's name for *on*. The caller reaches
  // here only for a stateful button, so this is the second line of defence
  // rather than the only one; it is here because the reading it prevents is
  // plausible-looking rather than obviously wrong.
  if (normal.isStream() || !normal.isDictionary()) return false;
  let name: string | undefined;
  normal.forEach((_appearance, key) => {
    // THE FIRST NON-`Off` KEY. The format allows several on-states and no
    // document here has one; taking the first is stated rather than assumed
    // unique, because a second would otherwise be silently ignored.
    if (name === undefined && String(key) !== 'Off') name = String(key);
  });
  // `getValue()` IS THE FIELD'S VALUE, not the widget's — measured, and it is
  // what makes this comparison meaningful: both widgets of a group answer the
  // same string, and only one of them has a key equal to it.
  return name !== undefined && name === widget.getValue();
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
          // rather than described: `getValue()` would answer the on-state name
          // here, and a push button's is meaningless in a different way again.
          value: stateful || kind === 'button' ? '' : widget.getValue().slice(0, MAX_FIELD_TEXT),
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
function refuseUnfillable(widget: PDFWidget, value: FieldFill): void {
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
      const held = widget.getValue();
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
