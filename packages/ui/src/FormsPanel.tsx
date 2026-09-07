import { useLingui } from '@lingui/react';
import type { ContractClient, FieldFill, FormFieldKind } from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import {
  FORMS_CHOICE_EMPTY,
  FORMS_DELETE,
  FORMS_EMPTY,
  FORMS_GO_TO_PAGE,
  FORMS_KIND_BUTTON,
  FORMS_KIND_CHECKBOX,
  FORMS_KIND_DROPDOWN,
  FORMS_KIND_LISTBOX,
  FORMS_KIND_OTHER,
  FORMS_KIND_RADIO,
  FORMS_KIND_SIGNATURE,
  FORMS_KIND_TEXT,
  FORMS_LABEL,
  FORMS_NOT_FILLABLE,
  FORMS_READ_ONLY,
  FORMS_ROW,
  FORMS_TRUNCATED,
  FORMS_UNAVAILABLE,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';

/**
 * Every AcroForm field in the document, with the control that fills it.
 *
 * ## Six types is six controls, and that is the row's own words
 *
 * `docs/FEATURES.md`'s D5 row asks for *render and fill all AcroForm field
 * types*, and a panel that showed one control for all of them would be
 * answering a different question. A tick box, a set of options and a list of
 * choices are three different gestures, and the kernel refuses a value aimed at
 * the wrong one — measured, because MuPDF does not.
 *
 * ## A FIELD IS NAMED BY ITS PLACE IN THE WALK, never by its name
 *
 * Measured 2026-09-07: both widgets of a radio group answer `applicant.post`,
 * so the name is what a person reads and `index` is what points. Every control
 * here dispatches `{ page, index, version }` taken from the answer it was built
 * from, exactly as `AnnotationsPanel` does — and taken from the STATE rather
 * than from the `version` prop, so the handle cannot be built from a value that
 * can never disagree.
 *
 * ## The row shows the field's own name, which is document data
 *
 * A form's vocabulary belongs to whoever wrote the form, so `name` is rendered
 * rather than translated — the same treatment `AnnotationsPanel` gives a
 * foreign annotation's note. What is translated is everything around it: the
 * kind, the page, and the two reasons a control may be absent.
 *
 * ## Read-only and unfillable are DIFFERENT ABSENCES
 *
 * A locked field is one this document decided about; a signature or a push
 * button is not a field anybody types into. Collapsing them would tell a reader
 * that a Send button might become editable if the document changed, and would
 * hide the one fact a person can act on — asking whoever produced the form.
 *
 * ## Raw controls rather than the `Input` primitive, and the reason is B9
 *
 * `primitives/Input.tsx` types its `label` as a `MessageKey`, which is
 * ADR-0029 Decision 6 working: a text-bearing prop a string literal cannot
 * satisfy. A form field's label is **the document's own name for it**, which is
 * data rather than a catalogue entry and can never be a key — so the primitive
 * is not the wrong choice here, it is one that cannot express this label. The
 * accessible name comes from `aria-label` on each control, which is what makes
 * one row's input distinguishable from another's to a screen reader.
 *
 * A widened primitive taking *either* a key or a string is the shape to avoid:
 * it would make the wrong choice available at every other call site, which is
 * exactly the guarantee the `MessageKey` type is there to give.
 */
export function FormsPanel({
  client,
  docId,
  version,
  onJump,
  onFill,
  onDelete,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The version the shell has. Re-reads when it moves. */
  readonly version: DocVersion | undefined;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
  /**
   * Fills one field, named by the handle the row was built from.
   *
   * Dispatched from the SURFACE for `AnnotationsPanel.onRemove`'s reason: a
   * registered command's `run` takes no arguments, because a menu, a chord and
   * the palette all invoke it and none of them can supply a handle. A row can.
   */
  readonly onFill: (handle: {
    readonly page: number;
    readonly index: number;
    readonly version: DocVersion;
    readonly value: FieldFill;
  }) => void;
  /**
   * Deletes one field, named by the handle the row was built from.
   *
   * **Offered on every row, including the ones with no fill control.** A
   * signature, a push button and a read-only field cannot be *filled* here, and
   * that is a statement about the value; removing the field from the document
   * is a different action, and the reasons the first is refused say nothing
   * about the second. A document's read-only flag governs filling, not editing
   * the form's structure.
   */
  readonly onDelete: (handle: {
    readonly page: number;
    readonly index: number;
    readonly version: DocVersion;
  }) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  useEffect(() => {
    if (docId === undefined || version === undefined) return;
    let cancelled = false;

    void client['document.formFields']({ docId }).then(
      (answer) => {
        if (cancelled) return;
        // A REFUSAL IS ITS OWN STATE, not an empty list — `AnnotationsPanel`'s
        // rule, and the reason is the same: *this document has no fields* and
        // *we could not ask* are different things to tell a person about a form
        // they are trying to fill in.
        setState(
          answer.ok
            ? {
                kind: 'listed',
                version,
                fields: answer.value.fields,
                truncated: answer.value.truncated,
              }
            : { kind: 'unavailable', version },
        );
      },
      () => {
        if (!cancelled) setState({ kind: 'unavailable', version });
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [client, docId, version]);

  // THE STATE CARRIES THE VERSION IT DESCRIBES. Showing the previous version's
  // fields while the new answer is in flight would be rows whose indices point
  // into a walk that has moved, and every control on them writes.
  if (docId === undefined || version === undefined || state.kind === 'idle') return null;
  if (state.version !== version) return null;

  return (
    <section className="m-forms-panel" aria-label={i18n._(FORMS_LABEL)}>
      {state.kind === 'unavailable' ? (
        <p className="m-forms-empty">{i18n._(FORMS_UNAVAILABLE)}</p>
      ) : state.fields.length === 0 ? (
        <p className="m-forms-empty">{i18n._(FORMS_EMPTY)}</p>
      ) : (
        <>
          <ul className="m-forms-list">
            {state.fields.map((field, at) => (
              // THE LIST POSITION IS THE REACT KEY and NOT the handle, for
              // `AnnotationsPanel`'s reason: `at` is where the row sits in this
              // array and `field.index` is where the widget sits in the walk on
              // its own page. They agree on a one-page form and diverge on the
              // second page, so a handle built from `at` would fill the wrong
              // field on every document but the simplest.
              <li className="m-forms-row" key={at}>
                <button
                  className="m-forms-jump"
                  onClick={() => {
                    onJump(field.page);
                  }}
                  title={i18n._(FORMS_GO_TO_PAGE, { page: pdfjsPageOf(field.page) })}
                  type="button"
                >
                  {i18n._(FORMS_ROW, {
                    // THE DOCUMENT'S OWN WORD for this field, rendered rather
                    // than translated. A form's vocabulary is not this
                    // application's to rewrite.
                    name: field.name,
                    kind: i18n._(KIND_LABELS[field.kind]),
                    page: pdfjsPageOf(field.page),
                  })}
                </button>
                <FieldControl
                  field={field}
                  onFill={(value) => {
                    onFill({
                      page: field.page,
                      index: field.index,
                      // FROM THE STATE, not the prop. The guard above returns
                      // null unless they are equal, and taking it from the
                      // answer anyway is the point: the handle is *page, index
                      // and the version its walk was read at*, and a version
                      // that can never disagree is a guard that cannot fire.
                      version: state.version,
                      value,
                    });
                  }}
                />
                <button
                  className="m-forms-delete"
                  onClick={() => {
                    onDelete({
                      page: field.page,
                      index: field.index,
                      // FROM THE STATE, for the fill's reason: the handle is
                      // *page, index and the version its walk was read at*, and
                      // a version that can never disagree is a guard that
                      // cannot fire.
                      version: state.version,
                    });
                  }}
                  title={i18n._(FORMS_DELETE)}
                  type="button"
                >
                  {i18n._(FORMS_DELETE)}
                </button>
              </li>
            ))}
          </ul>
          {state.truncated ? <p className="m-forms-empty">{i18n._(FORMS_TRUNCATED)}</p> : null}
        </>
      )}
    </section>
  );
}

/**
 * The control for one field, chosen by what the document says the field is.
 *
 * ## The two absences are separate, and neither is a disabled control
 *
 * A read-only field and an unfillable one both render as text with a reason,
 * rather than as a control that is present and refuses. The wired-tools rule
 * cuts both ways: a control that renders and does nothing is a defect, and the
 * honest rendering of *this cannot be filled* is not a control at all.
 *
 * ## Uncontrolled, deliberately
 *
 * Every control here shows the document's value and reports a change; none
 * holds a draft. The document is the state, the command is how it moves, and a
 * local copy would be a second answer to *what does this field say* — which is
 * the state that survives a failed command and shows a value the file does not
 * have.
 *
 * A text field therefore commits on blur and on Enter rather than per
 * keystroke: a command per character would be a log entry per character, and
 * §4's one-intent-one-entry is what that would break.
 */
function FieldControl({
  field,
  onFill,
}: {
  readonly field: PanelField;
  readonly onFill: (value: FieldFill) => void;
}): ReactElement {
  const { i18n } = useLingui();

  if (field.readOnly) return <span className="m-forms-locked">{i18n._(FORMS_READ_ONLY)}</span>;

  if (field.kind === 'text') {
    return (
      <input
        className="m-forms-text"
        // THE FIELD'S OWN NAME AS THE ACCESSIBLE NAME. B9 asks for no literal
        // user-facing string; this is the document's string, and it is the only
        // thing that distinguishes one row's control from another's to a screen
        // reader.
        aria-label={field.name}
        defaultValue={field.value}
        onBlur={(event) => {
          if (event.currentTarget.value !== field.value) {
            onFill({ set: 'text', text: event.currentTarget.value });
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        type="text"
      />
    );
  }

  if (field.kind === 'checkbox' || field.kind === 'radio') {
    return (
      <input
        className="m-forms-check"
        aria-label={field.name}
        // `checked` AND NOT `defaultChecked`: this one really is controlled by
        // the document, because a tick is a whole intent and the command runs
        // on the click. The re-read after the version moves is what changes it.
        checked={field.on === true}
        onChange={(event) => {
          onFill({ set: 'button', on: event.currentTarget.checked });
        }}
        // A CHECKBOX INPUT FOR BOTH, and the type is not a mistake. An HTML
        // radio group is a set of inputs sharing a `name` where exactly one is
        // chosen and none can be unchosen by clicking it; a PDF radio group
        // deselects when its lit widget is toggled — measured. Rendering it as
        // an HTML radio would hide a state the document has and the format
        // allows. The row's own label says which option this is.
        type="checkbox"
      />
    );
  }

  if (field.kind === 'dropdown' || field.kind === 'listbox') {
    return (
      <select
        className="m-forms-choice"
        aria-label={field.name}
        onChange={(event) => {
          onFill({ set: 'choice', option: event.currentTarget.value });
        }}
        // A LIST SHOWS SEVERAL ROWS and a dropdown shows one, which is the
        // whole difference between the two kinds at this level. Both write one
        // option: `/Ff`'s multi-select bit is a document capability this build
        // does not yet write, and offering it would be a control whose command
        // cannot express what it collected.
        size={field.kind === 'listbox' ? Math.min(field.options.length, LIST_ROWS) : undefined}
        value={field.value}
      >
        {/* THE EMPTY CHOICE IS ALWAYS OFFERED, because clearing is a fill: a
            document may arrive with a field already cleared, and a list with no
            empty entry could not show that state, let alone return to it. */}
        <option value="">{i18n._(FORMS_CHOICE_EMPTY)}</option>
        {field.options.map((option, at) => (
          <option key={at} value={option}>
            {option}
          </option>
        ))}
        {/* A VALUE THE DOCUMENT DOES NOT OFFER is shown rather than dropped.
            MuPDF stores one without complaint — measured — so a form can arrive
            holding it, and a `<select>` whose value matches no option renders as
            blank, which reads as an empty field rather than as a strange one. */}
        {field.value !== '' && !field.options.includes(field.value) ? (
          <option value={field.value}>{field.value}</option>
        ) : null}
      </select>
    );
  }

  return <span className="m-forms-locked">{i18n._(FORMS_NOT_FILLABLE)}</span>;
}

/**
 * How many rows of a list are shown at once.
 *
 * A number in a component, and it is the exception §10.2 names rather than a
 * magic one: `size` is a count of rows in a `<select>`, not a length in pixels,
 * and there is no token for *how many options a reader can see*.
 */
const LIST_ROWS = 4;

/**
 * A label per kind, which is what the contract's closed union buys.
 *
 * A `Record` over the union rather than a lookup with a fallback:
 * `AnnotationsPanel`'s argument, and its recorded defect — the copy that went on
 * satisfying the table while the channel grew past it. The type is imported.
 */
const KIND_LABELS: Record<FormFieldKind, MessageKey> = {
  text: FORMS_KIND_TEXT,
  // THE WORDS ON A FORM, not the format's. A person ticks a box and chooses an
  // option; `/Btn` with the radio flag is a term of art nobody filling in a
  // form has met.
  checkbox: FORMS_KIND_CHECKBOX,
  radio: FORMS_KIND_RADIO,
  dropdown: FORMS_KIND_DROPDOWN,
  listbox: FORMS_KIND_LISTBOX,
  signature: FORMS_KIND_SIGNATURE,
  button: FORMS_KIND_BUTTON,
  other: FORMS_KIND_OTHER,
};

/** One field, as the contract carries it. */
interface PanelField {
  readonly page: number;
  /**
   * The handle's other half — where this widget sits in the WIDGET walk on its
   * own page, which shares no entries with the annotation walk.
   *
   * Carried but never computed here, for `AnnotationsPanel`'s reason: it is
   * minted by the kernel's reader and resolved by its apply.
   */
  readonly index: number;
  /** **The contract's type, not a copy of its members.** See {@link KIND_LABELS}. */
  readonly kind: FormFieldKind;
  /** The document's own name for the field. Not unique across widgets. */
  readonly name: string;
  /** Empty for every button kind, by construction — see the kernel's reader. */
  readonly value: string;
  /** Whether THIS widget is on, or `null` for a field with no on-state. */
  readonly on: boolean | null;
  readonly options: readonly string[];
  readonly readOnly: boolean;
}

/**
 * What the panel is showing.
 *
 * Three states rather than a list plus a flag: *refused, and here are no
 * fields* would be a state nothing can produce and every reader has to rule
 * out (B5).
 */
type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unavailable'; readonly version: DocVersion }
  | {
      readonly kind: 'listed';
      readonly version: DocVersion;
      readonly fields: readonly PanelField[];
      readonly truncated: boolean;
    };
