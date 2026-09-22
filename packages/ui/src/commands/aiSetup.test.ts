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
 * *Set up AI…*: the UI half of E5's onboarding. What main does with a typed key is
 * `contractHandlers.test.ts`' case for `ai.checkKey` — a refused key never reaches the store; these
 * assert what this command SENDS: one check carrying the typed key, never a store before it, and
 * the start-up offer turned off only by a Skip or a key that checks out.
 */

const START = { docId: undefined, version: undefined, hasSelection: false, dirty: false, page: undefined } as unknown as CommandContext;

interface Sent {
  readonly id: string;
  readonly params: unknown;
}

/** A client whose key check answers what the case says, recording every call. */
function client(check: { problem?: 'unauthorised' | 'unreachable' }): {
  readonly client: ContractClient;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'settings.loadSecrets') return Promise.resolve(ok({ stored: [], available: true }));
    if (id === 'ai.checkKey') {
      return Promise.resolve(
        ok(check.problem === undefined ? { accepted: true as const } : { accepted: false as const, problem: check.problem }),
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
  it('CHECKS the typed key in one call, stores nothing itself, and a key that checks out turns the offer off', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    let changed = 0;
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([CHECK]).ask, onSecretsChanged: () => (changed += 1) }).run(START);

    expect(sent.map((call) => call.id)).toStrictEqual(['settings.loadSecrets', 'ai.checkKey']);
    expect(sent[1]?.params).toStrictEqual({ provider: 'openai', key: 'sk-test' });
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(false);
    expect(changed).toBe(1);
  });

  it('a key the provider REFUSES reopens the dialog saying why, and NOTHING is written — no store, no removal', async () => {
    // The old order stored the key, checked, then wrote '' — which deleted a working key that was
    // already there. The absence of any saveSecret call is the assertion that separates the two.
    const { client: built, sent } = client({ problem: 'unauthorised' });
    const store = settings();
    const { ask, shown } = dialogs([CHECK, { kind: 'skip' }]);
    await aiSetupCommand({ client: built, settings: store, ask, onSecretsChanged: () => undefined }).run(START);

    expect(sent.some((call) => call.id === 'settings.saveSecret')).toBe(false);
    expect(shown[1]).toStrictEqual({ secretsAvailable: true, problem: 'unauthorised', provider: 'openai' });
  });

  it('SKIP turns the offer off and checks nothing', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([{ kind: 'skip' }]).ask, onSecretsChanged: () => undefined }).run(START);
    expect(sent.some((call) => call.id === 'ai.checkKey')).toBe(false);
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(false);
  });

  it('CONTROL: closing the dialog is "not now" — the offer stays on and nothing is checked', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([undefined]).ask, onSecretsChanged: () => undefined }).run(START);
    expect(sent.some((call) => call.id === 'ai.checkKey')).toBe(false);
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(true);
  });

  it('Azure OpenAI’s address travels WITH the key it is checked with, and is kept only once it checks out', async () => {
    const accepted = client({});
    const store = settings();
    const azure: AiSetupAnswer = { kind: 'check', provider: 'azure-openai', key: 'k', endpoint: 'https://example.openai.azure.com' };
    await aiSetupCommand({ client: accepted.client, settings: store, ask: dialogs([azure]).ask, onSecretsChanged: () => undefined }).run(START);
    expect(accepted.sent[1]?.params).toStrictEqual({ provider: 'azure-openai', key: 'k', endpoint: 'https://example.openai.azure.com' });
    expect(store.get('ai.azure-openai-endpoint')).toBe('https://example.openai.azure.com');

    // CONTROL: refused, the address the person had is left as it was.
    const refused = client({ problem: 'unauthorised' });
    const kept = settings();
    await aiSetupCommand({ client: refused.client, settings: kept, ask: dialogs([azure, { kind: 'skip' }]).ask, onSecretsChanged: () => undefined }).run(START);
    expect(kept.get('ai.azure-openai-endpoint')).toBe('');
  });
});
