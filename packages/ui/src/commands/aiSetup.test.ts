import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { AI_SETUP_DIALOG_ID, type AiSetupAnswer } from '../dialogs/aiSetup.js';
import { TOAST_AI_KEY_CHECKED, TOAST_AI_KEY_KEPT_UNCHECKED } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import type { DialogReports } from '../registries/dialogs.js';
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
function client(check: { problem?: 'unauthorised' | 'unreachable'; checked?: boolean }): {
  readonly client: ContractClient;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'settings.loadSecrets') return Promise.resolve(ok({ stored: [], available: true }));
    if (id === 'app.openWebPage') return Promise.resolve(ok({ opened: true }));
    if (id === 'ai.checkKey') {
      return Promise.resolve(
        ok(
          check.problem === undefined
            ? { accepted: true as const, checked: check.checked ?? true }
            : { accepted: false as const, problem: check.problem },
        ),
      );
    }
    throw new Error(`this case does not answer ${id}`);
  });
  return { client: built, sent };
}

/** A dialog host answering from a script, recording what each opening was shown. */
function dialogs(
  answers: readonly (AiSetupAnswer | undefined)[],
  /** What the window REPORTS before it answers, in order — the *get a key* link. */
  reports: readonly unknown[] = [],
): {
  readonly ask: (id: string, props: unknown, onUpdate?: DialogReports) => Promise<unknown>;
  readonly shown: unknown[];
} {
  const queue = [...answers];
  const shown: unknown[] = [];
  return {
    shown,
    ask: (id, props, onUpdate) => {
      expect(id).toBe(AI_SETUP_DIALOG_ID);
      shown.push(props);
      for (const reported of reports) onUpdate?.(reported, () => undefined);
      return Promise.resolve(queue.shift());
    },
  };
}

function settings(): SettingsStore {
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}

const CHECK: AiSetupAnswer = { kind: 'check', provider: 'openai', key: 'sk-test', endpoint: '' };

describe('Set up AI — the get-a-key link (ADR-0184)', () => {
  it('opens the chosen provider’s key page BY NAME, composes no address, and leaves everything else untouched', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    await aiSetupCommand({
      client: built,
      settings: store,
      ask: dialogs([{ kind: 'skip' }], [{ kind: 'key-page', provider: 'groq' }]).ask,
      onSecretsChanged: () => undefined,
      toast: () => undefined,
    }).run(START);
    // THE PLACE, NOT AN ADDRESS: `main` turns it into one.
    expect(sent.filter((call) => call.id === 'app.openWebPage').map((call) => call.params)).toStrictEqual([
      { page: 'ai-key-groq' },
    ]);
    // THE LINK IS NOT A CHECK: no key was sent anywhere.
    expect(sent.some((call) => call.id === 'ai.checkKey')).toBe(false);
  });

  it('a report that is not the link opens nothing', async () => {
    const { client: built, sent } = client({});
    await aiSetupCommand({
      client: built,
      settings: settings(),
      ask: dialogs([{ kind: 'skip' }], [{ kind: 'something-else' }]).ask,
      onSecretsChanged: () => undefined,
      toast: () => undefined,
    }).run(START);
    expect(sent.some((call) => call.id === 'app.openWebPage')).toBe(false);
  });
});

describe('Set up AI (E5 onboarding)', () => {
  it('CHECKS the typed key in one call, stores nothing itself, and a key that checks out turns the offer off', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    let changed = 0;
    await aiSetupCommand({
      client: built,
      settings: store,
      ask: dialogs([CHECK]).ask,
      onSecretsChanged: () => (changed += 1),
      toast: () => undefined,
    }).run(START);

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
    await aiSetupCommand({ client: built, settings: store, ask, onSecretsChanged: () => undefined, toast: () => undefined }).run(START);

    expect(sent.some((call) => call.id === 'settings.saveSecret')).toBe(false);
    expect(shown[1]).toStrictEqual({ secretsAvailable: true, problem: 'unauthorised', provider: 'openai' });
  });

  it('SKIP turns the offer off and checks nothing', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([{ kind: 'skip' }]).ask, onSecretsChanged: () => undefined, toast: () => undefined }).run(START);
    expect(sent.some((call) => call.id === 'ai.checkKey')).toBe(false);
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(false);
  });

  it('CONTROL: closing the dialog is "not now" — the offer stays on and nothing is checked', async () => {
    const { client: built, sent } = client({});
    const store = settings();
    await aiSetupCommand({ client: built, settings: store, ask: dialogs([undefined]).ask, onSecretsChanged: () => undefined, toast: () => undefined }).run(START);
    expect(sent.some((call) => call.id === 'ai.checkKey')).toBe(false);
    expect(store.get(AI_SETUP_AT_START_SETTING.id)).toBe(true);
  });

  it('Azure OpenAI’s address travels WITH the key it is checked with, and is kept only once it checks out', async () => {
    const accepted = client({});
    const store = settings();
    const azure: AiSetupAnswer = { kind: 'check', provider: 'azure-openai', key: 'k', endpoint: 'https://example.openai.azure.com' };
    await aiSetupCommand({ client: accepted.client, settings: store, ask: dialogs([azure]).ask, onSecretsChanged: () => undefined, toast: () => undefined }).run(START);
    expect(accepted.sent[1]?.params).toStrictEqual({ provider: 'azure-openai', key: 'k', endpoint: 'https://example.openai.azure.com' });
    expect(store.get('ai.azure-openai-endpoint')).toBe('https://example.openai.azure.com');

    // CONTROL: refused, the address the person had is left as it was.
    const refused = client({ problem: 'unauthorised' });
    const kept = settings();
    await aiSetupCommand({ client: refused.client, settings: kept, ask: dialogs([azure, { kind: 'skip' }]).ask, onSecretsChanged: () => undefined, toast: () => undefined }).run(START);
    expect(kept.get('ai.azure-openai-endpoint')).toBe('');
  });

  /** Runs the command over a script of answers, and answers every toast it raised. */
  async function toastsFor(
    check: Parameters<typeof client>[0],
    answers: readonly (AiSetupAnswer | undefined)[],
  ): Promise<readonly (readonly [string, string])[]> {
    const raised: (readonly [string, string])[] = [];
    await aiSetupCommand({
      client: client(check).client,
      settings: settings(),
      ask: dialogs(answers).ask,
      onSecretsChanged: () => undefined,
      toast: (kind, message) => {
        raised.push([kind, message]);
      },
    }).run(START);
    return raised;
  }

  it('a key the provider CHECKED is confirmed on screen as working (the owner’s review of 0.1.6.0)', async () => {
    expect(await toastsFor({ checked: true }, [CHECK])).toStrictEqual([['done', TOAST_AI_KEY_CHECKED]]);
  });

  it('a key KEPT UNCHECKED is confirmed as saved, and never as working', async () => {
    expect(await toastsFor({ checked: false }, [CHECK])).toStrictEqual([['done', TOAST_AI_KEY_KEPT_UNCHECKED]]);
  });

  it('CONTROL: a refused key, a Skip and a closed dialog confirm nothing', async () => {
    expect(await toastsFor({ problem: 'unauthorised' }, [CHECK, { kind: 'skip' }])).toStrictEqual([]);
    expect(await toastsFor({}, [{ kind: 'skip' }])).toStrictEqual([]);
    expect(await toastsFor({}, [undefined])).toStrictEqual([]);
  });
});
