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
  MAX_BUTTON_ACTIONS,
  buttonActionSchema,
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
  BUTTON_ACTION_FULL,
  BUTTON_ACTION_KEPT_ROW,
  BUTTON_ACTION_KIND_GO_TO,
  BUTTON_ACTION_KIND_RESET,
  BUTTON_ACTION_PAGE,
  BUTTON_ACTION_PAGE_RANGE,
  BUTTON_ACTION_REMOVE,
  BUTTON_ACTION_ROW,
  BUTTON_ACTION_SAVE,
  BUTTON_ACTION_UP,
  BUTTON_ACTION_VIEW,
  BUTTON_ACTION_WHEN,
  BUTTON_SUMMARY_GO_TO,
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
  reset: BUTTON_ACTION_KIND_RESET,
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
    case 'reset':
      return { kind: 'reset', fields: null };
  }
}

/** One action in words, for its row. */
function summaryOf(action: FieldAction, say: (key: MessageKey, values?: Record<string, unknown>) => string): string {
  switch (action.kind) {
    case 'goTo':
      return say(BUTTON_SUMMARY_GO_TO, { page: pdfjsPageOf(action.page) });
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
  }
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

/**
 * Which fields an action names: every field, or those ticked. Each name once, in the form's order; a push button is not
 * offered, since there is nothing in it to reset or send.
 */
function FieldsChoice({
  fields,
  known,
  onChange,
}: {
  readonly fields: readonly string[] | null;
  readonly known: readonly KnownField[];
  readonly onChange: (fields: readonly string[] | null) => void;
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
            <p className="m-properties__meta">{i18n._(BUTTON_ACTION_FIELDS_LIMIT, { count: MAX_ACTION_FIELDS })}</p>
          ) : null}
        </>
      )}
    </fieldset>
  );
}
