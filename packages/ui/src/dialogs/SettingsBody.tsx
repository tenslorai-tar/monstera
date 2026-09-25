import { useLingui } from '@lingui/react';
import { AI_PROVIDERS, AI_PROVIDER_IDS, type AiProviderId, type SecretSettingId } from '@monstera/contract';
import { type MessageKey, channels } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { z } from 'zod';

import {
  ACCENT_DESCRIPTION,
  ACCENT_REJECTED,
  ACCENT_TITLE,
  AI_PROVIDER_NAMES,
  SETTINGS_ACTION_CLEAR_HISTORY,
  SETTINGS_ACTION_CLEAR_HISTORY_DESCRIPTION,
  SETTINGS_ACTION_CLEARED,
  SETTINGS_AI_NOTE,
  SETTINGS_AI_PROVIDER,
  SETTINGS_AI_PROVIDER_DESCRIPTION,
  SETTINGS_AI_PROVIDER_STORED,
  SETTINGS_APPEARANCE_NOTE,
  SETTINGS_DONE,
  SETTINGS_EDITING_NOTE,
  SETTINGS_EXPORT,
  SETTINGS_FOOTER_NOTE,
  SETTINGS_INTEGRATIONS_NOTE,
  SETTINGS_INVALID,
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
  SETTINGS_SECRET_REMOVE,
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
import { colourKindOf } from '../registries/settings.js';
import { ACCENT_SETTING } from '../settings/accent.js';
import { ACCENT_PRESETS, accentUsable } from '../settings/accentPresets.js';
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
}: {
  readonly setting: SettingDefinition;
  readonly draft: unknown;
  readonly onDraft: (value: unknown) => void;
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
        <div aria-labelledby={labelledBy} className="m-segmented" data-setting={setting.id} role="radiogroup">
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
    // WRITE-ONLY (ADR-0056 Decision 5). The field never holds the stored key — there is none on this
    // side to hold. It starts empty, a placeholder says a key is stored, typing replaces it and
    // Remove takes it away.
    return (
      <div className="m-settings-row__secret">
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
          <label className="m-settings-row__unset">
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
  resolve,
  update,
}: {
  readonly values: Readonly<Record<string, unknown>>;
  readonly storedSecrets: readonly SecretSettingId[];
  readonly secretsAvailable: boolean;
} & DialogAnswering<SettingsAnswer>): ReactElement {
  const { _, i18n } = useLingui();
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
  const [provider, setProvider] = useState<AiProviderId>('anthropic');
  const [cleared, setCleared] = useState(false);
  const searchId = useId();

  /** The settings each page draws: the AI page shows one provider's key, never all ten. */
  const onPage = (page: SettingCategory): readonly SettingDefinition[] =>
    DIALOG_SETTINGS.filter((setting) => {
      if (setting.category !== page) return false;
      if (page !== 'ai' || controlFor(setting) !== 'secret') return true;
      return setting.id === AI_PROVIDERS[provider].keySetting;
    });

  const pages = useMemo(() => listedPages(DIALOG_SETTINGS), []);
  const [chosen, setChosen] = useState<SettingCategory>(() => pages[0]?.id ?? 'appearance');

  /** Applying a change is REPORTING it: the command writes, and the dialog stays open (ADR-0094). */
  const report = (change: Partial<SettingsAnswer>): void => {
    update({ values: {}, secrets: {}, ...change });
  };

  const draftFor = (setting: SettingDefinition): unknown => drafts[setting.id];

  const changeValue = (setting: SettingDefinition, next: unknown): void => {
    setDrafts((current) => ({ ...current, [setting.id]: next }));
    const parsed = setting.schema.safeParse(candidateFor(controlFor(setting), next));
    // ONLY WHAT THE SCHEMA ACCEPTS travels. A half-typed number is a value on screen and not a
    // setting yet; the row says so through `invalid` below.
    if (parsed.success) report({ values: { [setting.id]: parsed.data } });
  };

  const changeSecret = (setting: SettingDefinition, next: SecretDraft): void => {
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

  const rowFor = (setting: SettingDefinition): ReactElement => (
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
    />
  );

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

              {page?.id === 'ai' && (
                // WHICH PROVIDER, before anything about a key: the owner's order, replacing ten fields.
                <div className="m-settings-row">
                  <div className="m-settings-row__text">
                    <span className="m-settings-row__label">{_(SETTINGS_AI_PROVIDER)}</span>
                    <span className="m-settings-row__note">{_(SETTINGS_AI_PROVIDER_DESCRIPTION)}</span>
                  </div>
                  <div className="m-settings-row__control">
                    <select
                      aria-label={_(SETTINGS_AI_PROVIDER)}
                      data-settings-provider=""
                      onChange={(event) => {
                        setProvider(event.target.value as AiProviderId);
                      }}
                      value={provider}
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
              )}

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
