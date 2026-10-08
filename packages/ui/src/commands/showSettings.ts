import { type AiProviderId, type ContractClient, SECRET_SETTING_IDS } from '@monstera/contract';
import type { z } from 'zod';

import {
  SETTINGS_DIALOG,
  SETTINGS_DIALOG_ID,
  type SettingsAnswer,
  DIALOG_SETTINGS,
  controlFor,
} from '../dialogs/settings.js';
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
import type { DialogReports } from '../registries/dialogs.js';
import type { SettingsStore } from '../settingsStore.js';
import type { ShortcutRow } from '../surfaces/shortcutChoice.js';
import type { ShowToast } from '../toasts.js';
import { confirmCopied, confirmDone, confirmWritten } from './confirmWritten.js';
import { reportProblem } from './documentCommands.js';
import { applyShortcutAnswer } from './keyboardShortcuts.js';

/** The props the Settings dialog opens with, and replies carry (ADR-0158). */
type SettingsProps = z.infer<typeof SETTINGS_DIALOG.props>;

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
  readonly ask: (id: string, props: unknown, onUpdate?: DialogReports) => Promise<unknown>;
  readonly onSecretsChanged: () => void;
  /** Told when the Privacy page emptied the Recent list, so a start screen behind the dialog reads it again. */
  readonly onRecentCleared: () => void;
  /** Says what an import did — imported, partly, or a file that was not a settings file. */
  readonly toast: ShowToast;
  /**
   * The Keyboard page's list (ADR-0191), read from the finished registry WHEN SETTINGS OPENS — the registry is built after
   * this command is, which is why they are functions (`keyboardShortcutsCommand`'s reason).
   */
  readonly shortcuts: {
    readonly rows: () => readonly ShortcutRow[];
    readonly dropped: () => readonly string[];
  };
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
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 905, size: 'small' },
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
        // EVERY EARLIER VERSION Monstera kept in its own folder (ADR-0198). The files beside a person's documents are never
        // touched by it; those are the person's.
        if (answer.action === 'clear-backups') await deps.client['app.clearBackups']({});
        if (answer.action === 'export') {
          // CONFIRMED where it was written, and SAID where it was not: the answer was discarded until 2 October, so
          // a settings file that failed to write looked exactly like one that was written.
          const exported = await deps.client['settings.export']({});
          if (exported.ok && exported.value.kind === 'written') confirmWritten(deps, TOAST_SETTINGS_SAVED, exported.value.written);
          if (exported.ok && exported.value.kind === 'write-failed') deps.toast('problem', TOAST_SETTINGS_NOT_SAVED);
        }
      };

      // THE INSTALLED VERSION, for the Updates page: `app.info`'s own, never a figure written here. A failed read leaves
      // the page without one rather than with a guess.
      const info = await deps.client['app.info']({});
      // EACH COMMAND'S REGISTERED KEY, by id, which a reported change is compared against (`applyShortcutAnswer`).
      const shortcutRows = deps.shortcuts.rows();
      const fallbacks = new Map(shortcutRows.map((row) => [row.id, row.fallback]));

      let shown: SettingsProps = {
        ...(info.ok ? { version: info.value.version } : {}),
        shortcuts: {
          rows: shortcutRows.map((row) => ({ ...row, also: [...row.also] })),
          dropped: [...deps.shortcuts.dropped()],
        },
        values,
        storedSecrets: secrets.ok ? secrets.value.stored : [],
        // A LOAD THAT FAILED IS NOT AVAILABLE STORAGE. Offering a field whose save cannot be known
        // to work would be the control that looks saved.
        secretsAvailable: secrets.ok && secrets.value.available,
        // A QUERY THAT FAILED IS NO LIST, and the row says so rather than offering nothing as though it were one.
        models: held.ok ? held.value : {},
      };

      /**
       * A KEY CHECK (ADR-0158): main asks the provider with the STORED key — Settings stores a key as it is typed — under
       * CR-SEC-02's address rule, and the answer is that provider's list. The reply carries it as the provider's models
       * and one more answered check, and the dialog stays open on the page it was on. Which secrets are stored is read
       * again with it, since the check is of a key typed since the dialog opened.
       */
      const answered: Partial<Record<AiProviderId, number>> = {};
      const refreshed: Partial<Record<AiProviderId, number>> = {};
      /**
       * ASKS THE PROVIDER for its list and replies with it. A CHECK is one that also counts as the answer to the key
       * (`checked`); a REFRESH is the AI page asking because a key is stored (`refreshed`), and says nothing of the key.
       */
      const ask = async (provider: AiProviderId, counted: Partial<Record<AiProviderId, number>>, reply: (props: unknown) => void): Promise<void> => {
        const list = await deps.client['ai.models']({ provider });
        const stored = await deps.client['settings.loadSecrets']({});
        counted[provider] = (counted[provider] ?? 0) + 1;
        // A QUERY THAT FAILED leaves the provider WITHOUT a list rather than with the one from before, so the answer
        // drawn for this check is never an earlier check's.
        const others: SettingsProps['models'] = Object.fromEntries(Object.entries(shown.models).filter(([held]) => held !== provider));
        const models = list.ok ? { ...others, [provider]: list.value } : others;
        shown = {
          ...shown,
          models,
          ...(Object.keys(answered).length > 0 ? { checked: { ...answered } } : {}),
          ...(Object.keys(refreshed).length > 0 ? { refreshed: { ...refreshed } } : {}),
          ...(stored.ok ? { storedSecrets: stored.value.stored } : {}),
        };
        reply(shown);
      };
      const check = (provider: AiProviderId, reply: (props: unknown) => void): Promise<void> => ask(provider, answered, reply);
      const refresh = (provider: AiProviderId, reply: (props: unknown) => void): Promise<void> => ask(provider, refreshed, reply);

      // IN THE ORDER REPORTED: a key is saved as it is typed, and a Check pressed straight after the last keystroke must
      // find that keystroke's save done, or main would ask the provider with the key before it. The chain goes on past
      // a failed report, whose rejection is left unhandled so it surfaces where every other one does.
      let queue: Promise<void> = Promise.resolve();
      const answer = (await deps.ask(SETTINGS_DIALOG_ID, shown, (reported, reply) => {
        const report = reported as SettingsAnswer;
        const next = queue.then(async () => {
          await apply(report);
          if (report.check !== undefined) await check(report.check, reply);
          if (report.refresh !== undefined) await refresh(report.refresh, reply);
          // A LINK ON THE PAGE: the place is named and main opens its address. Whether it opened is not read — a page
          // this build has an address for is the only kind these are, and the browser's own failure is the browser's.
          if (report.openPage !== undefined) await deps.client['app.openWebPage']({ page: report.openPage });
          // THE UPDATES PAGE'S TWO BUTTONS. Copy goes through main (the renderer holds no clipboard permission) and says
          // *Copied* only on main's word; Check opens the Store's own updates page, which installs nothing (ADR-0018).
          if (report.updates === 'copy-version' && info.ok) {
            const copied = await deps.client['window.copyText']({ text: info.value.version });
            if (copied.ok && copied.value.copied) confirmCopied(deps);
          }
          if (report.updates === 'check') await deps.client['app.openStore']({ page: 'updates' });
          // A KEY CHANGED ON THE KEYBOARD PAGE: written by the one function that writes `keyboard.shortcuts`.
          if (report.shortcut !== undefined) applyShortcutAnswer(deps.settings, fallbacks, report.shortcut);
        });
        queue = next.then(
          () => undefined,
          () => undefined,
        );
        void next;
      })) as SettingsAnswer | undefined;
      // DONE, or dismissed. Everything has been applied as it was reported; the answer carries what
      // a body reports at the moment it closes, which is nothing for this dialog. AFTER the reports still queued, so
      // the closing answer never overtakes a change made just before it.
      await queue;
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
