import { AI_PROVIDER_IDS, AZURE_KEY_SETTING_ID, type AiModelListAnswer, channels, createClient } from '@monstera/contract';
import { type FileHandle, asFileHandle, err, messageKey, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { SETTINGS_DIALOG, SETTINGS_DIALOG_ID } from '../dialogs/settings.js';
import { SETTINGS_PROBLEM_DIALOG_ID } from '../dialogs/settingsProblem.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { THEME_SETTING, THUMBNAIL_SIZE_SETTING } from '../settings/appearance.js';
import { AZURE_DI_KEY_SETTING, OCR_LANGUAGE_SETTING } from '../settings/editing.js';
import {
  TOAST_SETTINGS_IMPORTED,
  TOAST_SETTINGS_IMPORTED_PARTLY,
  TOAST_SETTINGS_NOT_SAVED,
  TOAST_SETTINGS_SAVED,
  TOAST_SETTINGS_UNREADABLE,
  TOAST_SHOW_IN_FOLDER,
} from '../messages/en.js';
import type { ToastAction } from '../primitives/Toast.js';
import { SettingsStore } from '../settingsStore.js';
import type { ShortcutRow } from '../surfaces/shortcutChoice.js';
import { SHORTCUTS_SETTING } from '../settings/keyboard.js';
import { showSettingsCommand } from './showSettings.js';

/**
 * The Settings command — what it opens the dialog with, and what it writes.
 *
 * The client is built from the CONTRACT, so every answer invented here goes
 * through the channels' real schemas: a `settings.loadSecrets` answer carrying a
 * value is not something this file could construct, which is the point of
 * ADR-0056 Decision 5.
 */
const HELD_OPENAI = {
  source: 'fetched' as const,
  models: [{ id: 'gpt-held', label: 'GPT held', capabilities: { vision: null, streaming: null } }],
};
const HELD_FALLBACK = { source: 'fallback' as const, models: [] };
/** The one command the Keyboard page lists in these cases, registered on Ctrl+G. */
const GRID_ROW: ShortcutRow = {
  id: 'view.toggle-grid',
  title: messageKey('command.grid.title'),
  chord: 'Ctrl+G',
  fallback: 'Ctrl+G',
  also: [],
};

function harness(options: {
  readonly stored?: readonly (typeof AZURE_KEY_SETTING_ID)[];
  readonly available?: boolean;
  readonly loadRefuses?: boolean;
  readonly heldRefuses?: boolean;
  readonly saveRefuses?: boolean;
  readonly answer?: unknown;
  /** What the dialog reports while it is open, each delivered before it answers (ADR-0094). */
  readonly reports?: readonly unknown[];
  /** What `settings.import` answers — a file's values, a dismissed picker, or a file that is not one. */
  readonly imported?: { kind: 'read'; values: Record<string, unknown> } | { kind: 'cancelled' } | { kind: 'unreadable' };
  /** What `settings.export` answers — a written file, a dismissed picker, or a write that failed. */
  readonly exported?: { kind: 'written'; settings: number; written: FileHandle } | { kind: 'cancelled' } | { kind: 'write-failed' };
  /** What `ai.models` answers for a key check (ADR-0158), or `refuse` for a query that fails. */
  readonly listed?: AiModelListAnswer | 'refuse';
}): {
  readonly run: () => Promise<void>;
  readonly settings: SettingsStore;
  readonly sent: { id: string; params: unknown }[];
  readonly asked: { id: string; props: unknown }[];
  /** The props each reply handed the open dialog (ADR-0158), in order. */
  readonly replies: unknown[];
  readonly secretsChanged: () => number;
  readonly recentCleared: () => number;
  readonly toasts: string[];
  readonly actions: (ToastAction | undefined)[];
} {
  const toasts: string[] = [];
  const actions: (ToastAction | undefined)[] = [];
  // THE DIALOG ANSWERS ITS FIRST OPENING ONLY. An import opens Settings again, and a fixture answering `import` every
  // time would loop; the second opening is dismissed, which is a person closing it.
  let opened = 0;
  const sent: { id: string; params: unknown }[] = [];
  const asked: { id: string; props: unknown }[] = [];
  const replies: unknown[] = [];
  let changed = 0;
  let recentCleared = 0;
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
      // SETTLED ON A LATER TURN, and its settling recorded, so a case can tell a request made after a save FINISHED
      // from one made while it was still on its way — both follow the call.
      return new Promise((settle) => {
        setTimeout(() => {
          sent.push({ id: 'settings.saveSecret:settled', params: undefined });
          settle(options.saveRefuses === true ? err({ code: 'secret-storage-unavailable' }) : ok({ stored: true }));
        }, 0);
      });
    }
    // THE LISTS MAIN HOLDS: OpenAI's fetched, every other provider its fallback — two sources, so a case can see
    // that the one handed to the dialog is this answer and not something built beside it.
    if (id === 'ai.models.held') {
      if (options.heldRefuses === true) return Promise.resolve(err({ code: 'internal', incident: 'test' }));
      return Promise.resolve(
        ok(
          Object.fromEntries(
            AI_PROVIDER_IDS.map((provider) => [provider, provider === 'openai' ? HELD_OPENAI : HELD_FALLBACK]),
          ),
        ),
      );
    }
    // THE FOOTER'S TWO CHANNELS, answered so a case can see which of them an action reached.
    if (id === 'ai.models') {
      if (options.listed === undefined || options.listed === 'refuse') return Promise.resolve(err({ code: 'internal', incident: 'test' }));
      return Promise.resolve(ok(options.listed));
    }
    if (id === 'app.openWebPage') return Promise.resolve(ok({ opened: true }));
    if (id === 'ai.history.clear') return Promise.resolve(ok({ cleared: 2 }));
    if (id === 'settings.export') return Promise.resolve(ok(options.exported ?? { kind: 'cancelled' as const }));
    if (id === 'file.reveal') return Promise.resolve(ok({ revealed: true }));
    if (id === 'document.clearRecent') return Promise.resolve(ok({ cleared: 3 }));
    if (id === 'settings.import') return Promise.resolve(ok(options.imported ?? { kind: 'cancelled' as const }));
    throw new Error(`this fixture answers only the secret and footer channels, not ${id}`);
  });
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const command = showSettingsCommand({
    client,
    settings,
    ask: (id, props, onUpdate) => {
      asked.push({ id, props });
      if (id !== SETTINGS_DIALOG_ID) return Promise.resolve(undefined);
      opened += 1;
      if (opened > 1) return Promise.resolve(undefined);
      for (const report of options.reports ?? []) {
        // EVERY REPLY VALIDATED as the host validates it (ADR-0158), so a case cannot pass on props the dialog refuses.
        onUpdate?.(report, (props) => replies.push(SETTINGS_DIALOG.props.parse(props)));
      }
      return Promise.resolve(options.answer);
    },
    onSecretsChanged: () => {
      changed += 1;
    },
    onRecentCleared: () => {
      recentCleared += 1;
    },
    toast: (kind, message, action) => {
      toasts.push(`${kind} ${message}`);
      actions.push(action);
    },
    shortcuts: { rows: () => [GRID_ROW], dropped: () => ['view.toggle-rulers'] },
  });
  return {
    run: async () => {
      await command.run({
        selectedPages: [],
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
    replies,
    secretsChanged: () => changed,
    recentCleared: () => recentCleared,
    toasts,
    actions,
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

  it('each FOOTER ACTION reaches its own channel, and only its own', async () => {
    // THE STEP BETWEEN THE PAIR'S HALVES: `SettingsBody.test.tsx` proves the button reports the
    // action, `contractHandlers.test.ts` that the channel clears the history, and only this case
    // crosses the command that turns one into the other. A report is applied without being awaited,
    // so the case waits a turn for the call it asserts.
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const footer = (id: string): string[] =>
      id === 'ai.history.clear' || id === 'settings.export' || id === 'document.clearRecent' ? [id] : [];

    const cleared = harness({ reports: [{ values: {}, secrets: {}, action: 'clear-chat-history' }] });
    await cleared.run();
    await settle();
    expect(cleared.sent.flatMap((call) => footer(call.id))).toStrictEqual(['ai.history.clear']);
    // CONTROL for the one below: clearing the chats does not tell the start screen to read its list again.
    expect(cleared.recentCleared()).toBe(0);

    // THE RECENT LIST: main empties it, THEN the start screen is told, so it reads the emptied list.
    const recent = harness({ reports: [{ values: {}, secrets: {}, action: 'clear-recent' }] });
    await recent.run();
    await settle();
    expect(recent.sent.flatMap((call) => footer(call.id))).toStrictEqual(['document.clearRecent']);
    expect(recent.recentCleared()).toBe(1);

    const exported = harness({ reports: [{ values: {}, secrets: {}, action: 'export' }] });
    await exported.run();
    await settle();
    expect(exported.sent.flatMap((call) => footer(call.id))).toStrictEqual(['settings.export']);

    // RESET puts a changed setting back, and calls neither channel.
    const reset = harness({ reports: [{ values: {}, secrets: {}, action: 'reset' }] });
    reset.settings.set(THEME_SETTING.id, 'dark');
    await reset.run();
    await settle();
    expect(reset.settings.get(THEME_SETTING.id)).toBe(THEME_SETTING.fallback);
    expect(reset.sent.flatMap((call) => footer(call.id))).toStrictEqual([]);
  });

  it('an export CONFIRMS where it was written, with Show in folder on the handle it answered, and says where it was not', async () => {
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const handle = asFileHandle('Handle-settings-written');
    const EXPORT = { reports: [{ values: {}, secrets: {}, action: 'export' }] } as const;

    const written = harness({ ...EXPORT, exported: { kind: 'written', settings: 12, written: handle } });
    await written.run();
    await settle();
    expect(written.toasts).toStrictEqual([`done ${TOAST_SETTINGS_SAVED}`]);
    expect(written.actions[0]?.label).toBe(TOAST_SHOW_IN_FOLDER);
    // NOTHING IS REVEALED UNTIL THE ACTION RUNS, and then the file this write answered.
    expect(written.sent.some((call) => call.id === 'file.reveal')).toBe(false);
    written.actions[0]?.run();
    expect(written.sent.at(-1)).toStrictEqual({ id: 'file.reveal', params: { handle } });

    const failed = harness({ ...EXPORT, exported: { kind: 'write-failed' } });
    await failed.run();
    await settle();
    expect(failed.toasts).toStrictEqual([`problem ${TOAST_SETTINGS_NOT_SAVED}`]);

    // CONTROL: a dismissed picker wrote nothing and says nothing.
    const cancelled = harness({ ...EXPORT, exported: { kind: 'cancelled' } });
    await cancelled.run();
    await settle();
    expect(cancelled.toasts).toStrictEqual([]);
  });

  it('CONTROL: a dismissed dialog writes nothing anywhere', async () => {
    const { run, settings, sent, secretsChanged } = harness({ answer: undefined });
    const before = settings.get(THEME_SETTING.id);

    await run();

    expect(settings.get(THEME_SETTING.id)).toBe(before);
    expect(sent.map((call) => call.id)).toStrictEqual(['settings.loadSecrets', 'ai.models.held']);
    expect(secretsChanged()).toBe(0);
  });

  it('opens with the model lists main HOLDS, and asks no channel that fetches one (ADR-0117)', async () => {
    const { run, asked, sent } = harness({});

    await run();

    const props = asked[0]?.props as { models: Record<string, unknown> };
    // OPENAI'S IS THE FETCHED ONE main answered, so this is the query's answer handed through, not a list made here.
    expect(props.models['openai']).toStrictEqual(HELD_OPENAI);
    expect(Object.keys(props.models).sort()).toStrictEqual([...AI_PROVIDER_IDS].sort());
    // THE DECISION: nothing that reaches a provider is called to open Settings.
    expect(sent.map((call) => call.id)).not.toContain('ai.models');
  });

  it('a held query that FAILED opens with no lists, which each model row reports, rather than refusing to open', async () => {
    const { run, asked } = harness({ heldRefuses: true });

    await run();

    expect(asked[0]?.id).toBe(SETTINGS_DIALOG_ID);
    expect((asked[0]?.props as { models: unknown }).models).toStrictEqual({});
  });

  describe('the KEYBOARD page (ADR-0191)', () => {
    it('opens with the registry’s rows and the dropped choices, read when Settings opens', async () => {
      const { run, asked } = harness({});
      await run();
      expect((asked[0]?.props as { shortcuts: unknown }).shortcuts).toStrictEqual({
        rows: [GRID_ROW],
        dropped: ['view.toggle-rulers'],
      });
    });

    it('a reported key is stored NORMALISED, as a difference from the default, by the one writer', async () => {
      const chosen = harness({ reports: [{ values: {}, secrets: {}, shortcut: { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+Shift+M' } }] });
      await chosen.run();
      expect(chosen.settings.get(SHORTCUTS_SETTING.id)).toStrictEqual({ 'view.toggle-grid': 'ctrl+shift+m' });

      // BACK TO THE DEFAULT removes the entry, so a default a later build changes still reaches this person.
      const restored = harness({
        reports: [
          { values: {}, secrets: {}, shortcut: { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+Shift+M' } },
          { values: {}, secrets: {}, shortcut: { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+G' } },
        ],
      });
      await restored.run();
      expect(restored.settings.get(SHORTCUTS_SETTING.id)).toStrictEqual({});
    });

    it('no key is stored as null, and Reset all empties the choices', async () => {
      const removed = harness({ reports: [{ values: {}, secrets: {}, shortcut: { kind: 'choose', id: 'view.toggle-grid', chord: null } }] });
      await removed.run();
      expect(removed.settings.get(SHORTCUTS_SETTING.id)).toStrictEqual({ 'view.toggle-grid': null });

      const reset = harness({
        reports: [
          { values: {}, secrets: {}, shortcut: { kind: 'choose', id: 'view.toggle-grid', chord: null } },
          { values: {}, secrets: {}, shortcut: { kind: 'reset' } },
        ],
      });
      await reset.run();
      expect(reset.settings.get(SHORTCUTS_SETTING.id)).toStrictEqual({});
    });

    it('CONTROL: a report with no shortcut writes none', async () => {
      const untouched = harness({ reports: [{ values: { [THEME_SETTING.id]: 'dark' }, secrets: {} }] });
      await untouched.run();
      expect(untouched.settings.get(SHORTCUTS_SETTING.id)).toStrictEqual({});
    });
  });

  describe('a KEY CHECK (ADR-0158)', () => {
    const CHECK = { values: {}, secrets: {}, check: 'openai' as const };
    const FETCHED: AiModelListAnswer = {
      source: 'fetched',
      models: [{ id: 'gpt-checked', label: 'GPT checked', capabilities: { vision: null, streaming: null } }],
    };
    const replied = (replies: unknown[]): { models: Record<string, unknown>; checked?: Record<string, number> }[] =>
      replies as { models: Record<string, unknown>; checked?: Record<string, number> }[];

    it('ACCEPTED: asks ai.models for the provider and replies with its fetched list and one answered check', async () => {
      const { run, sent, replies } = harness({ reports: [CHECK], listed: FETCHED });
      await run();
      expect(sent.filter((call) => call.id === 'ai.models').map((call) => call.params)).toStrictEqual([{ provider: 'openai' }]);
      expect(replied(replies)).toHaveLength(1);
      expect(replied(replies)[0]?.models['openai']).toStrictEqual(FETCHED);
      expect(replied(replies)[0]?.checked).toStrictEqual({ openai: 1 });
      // EVERY OTHER PROVIDER'S LIST is the one the dialog opened with: the check changes only its own.
      expect(replied(replies)[0]?.models['anthropic']).toStrictEqual(HELD_FALLBACK);
    });

    it('REFUSED and OFFLINE: the provider’s answer with its problem is what the reply carries', async () => {
      for (const problem of ['unauthorised', 'unreachable'] as const) {
        const answer: AiModelListAnswer = { source: 'fallback', problem, models: [] };
        const { run, replies } = harness({ reports: [CHECK], listed: answer });
        await run();
        expect(replied(replies)[0]?.models['openai']).toStrictEqual(answer);
        expect(replied(replies)[0]?.checked).toStrictEqual({ openai: 1 });
      }
    });

    it('a query that FAILED replies with NO list for the provider, never the one it opened with', async () => {
      const { run, replies } = harness({ reports: [CHECK], listed: 'refuse' });
      await run();
      expect(replied(replies)[0]?.checked).toStrictEqual({ openai: 1 });
      expect(Object.keys(replied(replies)[0]?.models ?? {})).not.toContain('openai');
    });

    it('waits for the key typed just before it to be SAVED, so the provider is asked with that key', async () => {
      const typed = { values: {}, secrets: { 'ai.openai-key': 'example-key-typed' } };
      const { run, sent } = harness({ reports: [typed, CHECK], listed: FETCHED });
      await run();
      const order = sent.map((call) => call.id).filter((id) => id.startsWith('settings.saveSecret') || id === 'ai.models');
      expect(order).toStrictEqual(['settings.saveSecret', 'settings.saveSecret:settled', 'ai.models']);
    });

    it('counts each check, and NO KEY travels in a reply', async () => {
      // A KEY IS IN THE INPUT (audit PPPPPPP-3): typed before the first check and reported WITH the second, so a reply that
      // carried a report's secrets, or the stored ones, would carry it. Without one the absence below could not fail.
      const typed = { values: {}, secrets: { 'ai.openai-key': 'example-key-typed' } };
      const { run, replies } = harness({
        reports: [typed, CHECK, { ...CHECK, secrets: { 'ai.openai-key': 'example-key-typed' } }],
        listed: FETCHED,
      });
      await run();
      expect(replied(replies).map((props) => props.checked)).toStrictEqual([{ openai: 1 }, { openai: 2 }]);
      expect(JSON.stringify(replies)).not.toContain('example-key');
    });

    it('a REFRESH (ADR-0190) asks the provider for its list and replies with it, counted apart from a check', async () => {
      const { run, sent, replies } = harness({ reports: [{ values: {}, secrets: {}, refresh: 'openai' }], listed: FETCHED });
      await run();
      expect(sent.filter((call) => call.id === 'ai.models').map((call) => call.params)).toStrictEqual([{ provider: 'openai' }]);
      const reply = replies[0] as { models: Record<string, unknown>; checked?: unknown; refreshed?: unknown };
      expect(reply.models['openai']).toStrictEqual(FETCHED);
      expect(reply.refreshed).toStrictEqual({ openai: 1 });
      // IT SAYS NOTHING OF THE KEY: no answered check is counted, so no *Key works* can follow from it.
      expect(reply.checked).toBeUndefined();
    });

    it('an OPEN-PAGE report names the PLACE to main and replies nothing, asking no provider', async () => {
      const { run, sent, replies } = harness({ reports: [{ values: {}, secrets: {}, openPage: 'azure-di-keys' }], listed: FETCHED });
      await run();
      expect(sent.filter((call) => call.id === 'app.openWebPage').map((call) => call.params)).toStrictEqual([
        { page: 'azure-di-keys' },
      ]);
      expect(sent.map((call) => call.id)).not.toContain('ai.models');
      expect(replies).toStrictEqual([]);
    });

    it('CONTROL: a report without a check asks no provider and replies nothing', async () => {
      const { run, sent, replies } = harness({ reports: [{ values: { [THEME_SETTING.id]: 'dark' }, secrets: {} }], listed: FETCHED });
      await run();
      expect(sent.map((call) => call.id)).not.toContain('ai.models');
      expect(replies).toStrictEqual([]);
    });
  });

  describe('IMPORT SETTINGS (BUILD-PROMPT.md:630)', () => {
    const IMPORT = { values: {}, secrets: {}, action: 'import' as const };

    it('applies each value this build reads — an OLD single language migrated — leaves out the rest, and reopens on it', async () => {
      const { run, settings, asked, toasts } = harness({
        answer: IMPORT,
        imported: {
          kind: 'read',
          values: {
            [THEME_SETTING.id]: 'dark',
            // AN OLDER BUILD'S SHAPE: one language, which this build reads as a set of one — through the registry's
            // one reading, so an import cannot accept what a restart would then replace with the fallback.
            [OCR_LANGUAGE_SETTING.id]: 'deu',
            'no.such-setting': 1,
            [THUMBNAIL_SIZE_SETTING.id]: 'enormous',
          },
        },
      });
      await run();

      expect(settings.get(THEME_SETTING.id)).toBe('dark');
      expect(settings.get(OCR_LANGUAGE_SETTING.id)).toStrictEqual(['deu']);
      expect(settings.get(THUMBNAIL_SIZE_SETTING.id)).toBe(THUMBNAIL_SIZE_SETTING.fallback);
      expect(toasts).toStrictEqual([`done ${TOAST_SETTINGS_IMPORTED_PARTLY}`]);
      // OPENED AGAIN, on what the file changed.
      const openings = asked.filter((entry) => entry.id === SETTINGS_DIALOG_ID);
      expect(openings).toHaveLength(2);
      expect((openings[1]?.props as { values: Record<string, unknown> }).values[THEME_SETTING.id]).toBe('dark');
    });

    it('a file whose every value is read says so plainly', async () => {
      const { run, toasts } = harness({ answer: IMPORT, imported: { kind: 'read', values: { [THEME_SETTING.id]: 'light' } } });
      await run();
      expect(toasts).toStrictEqual([`done ${TOAST_SETTINGS_IMPORTED}`]);
    });

    it('a SECRET in the file is never set, whatever main let through', async () => {
      const { run, settings } = harness({
        answer: IMPORT,
        imported: { kind: 'read', values: { [AZURE_DI_KEY_SETTING.id]: 'a-key-from-a-file' } },
      });
      await run();
      expect(settings.get(AZURE_DI_KEY_SETTING.id)).toBe(AZURE_DI_KEY_SETTING.fallback);
    });

    it('a file that is not a settings file changes nothing, says so, and returns to Settings', async () => {
      const { run, settings, asked, toasts } = harness({ answer: IMPORT, imported: { kind: 'unreadable' } });
      await run();
      expect(settings.get(THEME_SETTING.id)).toBe(THEME_SETTING.fallback);
      expect(toasts).toStrictEqual([`problem ${TOAST_SETTINGS_UNREADABLE}`]);
      expect(asked.filter((entry) => entry.id === SETTINGS_DIALOG_ID)).toHaveLength(2);
    });

    it('CONTROL: an answer that is not an import asks for no file', async () => {
      const { run, sent } = harness({ answer: { values: {}, secrets: {} } });
      await run();
      expect(sent.some((call) => call.id === 'settings.import')).toBe(false);
    });
  });
});
