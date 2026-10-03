import { type ContractClient, SECRET_SETTING_IDS } from '@monstera/contract';

import { SETTINGS_DIALOG_ID, type SettingsAnswer, DIALOG_SETTINGS, controlFor } from '../dialogs/settings.js';
import { SETTINGS_PROBLEM_DIALOG_ID } from '../dialogs/settingsProblem.js';
import {
  GROUP_APPLICATION,
  SETTINGS_COMMAND_TITLE,
  TOAST_SETTINGS_IMPORTED,
  TOAST_SETTINGS_IMPORTED_PARTLY,
  TOAST_SETTINGS_NOT_SAVED,
  TOAST_SETTINGS_SAVED,
  TOAST_SETTINGS_UNREADABLE,
} from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';
import type { SettingsStore } from '../settingsStore.js';
import type { ShowToast } from '../toasts.js';
import { confirmDone, confirmWritten } from './confirmWritten.js';
import { reportProblem } from './documentCommands.js';

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
  /** Told when the Privacy page emptied the Recent list, so a start screen behind the dialog reads it again. */
  readonly onRecentCleared: () => void;
  /** Says what an import did — imported, partly, or a file that was not a settings file. */
  readonly toast: ShowToast;
}): UiCommand {
  return {
    id: 'app.settings',
    // A CHANGED SETTING SHOWS WHERE IT APPLIES; an export or an import from the dialog confirms through its own toast.
    feedback: VISIBLE,
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
      { surface: 'menu-bar', menu: 'window', group: 2, order: 10 },
    ],
    run: async (): Promise<void> => {
      await open();
    },
  };

  /**
   * Opens the dialog, applies what it reports, and — where it answered *Import settings…* — imports and opens it again
   * on the result, since its values are props fixed while it is open.
   */
  async function open(): Promise<void> {
      const secrets = await deps.client['settings.loadSecrets']({});
      // THE LISTS MAIN ALREADY HOLDS, asked of `main` and never of a provider: the dialog is props-only (ADR-0038), and
      // this query answers without the network, so opening Settings never waits on one (ADR-0117, corrected 2026-09-28).
      const held = await deps.client['ai.models.held']({});
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
        if (answer.action === 'clear-recent') {
          await deps.client['document.clearRecent']({});
          deps.onRecentCleared();
        }
        if (answer.action === 'export') {
          // CONFIRMED where it was written, and SAID where it was not: the answer was discarded until 2 October, so
          // a settings file that failed to write looked exactly like one that was written.
          const exported = await deps.client['settings.export']({});
          if (exported.ok && exported.value.kind === 'written') confirmWritten(deps, TOAST_SETTINGS_SAVED, exported.value.written);
          if (exported.ok && exported.value.kind === 'write-failed') deps.toast('problem', TOAST_SETTINGS_NOT_SAVED);
        }
      };

      const answer = (await deps.ask(
        SETTINGS_DIALOG_ID,
        {
          values,
          storedSecrets: secrets.ok ? secrets.value.stored : [],
          // A LOAD THAT FAILED IS NOT AVAILABLE STORAGE. Offering a field whose save cannot be known
          // to work would be the control that looks saved.
          secretsAvailable: secrets.ok && secrets.value.available,
          // A QUERY THAT FAILED IS NO LIST, and the row says so rather than offering nothing as though it were one.
          models: held.ok ? held.value : {},
        },
        (reported) => {
          void apply(reported as SettingsAnswer);
        },
      )) as SettingsAnswer | undefined;
      // DONE, or dismissed. Everything has been applied as it was reported; the answer carries what
      // a body reports at the moment it closes, which is nothing for this dialog.
      if (answer !== undefined) await apply(answer);
      if (answer?.action !== 'import') return;

      // IMPORT SETTINGS (`BUILD-PROMPT.md`:630): main reads the file the person picks, secrets left out, and the
      // store applies each value the registry can read — migrated and validated — leaving out the rest. Settings then
      // opens again, so what changed is what the person sees; a dismissed picker returns them to it unchanged.
      const read = await deps.client['settings.import']({});
      if (!read.ok) {
        reportProblem(deps, read.error);
        return;
      }
      if (read.value.kind === 'unreadable') deps.toast('problem', TOAST_SETTINGS_UNREADABLE);
      if (read.value.kind === 'read') {
        const { skipped } = deps.settings.importValues(read.value.values);
        confirmDone(deps, skipped === 0 ? TOAST_SETTINGS_IMPORTED : TOAST_SETTINGS_IMPORTED_PARTLY);
      }
      await open();
  }
}
