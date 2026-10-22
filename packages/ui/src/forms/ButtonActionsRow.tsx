import { useLingui } from '@lingui/react';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import {
  type ButtonAction,
  type ButtonStep,
  FIELD_ACTION_KINDS,
  FIELD_ACTION_TRIGGERS,
  type FieldAction,
  type FieldActionTrigger,
  type FormFieldHandle,
  MAX_ACTION_FIELDS,
  MAX_ACTION_FILE,
  MAX_BUTTON_ACTIONS,
  MAX_LINK_URI,
  SUBMIT_FORMATS,
  buttonActionSchema,
  fieldActionSchema,
  isSubmitAddress,
} from '@monstera/contract';
import type { DocVersion, MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useId, useState } from 'react';

import type { KnownField } from '../annotations/fieldNameCheck.js';
import {
  BUTTON_ACTIONS_LABEL,
  BUTTON_ACTIONS_NONE,
  BUTTON_ACTIONS_READING,
  BUTTON_ACTION_ADD,
  BUTTON_ACTION_CANCEL,
  BUTTON_ACTION_DO,
  BUTTON_ACTION_DOWN,
  BUTTON_ACTION_EDIT,
  BUTTON_ACTION_FIELDS,
  BUTTON_ACTION_FIELDS_ALL,
  BUTTON_ACTION_FIELDS_CHOSEN,
  BUTTON_ACTION_FIELDS_LIMIT,
  BUTTON_ACTION_FIELDS_LIMIT_SOME,
  BUTTON_ACTION_FILE,
  BUTTON_ACTION_FILE_NAME,
  BUTTON_ACTION_FILE_NOTE,
  BUTTON_ACTION_FULL,
  BUTTON_ACTION_KEPT_ROW,
  BUTTON_ACTION_ADDRESS,
  BUTTON_ACTION_ADDRESS_HTTPS,
  BUTTON_ACTION_KIND_GO_TO,
  BUTTON_ACTION_FIELDS_NONE,
  BUTTON_ACTION_HIDE,
  BUTTON_ACTION_KIND_IMPORT,
  BUTTON_ACTION_KIND_LINK,
  BUTTON_ACTION_KIND_SHOW_HIDE,
  BUTTON_ACTION_KIND_OPEN_FILE,
  BUTTON_ACTION_KIND_SUBMIT,
  BUTTON_ACTION_OPEN_FILE,
  BUTTON_ACTION_OPEN_FILE_NOTE,
  BUTTON_ACTION_OPEN_FILE_RULE,
  BUTTON_SUMMARY_OPEN_FILE,
  BUTTON_ACTION_SHOW,
  BUTTON_ACTION_SUBMIT_AS,
  BUTTON_ACTION_SUBMIT_NOTE,
  BUTTON_ACTION_SUBMIT_TO,
  BUTTON_ACTION_SUBMIT_TO_RULE,
  BUTTON_SUMMARY_SUBMIT,
  BUTTON_SUMMARY_HIDE,
  BUTTON_SUMMARY_SHOW,
  BUTTON_ACTION_KIND_PRINT,
  BUTTON_ACTION_KIND_RESET,
  BUTTON_ACTION_PAGE,
  BUTTON_ACTION_PAGE_RANGE,
  BUTTON_ACTION_PRINT_NOTE,
  BUTTON_ACTION_REMOVE,
  BUTTON_ACTION_ROW,
  BUTTON_ACTION_SAVE,
  BUTTON_ACTION_UP,
  BUTTON_ACTION_VIEW,
  BUTTON_ACTION_WHEN,
  BUTTON_SUMMARY_GO_TO,
  BUTTON_SUMMARY_LINK,
  BUTTON_SUMMARY_RESET_ALL,
  BUTTON_SUMMARY_RESET_SOME,
  BUTTON_TRIGGER_DOWN,
  BUTTON_TRIGGER_ENTER,
  BUTTON_TRIGGER_EXIT,
  BUTTON_TRIGGER_UP,
  BUTTON_VIEW_FIT,
  BUTTON_VIEW_FIT_WIDTH,
  BUTTON_VIEW_KEEP,
  FIELD_PROPS_ACTION_OTHER,
} from '../messages/en.js';
import { SUBMIT_FORMAT_NAMES } from '../dialogs/submitForm.js';
import { kernelPageOf, pdfjsPageOf } from '../pageNumbering.js';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';

/** Each trigger's name, as a person meets it. A total record, so a trigger the contract gains has a name or no build. */
const TRIGGER_LABELS: Readonly<Record<FieldActionTrigger, MessageKey>> = {
  up: BUTTON_TRIGGER_UP,
  down: BUTTON_TRIGGER_DOWN,
  enter: BUTTON_TRIGGER_ENTER,
  exit: BUTTON_TRIGGER_EXIT,
};

/** Each kind's name in the *Do* list. Total, for the trigger's reason. */
const KIND_LABELS: Readonly<Record<FieldAction['kind'], MessageKey>> = {
  goTo: BUTTON_ACTION_KIND_GO_TO,
  link: BUTTON_ACTION_KIND_LINK,
  reset: BUTTON_ACTION_KIND_RESET,
  showHide: BUTTON_ACTION_KIND_SHOW_HIDE,
  print: BUTTON_ACTION_KIND_PRINT,
  importData: BUTTON_ACTION_KIND_IMPORT,
  submit: BUTTON_ACTION_KIND_SUBMIT,
  openFile: BUTTON_ACTION_KIND_OPEN_FILE,
};

/** A go-to's view in words. Total, for the trigger's reason. */
const VIEW_LABELS: Readonly<Record<Extract<FieldAction, { kind: 'goTo' }>['view'], MessageKey>> = {
  keep: BUTTON_VIEW_KEEP,
  fit: BUTTON_VIEW_FIT,
  'fit-width': BUTTON_VIEW_FIT_WIDTH,
};

/** A new action of a kind, as the editor starts it: the first page, every field. */
function freshAction(kind: FieldAction['kind']): FieldAction {
  switch (kind) {
    case 'goTo':
      return { kind: 'goTo', page: 0, view: 'keep', at: null };
    case 'link':
      return { kind: 'link', address: 'https://' };
    case 'reset':
      return { kind: 'reset', fields: null };
    // NO FIELD TICKED, which cannot be saved: the standard's `/T` names at least one, and which is the person's choice.
    case 'showHide':
      return { kind: 'showHide', fields: [], hide: true };
    case 'print':
      return { kind: 'print' };
    case 'importData':
      return { kind: 'importData', file: 'form data.fdf' };
    case 'submit':
      return { kind: 'submit', address: 'https://', format: 'fdf', fields: null };
    case 'openFile':
      return { kind: 'openFile', file: 'guide.pdf' };
  }
}

/** An address a submission is written to: a whole `https:` address with a host, or a `mailto:` naming someone. */
function writableSubmitAddress(address: string): boolean {
  if (address.startsWith('mailto:')) return address.length > 'mailto:'.length && isSubmitAddress(address);
  return writableAddress(address);
}

/** An address the editor writes: whole, and `https:` (the owner's R22); a document's own `http:` or `mailto:` is kept. */
function writableAddress(address: string): boolean {
  return address.startsWith('https://') && URL.canParse(address) && new URL(address).hostname !== '';
}

/** One action in words, for its row. */
function summaryOf(action: FieldAction, say: (key: MessageKey, values?: Record<string, unknown>) => string): string {
  switch (action.kind) {
    case 'goTo':
      return say(BUTTON_SUMMARY_GO_TO, { page: pdfjsPageOf(action.page) });
    case 'link':
      return say(BUTTON_SUMMARY_LINK, { address: action.address });
    case 'print':
      return say(BUTTON_ACTION_KIND_PRINT);
    case 'importData':
      return say(BUTTON_ACTION_KIND_IMPORT);
    case 'submit':
      return say(BUTTON_SUMMARY_SUBMIT, { address: action.address });
    case 'openFile':
      return say(BUTTON_SUMMARY_OPEN_FILE, { file: action.file });
    case 'showHide':
      return say(action.hide ? BUTTON_SUMMARY_HIDE : BUTTON_SUMMARY_SHOW, { count: action.fields.length });
    case 'reset':
      return action.fields === null ? say(BUTTON_SUMMARY_RESET_ALL) : say(BUTTON_SUMMARY_RESET_SOME, { count: action.fields.length });
  }
}

/**
 * Whether the editor's action may be saved: what the contract takes, and what only this document can say, a page it
 * has. A go-to to a page past the end would be written and go nowhere.
 */
function savable(draft: ButtonAction, pageCount: number): boolean {
  if (!buttonActionSchema.safeParse(draft).success) return false;
  if (draft.action.kind === 'link') return writableAddress(draft.action.address);
  if (draft.action.kind === 'submit') return writableSubmitAddress(draft.action.address);
  return draft.action.kind !== 'goTo' || draft.action.page < pageCount;
}

/** The steps as the list an edit writes, or `undefined` where one is kept and the list is not this build's to write. */
function editableOf(steps: readonly ButtonStep[]): readonly ButtonAction[] | undefined {
  const actions: ButtonAction[] = [];
  for (const step of steps) {
    if (step.action.kind === 'kept') return undefined;
    actions.push({ trigger: step.trigger, action: step.action });
  }
  return actions;
}

/**
 * A push button's actions in Properties (ADR-0259): the list in the order each trigger runs them, each with Edit, Up,
 * Down and Remove, and Add under it. Adding or editing opens the editor in place, where *When* and *Do* are chosen and
 * then what the action needs; Save writes the whole list.
 *
 * ## Read from the document, one button at a time
 *
 * The list is `document.buttonActions`' answer for this handle, read again whenever the version moves, so what is shown
 * is what the document holds after the last write. A button holding a script or another action this build does not
 * write is shown, each step with what it is, and offered nothing to change: an edit writes the whole list, and the
 * script would be lost (ADR-0259 Decision 5).
 */
export function ButtonActionsRow({
  handle,
  version,
  readActions,
  known,
  pageCount,
  onCommit,
}: {
  readonly handle: FormFieldHandle;
  readonly version: DocVersion;
  readonly readActions: (handle: FormFieldHandle) => Promise<readonly ButtonStep[] | null>;
  /** Every field the form has, for the actions that name fields. */
  readonly known: readonly KnownField[];
  /** How many pages the document has, for the actions that name a page. */
  readonly pageCount: number;
  readonly onCommit: (actions: readonly ButtonAction[]) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const labelId = useId();
  const key = `${String(version)}:${String(handle.page)}:${String(handle.index)}:${handle.name}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly steps: readonly ButtonStep[] | null } | undefined>(undefined);
  const [editing, setEditing] = useState<{ readonly at: number; readonly draft: ButtonAction } | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void readActions(handle).then((steps) => {
      if (live) setAnswer({ key, steps });
    });
    return () => {
      live = false;
    };
  }, [handle, key, readActions]);

  const say = (message: MessageKey, values?: Record<string, unknown>): string => i18n._(message, values);
  const steps = answer?.key === key ? answer.steps : undefined;
  if (steps === undefined || steps === null) {
    return (
      <div aria-labelledby={labelId} className="m-properties__row" role="group">
        <span className="m-properties__label" id={labelId}>
          {say(BUTTON_ACTIONS_LABEL)}
        </span>
        <p className="m-properties__meta">{say(BUTTON_ACTIONS_READING)}</p>
      </div>
    );
  }
  const actions = editableOf(steps);
  const write = (next: readonly ButtonAction[]): void => {
    setEditing(undefined);
    onCommit(next);
  };
  const move = (list: readonly ButtonAction[], at: number, by: -1 | 1): void => {
    const next = [...list];
    const [taken] = next.splice(at, 1);
    if (taken === undefined) return;
    next.splice(at + by, 0, taken);
    write(next);
  };

  return (
    <div aria-labelledby={labelId} className="m-properties__row m-button-actions" role="group">
      <span className="m-properties__label" id={labelId}>
        {say(BUTTON_ACTIONS_LABEL)}
      </span>
      {actions === undefined ? (
        <>
          <ol className="m-field-options__list" data-button-actions="kept">
            {steps.map((step) => (
              <li className="m-button-actions__row" key={`${step.trigger}:${String(step.step)}`}>
                {say(step.action.kind === 'kept' ? BUTTON_ACTION_KEPT_ROW : BUTTON_ACTION_ROW, {
                  when: say(TRIGGER_LABELS[step.trigger]),
                  what: step.action.kind === 'kept' ? step.action.subtype : summaryOf(step.action, say),
                })}
              </li>
            ))}
          </ol>
          <p className="m-properties__meta" data-button-action="other">
            {say(FIELD_PROPS_ACTION_OTHER)}
          </p>
        </>
      ) : (
        <>
          {actions.length === 0 ? <p className="m-properties__meta">{say(BUTTON_ACTIONS_NONE)}</p> : null}
          <ol className="m-field-options__list" data-button-actions="">
            {actions.map((entry, at) => (
              <li className="m-field-options__row m-button-actions__row" key={at}>
                <span className="m-button-actions__words">
                  {say(BUTTON_ACTION_ROW, { when: say(TRIGGER_LABELS[entry.trigger]), what: summaryOf(entry.action, say) })}
                </span>
                <IconButton
                  icon={Pencil}
                  label={BUTTON_ACTION_EDIT}
                  onClick={() => {
                    setEditing({ at, draft: entry });
                  }}
                  size="dense"
                  values={{ number: at + 1 }}
                />
                <IconButton
                  disabled={at === 0}
                  icon={ArrowUp}
                  label={BUTTON_ACTION_UP}
                  onClick={() => {
                    move(actions, at, -1);
                  }}
                  size="dense"
                  values={{ number: at + 1 }}
                />
                <IconButton
                  disabled={at === actions.length - 1}
                  icon={ArrowDown}
                  label={BUTTON_ACTION_DOWN}
                  onClick={() => {
                    move(actions, at, 1);
                  }}
                  size="dense"
                  values={{ number: at + 1 }}
                />
                <IconButton
                  icon={Trash2}
                  label={BUTTON_ACTION_REMOVE}
                  onClick={() => {
                    write(actions.filter((_entry, index) => index !== at));
                  }}
                  size="dense"
                  values={{ number: at + 1 }}
                />
              </li>
            ))}
          </ol>
          {editing === undefined ? (
            <div className="m-field-options__actions">
              <Button
                disabled={actions.length >= MAX_BUTTON_ACTIONS}
                label={BUTTON_ACTION_ADD}
                onClick={() => {
                  setEditing({ at: actions.length, draft: { trigger: 'up', action: freshAction(FIELD_ACTION_KINDS[0]) } });
                }}
              />
            </div>
          ) : (
            <ActionEditor
              draft={editing.draft}
              known={known}
              pageCount={pageCount}
              onCancel={() => {
                setEditing(undefined);
              }}
              onChange={(draft) => {
                setEditing({ at: editing.at, draft });
              }}
              onSave={(draft) => {
                write(editing.at < actions.length ? actions.map((entry, index) => (index === editing.at ? draft : entry)) : [...actions, draft]);
              }}
            />
          )}
          {actions.length >= MAX_BUTTON_ACTIONS ? (
            <p className="m-properties__meta">{say(BUTTON_ACTION_FULL, { count: MAX_BUTTON_ACTIONS })}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The editor for one action, in place: *When*, *Do*, then what the kind needs. Save only when the contract takes it. */
function ActionEditor({
  draft,
  known,
  pageCount,
  onChange,
  onSave,
  onCancel,
}: {
  readonly draft: ButtonAction;
  readonly known: readonly KnownField[];
  readonly pageCount: number;
  readonly onChange: (draft: ButtonAction) => void;
  readonly onSave: (draft: ButtonAction) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const whenId = useId();
  const doId = useId();
  const valid = savable(draft, pageCount);
  return (
    <div className="m-button-actions__editor" data-button-action-editor="">
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={whenId}>
          {i18n._(BUTTON_ACTION_WHEN)}
        </label>
        <select
          className="m-properties__select"
          id={whenId}
          onChange={(event) => {
            const trigger = FIELD_ACTION_TRIGGERS.find((each) => each === event.target.value);
            if (trigger !== undefined) onChange({ ...draft, trigger });
          }}
          value={draft.trigger}
        >
          {FIELD_ACTION_TRIGGERS.map((trigger) => (
            <option key={trigger} value={trigger}>
              {i18n._(TRIGGER_LABELS[trigger])}
            </option>
          ))}
        </select>
      </div>
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={doId}>
          {i18n._(BUTTON_ACTION_DO)}
        </label>
        <select
          className="m-properties__select"
          id={doId}
          onChange={(event) => {
            const kind = FIELD_ACTION_KINDS.find((each) => each === event.target.value);
            if (kind !== undefined && kind !== draft.action.kind) onChange({ ...draft, action: freshAction(kind) });
          }}
          value={draft.action.kind}
        >
          {FIELD_ACTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {i18n._(KIND_LABELS[kind])}
            </option>
          ))}
        </select>
      </div>
      <ActionDetails
        action={draft.action}
        known={known}
        onChange={(action) => {
          onChange({ ...draft, action });
        }}
        pageCount={pageCount}
      />
      <div className="m-field-options__actions">
        <Button
          disabled={!valid}
          label={BUTTON_ACTION_SAVE}
          onClick={() => {
            if (valid) onSave(draft);
          }}
          variant="primary"
        />
        <Button label={BUTTON_ACTION_CANCEL} onClick={onCancel} />
      </div>
    </div>
  );
}

/** What one kind needs beyond *When* and *Do*. */
function ActionDetails({
  action,
  known,
  pageCount,
  onChange,
}: {
  readonly action: FieldAction;
  readonly known: readonly KnownField[];
  readonly pageCount: number;
  readonly onChange: (action: FieldAction) => void;
}): ReactElement | null {
  switch (action.kind) {
    case 'goTo':
      return <GoToDetails action={action} onChange={onChange} pageCount={pageCount} />;
    case 'link':
      return <LinkDetails action={action} onChange={onChange} />;
    case 'reset':
      return (
        <FieldsChoice
          fields={action.fields}
          known={known}
          onChange={(fields) => {
            onChange({ kind: 'reset', fields });
          }}
        />
      );
    case 'print':
      return <PrintNote />;
    case 'importData':
      return <ImportDetails action={action} onChange={onChange} />;
    case 'showHide':
      return <ShowHideDetails action={action} known={known} onChange={onChange} />;
    case 'submit':
      return <SubmitDetails action={action} known={known} onChange={onChange} />;
    case 'openFile':
      return <OpenFileDetails action={action} onChange={onChange} />;
  }
}

/** The PDF a button opens: one name, in the folder the document is in. A name the contract refuses is said. */
function OpenFileDetails({
  action,
  onChange,
}: {
  readonly action: Extract<FieldAction, { kind: 'openFile' }>;
  readonly onChange: (action: FieldAction) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const valid = fieldActionSchema.safeParse(action).success;
  return (
    <>
      <div className="m-properties__row">
        <label className="m-properties__label" htmlFor={id}>
          {i18n._(BUTTON_ACTION_OPEN_FILE)}
        </label>
        <input
          aria-invalid={!valid}
          className="m-properties__comment"
          id={id}
          maxLength={MAX_ACTION_FILE}
          onChange={(event) => {
            onChange({ kind: 'openFile', file: event.target.value });
          }}
          type="text"
          value={action.file}
        />
      </div>
      {valid ? null : <p className="m-properties__meta">{i18n._(BUTTON_ACTION_OPEN_FILE_RULE)}</p>}
      <p className="m-properties__meta">{i18n._(BUTTON_ACTION_OPEN_FILE_NOTE)}</p>
    </>
  );
}

/** Where a submission goes, how it is encoded and which fields it carries. A press asks before anything is sent. */
function SubmitDetails({
  action,
  known,
  onChange,
}: {
  readonly action: Extract<FieldAction, { kind: 'submit' }>;
  readonly known: readonly KnownField[];
  readonly onChange: (action: FieldAction) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const toId = useId();
  const asId = useId();
  const valid = writableSubmitAddress(action.address);
  return (
    <>
      <div className="m-properties__row">
        <label className="m-properties__label" htmlFor={toId}>
          {i18n._(BUTTON_ACTION_SUBMIT_TO)}
        </label>
        <input
          aria-invalid={!valid}
          className="m-properties__comment"
          id={toId}
          inputMode="url"
          maxLength={MAX_LINK_URI}
          onChange={(event) => {
            onChange({ ...action, address: event.target.value });
          }}
          type="text"
          value={action.address}
        />
      </div>
      {valid ? null : <p className="m-properties__meta">{i18n._(BUTTON_ACTION_SUBMIT_TO_RULE)}</p>}
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={asId}>
          {i18n._(BUTTON_ACTION_SUBMIT_AS)}
        </label>
        <select
          className="m-properties__select"
          id={asId}
          onChange={(event) => {
            const format = SUBMIT_FORMATS.find((each) => each === event.target.value);
            if (format !== undefined) onChange({ ...action, format });
          }}
          value={action.format}
        >
          {SUBMIT_FORMATS.map((format) => (
            <option key={format} value={format}>
              {i18n._(SUBMIT_FORMAT_NAMES[format])}
            </option>
          ))}
        </select>
      </div>
      <FieldsChoice
        fields={action.fields}
        known={known}
        onChange={(fields) => {
          onChange({ ...action, fields });
        }}
      />
      <p className="m-properties__meta">{i18n._(BUTTON_ACTION_SUBMIT_NOTE)}</p>
    </>
  );
}

/** Which fields a show or hide names, ticked from the form's own (never *every field*: `/T` names some), and which way. */
function ShowHideDetails({
  action,
  known,
  onChange,
}: {
  readonly action: Extract<FieldAction, { kind: 'showHide' }>;
  readonly known: readonly KnownField[];
  readonly onChange: (action: FieldAction) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const groupId = useId();
  return (
    <>
      <fieldset aria-label={i18n._(BUTTON_ACTION_KIND_SHOW_HIDE)} className="m-button-actions__fields">
        <label className="m-properties__check">
          <input
            checked={action.hide}
            name={groupId}
            onChange={() => {
              onChange({ ...action, hide: true });
            }}
            type="radio"
          />
          {i18n._(BUTTON_ACTION_HIDE)}
        </label>
        <label className="m-properties__check">
          <input
            checked={!action.hide}
            name={groupId}
            onChange={() => {
              onChange({ ...action, hide: false });
            }}
            type="radio"
          />
          {i18n._(BUTTON_ACTION_SHOW)}
        </label>
      </fieldset>
      <FieldsChoice
        every={false}
        fields={action.fields}
        known={known}
        onChange={(fields) => {
          onChange({ ...action, fields: fields ?? [] });
        }}
      />
      {action.fields.length === 0 ? <p className="m-properties__meta">{i18n._(BUTTON_ACTION_FIELDS_NONE)}</p> : null}
    </>
  );
}

/**
 * Import form data's file name, which only another reader opens: here a press asks the person to pick, so the note says
 * so. A name the contract refuses (a folder in it, or none) is said and cannot be saved.
 */
function ImportDetails({
  action,
  onChange,
}: {
  readonly action: Extract<FieldAction, { kind: 'importData' }>;
  readonly onChange: (action: FieldAction) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const valid = fieldActionSchema.safeParse(action).success;
  return (
    <>
      <div className="m-properties__row">
        <label className="m-properties__label" htmlFor={id}>
          {i18n._(BUTTON_ACTION_FILE)}
        </label>
        <input
          aria-invalid={!valid}
          className="m-properties__comment"
          id={id}
          maxLength={MAX_ACTION_FILE}
          onChange={(event) => {
            onChange({ kind: 'importData', file: event.target.value });
          }}
          type="text"
          value={action.file}
        />
      </div>
      {valid ? null : <p className="m-properties__meta">{i18n._(BUTTON_ACTION_FILE_NAME)}</p>}
      <p className="m-properties__meta">{i18n._(BUTTON_ACTION_FILE_NOTE)}</p>
    </>
  );
}

/** Print needs nothing more: what it does is said, so the person knows a press asks before anything prints. */
function PrintNote(): ReactElement {
  const { i18n } = useLingui();
  return <p className="m-properties__meta">{i18n._(BUTTON_ACTION_PRINT_NOTE)}</p>;
}

/**
 * A go-to's page and view. The page is typed as a person sees it, from 1, and kept as the kernel counts, from 0
 * (`pageNumbering.ts`); a number outside the document is said and cannot be saved. Choosing a view takes away a place
 * and zoom another tool wrote, which is that choice.
 */
function GoToDetails({
  action,
  pageCount,
  onChange,
}: {
  readonly action: Extract<FieldAction, { kind: 'goTo' }>;
  readonly pageCount: number;
  readonly onChange: (action: FieldAction) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const pageId = useId();
  const viewId = useId();
  const [typed, setTyped] = useState(String(pdfjsPageOf(action.page)));
  const number = Number(typed);
  const inside = Number.isInteger(number) && number >= 1 && number <= pageCount;
  return (
    <>
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={pageId}>
          {i18n._(BUTTON_ACTION_PAGE)}
        </label>
        <input
          aria-invalid={!inside}
          className="m-properties__number"
          id={pageId}
          inputMode="numeric"
          onChange={(event) => {
            setTyped(event.target.value);
            const next = Number(event.target.value);
            // OUTSIDE THE DOCUMENT IS SENT AS ONE PAGE PAST ITS END, which `savable` refuses: the draft holds no page the
            // person did not type, and Save waits until they type one there is.
            const page = Number.isInteger(next) && next >= 1 && next <= pageCount ? kernelPageOf(next) : pageCount;
            onChange({ ...action, page });
          }}
          type="text"
          value={typed}
        />
      </div>
      {inside ? null : <p className="m-properties__meta">{i18n._(BUTTON_ACTION_PAGE_RANGE, { count: pageCount })}</p>}
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={viewId}>
          {i18n._(BUTTON_ACTION_VIEW)}
        </label>
        <select
          className="m-properties__select"
          id={viewId}
          onChange={(event) => {
            const view = (['keep', 'fit', 'fit-width'] as const).find((each) => each === event.target.value);
            if (view !== undefined && view !== action.view) onChange({ ...action, view, at: null });
          }}
          value={action.view}
        >
          {(['keep', 'fit', 'fit-width'] as const).map((view) => (
            <option key={view} value={view}>
              {i18n._(VIEW_LABELS[view])}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/** A link's address, typed whole; one that is not a whole `https:` address is said and cannot be saved. */
function LinkDetails({
  action,
  onChange,
}: {
  readonly action: Extract<FieldAction, { kind: 'link' }>;
  readonly onChange: (action: FieldAction) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  return (
    <>
      <div className="m-properties__row">
        <label className="m-properties__label" htmlFor={id}>
          {i18n._(BUTTON_ACTION_ADDRESS)}
        </label>
        <input
          aria-invalid={!writableAddress(action.address)}
          className="m-properties__comment"
          id={id}
          inputMode="url"
          maxLength={MAX_LINK_URI}
          onChange={(event) => {
            onChange({ kind: 'link', address: event.target.value });
          }}
          type="text"
          value={action.address}
        />
      </div>
      {writableAddress(action.address) ? null : <p className="m-properties__meta">{i18n._(BUTTON_ACTION_ADDRESS_HTTPS)}</p>}
    </>
  );
}

/**
 * Which fields an action names: every field, or those ticked. Each name once, in the form's order; a push button is not
 * offered, since there is nothing in it to reset or send.
 */
function FieldsChoice({
  fields,
  known,
  onChange,
  every = true,
}: {
  readonly fields: readonly string[] | null;
  readonly known: readonly KnownField[];
  readonly onChange: (fields: readonly string[] | null) => void;
  /** Whether *Every field* is a choice: a reset's `/Fields` may be absent, and a show or hide's `/T` may not. */
  readonly every?: boolean;
}): ReactElement {
  const { i18n } = useLingui();
  const groupId = useId();
  const names = [...new Set(known.filter((field) => field.kind !== 'button').map((field) => field.name))];
  const chosen = fields ?? [];
  return (
    <fieldset aria-labelledby={groupId} className="m-button-actions__fields">
      <legend className="m-properties__label" id={groupId}>
        {i18n._(BUTTON_ACTION_FIELDS)}
      </legend>
      {every ? (
        <>
          <label className="m-properties__check">
            <input
              checked={fields === null}
              name={groupId}
              onChange={() => {
                onChange(null);
              }}
              type="radio"
            />
            {i18n._(BUTTON_ACTION_FIELDS_ALL)}
          </label>
          <label className="m-properties__check">
            <input
              checked={fields !== null}
              name={groupId}
              onChange={() => {
                onChange([]);
              }}
              type="radio"
            />
            {i18n._(BUTTON_ACTION_FIELDS_CHOSEN)}
          </label>
        </>
      ) : null}
      {fields === null ? null : (
        <>
          <ul className="m-button-actions__names">
            {names.map((name) => (
              <li key={name}>
                <label className="m-properties__check">
                  <input
                    checked={chosen.includes(name)}
                    onChange={(event) => {
                      onChange(event.target.checked ? names.filter((each) => each === name || chosen.includes(each)) : chosen.filter((each) => each !== name));
                    }}
                    type="checkbox"
                  />
                  {name}
                </label>
              </li>
            ))}
          </ul>
          {chosen.length > MAX_ACTION_FIELDS ? (
            <p className="m-properties__meta">
              {i18n._(every ? BUTTON_ACTION_FIELDS_LIMIT : BUTTON_ACTION_FIELDS_LIMIT_SOME, { count: MAX_ACTION_FIELDS })}
            </p>
          ) : null}
        </>
      )}
    </fieldset>
  );
}
