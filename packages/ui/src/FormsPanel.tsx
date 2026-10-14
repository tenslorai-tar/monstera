import { useLingui } from '@lingui/react';
import type { ContractClient, FieldFill, FormFieldKind } from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useId, useState } from 'react';

import { ChoiceOptions, FieldTextBox } from './forms/FieldControls.js';
import { type ListedField, fieldFill } from './forms/fieldFill.js';
import { type FieldKey, type SelectMode, fieldKey, modeOf } from './forms/fieldSelection.js';
import {
  FORMS_EMPTY,
  FORMS_EMPTY_VALUE,
  FORMS_FLATTEN,
  FORMS_FLATTEN_CONFIRM,
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
  FORMS_NO_MATCH,
  FORMS_NOT_FILLABLE,
  FORMS_SIGN_ON_PAGE,
  FORMS_PAGE,
  FORMS_ROW,
  FORMS_SEARCH,
  FORMS_TRUNCATED,
  FORMS_UNAVAILABLE,
} from './messages/en.js';
import { Icon } from './primitives/Icon.js';
import type { IconName } from './primitives/icons.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { readWholeList } from './readWholeList.js';

/**
 * Every AcroForm field in the document: the Fields list (the owner's K3, ADR-0226).
 *
 * ## A tree by page, a kind's icon, the name, the value
 *
 * PDF-XChange's shape: the fields grouped under the page they sit on, each row the field's kind as an icon and its own
 * name, and its value beside it. A radio group is ONE row with its options under it, because the options are one
 * field. A search box at the top narrows the rows by name. There is no Delete on a row: removing a field is the Delete
 * key and the right-click menu, which are the registered command every other surface uses (`annotate.delete-selection`).
 *
 * ## The value is filled IN PLACE, and the page stays the primary way to fill (A1.2)
 *
 * A text value reads as words; a click on it opens the field's box where the words were, and leaving it fills. A tick
 * box and a radio option are filled by a click on their mark. A dropdown and a list are a list of their options. No
 * empty grey box sits on a row waiting to be typed into: an empty value says so in words.
 *
 * ## A FIELD IS NAMED BY ITS PLACE IN THE WALK, never by its name
 *
 * Measured 2026-09-07: both widgets of a radio group answer `applicant.post`, so the name is what a person reads and
 * `index` is what points. Every control here dispatches `{ page, index, version }` taken from the answer it was built
 * from, exactly as `AnnotationsPanel` does, and taken from the STATE rather than from the `version` prop, so the
 * handle cannot be built from a value that can never disagree.
 *
 * ## The row shows the field's own name, which is document data
 *
 * A form's vocabulary belongs to whoever wrote the form, so `name` is rendered rather than translated, the same
 * treatment `AnnotationsPanel` gives a foreign annotation's note. What is translated is everything around it.
 *
 * ## Read-only and unfillable are DIFFERENT ABSENCES
 *
 * A locked field is one this document decided about; a signature or a push button is not a field anybody types into.
 * Collapsing them would tell a reader that a Send button might become editable if the document changed.
 */
export function FormsPanel({
  client,
  docId,
  version,
  onJump,
  selected,
  onSelect,
  onProperties,
  onFill,
  onFlatten,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The version the shell has. Re-reads when it moves. */
  readonly version: DocVersion | undefined;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
  /** The fields selected, by page and place in its walk (`forms/fieldSelection.ts`): the rows drawn as chosen. */
  readonly selected: ReadonlySet<FieldKey>;
  /**
   * A click on a row's name: select that field (Ctrl toggles, Shift takes a run in this list's order), which also
   * outlines it on its page and brings it into view. `ordered` is every row in the order shown.
   */
  readonly onSelect: (page: number, index: number, mode: SelectMode, ordered: readonly FieldKey[]) => void;
  /** A double click on a row's name: its properties, in the Properties tab. */
  readonly onProperties: () => void;
  /**
   * Fills one field, named by the handle the row was built from.
   *
   * Dispatched from the SURFACE for `AnnotationsPanel.onRemove`'s reason: a registered command's `run` takes no
   * arguments, because a menu, a chord and the palette all invoke it and none of them can supply a handle. A row can.
   */
  readonly onFill: (handle: {
    readonly page: number;
    readonly index: number;
    readonly version: DocVersion;
    readonly value: FieldFill;
  }) => void;
  /**
   * Flattens the whole form. **No handle at all**: MuPDF's `bake` takes no page and no field list. **The command asks
   * first** (`dialogs/flattenForm.ts`), the owner's F-F1.
   */
  readonly onFlatten: () => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const [query, setQuery] = useState('');
  const panelId = useId();

  useEffect(() => {
    if (docId === undefined || version === undefined) return;
    let cancelled = false;

    void readWholeList(
      (from) => client['document.formFields']({ docId, from }),
      (part) => part.fields,
    ).then(
      (answer) => {
        if (cancelled) return;
        // A REFUSAL IS ITS OWN STATE, not an empty list: *this document has no fields* and *we could not ask* are
        // different things to tell a person about a form they are trying to fill in.
        setState(
          answer.ok
            ? { kind: 'listed', version, fields: answer.value.items, truncated: answer.value.last.truncated }
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

  // THE STATE CARRIES THE VERSION IT DESCRIBES. Showing the previous version's fields while the new answer is in flight
  // would be rows whose indices point into a walk that has moved, and every control on them writes.
  if (docId === undefined || version === undefined || state.kind === 'idle') return null;
  if (state.version !== version) return null;

  if (state.kind === 'unavailable') {
    return (
      <section className="m-forms-panel" aria-label={i18n._(FORMS_LABEL)}>
        <p className="m-forms-empty">{i18n._(FORMS_UNAVAILABLE)}</p>
      </section>
    );
  }
  if (state.fields.length === 0) {
    return (
      <section className="m-forms-panel" aria-label={i18n._(FORMS_LABEL)}>
        <p className="m-forms-empty">{i18n._(FORMS_EMPTY)}</p>
      </section>
    );
  }

  const wanted = query.trim().toLowerCase();
  const shown = wanted === '' ? state.fields : state.fields.filter((field) => field.name.toLowerCase().includes(wanted));
  const ordered = shown.map((field) => fieldKey(field.page, field.index));
  const fill = (field: ListedField) => (value: FieldFill): void => {
    // FROM THE STATE, not the prop: the handle is *page, index and the version its walk was read at*.
    onFill({ page: field.page, index: field.index, version: state.version, value });
  };
  const choose = (field: ListedField, mode: SelectMode): void => {
    // ONE CLICK SELECTS ONE FIELD, outlines it on its page and brings it into view; the page is jumped to first so the
    // outline has a page to be on.
    if (mode === 'replace') onJump(field.page);
    onSelect(field.page, field.index, mode, ordered);
  };

  return (
    <section className="m-forms-panel" aria-label={i18n._(FORMS_LABEL)}>
      <input
        aria-label={i18n._(FORMS_SEARCH)}
        className="m-forms-search"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
        placeholder={i18n._(FORMS_SEARCH)}
        type="search"
        value={query}
      />
      {shown.length === 0 ? <p className="m-forms-empty">{i18n._(FORMS_NO_MATCH)}</p> : null}
      {pagesOf(shown).map(({ page, rows }) => (
        <section className="m-forms-page" key={page}>
          <h3 className="m-forms-page__title">{i18n._(FORMS_PAGE, { page: pdfjsPageOf(page) })}</h3>
          <ul className="m-forms-list">
            {rows.map((row) =>
              row.kind === 'group' ? (
                <li className="m-forms-row m-forms-row--group" key={`group:${row.name}`}>
                  <NameButton
                    chosen={row.options.some((option) => selected.has(fieldKey(option.page, option.index)))}
                    field={row.options[0] ?? row.first}
                    onChoose={choose}
                    onProperties={onProperties}
                  />
                  <ul className="m-forms-options">
                    {row.options.map((option) => (
                      <li
                        className="m-forms-option"
                        data-form-row-selected={selected.has(fieldKey(option.page, option.index)) ? 'true' : undefined}
                        key={option.index}
                      >
                        <FieldValue field={option} group={`${panelId}:${row.name}`} onFill={fill(option)} />
                        <button
                          aria-pressed={selected.has(fieldKey(option.page, option.index))}
                          className="m-forms-option__name"
                          onClick={(event) => {
                            choose(option, modeOf(event));
                          }}
                          type="button"
                        >
                          {optionName(option)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li
                  className="m-forms-row"
                  data-form-row-selected={selected.has(fieldKey(row.field.page, row.field.index)) ? 'true' : undefined}
                  key={row.field.index}
                >
                  <NameButton
                    chosen={selected.has(fieldKey(row.field.page, row.field.index))}
                    field={row.field}
                    onChoose={choose}
                    onProperties={onProperties}
                  />
                  <FieldValue field={row.field} group={`${panelId}:${row.field.name}`} onFill={fill(row.field)} />
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
      {state.truncated ? <p className="m-forms-empty">{i18n._(FORMS_TRUNCATED)}</p> : null}
      {/* INSIDE THE BRANCH THAT HAS FIELDS, so it is not offered on a document with none, and OFFERED EVEN WHEN EVERY
          FIELD IS TRUNCATED AWAY: `bake` acts on the document, not on the rows this panel managed to list. */}
      <button className="m-forms-flatten" onClick={onFlatten} title={i18n._(FORMS_FLATTEN_CONFIRM)} type="button">
        {i18n._(FORMS_FLATTEN)}
      </button>
    </section>
  );
}

/** A row's name: a click selects, a double click opens its properties. The kind is its icon and its accessible name. */
function NameButton({
  field,
  chosen,
  onChoose,
  onProperties,
}: {
  readonly field: ListedField;
  readonly chosen: boolean;
  readonly onChoose: (field: ListedField, mode: SelectMode) => void;
  readonly onProperties: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  return (
    <button
      aria-label={i18n._(FORMS_ROW, { name: field.name, kind: i18n._(KIND_LABELS[field.kind]), page: pdfjsPageOf(field.page) })}
      aria-pressed={chosen}
      className="m-forms-jump"
      onClick={(event) => {
        onChoose(field, modeOf(event));
      }}
      onDoubleClick={onProperties}
      title={i18n._(FORMS_GO_TO_PAGE, { page: pdfjsPageOf(field.page) })}
      type="button"
    >
      <Icon name={KIND_ICONS[field.kind]} size="dense" />
      {/* THE DOCUMENT'S OWN WORD for this field, rendered rather than translated. */}
      <span className="m-forms-jump__name">{field.name}</span>
    </button>
  );
}

/**
 * What a radio option stands for: its own value, the one thing that tells one option from another. Never the group's
 * first option, which every widget of the group answers alike (the owner's F9, "Male, Male").
 */
function optionName(option: ListedField): string {
  return option.option ?? option.name;
}

/**
 * A field's value, filled where it is shown.
 *
 * ## The two absences are separate, and neither is a disabled control
 *
 * A read-only field and an unfillable one both render as text with a reason, rather than as a control that is present
 * and refuses. A control that renders and does nothing is a defect, and the honest rendering of *this cannot be filled*
 * is not a control at all.
 *
 * ## The document is the state
 *
 * Every control here shows the document's value and reports a change; none holds a draft, which would be a second
 * answer to *what does this field say*. A text value commits when its box is left or on Enter, not per keystroke.
 */
function FieldValue({
  field,
  group,
  onFill,
}: {
  readonly field: ListedField;
  /** The radio group this field's options share: its name, scoped by the panel. */
  readonly group: string;
  readonly onFill: (value: FieldFill) => void;
}): ReactElement {
  const { i18n } = useLingui();
  // THE BOX OPEN IN PLACE, with where the press landed so the caret goes there (ADR-0226 Decision 3), or none.
  const [typing, setTyping] = useState<{ readonly at: { readonly x: number; readonly y: number } | undefined } | undefined>();
  // WHAT MAY BE DONE WITH IT is `fieldFill`'s, which the page's form layer takes too (ADR-0168 Decision 2).
  const offer = fieldFill(field);

  if (offer.kind === 'none') return <span className="m-forms-locked">{i18n._(offer.reason, offer.values)}</span>;
  // A PUSH BUTTON is pressed on the page, where it says what it cannot do; a second press point here would say it twice.
  if (offer.kind === 'button') return <span className="m-forms-locked">{i18n._(FORMS_NOT_FILLABLE)}</span>;
  // AN EMPTY SIGNATURE FIELD is signed on the page, where the signature is drawn (the owner's F8); the list says where.
  if (offer.kind === 'sign') return <span className="m-forms-locked">{i18n._(FORMS_SIGN_ON_PAGE)}</span>;

  if (offer.kind === 'choices') {
    return (
      <select
        className="m-forms-choice"
        aria-label={field.name}
        multiple
        onChange={(event) => {
          onFill({ set: 'choices', options: [...event.currentTarget.selectedOptions].map((option) => option.value) });
        }}
        size={Math.min(offer.options.length, LIST_ROWS)}
        value={[...offer.held]}
      >
        {offer.options.map((option, at) => (
          <option key={at} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (offer.kind === 'text') {
    if (typing !== undefined) {
      return (
        <FieldTextBox
          autoFocus
          className="m-forms-text"
          // THE FIELD'S OWN NAME AS THE ACCESSIBLE NAME: the document's string, and the only thing that tells one row's
          // box from another's to a screen reader.
          name={field.name}
          offer={offer}
          onCancel={() => {
            setTyping(undefined);
          }}
          onCommit={(text) => {
            onFill({ set: 'text', text });
          }}
          onDone={() => {
            setTyping(undefined);
          }}
          pressedAt={typing.at}
          rows={TEXT_ROWS}
          selectsAll={typing.at === undefined}
        />
      );
    }
    return (
      <button
        aria-label={field.name}
        className={offer.held === '' ? 'm-forms-value m-forms-value--empty' : 'm-forms-value'}
        onClick={(event) => {
          // A KEYBOARD'S PRESS (`detail` 0) has no place, and opens the box with its words selected, as Tab does.
          setTyping({ at: event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY } });
        }}
        type="button"
      >
        {offer.held === '' ? i18n._(FORMS_EMPTY_VALUE) : offer.held}
      </button>
    );
  }

  if (offer.kind === 'toggle' && !offer.radio) {
    return (
      <button
        aria-checked={offer.on}
        aria-label={field.name}
        className="m-forms-mark"
        // A TICK IS A WHOLE INTENT and the command runs on the click; the re-read after the version moves is what
        // changes the mark.
        onClick={() => {
          onFill({ set: 'button', on: !offer.on });
        }}
        role="checkbox"
        type="button"
      >
        <Icon name={offer.on ? 'SquareCheck' : 'Square'} size="dense" />
      </button>
    );
  }

  if (offer.kind === 'toggle') {
    return (
      <button
        aria-checked={offer.on}
        aria-label={`${field.name}: ${optionName(field)}`}
        className="m-forms-mark"
        data-group={group}
        // CHOOSING an option that is off, and CLEARING the chosen one: a PDF radio group deselects when its lit widget
        // is toggled (measured), so an option that could not be cleared here would hide a state the document allows.
        onClick={() => {
          onFill({ set: 'button', on: !offer.on });
        }}
        role="radio"
        type="button"
      >
        <Icon name={offer.on ? 'CircleDot' : 'Circle'} size="dense" />
      </button>
    );
  }

  return (
    <select
      className="m-forms-choice"
      aria-label={field.name}
      onChange={(event) => {
        onFill({ set: 'choice', option: event.currentTarget.value });
      }}
      // A LIST SHOWS SEVERAL ROWS and a dropdown shows one, which is the whole difference between the two kinds here.
      size={field.kind === 'listbox' ? Math.min(field.options.length, LIST_ROWS) : undefined}
      value={offer.held}
    >
      <ChoiceOptions offer={offer} />
    </select>
  );
}

/** One row of a page: a field, or a radio group with its options under it. */
type Row =
  | { readonly kind: 'field'; readonly field: ListedField }
  | { readonly kind: 'group'; readonly name: string; readonly first: ListedField; readonly options: readonly ListedField[] };

/**
 * The fields grouped by page in the walk's order, a radio group's options gathered under its first one on that page.
 * The walk's order and not the name's: a person reads a page top to bottom, and the walk is the document's own order.
 */
function pagesOf(fields: readonly ListedField[]): readonly { readonly page: number; readonly rows: readonly Row[] }[] {
  const pages = new Map<number, Row[]>();
  for (const field of fields) {
    const rows = pages.get(field.page) ?? [];
    if (!pages.has(field.page)) pages.set(field.page, rows);
    if (field.kind === 'radio') {
      const at = rows.findIndex((row) => row.kind === 'group' && row.name === field.name);
      const group = rows[at];
      if (group?.kind === 'group') {
        rows[at] = { ...group, options: [...group.options, field] };
        continue;
      }
      rows.push({ kind: 'group', name: field.name, first: field, options: [field] });
      continue;
    }
    rows.push({ kind: 'field', field });
  }
  return [...pages.entries()].sort(([a], [b]) => a - b).map(([page, rows]) => ({ page, rows }));
}

/**
 * How many rows of a list are shown at once. A count of rows in a `<select>`, not a length in pixels, so it is the
 * exception §10.2 names rather than a magic number.
 */
const LIST_ROWS = 4;

/** How many lines a multi-line text field's box shows at once: a count of rows, `LIST_ROWS`' exception. */
const TEXT_ROWS = 3;

/** A label per kind, which is what the contract's closed union buys: a `Record` over the union, never a fallback. */
const KIND_LABELS: Record<FormFieldKind, MessageKey> = {
  text: FORMS_KIND_TEXT,
  // THE WORDS ON A FORM, not the format's: a person ticks a box and chooses an option.
  checkbox: FORMS_KIND_CHECKBOX,
  radio: FORMS_KIND_RADIO,
  dropdown: FORMS_KIND_DROPDOWN,
  listbox: FORMS_KIND_LISTBOX,
  signature: FORMS_KIND_SIGNATURE,
  button: FORMS_KIND_BUTTON,
  other: FORMS_KIND_OTHER,
};

/** The icon per kind, the same glyph its tool has on the ribbon, so a row and the tool that made it look alike. */
const KIND_ICONS: Record<FormFieldKind, IconName> = {
  text: 'TextCursor',
  checkbox: 'SquareCheck',
  radio: 'CircleDot',
  dropdown: 'ChevronDown',
  listbox: 'List',
  signature: 'Signature',
  button: 'RectangleHorizontal',
  other: 'File',
};

/**
 * What the panel is showing. Three states rather than a list plus a flag: *refused, and here are no fields* would be a
 * state nothing can produce and every reader has to rule out (B5).
 */
type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unavailable'; readonly version: DocVersion }
  | {
      readonly kind: 'listed';
      readonly version: DocVersion;
      /** The contract's own rows (`ListedField`): the handle's `index` is the WIDGET walk's, minted by the kernel. */
      readonly fields: readonly ListedField[];
      readonly truncated: boolean;
    };
