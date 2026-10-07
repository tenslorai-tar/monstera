import { useLingui } from '@lingui/react';
import {
  type AI_LIST_PROBLEMS,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiModelListAnswer,
  type AiProviderId,
  type AzureDiPage,
  type SecretSettingId,
  choiceReadsImages,
  defaultModel,
  servesVision,
} from '@monstera/contract';
import { type MessageKey, channels } from '@monstera/shared';
import type { ReactElement } from 'react';
import { Fragment, useId, useMemo, useState } from 'react';
import { z } from 'zod';

import {
  ACCENT_DESCRIPTION,
  ACCENT_REJECTED,
  ACCENT_TITLE,
  AI_MODELS_NONE,
  SETTINGS_AI_MODELS_ASKING,
  AI_PROVIDER_NAMES,
  ASSISTANT_MODEL_NO_VISION,
  ASSISTANT_MODEL_NOT_OFFERED,
  SETTINGS_ACTION_CLEAR_HISTORY,
  SETTINGS_ACTION_CLEAR_HISTORY_DESCRIPTION,
  SETTINGS_ACTION_CLEAR_RECENT,
  SETTINGS_ACTION_CLEAR_RECENT_DESCRIPTION,
  SETTINGS_ACTION_CLEARED,
  SETTINGS_AI_MODELS_FALLBACK,
  SETTINGS_AI_MODELS_FETCHED,
  SETTINGS_AI_MODELS_NO_LIST,
  SETTINGS_AI_MODELS_NOT_LISTED,
  SETTINGS_AI_MODELS_UNREAD,
  SETTINGS_AI_NOTE,
  SETTINGS_AI_PROVIDER_STORED,
  SETTINGS_APPEARANCE_NOTE,
  SETTINGS_DONE,
  SETTINGS_EDITING_NOTE,
  SETTINGS_EXPORT,
  SETTINGS_FOOTER_NOTE,
  SETTINGS_IMPORT,
  SETTINGS_INTEGRATIONS_NOTE,
  SETTINGS_INVALID,
  SETTINGS_KEY_CHECK,
  SETTINGS_KEY_CHECKING,
  SETTINGS_KEY_NONE,
  SETTINGS_KEY_NOT_THE_SERVICE,
  SETTINGS_KEY_REJECTED,
  SETTINGS_KEY_UNAUTHORISED,
  SETTINGS_KEY_UNCHECKED,
  SETTINGS_KEY_UNREACHABLE,
  SETTINGS_KEY_UNREADABLE,
  SETTINGS_KEY_WORKS,
  SETTINGS_KEYBOARD_NOTE,
  SETTINGS_NO_MATCH,
  SETTINGS_OCR_NOTE,
  SETTINGS_PAGES_LABEL,
  SETTINGS_PRIVACY_NOTE,
  SETTINGS_ADVANCED_NOTE,
  SETTINGS_SAVING_NOTE,
  SETTINGS_RENDERING_NOTE,
  SETTINGS_RESET,
  SETTINGS_SEARCH,
  SETTINGS_SECRET_PLACEHOLDER,
  SETTINGS_AZURE_DI_CREATE,
  SETTINGS_AZURE_DI_FIND,
  SETTINGS_AZURE_DI_RESOURCE,
  SETTINGS_SECRET_REMOVE,
  SETTINGS_SECRET_REMOVE_ASK,
  SETTINGS_SECRET_REMOVE_KEEP,
  SETTINGS_SECRET_REMOVE_YES,
  SETTINGS_SECRET_REMOVED,
  SETTINGS_SECRET_STORED,
  SETTINGS_SECRET_UNAVAILABLE,
  SETTINGS_UPDATES_NOTE,
  SETTINGS_VIEWING_NOTE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Icon } from '../primitives/Icon.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SettingCategory, SettingDefinition } from '../registries/settings.js';
import { colourKindOf, enumeratedOf } from '../registries/settings.js';
import { ACCENT_SETTING } from '../settings/accent.js';
import { ACCENT_PRESETS, accentUsable } from '../settings/accentPresets.js';
import { AI_MODELS_SETTING, AI_PROVIDER_SETTING, AZURE_OPENAI_ENDPOINT_SETTING } from '../settings/ai.js';
import { AZURE_DI_ENDPOINT_SETTING } from '../settings/editing.js';
import type { SettingsAnswer } from './settings.js';
import { controlFor, DIALOG_SETTINGS, listedPages } from './settings.js';

/**
 * The Settings dialog, as the owner drew it on 2026-09-22
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md),
 * [ADR-0094](../../../../docs/DECISIONS/0094-a-dialog-may-report-before-it-answers.md)).
 *
 * A search field, a list of pages down the left, the chosen page on the right, and a footer that
 * says where changes go. Each row is a bold label with one plain line under it and its control on
 * the right.
 *
 * ## Every change applies at once
 *
 * There is no *Save*. A change is reported through `update` and the command applies it, so the
 * theme changes as it is chosen (ADR-0094). *Done* closes; so does Escape, and nothing is lost by
 * either because nothing was being held.
 *
 * ## A page is not always a list of settings
 *
 * *Keyboard* says where the shortcut map is, *Updates* says where updates come from, and *Privacy*
 * carries an action rather than a value. A page with neither a setting nor content of its own is not
 * listed at all — an empty page explaining that it is empty is what the owner's design pass called
 * out by name.
 *
 * ## The AI page asks WHICH PROVIDER first
 *
 * Ten providers with ten key fields is the wall the owner found here. One drop-down chooses the
 * provider, and the page then shows that provider's key and nothing else — progressive disclosure,
 * and the drop-down marks which providers already have a key so the choice is informed.
 *
 * **That drop-down IS `ai.provider`**, the provider the Assistant asks (ADR-0117 Decision 1), and the
 * provider's model follows its key. Two drop-downs — one for the Assistant, one for which key to show —
 * put two answers to *which provider* on one page, and a person reading the key of one while the
 * Assistant asked the other.
 */

/** One secret field's edit: text typed to replace it, or a request to remove it. */
interface SecretDraft {
  readonly replace: string;
  readonly remove: boolean;
}

const UNTOUCHED: SecretDraft = { replace: '', remove: false };

/**
 * What each page says under its title — the owner's design gives every page one line.
 *
 * A note says what the page is ABOUT, in a person's words. `settings2.png` shows the sentence that
 * must never ship — *"every setting is declared once in the registry; this page is derived from
 * it"* — which is the application explaining its own construction to somebody who wanted to change
 * how pages look.
 */
const PAGE_NOTES: Partial<Record<SettingCategory, MessageKey>> = {
  appearance: SETTINGS_APPEARANCE_NOTE,
  viewing: SETTINGS_VIEWING_NOTE,
  rendering: SETTINGS_RENDERING_NOTE,
  editing: SETTINGS_EDITING_NOTE,
  ocr: SETTINGS_OCR_NOTE,
  ai: SETTINGS_AI_NOTE,
  integrations: SETTINGS_INTEGRATIONS_NOTE,
  keyboard: SETTINGS_KEYBOARD_NOTE,
  privacy: SETTINGS_PRIVACY_NOTE,
  updates: SETTINGS_UPDATES_NOTE,
  advanced: SETTINGS_ADVANCED_NOTE,
  saving: SETTINGS_SAVING_NOTE,
};


/**
 * The value a number field holds while it is being typed, parsed for its schema.
 *
 * An empty field is `NaN`, which every number schema refuses — so clearing a box is an invalid value
 * the dialog names, never a zero it quietly saves.
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

/** Whether a provider's key is one of the stored secrets. */
function keyStored(provider: AiProviderId, stored: readonly SecretSettingId[]): boolean {
  return stored.some((id) => id === AI_PROVIDERS[provider].keySetting);
}

/** One setting's control, derived from its schema, with no label of its own — the row carries it. */
function SettingControl({
  setting,
  draft,
  onDraft,
  stored,
  available,
  secret,
  onSecret,
  labelledBy,
  keyCheck,
}: {
  readonly setting: SettingDefinition;
  readonly draft: unknown;
  readonly onDraft: (value: unknown) => void;
  /** A provider key's Check and its answer (ADR-0158), drawn under the key; absent for every other secret. */
  readonly keyCheck?: ReactElement | undefined;
  readonly stored: boolean;
  readonly available: boolean;
  readonly secret: SecretDraft;
  readonly onSecret: (next: SecretDraft) => void;
  readonly labelledBy: string;
}): ReactElement | null {
  const { _ } = useLingui();
  const control = controlFor(setting);

  if (control === 'boolean') {
    // A SWITCH: a checkbox with the switch role, so the control says on or off rather than ticked.
    // Disabled where the setting needs the credential store this machine has not got: the row's note
    // then says why, rather than the switch reading ON while nothing it promises can happen.
    return (
      <input
        aria-labelledby={labelledBy}
        checked={draft === true}
        className="m-switch"
        data-setting={setting.id}
        disabled={setting.needsSecureStorage === true && !available}
        onChange={(event) => {
          onDraft(event.target.checked);
        }}
        role="switch"
        type="checkbox"
      />
    );
  }

  if (control === 'enum' && setting.schema instanceof z.ZodEnum) {
    const members = setting.schema.options.map(String);
    // THREE OR FEWER is a segmented control, as the design draws Theme; more is a drop-down, because
    // a row of eight buttons is the wall this dialog exists to stop being.
    if (members.length <= 3) {
      return (
        // `--wrap`: a group whose choices are sentences (Print quality's) may be wider than the row; it wraps its choices
        // rather than running past the dialog's edge.
        <div aria-labelledby={labelledBy} className="m-segmented m-segmented--wrap" data-setting={setting.id} role="radiogroup">
          {members.map((member) => (
            <button
              aria-checked={String(draft) === member}
              className="m-segmented__choice"
              key={member}
              onClick={() => {
                onDraft(member);
              }}
              role="radio"
              type="button"
            >
              {_(memberTitle(setting, member))}
            </button>
          ))}
        </div>
      );
    }
    return (
      <select
        aria-labelledby={labelledBy}
        data-setting={setting.id}
        onChange={(event) => {
          onDraft(event.target.value);
        }}
        value={String(draft)}
      >
        {members.map((member) => (
          <option key={member} value={member}>
            {_(memberTitle(setting, member))}
          </option>
        ))}
      </select>
    );
  }

  if (control === 'number' && setting.schema instanceof z.ZodNumber) {
    return (
      <input
        aria-labelledby={labelledBy}
        className="m-input m-input--number"
        data-setting={setting.id}
        max={setting.schema.maxValue ?? undefined}
        min={setting.schema.minValue ?? undefined}
        onChange={(event) => {
          onDraft(event.target.value);
        }}
        step="any"
        type="number"
        value={String(draft)}
      />
    );
  }

  if (control === 'colour') {
    const kind = colourKindOf(setting.schema);
    if (kind === undefined || setting.unsetTitle === undefined) {
      throw new Error(
        `Setting "${setting.id}" reached the colour control without a colour kind and an unset title, ` +
          'which SettingsRegistry refuses at construction — this definition never went through one.',
      );
    }
    const chosen = typeof draft === 'string' && draft !== kind.unset;
    // THE STYLES PANEL'S PAIR (ADR-0056, corrected 2026-09-15). A colour input cannot show *no
    // colour*, so the tick box says which state the setting is in and the input, disabled while it is
    // ticked, supplies the colour otherwise.
    return (
      <div className="m-settings-row__colour">
        <label className="m-settings-row__unset">
          <input
            checked={!chosen}
            data-setting={setting.id}
            onChange={(event) => {
              onDraft(event.target.checked ? kind.unset : kind.starting);
            }}
            type="checkbox"
          />
          {_(setting.unsetTitle)}
        </label>
        <input
          aria-labelledby={labelledBy}
          disabled={!chosen}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          type="color"
          value={chosen ? draft : kind.starting}
        />
      </div>
    );
  }

  if (control === 'choices') {
    const members = enumeratedOf(setting.schema)?.members ?? [];
    const held = Array.isArray(draft) ? draft.map(String) : [];
    // A SET OF THE ENUM'S MEMBERS (ADR-0056, corrected 2026-09-28): a box per member, in the enum's order. How many
    // it may hold is the SCHEMA's, asked rather than read — a box is disabled when changing it would produce a value
    // the schema refuses, which is the last one ticked and any beyond the maximum. Refused in the offer, never on
    // apply.
    const toggled = (member: string): string[] =>
      held.includes(member) ? held.filter((each) => each !== member) : [...held, member];
    return (
      <div aria-labelledby={labelledBy} className="m-settings-row__choices" data-setting={setting.id} role="group">
        {members.map((member) => (
          <label className="m-settings-row__choice" key={member}>
            <input
              checked={held.includes(member)}
              data-setting-member={member}
              disabled={!setting.schema.safeParse(toggled(member)).success}
              onChange={() => {
                onDraft(toggled(member));
              }}
              type="checkbox"
            />
            {_(memberTitle(setting, member))}
          </label>
        ))}
      </div>
    );
  }

  if (control === 'text') {
    return (
      <Input
        label={setting.title}
        // THE ROW SHOWS THE LABEL, in bold beside the field; drawing it again above the box said it twice.
        labelShownBeside
        // THE SETTING'S OWN PURPOSE (ADR-0116), never decided here from its id.
        purpose={setting.purpose}
        // AND WHETHER IT RUNS LONG, which every text setting declares (ADR-0157).
        runsLong={setting.runsLong === true}
        onValueChange={(value) => {
          onDraft(value);
        }}
        value={typeof draft === 'string' ? draft : ''}
      />
    );
  }

  if (control === 'secret') {
    // WRITE-ONLY (ADR-0056 Decision 5). The field never holds the stored key — there is none on this
    // side to hold. It starts empty, a placeholder says a key is stored, typing replaces it and
    // Remove takes it away.
    return (
      <div className="m-settings-row__secret">
        <Input
          disabled={!available}
          label={setting.title}
          labelShownBeside
          onValueChange={(value) => {
            // TYPING A NEW KEY AFTER REMOVING THE OLD ONE is a replacement, so the removal is no longer the state.
            onSecret({ replace: value, remove: false });
          }}
          placeholder={stored && !secret.remove ? SETTINGS_SECRET_PLACEHOLDER : undefined}
          // A KEY OR A TOKEN, which every secret setting is: it runs long (ADR-0157).
          runsLong
          secret
          value={secret.replace}
        />
        {/* ONE ROW OF ACTIONS UNDER THE KEY, for every stored key — a provider's, Azure's, DocuSign's: the check where
            the key has one, and the red button that removes it. */}
        <div className="m-settings-row__key-actions">
          {keyCheck}
          {stored && !secret.remove ? (
            <RemoveKey
              disabled={!available}
              onRemove={() => {
                onSecret({ replace: '', remove: true });
              }}
            />
          ) : null}
        </div>
        {stored && secret.remove ? (
          <span className="m-settings-row__note" role="status">
            {_(SETTINGS_SECRET_REMOVED)}
          </span>
        ) : null}
      </div>
    );
  }

  return null;
}

/** One row: a bold label, a line saying what it does, and the control on the right. */
function SettingRow(props: {
  readonly setting: SettingDefinition;
  readonly draft: unknown;
  readonly onDraft: (value: unknown) => void;
  readonly stored: boolean;
  readonly available: boolean;
  readonly secret: SecretDraft;
  readonly onSecret: (next: SecretDraft) => void;
  readonly keyCheck?: ReactElement | undefined;
}): ReactElement {
  const { _ } = useLingui();
  const labelId = useId();
  const needsStore = controlFor(props.setting) === 'secret' || props.setting.needsSecureStorage === true;
  const note =
    needsStore && !props.available
      ? SETTINGS_SECRET_UNAVAILABLE
      : controlFor(props.setting) === 'secret' && props.stored
        ? SETTINGS_SECRET_STORED
        : props.setting.description;
  return (
    <div className="m-settings-row">
      <div className="m-settings-row__text">
        <span className="m-settings-row__label" id={labelId}>
          {_(props.setting.title)}
        </span>
        {note === undefined ? null : <span className="m-settings-row__note">{_(note)}</span>}
      </div>
      <div className="m-settings-row__control">
        <SettingControl {...props} labelledBy={labelId} />
      </div>
    </div>
  );
}

/** The provider row: `ai.provider`, each provider marked where its key is stored. */
function ProviderRow({
  chosen,
  storedSecrets,
  onChoose,
}: {
  readonly chosen: AiProviderId;
  readonly storedSecrets: readonly SecretSettingId[];
  readonly onChoose: (provider: string) => void;
}): ReactElement {
  const { _, i18n } = useLingui();
  const labelId = useId();
  return (
    <div className="m-settings-row">
      <div className="m-settings-row__text">
        <span className="m-settings-row__label" id={labelId}>
          {_(AI_PROVIDER_SETTING.title)}
        </span>
        {AI_PROVIDER_SETTING.description === undefined ? null : (
          <span className="m-settings-row__note">{_(AI_PROVIDER_SETTING.description)}</span>
        )}
      </div>
      <div className="m-settings-row__control">
        <select
          aria-labelledby={labelId}
          data-setting={AI_PROVIDER_SETTING.id}
          onChange={(event) => {
            onChoose(event.target.value);
          }}
          value={chosen}
        >
          {AI_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {keyStored(id, storedSecrets)
                ? i18n._(SETTINGS_AI_PROVIDER_STORED, { provider: _(AI_PROVIDER_NAMES[id]) })
                : _(AI_PROVIDER_NAMES[id])}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A key check's answer that is not a tick, one sentence per problem `listModels` can report. */
const KEY_PROBLEM_WORDS: Readonly<Record<(typeof AI_LIST_PROBLEMS)[number], MessageKey>> = {
  unauthorised: SETTINGS_KEY_UNAUTHORISED,
  unreachable: SETTINGS_KEY_UNREACHABLE,
  rejected: SETTINGS_KEY_REJECTED,
  unreadable: SETTINGS_KEY_UNREADABLE,
  'not-the-service': SETTINGS_KEY_NOT_THE_SERVICE,
};

/**
 * What a provider's key check says, from the list `ai.models` answered (ADR-0158).
 *
 * **The tick is main's own rule**: *Key works* only where the provider answered a list, which is `ai.checkKey`'s
 * `checked`. A provider with no list keeps its key unchecked and says so; a list that came back with a problem says
 * which; one with neither had no key to ask with.
 */
function keyCheckWords(answer: AiModelListAnswer | undefined): MessageKey {
  if (answer === undefined) return SETTINGS_AI_MODELS_UNREAD;
  if (answer.source === 'fetched') return SETTINGS_KEY_WORKS;
  if (answer.source === 'no-list') return SETTINGS_KEY_UNCHECKED;
  return answer.problem === undefined ? SETTINGS_KEY_NONE : KEY_PROBLEM_WORDS[answer.problem];
}

/**
 * What the Azure Document Intelligence boxes need, said once under the first of them: the exact kind of Azure resource,
 * and the two places to go — where it is created, and where its endpoint and key are read. The pages are PLACES a press
 * reports (`openPage`); `main` holds the addresses.
 */
function AzureDocumentIntelligenceHelp({ onOpen }: { readonly onOpen: (page: AzureDiPage) => void }): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-settings-row m-settings-row--help">
      <div className="m-settings-row__text">
        <span className="m-settings-row__note">{_(SETTINGS_AZURE_DI_RESOURCE)}</span>
        <div className="m-settings-row__key-actions">
          <Button
            label={SETTINGS_AZURE_DI_CREATE}
            onClick={() => {
              onOpen('azure-di-create');
            }}
          />
          <Button
            label={SETTINGS_AZURE_DI_FIND}
            onClick={() => {
              onOpen('azure-di-keys');
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The red button that removes a stored key, and the question it asks first.
 *
 * Pressing it does not remove: it asks *Remove this key from this computer?* in the row, beside two answers, and only
 * *Remove it* reports the removal. A key is not recoverable from here — the value is held by `main` and never crosses
 * — so a press that removed at once would be a loss a person could not take back.
 */
function RemoveKey({ disabled, onRemove }: { readonly disabled: boolean; readonly onRemove: () => void }): ReactElement {
  const { _ } = useLingui();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        disabled={disabled}
        label={SETTINGS_SECRET_REMOVE}
        onClick={() => {
          setAsking(true);
        }}
        variant="danger"
      />
    );
  }
  return (
    <span className="m-settings-row__remove-ask" role="group" aria-label={_(SETTINGS_SECRET_REMOVE_ASK)}>
      <span>{_(SETTINGS_SECRET_REMOVE_ASK)}</span>
      <Button
        label={SETTINGS_SECRET_REMOVE_YES}
        onClick={() => {
          setAsking(false);
          onRemove();
        }}
        variant="danger"
      />
      <Button
        label={SETTINGS_SECRET_REMOVE_KEEP}
        onClick={() => {
          setAsking(false);
        }}
      />
    </span>
  );
}

/**
 * A provider key's Check, and the answer to the last one asked while the key has not changed since. The key is never
 * here: the check is of the stored one, and the answer is the provider's list.
 */
function KeyCheck({
  provider,
  state,
  canCheck,
  onCheck,
}: {
  readonly provider: AiProviderId;
  /** Nothing to show, a check on its way, or the answer to the one last asked. */
  readonly state: { readonly kind: 'none' } | { readonly kind: 'checking' } | { readonly kind: 'answered'; readonly answer: AiModelListAnswer | undefined };
  readonly canCheck: boolean;
  readonly onCheck: () => void;
}): ReactElement {
  const { _, i18n } = useLingui();
  const name = _(AI_PROVIDER_NAMES[provider]);
  const words = state.kind === 'answered' ? keyCheckWords(state.answer) : undefined;
  return (
    <div className="m-key-check">
      <Button
        disabled={!canCheck || state.kind === 'checking'}
        label={SETTINGS_KEY_CHECK}
        onClick={onCheck}
      />
      {/* SAID WHERE IT IS ASKED, and announced: a status, since the answer arrives while the person waits. */}
      <span className="m-key-check__answer" data-key-check={state.kind === 'answered' ? (state.answer?.source ?? 'unread') : state.kind} role="status">
        {state.kind === 'checking' ? i18n._(SETTINGS_KEY_CHECKING, { provider: name }) : null}
        {words === SETTINGS_KEY_WORKS ? <Icon name="CircleCheck" size="dense" /> : null}
        {words === undefined ? null : i18n._(words, { provider: name })}
      </span>
    </div>
  );
}

/** Where a held list came from, in words — ADR-0117 Decision 3's *"with the source said"*. */
const LIST_SOURCE_WORDS: Readonly<Record<AiModelListAnswer['source'], MessageKey>> = {
  fetched: SETTINGS_AI_MODELS_FETCHED,
  fallback: SETTINGS_AI_MODELS_FALLBACK,
  'no-list': SETTINGS_AI_MODELS_NO_LIST,
};

/**
 * The model row (ADR-0117 Decision 3): the chosen provider's list as `main` held it when the dialog opened, the stored
 * choice or the contract's one default selected, and only that provider's entry written.
 *
 * The same three rules as the Assistant's picker, taken from the same places: which choice reads images
 * (`choiceReadsImages`), the default (`defaultModel`), and a model without vision listed disabled, never dropped. A
 * stored id the list does not name stays selected and marked, never silently replaced.
 */
function ModelRow({
  provider,
  list,
  asking,
  chosen,
  onChoose,
}: {
  readonly provider: AiProviderId;
  /** Whether the provider is being asked for its list now (a key is stored and the reply has not come). */
  readonly asking: boolean;
  /** `undefined` when the query for the held lists failed. */
  readonly list: AiModelListAnswer | undefined;
  readonly chosen: Readonly<Partial<Record<AiProviderId, string>>>;
  readonly onChoose: (next: Readonly<Partial<Record<AiProviderId, string>>>) => void;
}): ReactElement {
  const { _, i18n } = useLingui();
  const labelId = useId();
  const models = list?.models ?? [];
  const readsImages = choiceReadsImages(provider);
  const stored = chosen[provider];
  const selected = stored ?? defaultModel(models, { vision: readsImages })?.id ?? '';
  // *NOT OFFERED* IS SAID ONLY OF A LIST THE PROVIDER GAVE. A stored model is the person's choice, and a list that is
  // this build's own, or is still being asked for, or could not be read, is not evidence the provider stopped offering
  // it — it was the saved choice called *not offered now* on every launch, before anything had asked.
  const authoritative = list?.source === 'fetched' && list.problem === undefined && !asking;
  const known = stored === undefined || models.some((entry) => entry.id === stored);
  const name = _(AI_PROVIDER_NAMES[provider]);
  return (
    <div className="m-settings-row">
      <div className="m-settings-row__text">
        <span className="m-settings-row__label" id={labelId}>
          {_(AI_MODELS_SETTING.title)}
        </span>
        {AI_MODELS_SETTING.description === undefined ? null : (
          <span className="m-settings-row__note">{_(AI_MODELS_SETTING.description)}</span>
        )}
        <span className="m-settings-row__note" data-model-source={list?.source ?? 'unread'}>
          {asking
            ? i18n._(SETTINGS_AI_MODELS_ASKING, { provider: name })
            : list === undefined
            ? _(SETTINGS_AI_MODELS_UNREAD)
            : // ASKED AND REFUSED is not *not asked*: a key check's answer carries its problem (ADR-0158), and the
              // fallback's own sentence would then say the provider was never asked.
              i18n._(list.problem === undefined ? LIST_SOURCE_WORDS[list.source] : SETTINGS_AI_MODELS_NOT_LISTED, { provider: name })}
        </span>
      </div>
      <div className="m-settings-row__control">
        <select
          aria-labelledby={labelId}
          data-setting={AI_MODELS_SETTING.id}
          disabled={models.length === 0 && stored === undefined}
          onChange={(event) => {
            onChoose({ ...chosen, [provider]: event.target.value });
          }}
          value={selected}
        >
          {models.length === 0 && stored === undefined ? <option value="">{_(AI_MODELS_NONE)}</option> : null}
          {known ? null : (
            <option value={stored}>{authoritative ? i18n._(ASSISTANT_MODEL_NOT_OFFERED, { name: stored }) : stored}</option>
          )}
          {models.map((entry) => {
            const blind = readsImages && !servesVision(entry);
            return (
              <option disabled={blind} key={entry.id} value={entry.id}>
                {blind ? i18n._(ASSISTANT_MODEL_NO_VISION, { name: entry.label }) : entry.label}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}

/**
 * The accent row: the design's swatches, each checked before it is offered.
 *
 * `controlFor` gives this setting no generic control on purpose (ADR-0056 Decision 3) — a colour
 * typed into a text box satisfies its schema and offers no colour — so the one place that knows what
 * the choice means draws it. A preset that cannot carry readable text is shown REFUSED rather than
 * hidden: a person who expected it to be there learns why, which is the design's own note.
 */
function AccentRow({
  chosen,
  onChoose,
}: {
  readonly chosen: unknown;
  readonly onChoose: (value: string) => void;
}): ReactElement {
  const { _, i18n } = useLingui();
  // THE SURFACES THIS THEME DECLARES, read where `tokens.css` writes them. A list built here from
  // literals would be a second opinion about the palette, and wrong in whichever theme it was not
  // written for.
  const surfaces = useMemo(() => {
    const root = globalThis.getComputedStyle(document.documentElement);
    return ['--surface', '--surface2', '--bg']
      .map((token) => channels(root.getPropertyValue(token).trim()))
      .filter((rgb): rgb is NonNullable<typeof rgb> => rgb !== null);
  }, []);
  return (
    <div className="m-settings-row">
      <div className="m-settings-row__text">
        <span className="m-settings-row__label">{_(ACCENT_TITLE)}</span>
        <span className="m-settings-row__note">{_(ACCENT_DESCRIPTION)}</span>
      </div>
      <div className="m-settings-row__control">
        {ACCENT_PRESETS.map((preset) => {
          const rgb = preset.value === 'theme' ? null : channels(preset.value);
          // AGAINST THIS THEME'S OWN SURFACES, read from the root where the tokens are declared —
          // the design's *rejected if it can't reach 4.5:1*, which is a different answer per theme.
          const readable = accentUsable(preset.value, surfaces);
          return (
            <button
              aria-pressed={String(chosen) === preset.value}
              className={preset.value === 'theme' ? 'm-accent-swatch m-accent-swatch--theme' : 'm-accent-swatch'}
              disabled={!readable}
              key={preset.value}
              onClick={() => {
                onChoose(preset.value);
              }}
              style={rgb === null ? undefined : { background: preset.value }}
              title={readable ? _(preset.title) : i18n._(ACCENT_REJECTED, { colour: _(preset.title) })}
              type="button"
            >
              <span className="m-accent-swatch__name">{_(preset.title)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A row whose control is a button rather than a value — Privacy's *Clear chat history*. */
function ActionRow({
  title,
  description,
  label,
  done,
  onRun,
}: {
  readonly title: MessageKey;
  readonly description: MessageKey;
  readonly label: MessageKey;
  readonly done: boolean;
  readonly onRun: () => void;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-settings-row">
      <div className="m-settings-row__text">
        <span className="m-settings-row__label">{_(title)}</span>
        <span className="m-settings-row__note">{_(done ? SETTINGS_ACTION_CLEARED : description)}</span>
      </div>
      <div className="m-settings-row__control">
        <Button label={label} onClick={onRun} />
      </div>
    </div>
  );
}

/** A default export because `declareDialog` takes a `lazy()` component. */
export default function SettingsBody({
  values,
  storedSecrets,
  secretsAvailable,
  models,
  checked = {},
  refreshed = {},
  resolve,
  update,
}: {
  readonly values: Readonly<Record<string, unknown>>;
  readonly storedSecrets: readonly SecretSettingId[];
  readonly secretsAvailable: boolean;
  readonly models: Readonly<Partial<Record<AiProviderId, AiModelListAnswer>>>;
  readonly checked?: Readonly<Partial<Record<AiProviderId, number>>> | undefined;
  readonly refreshed?: Readonly<Partial<Record<AiProviderId, number>>> | undefined;
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
  const [query, setQuery] = useState('');
  const [cleared, setCleared] = useState(false);
  const [clearedRecent, setClearedRecent] = useState(false);
  const searchId = useId();

  // THE PROVIDER IS THE SETTING'S DRAFT, so the page shows the key and model of the provider the Assistant asks.
  const providerDraft = AI_PROVIDER_SETTING.schema.safeParse(drafts[AI_PROVIDER_SETTING.id]);
  const provider: AiProviderId = providerDraft.success ? providerDraft.data : AI_PROVIDER_SETTING.fallback;
  const modelsDraft = AI_MODELS_SETTING.schema.safeParse(drafts[AI_MODELS_SETTING.id]);
  const chosenModels = modelsDraft.success ? modelsDraft.data : AI_MODELS_SETTING.fallback;

  /**
   * The settings each page draws: the AI page shows one provider's key, never all ten, and Azure OpenAI's address only
   * while Azure OpenAI is the provider.
   */
  const onPage = (page: SettingCategory): readonly SettingDefinition[] =>
    DIALOG_SETTINGS.filter((setting) => {
      if (setting.category !== page) return false;
      if (page !== 'ai') return true;
      if (setting.id === AZURE_OPENAI_ENDPOINT_SETTING.id) return provider === 'azure-openai';
      if (controlFor(setting) !== 'secret') return true;
      return setting.id === AI_PROVIDERS[provider].keySetting;
    });

  const pages = useMemo(() => listedPages(DIALOG_SETTINGS), []);
  const [chosen, setChosen] = useState<SettingCategory>(() => pages[0]?.id ?? 'appearance');

  /** Applying a change is REPORTING it: the command writes, and the dialog stays open (ADR-0094). */
  const report = (change: Partial<SettingsAnswer>): void => {
    update({ values: {}, secrets: {}, ...change });
  };

  const draftFor = (setting: SettingDefinition): unknown => drafts[setting.id];

  /**
   * THE LIST A PROVIDER OFFERS IS ASKED OF IT whenever a key is stored for it, when the AI page is shown and when the
   * provider changes — once for each provider per opening of the dialog, since the reply replaces the held list.
   * `main`'s held list is only what it fetched earlier this session or this build's own, so a choice made from it alone
   * is made from a list the provider never gave. A provider with no key stored has nothing to ask with, and says so.
   */
  const [refreshAsked, setRefreshAsked] = useState<Readonly<Partial<Record<AiProviderId, number>>>>({});
  const ensureList = (id: AiProviderId): void => {
    if (!secretsAvailable || refreshAsked[id] !== undefined) return;
    if (!storedSecrets.some((held) => held === AI_PROVIDERS[id].keySetting)) return;
    setRefreshAsked((current) => ({ ...current, [id]: 1 }));
    report({ refresh: id });
  };

  const changeValue = (setting: SettingDefinition, next: unknown): void => {
    setDrafts((current) => ({ ...current, [setting.id]: next }));
    if (setting.id === AI_PROVIDER_SETTING.id) {
      const chosenProvider = AI_PROVIDER_SETTING.schema.safeParse(next);
      if (chosenProvider.success) ensureList(chosenProvider.data);
    }
    const parsed = setting.schema.safeParse(candidateFor(controlFor(setting), next));
    // ONLY WHAT THE SCHEMA ACCEPTS travels. A half-typed number is a value on screen and not a
    // setting yet; the row says so through `invalid` below.
    if (parsed.success) report({ values: { [setting.id]: parsed.data } });
  };

  /**
   * KEY CHECKS (ADR-0158): how many each provider's key has been asked, and which keys changed since. An answer is the
   * one to the LAST check asked only when the reply's count reaches it, and editing or removing the key takes the
   * answer away, since it was about a key that is no longer there.
   */
  const [asked, setAsked] = useState<Readonly<Partial<Record<AiProviderId, number>>>>({});
  const [changedSince, setChangedSince] = useState<Readonly<Partial<Record<AiProviderId, true>>>>({});
  const providerOfKey = (setting: SettingDefinition): AiProviderId | undefined =>
    AI_PROVIDER_IDS.find((id) => AI_PROVIDERS[id].keySetting === setting.id);
  const checkState = (id: AiProviderId): Parameters<typeof KeyCheck>[0]['state'] => {
    const times = asked[id] ?? 0;
    if (times === 0 || changedSince[id] === true) return { kind: 'none' };
    if ((checked[id] ?? 0) < times) return { kind: 'checking' };
    return { kind: 'answered', answer: models[id] };
  };

  const changeSecret = (setting: SettingDefinition, next: SecretDraft): void => {
    const keyOf = providerOfKey(setting);
    if (keyOf !== undefined) setChangedSince((current) => ({ ...current, [keyOf]: true }));
    setSecrets((current) => ({ ...current, [setting.id]: next }));
    const id = storedSecrets.find((held) => held === setting.id) ?? (setting.id as SecretSettingId);
    if (next.remove) report({ secrets: { [id]: '' } });
    else if (next.replace !== '') report({ secrets: { [id]: next.replace } });
  };

  /** Which shown setting holds a value its schema refuses, if any. */
  let invalid: MessageKey | undefined;
  for (const setting of DIALOG_SETTINGS) {
    const control = controlFor(setting);
    if (control === 'secret') continue;
    if (!setting.schema.safeParse(candidateFor(control, drafts[setting.id])).success) invalid ??= setting.title;
  }

  const wanted = query.trim().toLocaleLowerCase();
  const matches = (setting: SettingDefinition): boolean =>
    wanted === '' ||
    _(setting.title).toLocaleLowerCase().includes(wanted) ||
    (setting.description !== undefined && _(setting.description).toLocaleLowerCase().includes(wanted));
  const found = wanted === '' ? [] : DIALOG_SETTINGS.filter((setting) => matches(setting));

  const rowFor = (setting: SettingDefinition): ReactElement =>
    setting.id === AI_PROVIDER_SETTING.id ? (
      <ProviderRow
        chosen={provider}
        key={setting.id}
        onChoose={(value) => {
          changeValue(setting, value);
        }}
        storedSecrets={storedSecrets}
      />
    ) : controlFor(setting) === 'ai-models' ? (
      <ModelRow
        chosen={chosenModels}
        key={setting.id}
        // ASKING until the reply to this provider's read arrives, so the row never says *not offered* of a model
        // nobody has yet checked against the provider's own list.
        asking={
          refreshAsked[provider] !== undefined &&
          (refreshed[provider] ?? 0) < (refreshAsked[provider] ?? 0) &&
          // A CHECK'S ANSWER REPLACED THE LIST TOO, from the same read.
          (checked[provider] ?? 0) === 0
        }
        list={models[provider]}
        onChoose={(next) => {
          changeValue(setting, next);
        }}
        provider={provider}
      />
    ) : setting.id === AZURE_DI_ENDPOINT_SETTING.id ? (
      // THE HELP UNDER THE FIRST OF THE TWO BOXES, where a person looking at the empty address finds what to create.
      <Fragment key={setting.id}>
        <AzureDocumentIntelligenceHelp
          onOpen={(page) => {
            report({ openPage: page });
          }}
        />
        {plainRow(setting)}
      </Fragment>
    ) : (
      plainRow(setting)
    );

  const plainRow = (setting: SettingDefinition): ReactElement => (
    <SettingRow
      available={secretsAvailable}
      draft={draftFor(setting)}
      key={setting.id}
      onDraft={(value) => {
        changeValue(setting, value);
      }}
      onSecret={(next) => {
        changeSecret(setting, next);
      }}
      secret={secrets[setting.id] ?? UNTOUCHED}
      setting={setting}
      stored={storedSecrets.some((id) => id === setting.id)}
      keyCheck={keyCheckFor(setting)}
    />
  );

  /** A provider key's Check, which needs a key stored or typed and not being removed, and a store to keep it in. */
  function keyCheckFor(setting: SettingDefinition): ReactElement | undefined {
    const id = providerOfKey(setting);
    if (id === undefined) return undefined;
    const draft = secrets[setting.id] ?? UNTOUCHED;
    const hasKey = !draft.remove && (draft.replace !== '' || storedSecrets.some((held) => held === setting.id));
    return (
      <KeyCheck
        canCheck={secretsAvailable && hasKey}
        onCheck={() => {
          setAsked((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
          setChangedSince((current) => Object.fromEntries(Object.entries(current).filter(([held]) => held !== id)));
          report({ check: id });
        }}
        provider={id}
        state={checkState(id)}
      />
    );
  }

  const page = pages.find((entry) => entry.id === chosen) ?? pages[0];
  const note = page === undefined ? undefined : PAGE_NOTES[page.id];

  return (
    <div className="m-settings">
      <div className="m-settings__search">
        <Icon name="Search" size="dense" />
        <input
          aria-label={_(SETTINGS_SEARCH)}
          className="m-input"
          id={searchId}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={_(SETTINGS_SEARCH)}
          type="search"
          value={query}
        />
      </div>

      <div className="m-settings__frame">
        <nav aria-label={_(SETTINGS_PAGES_LABEL)} className="m-settings__pages">
          {pages.map((entry) => (
            <button
              aria-current={entry.id === chosen ? 'page' : undefined}
              className="m-settings__page-choice"
              key={entry.id}
              onClick={() => {
                setChosen(entry.id);
                setQuery('');
                if (entry.id === 'ai') ensureList(provider);
              }}
              type="button"
            >
              <Icon name={entry.icon} size="dense" />
              {_(entry.title)}
            </button>
          ))}
        </nav>

        <section className="m-settings__page">
          {wanted === '' ? (
            <>
              <h3 className="m-settings__page-title">{page === undefined ? '' : _(page.title)}</h3>
              {note === undefined ? null : <p className="m-settings__page-note">{_(note)}</p>}

              {page?.id === 'appearance' && (
                <AccentRow
                  chosen={drafts[ACCENT_SETTING.id] ?? ACCENT_SETTING.fallback}
                  onChoose={(value) => {
                    changeValue(ACCENT_SETTING, value);
                  }}
                />
              )}

              {page === undefined ? null : onPage(page.id).map((setting) => rowFor(setting))}

              {page?.id === 'privacy' && (
                <ActionRow
                  description={SETTINGS_ACTION_CLEAR_HISTORY_DESCRIPTION}
                  done={cleared}
                  label={SETTINGS_ACTION_CLEAR_HISTORY}
                  onRun={() => {
                    report({ action: 'clear-chat-history' });
                    setCleared(true);
                  }}
                  title={SETTINGS_ACTION_CLEAR_HISTORY}
                />
              )}
              {page?.id === 'privacy' && (
                <ActionRow
                  description={SETTINGS_ACTION_CLEAR_RECENT_DESCRIPTION}
                  done={clearedRecent}
                  label={SETTINGS_ACTION_CLEAR_RECENT}
                  onRun={() => {
                    report({ action: 'clear-recent' });
                    setClearedRecent(true);
                  }}
                  title={SETTINGS_ACTION_CLEAR_RECENT}
                />
              )}
            </>
          ) : (
            <>
              <h3 className="m-settings__page-title">{_(SETTINGS_SEARCH)}</h3>
              {found.length === 0 ? (
                <p className="m-settings__page-note">{_(SETTINGS_NO_MATCH, { query: query.trim() })}</p>
              ) : (
                found.map((setting) => rowFor(setting))
              )}
            </>
          )}
        </section>
      </div>

      <footer className="m-settings__footer">
        <p className="m-settings__footer-note" role="status">
          {invalid === undefined ? _(SETTINGS_FOOTER_NOTE) : _(SETTINGS_INVALID, { setting: _(invalid) })}
        </p>
        <div className="m-settings__footer-controls">
          <Button
            label={SETTINGS_EXPORT}
            onClick={() => {
              report({ action: 'export' });
            }}
          />
          <Button
            label={SETTINGS_IMPORT}
            onClick={() => {
              // ANSWERED, NOT REPORTED: the values on this page are props, fixed while it is open (ADR-0038), so the
              // dialog closes and the command opens it again on what the file changed.
              resolve({ values: {}, secrets: {}, action: 'import' });
            }}
          />
          <Button
            label={SETTINGS_RESET}
            onClick={() => {
              report({ action: 'reset' });
              // THE DRAFTS FOLLOW, so the controls show what the command has just written.
              setDrafts(
                Object.fromEntries(
                  DIALOG_SETTINGS.filter((setting) => controlFor(setting) !== 'secret').map((setting) => [
                    setting.id,
                    controlFor(setting) === 'number' ? String(setting.fallback) : setting.fallback,
                  ]),
                ),
              );
            }}
          />
          <Button
            label={SETTINGS_DONE}
            onClick={() => {
              // NOTHING IS HELD: every change has been reported already, so the answer is empty.
              resolve({ values: {}, secrets: {} });
            }}
            variant="primary"
          />
        </div>
      </footer>
    </div>
  );
}
