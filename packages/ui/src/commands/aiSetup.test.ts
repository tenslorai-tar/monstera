import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { AI_SETUP_DIALOG_ID, type AiSetupAnswer } from '../dialogs/aiSetup.js';
import type { CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { AI_SETUP_AT_START_SETTING } from '../settings/ai.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SettingsStore } from '../settingsStore.js';
import { aiSetupCommand } from './aiSetup.js';

/**
 * *Set up AI…*: the UI half of E5's onboarding. What main does with a key is `secretStore.ts`'
 * and `ai.models`' own cases; these assert what this command SENDS and in what order — a key
 * saved before the check, removed again when the provider refuses it, and the start-up offer
 * turned off only by a Skip or a key that checks out.
 */

const START = { docId: undefined, version: undefined, hasSelection: false, dirty: false, page: undefined } as unknown as CommandContext;

interface Sent {
  readonly id: string;
  readonly params: unknown;
}

/** A client whose model list answers what the case says, recording every call. */
function client(models: { problem?: 'unauthorised' | 'unreachable'; source?: 'fetched' | 'no-list' }): {
  readonly client: ContractClient;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'settings.loadSecrets') return Promise.resolve(ok({ stored: [], available: true }));
    if (id === 'settings.saveSecret') return Promise.resolve(ok({ stored: true }));
    if (id === 'ai.models') {
      return Promise.resolve(
        ok({
          source: models.source ?? 'fetched',
          ...(models.problem === undefined ? {} : { problem: models.problem }),
          models: [],
        }),
      );
    }
    throw new Error(`this case does not answer ${id}`);
  });
  return { client: built, sent };
}

/** A dialog host answering from a script, recording what each opening was shown. */
function dialogs(answers: readonly (AiSetupAnswer | undefined)[]): {
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly shown: unknown[];
} {
  const queue = [...answers];
  const shown: unknown[] = [];
  return {
    shown,
    ask: (id, props) => {
      expect(id).toBe(AI_SETUP_DIALOG_ID);
      shown.push(props);
      return Promise.resolve(queue.shift());
    },
  };
}

function settings(): SettingsStore {
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}

const CHECK: AiSetupAnswer = { kind: 'check', provider: 'openai', key: 'sk-test', endpoint: '' };

describe('Set up AI (E5 onboarding)', () => {
  it('SAVES the key, then checks it with the model list, and a key that checks out turns the offer off', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    let changed = 0;
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([CHECK]).ask, onSecretsChanged: () => (changed += 1) }).run(START);

    expect(sent.map((call) => call.id)).toStrictEqual(['settings.loadSecrets', 'settings.saveSecret', 'ai.models']);
    expect(sent[1]?.params).toStrictEqual({ id: 'ai.openai-key', value: 'sk-test' });
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(false);
    expect(changed).toBe(1);
  });

  it('a key the provider REFUSES is removed again, and the dialog reopens saying why, on the same provider', async () => {
    const { client: built, sent } = client({ problem: 'unauthorised' });
    const store = settings();
    const { ask, shown } = dialogs([CHECK, { kind: 'skip' }]);
    await aiSetupCommand({ client: built, settings: store, ask, onSecretsChanged: () => undefined }).run(START);

    const saves = sent.filter((call) => call.id === 'settings.saveSecret').map((call) => call.params);
    expect(saves).toStrictEqual([
      { id: 'ai.openai-key', value: 'sk-test' },
      { id: 'ai.openai-key', value: '' },
    ]);
    expect(shown[1]).toStrictEqual({ secretsAvailable: true, problem: 'unauthorised', provider: 'openai' });
  });

  it('SKIP turns the offer off and stores nothing', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([{ kind: 'skip' }]).ask, onSecretsChanged: () => undefined }).run(START);
    expect(sent.some((call) => call.id === 'settings.saveSecret')).toBe(false);
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(false);
  });

  it('CONTROL: closing the dialog is "not now" — the offer stays on and nothing is stored', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([undefined]).ask, onSecretsChanged: () => undefined }).run(START);
    expect(sent.some((call) => call.id === 'settings.saveSecret')).toBe(false);
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(true);
  });

  it('a provider with NO model list keeps the key: the first question is its check', async () => {
    const { client: built, sent } = client({ source: 'no-list' });
    const store = settings();
    await aiSetupCommand({
      client: built,
      settings: store,
      ask: dialogs([{ kind: 'check', provider: 'perplexity', key: 'pplx', endpoint: '' }]).ask,
      onSecretsChanged: () => undefined,
    }).run(START);
    const saves = sent.filter((call) => call.id === 'settings.saveSecret').map((call) => call.params);
    expect(saves).toStrictEqual([{ id: 'ai.perplexity-key', value: 'pplx' }]);
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(false);
  });

  it('Azure OpenAI’s address is stored as its setting before the check reads it', async () => {
    const { client: built } = client({});
    const store = settings();
    await aiSetupCommand({
      client: built,
      settings: store,
      ask: dialogs([{ kind: 'check', provider: 'azure-openai', key: 'k', endpoint: 'https://example.openai.azure.com' }]).ask,
      onSecretsChanged: () => undefined,
    }).run(START);
    expect(store.get('ai.azure-openai-endpoint')).toBe('https://example.openai.azure.com');
  });
});
