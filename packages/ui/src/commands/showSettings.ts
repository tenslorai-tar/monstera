import { type ContractClient, SECRET_SETTING_IDS } from '@monstera/contract';

import { SETTINGS_DIALOG_ID, type SettingsAnswer, DIALOG_SETTINGS, controlFor } from '../dialogs/settings.js';
import { SETTINGS_PROBLEM_DIALOG_ID } from '../dialogs/settingsProblem.js';
import { GROUP_APPLICATION, SETTINGS_COMMAND_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import type { SettingsStore } from '../settingsStore.js';

/**
 * Opens the Settings dialog and writes what it reports
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md),
 * [ADR-0094](../../../../docs/DECISIONS/0094-a-dialog-may-report-before-it-answers.md)).
 *
 * ## Every change applies at once, and this command is still the writer
 *
 * The owner's design has no *Save*: a person changes a row and the change takes effect. The body
 * therefore REPORTS each change through `update` and this command applies it — the same code path
 * the closing answer took before, called more often. The mutation stays here, which is the property
 * ADR-0038 bought and ADR-0094 keeps.
 *
 * ## Two writers, by the kind of value, and neither is this command's invention
 *
 * An ordinary value goes through `SettingsStore.set`, which validates it and which `persistSettings`
 * saves — the rulers' toggle's route. A secret goes through `settings.saveSecret`, the only channel
 * that accepts one; main encrypts it through `safeStorage` or refuses with
 * `secret-storage-unavailable`, and that refusal is SHOWN, naming the setting, because a key a
 * person typed and that was not kept looks exactly like one that was.
 *
 * ## An ACTION is a button on a page, not a setting
 *
 * *Reset to defaults*, *Export settings…* and *Clear chat history* are reported the same way and
 * done here, because the body has no client and no store — the same reason the values are.
 *
 * ## No document, and on the start screen
 *
 * `About`'s placement and its reason: settings are wanted before anything is open, and a person
 * whose cloud engine cannot be reached comes looking here.
 */
export function showSettingsCommand(deps: {
  readonly client: ContractClient;
  readonly settings: SettingsStore;
  readonly ask: (id: string, props: unknown, onUpdate?: (result: unknown) => void) => Promise<unknown>;
  readonly onSecretsChanged: () => void;
}): UiCommand {
  return {
    id: 'app.settings',
    icon: 'Settings',
    title: SETTINGS_COMMAND_TITLE,
    placements: [
      // FIRST in the footer, v5-01's order: Settings · About · Help centre.
      { surface: 'start-screen', slot: 'footer', order: 1 },
      // 900s: Application is the LAST group on Tools. The section is for working on documents, and
      // a ribbon that opened on Settings and About put the application ahead of the work.
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 905 },
      // THE RAIL'S FOOT, where the owner's v5 design draws the gear on every document screen (ADR-0098).
      { surface: 'rail', order: 10 },
    ],
    run: async (): Promise<void> => {
      const secrets = await deps.client['settings.loadSecrets']({});
      const values = Object.fromEntries(
        DIALOG_SETTINGS.filter((setting) => controlFor(setting) !== 'secret').map((setting) => [
          setting.id,
          deps.settings.get(setting.id),
        ]),
      );

      const apply = async (answer: SettingsAnswer): Promise<void> => {
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
            // VOIDED for `reportProblem`'s reason: an informational dialog would hold the command
            // open until a person closed it.
            void deps.ask(SETTINGS_PROBLEM_DIALOG_ID, { setting: title, secret: true });
          }
        }
        if (moved) deps.onSecretsChanged();

        if (answer.action === 'reset') {
          // EVERY SHOWN SETTING back to what it was declared with. A secret is not reset: removing a
          // person's keys is not what *defaults* means, and each has its own Remove.
          for (const setting of DIALOG_SETTINGS) {
            if (controlFor(setting) === 'secret') continue;
            deps.settings.set(setting.id, setting.fallback);
          }
        }
        if (answer.action === 'clear-chat-history') await deps.client['ai.history.clear']({});
        if (answer.action === 'export') await deps.client['settings.export']({});
      };

      const answer = (await deps.ask(
        SETTINGS_DIALOG_ID,
        {
          values,
          storedSecrets: secrets.ok ? secrets.value.stored : [],
          // A LOAD THAT FAILED IS NOT AVAILABLE STORAGE. Offering a field whose save cannot be known
          // to work would be the control that looks saved.
          secretsAvailable: secrets.ok && secrets.value.available,
        },
        (reported) => {
          void apply(reported as SettingsAnswer);
        },
      )) as SettingsAnswer | undefined;
      // DONE, or dismissed. Everything has been applied as it was reported; the answer carries what
      // a body reports at the moment it closes, which is nothing for this dialog.
      if (answer !== undefined) await apply(answer);
    },
  };
}
