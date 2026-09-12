import { useLingui } from '@lingui/react';
import type { SecretSettingId } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';
import { z } from 'zod';

import {
  SETTINGS_CATEGORY_TITLES,
  SETTINGS_INVALID,
  SETTINGS_SAVE,
  SETTINGS_SECRET_PLACEHOLDER,
  SETTINGS_SECRET_REMOVE,
  SETTINGS_SECRET_STORED,
  SETTINGS_SECRET_UNAVAILABLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SettingCategory, SettingDefinition } from '../registries/settings.js';
import type { SettingsAnswer } from './settings.js';
import { controlFor, DIALOG_SETTINGS } from './settings.js';

/**
 * Each category's heading, exhaustive over the registry's own type.
 *
 * Assigned through the annotation so a category added to `SettingCategory`
 * without a heading is a compile error. The ORDER is this record's, and a
 * category with no renderable setting draws nothing.
 */
const CATEGORY_TITLES: Readonly<Record<SettingCategory, MessageKey>> = SETTINGS_CATEGORY_TITLES;

/** One secret field's edit: text typed to replace it, or a request to remove it. */
interface SecretDraft {
  readonly replace: string;
  readonly remove: boolean;
}

const UNTOUCHED: SecretDraft = { replace: '', remove: false };

/**
 * The value a number field holds while it is being typed, parsed for its schema.
 *
 * An empty field is `NaN`, which every number schema refuses — so clearing a box
 * is an invalid value the dialog names, never a zero it quietly saves.
 */
function candidateFor(control: string | undefined, draft: unknown): unknown {
  if (control !== 'number') return draft;
  return typeof draft === 'string' && draft.trim() !== '' ? Number(draft) : Number.NaN;
}

/** An enum member's title. The registry refused a setting without one at startup. */
function memberTitle(setting: SettingDefinition, member: string): MessageKey {
  const title = setting.optionTitles?.[member];
  if (title === undefined) {
    throw new Error(
      `Setting "${setting.id}" has no title for "${member}", which SettingsRegistry refuses at ` +
        'construction — this dialog was handed a definition that never went through one.',
    );
  }
  return title;
}

/**
 * One setting's control, derived from its schema.
 *
 * A component per setting rather than a branch inside the list, so each has its
 * own `useId` for the label it needs.
 */
function SettingField({
  setting,
  draft,
  onDraft,
  stored,
  available,
  secret,
  onSecret,
}: {
  readonly setting: SettingDefinition;
  readonly draft: unknown;
  readonly onDraft: (value: unknown) => void;
  readonly stored: boolean;
  readonly available: boolean;
  readonly secret: SecretDraft;
  readonly onSecret: (next: SecretDraft) => void;
}): ReactElement | null {
  const { _ } = useLingui();
  const fieldId = useId();
  const control = controlFor(setting);

  if (control === 'boolean') {
    return (
      <label className="m-settings__check">
        <input
          checked={draft === true}
          data-setting={setting.id}
          onChange={(event) => {
            onDraft(event.target.checked);
          }}
          type="checkbox"
        />
        {_(setting.title)}
      </label>
    );
  }

  if (control === 'enum' && setting.schema instanceof z.ZodEnum) {
    return (
      <label className="m-document-choice" htmlFor={fieldId}>
        {_(setting.title)}
        {/* A NATIVE `<select>`, for `DocumentChoice`'s reason: §9.27's pinned
            CSP admits no inline style, so the primitive set has no select. */}
        <select
          data-setting={setting.id}
          id={fieldId}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          value={String(draft)}
        >
          {setting.schema.options.map((member) => (
            <option key={String(member)} value={String(member)}>
              {_(memberTitle(setting, String(member)))}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (control === 'number' && setting.schema instanceof z.ZodNumber) {
    return (
      <label className="m-field" htmlFor={fieldId}>
        <span className="m-field__label">{_(setting.title)}</span>
        {/* THE SCHEMA'S OWN BOUNDS, never restated: an input offering a value the
            schema refuses is a control that fails on save. */}
        <input
          className="m-input"
          data-setting={setting.id}
          id={fieldId}
          max={setting.schema.maxValue ?? undefined}
          min={setting.schema.minValue ?? undefined}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          step="any"
          type="number"
          value={String(draft)}
        />
      </label>
    );
  }

  if (control === 'text') {
    return (
      <Input
        label={setting.title}
        onValueChange={(value) => {
          onDraft(value);
        }}
        value={typeof draft === 'string' ? draft : ''}
      />
    );
  }

  if (control === 'secret') {
    // WRITE-ONLY (ADR-0056 Decision 5). The field never holds the stored key —
    // there is none on this side to hold. It starts empty, a placeholder says a
    // key is stored, typing replaces it and the checkbox removes it.
    return (
      <div className="m-settings__secret">
        <Input
          disabled={!available || secret.remove}
          label={setting.title}
          onValueChange={(value) => {
            onSecret({ ...secret, replace: value });
          }}
          placeholder={stored ? SETTINGS_SECRET_PLACEHOLDER : undefined}
          secret
          value={secret.replace}
        />
        {stored ? (
          <label className="m-settings__check">
            <input
              checked={secret.remove}
              data-setting-remove={setting.id}
              disabled={!available}
              onChange={(event) => {
                onSecret({ replace: '', remove: event.target.checked });
              }}
              type="checkbox"
            />
            {_(SETTINGS_SECRET_REMOVE)}
          </label>
        ) : null}
        <p className="m-settings__note">
          {!available ? _(SETTINGS_SECRET_UNAVAILABLE) : stored ? _(SETTINGS_SECRET_STORED) : ''}
        </p>
      </div>
    );
  }

  return null;
}

/**
 * The Settings dialog — every registered setting with a control its schema
 * derives, grouped by category
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)).
 *
 * ## It answers what CHANGED
 *
 * ADR-0038's shape: the command that opened this writes. So the answer is the
 * ordinary values a person altered, parsed by each setting's own schema, and the
 * secrets they replaced or removed. *Save* is disabled while any field holds a
 * value its schema refuses, and the status line names that setting.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SettingsBody({
  values,
  storedSecrets,
  secretsAvailable,
  resolve,
}: {
  readonly values: Readonly<Record<string, unknown>>;
  readonly storedSecrets: readonly SecretSettingId[];
  readonly secretsAvailable: boolean;
} & DialogAnswering<SettingsAnswer>): ReactElement {
  const { _ } = useLingui();
  const [drafts, setDrafts] = useState<Readonly<Record<string, unknown>>>(() =>
    Object.fromEntries(
      DIALOG_SETTINGS.filter((setting) => controlFor(setting) !== 'secret').map((setting) => {
        const value = values[setting.id] ?? setting.fallback;
        return [setting.id, controlFor(setting) === 'number' ? String(value) : value];
      }),
    ),
  );
  const [secrets, setSecrets] = useState<Readonly<Record<string, SecretDraft>>>({});

  // PARSED ON EVERY RENDER, so *Save* and the status line always describe what is
  // on screen rather than what was on screen at the last keystroke.
  const changed: Record<string, unknown> = {};
  let invalid: MessageKey | undefined;
  for (const setting of DIALOG_SETTINGS) {
    const control = controlFor(setting);
    if (control === 'secret') continue;
    const parsed = setting.schema.safeParse(candidateFor(control, drafts[setting.id]));
    if (!parsed.success) {
      invalid ??= setting.title;
      continue;
    }
    const before = values[setting.id] ?? setting.fallback;
    if (JSON.stringify(parsed.data) !== JSON.stringify(before)) changed[setting.id] = parsed.data;
  }

  const categories = (Object.keys(CATEGORY_TITLES) as SettingCategory[]).filter((category) =>
    DIALOG_SETTINGS.some((setting) => setting.category === category),
  );

  return (
    <div className="m-settings">
      {categories.map((category) => (
        <fieldset className="m-settings__group" key={category}>
          <legend>{_(CATEGORY_TITLES[category])}</legend>
          {DIALOG_SETTINGS.filter((setting) => setting.category === category).map((setting) => (
            <SettingField
              available={secretsAvailable}
              draft={drafts[setting.id]}
              key={setting.id}
              onDraft={(value) => {
                setDrafts((current) => ({ ...current, [setting.id]: value }));
              }}
              onSecret={(next) => {
                setSecrets((current) => ({ ...current, [setting.id]: next }));
              }}
              secret={secrets[setting.id] ?? UNTOUCHED}
              setting={setting}
              stored={storedSecrets.some((id) => id === setting.id)}
            />
          ))}
        </fieldset>
      ))}

      <p className="m-settings__problem" role="status">
        {invalid === undefined ? '' : _(SETTINGS_INVALID, { setting: _(invalid) })}
      </p>
      <Button
        disabled={invalid !== undefined}
        label={SETTINGS_SAVE}
        onClick={() => {
          if (invalid !== undefined) return;
          const answered: Partial<Record<SecretSettingId, string>> = {};
          if (secretsAvailable) {
            for (const id of storedSecrets.concat(
              DIALOG_SETTINGS.filter((setting) => controlFor(setting) === 'secret')
                .map((setting) => setting.id)
                .filter((id): id is SecretSettingId => !storedSecrets.some((held) => held === id)),
            )) {
              const draft = secrets[id];
              if (draft === undefined) continue;
              // REMOVE WINS, and only for a stored key; TYPED TEXT REPLACES. A
              // field left empty is untouched, never a removal.
              if (draft.remove) answered[id] = '';
              else if (draft.replace !== '') answered[id] = draft.replace;
            }
          }
          resolve({ values: changed, secrets: answered });
        }}
        variant="primary"
      />
    </div>
  );
}
