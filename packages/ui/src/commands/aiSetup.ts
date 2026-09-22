import {
  AI_PROVIDER_KEY_SETTING_IDS,
  AI_PROVIDERS,
  AZURE_OPENAI_ENDPOINT_SETTING_ID,
  type ContractClient,
} from '@monstera/contract';

import { AI_SETUP_DIALOG_ID, type AiSetupAnswer, type AiSetupProblem } from '../dialogs/aiSetup.js';
import { AI_SETUP_COMMAND_TITLE, GROUP_AI } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { AI_SETUP_AT_START_SETTING } from '../settings/ai.js';
import type { SettingsStore } from '../settingsStore.js';

/**
 * *Set up AI…* — BUILD-PROMPT E5's first-run step, and the same step on demand: choose a
 * provider, paste a key, have it checked, or Skip.
 *
 * ## The check is `ai.models`, with the key already stored (the owner's ruling, 2026-09-21)
 *
 * `ai.models` asks the provider for its model list with the stored key, so *the list came back*
 * is *the provider accepted this key*. The key goes through `settings.saveSecret` first — the one
 * channel that stores a secret (ADR-0056) — and a key the provider refuses is REMOVED again
 * (`''`, the channel's own meaning), so a failed check leaves nothing stored. The dialog then
 * opens again saying why, until the person's key checks out or they Skip.
 *
 * A provider with no model list (Perplexity, probed 2026-09-17) cannot be checked this way: its
 * key is kept, because the first question is then the check, and the assistant's own refusal
 * words cover a wrong one.
 *
 * ## Skip, a key that checks out, and nothing else turn the start-up offer off
 *
 * Closing the dialog is *not now*, not *never*, so it leaves {@link AI_SETUP_AT_START_SETTING}
 * as it was.
 */
export function aiSetupCommand(deps: {
  readonly client: ContractClient;
  readonly settings: SettingsStore;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly onSecretsChanged: () => void;
}): UiCommand {
  return {
    id: 'ai.setup',
    icon: 'Sparkles',
    title: AI_SETUP_COMMAND_TITLE,
    // THE RIBBON AND THE PALETTE, and the first run opens it by itself. Not the start screen's
    // footer, which holds About, the log and Settings — and Settings is where a key goes anyway.
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_AI, order: 5 }],
    run: async (): Promise<void> => {
      const secrets = await deps.client['settings.loadSecrets']({});
      const secretsAvailable = secrets.ok && secrets.value.available;
      let problem: AiSetupProblem | undefined;
      let provider: (AiSetupAnswer & { kind: 'check' })['provider'] | undefined;

      for (;;) {
        const answer = (await deps.ask(AI_SETUP_DIALOG_ID, {
          secretsAvailable,
          ...(problem === undefined ? {} : { problem }),
          ...(provider === undefined ? {} : { provider }),
        })) as AiSetupAnswer | undefined;
        if (answer === undefined) return;
        if (answer.kind === 'skip') {
          deps.settings.set(AI_SETUP_AT_START_SETTING.id, false);
          return;
        }

        provider = answer.provider;
        // THE CONTRACT'S LITERAL for this provider's key, found in the list `settings.saveSecret`
        // accepts rather than cast from the table's wider template type.
        const keySetting = AI_PROVIDER_KEY_SETTING_IDS.find((id) => id === AI_PROVIDERS[answer.provider].keySetting);
        if (keySetting === undefined) throw new Error(`no key setting is declared for ${answer.provider}`);
        if (answer.provider === 'azure-openai') deps.settings.set(AZURE_OPENAI_ENDPOINT_SETTING_ID, answer.endpoint);
        const saved = await deps.client['settings.saveSecret']({ id: keySetting, value: answer.key });
        if (!saved.ok) {
          problem = 'not-stored';
          continue;
        }

        const listed = await deps.client['ai.models']({ provider: answer.provider });
        const refused = !listed.ok ? 'unreadable' : listed.value.problem;
        if (refused !== undefined) {
          // A KEY THE PROVIDER DID NOT ACCEPT IS NOT KEPT: removed before the dialog says so.
          await deps.client['settings.saveSecret']({ id: keySetting, value: '' });
          problem = refused;
          continue;
        }

        deps.settings.set(AI_SETUP_AT_START_SETTING.id, false);
        deps.onSecretsChanged();
        return;
      }
    },
  };
}
