import { AZURE_KEY_SETTING_ID, channels, createClient } from '@monstera/contract';
import { err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { SETTINGS_DIALOG_ID } from '../dialogs/settings.js';
import { SETTINGS_PROBLEM_DIALOG_ID } from '../dialogs/settingsProblem.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { THEME_SETTING } from '../settings/appearance.js';
import { AZURE_DI_KEY_SETTING } from '../settings/editing.js';
import { SettingsStore } from '../settingsStore.js';
import { showSettingsCommand } from './showSettings.js';

/**
 * The Settings command — what it opens the dialog with, and what it writes.
 *
 * The client is built from the CONTRACT, so every answer invented here goes
 * through the channels' real schemas: a `settings.loadSecrets` answer carrying a
 * value is not something this file could construct, which is the point of
 * ADR-0056 Decision 5.
 */
function harness(options: {
  readonly stored?: readonly (typeof AZURE_KEY_SETTING_ID)[];
  readonly available?: boolean;
  readonly loadRefuses?: boolean;
  readonly saveRefuses?: boolean;
  readonly answer?: unknown;
}): {
  readonly run: () => Promise<void>;
  readonly settings: SettingsStore;
  readonly sent: { id: string; params: unknown }[];
  readonly asked: { id: string; props: unknown }[];
  readonly secretsChanged: () => number;
} {
  const sent: { id: string; params: unknown }[] = [];
  const asked: { id: string; props: unknown }[] = [];
  let changed = 0;
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'settings.loadSecrets') {
      return Promise.resolve(
        options.loadRefuses === true
          ? err({ code: 'internal', incident: 'test' })
          : ok({ stored: [...(options.stored ?? [])], available: options.available ?? true }),
      );
    }
    if (id === 'settings.saveSecret') {
      return Promise.resolve(
        options.saveRefuses === true
          ? err({ code: 'secret-storage-unavailable' })
          : ok({ stored: true }),
      );
    }
    throw new Error(`this fixture answers only the secret channels, not ${id}`);
  });
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const command = showSettingsCommand({
    client,
    settings,
    ask: (id, props) => {
      asked.push({ id, props });
      return Promise.resolve(id === SETTINGS_DIALOG_ID ? options.answer : undefined);
    },
    onSecretsChanged: () => {
      changed += 1;
    },
  });
  return {
    run: async () => {
      await command.run({
        docId: undefined,
        version: undefined,
        hasSelection: false,
        dirty: false,
        page: undefined,
        pageCount: undefined,
        openDocuments: [],
      });
    },
    settings,
    sent,
    asked,
    secretsChanged: () => changed,
  };
}

describe('showSettingsCommand', () => {
  it('opens the dialog with the ids of stored secrets, and NO secret value or id among the values', async () => {
    const { run, asked } = harness({ stored: [AZURE_KEY_SETTING_ID] });

    await run();

    const opened = asked[0]?.props as {
      values: Record<string, unknown>;
      storedSecrets: string[];
      secretsAvailable: boolean;
    };
    expect(asked[0]?.id).toBe(SETTINGS_DIALOG_ID);
    expect(opened.storedSecrets).toStrictEqual([AZURE_KEY_SETTING_ID]);
    expect(opened.secretsAvailable).toBe(true);
    // THE CONTROL: an ordinary setting IS among the values, so the absence of the
    // key's id below is not a values object that is empty.
    expect(opened.values).toHaveProperty(THEME_SETTING.id);
    expect(opened.values).not.toHaveProperty(AZURE_KEY_SETTING_ID);
  });

  it('writes a changed value through the store, and a typed key through settings.saveSecret', async () => {
    const { run, settings, sent, secretsChanged } = harness({
      answer: { values: { [THEME_SETTING.id]: 'dark' }, secrets: { [AZURE_KEY_SETTING_ID]: 'k' } },
    });

    await run();

    expect(settings.get(THEME_SETTING.id)).toBe('dark');
    expect(sent.filter((call) => call.id === 'settings.saveSecret')).toStrictEqual([
      { id: 'settings.saveSecret', params: { id: AZURE_KEY_SETTING_ID, value: 'k' } },
    ]);
    // THE KEY NEVER TOUCHES THE STORE, which is the route `settings.save` took.
    expect(settings.all()).not.toHaveProperty(AZURE_KEY_SETTING_ID);
    expect(secretsChanged()).toBe(1);
  });

  it('SHOWS a refused key, naming the setting — and nothing reports it as stored', async () => {
    const { run, asked, secretsChanged } = harness({
      saveRefuses: true,
      answer: { values: {}, secrets: { [AZURE_KEY_SETTING_ID]: 'k' } },
    });

    await run();

    expect(asked[1]).toStrictEqual({
      id: SETTINGS_PROBLEM_DIALOG_ID,
      props: { setting: AZURE_DI_KEY_SETTING.title, secret: true },
    });
    expect(secretsChanged()).toBe(0);
  });

  it('a load that FAILED offers no secret storage, rather than a field whose save is unknown', async () => {
    const { run, asked } = harness({ loadRefuses: true });

    await run();

    expect((asked[0]?.props as { secretsAvailable: boolean }).secretsAvailable).toBe(false);
  });

  it('CONTROL: a dismissed dialog writes nothing anywhere', async () => {
    const { run, settings, sent, secretsChanged } = harness({ answer: undefined });
    const before = settings.get(THEME_SETTING.id);

    await run();

    expect(settings.get(THEME_SETTING.id)).toBe(before);
    expect(sent.map((call) => call.id)).toStrictEqual(['settings.loadSecrets']);
    expect(secretsChanged()).toBe(0);
  });
});
