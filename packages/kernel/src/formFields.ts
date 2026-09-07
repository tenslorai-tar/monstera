import type { AnnotationRect, FormFieldKind } from '@monstera/contract';
import type { PDFWidget } from 'mupdf';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { frameOf, readRect } from './pageAnnotations.js';

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
  if (!normal.isDictionary()) return false;
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
        const button = kind === 'checkbox' || kind === 'radio' || kind === 'button';
        found.push({
          page,
          index: index++,
          kind,
          name: widget.getName().slice(0, MAX_FIELD_TEXT),
          // EMPTY FOR A BUTTON, which is the trap made unrepresentable rather
          // than described: `getValue()` would answer the on-state name here.
          value: button ? '' : widget.getValue().slice(0, MAX_FIELD_TEXT),
          on: button ? onState(widget) : null,
          options: widget.getOptions().slice(0, MAX_FIELD_OPTIONS),
          readOnly: widget.isReadOnly(),
          rect: transform === null ? null : readRect(widget, transform),
        });
      }
    }
    return { fields: found, truncated: false };
  });
}
