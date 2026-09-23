import { AZURE_OPENAI_ENDPOINT_SETTING_ID, type ContractClient } from '@monstera/contract';

import { AI_SETUP_DIALOG_ID, type AiSetupAnswer, type AiSetupProblem } from '../dialogs/aiSetup.js';
import { AI_SETUP_COMMAND_TITLE, GROUP_AI } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { AI_SETUP_AT_START_SETTING } from '../settings/ai.js';
import type { SettingsStore } from '../settingsStore.js';

/**
 * *Set up AI…* — BUILD-PROMPT E5's first-run step, and the same step on demand: choose a
 * provider, paste a key, have it checked, or Skip.
 *
 * ## The check is the model list, asked with the TYPED key before it is stored (the owner's ruling, 2026-09-21)
 *
 * `ai.checkKey` asks the provider for its model list with the key the person typed, so *the list
 * came back* is *the provider accepted this key*, and `main` stores it only then. It used to store
 * first, ask with the stored key and remove it on a refusal — so with a working key already stored,
 * a mistyped replacement overwrote it and was then deleted, leaving no key at all (found reading
 * this row on 2026-09-22). A refused key now never reaches the store. The dialog opens again saying
 * why, until the person's key checks out or they Skip.
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
        const endpoint = answer.provider === 'azure-openai' ? answer.endpoint : undefined;
        const checked = await deps.client['ai.checkKey']({
          provider: answer.provider,
          key: answer.key,
          ...(endpoint === undefined ? {} : { endpoint }),
        });
        if (!checked.ok) {
          problem = checked.error.code === 'secret-storage-unavailable' ? 'not-stored' : 'unreadable';
          continue;
        }
        if (!checked.value.accepted) {
          problem = checked.value.problem;
          continue;
        }
        // THE ADDRESS IS KEPT WITH THE KEY IT WAS CHECKED WITH, and only then.
        if (endpoint !== undefined) deps.settings.set(AZURE_OPENAI_ENDPOINT_SETTING_ID, endpoint);

        deps.settings.set(AI_SETUP_AT_START_SETTING.id, false);
        deps.onSecretsChanged();
        return;
      }
    },
  };
}
