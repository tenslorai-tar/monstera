import { type ContractClient, SECRET_SETTING_IDS } from '@monstera/contract';

import { SETTINGS_DIALOG_ID, type SettingsAnswer, DIALOG_SETTINGS, controlFor } from '../dialogs/settings.js';
import { SETTINGS_PROBLEM_DIALOG_ID } from '../dialogs/settingsProblem.js';
import { GROUP_APPLICATION, SETTINGS_COMMAND_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import type { SettingsStore } from '../settingsStore.js';

/**
 * Opens the Settings dialog and writes what it answers
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)).
 *
 * ## Two writers, by the kind of value, and neither is this command's invention
 *
 * An ordinary value goes through `SettingsStore.set`, which validates it and
 * which `persistSettings` saves — the rulers' toggle's route. A secret goes
 * through `settings.saveSecret`, the only channel that accepts one; main encrypts
 * it through `safeStorage` or refuses with `secret-storage-unavailable`, and that
 * refusal is SHOWN, naming the setting, because a key a person typed and that
 * was not kept looks exactly like one that was.
 *
 * ## No document, and on the start screen
 *
 * `About`'s placement and its reason: settings are wanted before anything is
 * open, and a person whose cloud engine cannot be reached comes looking here.
 *
 * `onSecretsChanged` re-asks main which secrets are stored, so a tool gated on a
 * key appears once the key lands rather than on the next launch.
 */
export function showSettingsCommand(deps: {
  readonly client: ContractClient;
  readonly settings: SettingsStore;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly onSecretsChanged: () => void;
}): UiCommand {
  return {
    id: 'app.settings',
    title: SETTINGS_COMMAND_TITLE,
    placements: [
      { surface: 'start-screen', order: 3 },
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 5 },
    ],
    run: async (): Promise<void> => {
      const secrets = await deps.client['settings.loadSecrets']({});
      const values = Object.fromEntries(
        DIALOG_SETTINGS.filter((setting) => controlFor(setting) !== 'secret').map((setting) => [
          setting.id,
          deps.settings.get(setting.id),
        ]),
      );
      const answer = (await deps.ask(SETTINGS_DIALOG_ID, {
        values,
        storedSecrets: secrets.ok ? secrets.value.stored : [],
        // A LOAD THAT FAILED IS NOT AVAILABLE STORAGE. Offering a field whose
        // save cannot be known to work would be the control that looks saved.
        secretsAvailable: secrets.ok && secrets.value.available,
      })) as SettingsAnswer | undefined;
      if (answer === undefined) return;

      for (const [id, value] of Object.entries(answer.values)) deps.settings.set(id, value);

      let moved = false;
      for (const id of SECRET_SETTING_IDS) {
        const value = answer.secrets[id];
        if (value === undefined) continue;
        const saved = await deps.client['settings.saveSecret']({ id, value });
        if (saved.ok) {
          moved = true;
          continue;
        }
        const title = deps.settings.definition(id)?.title;
        if (title !== undefined) {
          // VOIDED for `reportProblem`'s reason: an informational dialog would
          // hold the command open until a person closed it.
          void deps.ask(SETTINGS_PROBLEM_DIALOG_ID, { setting: title, secret: true });
        }
      }
      if (moved) deps.onSecretsChanged();
    },
  };
}
