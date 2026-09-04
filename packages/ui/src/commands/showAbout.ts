import type { ContractClient } from '@monstera/contract';

import { ABOUT_DIALOG_ID } from '../dialogs/about.js';
import { ABOUT_COMMAND_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';

/**
 * Opens the About dialog with what main says about the running application.
 *
 * ## The command fetches, and the dialog displays
 *
 * `app.info` is asked here rather than inside the body, because
 * `DialogRegistry.openWith` validates props at the open call and that is the
 * only place both the schema and the values exist (ADR-0029 Decision 7). A body
 * that fetched its own would be validated before it had anything to validate.
 *
 * ## A failure opens nothing
 *
 * `app.info` declares no failure codes, so a `!ok` here is `internal` — a defect
 * recorded main-side. The right response is to open no dialog: a dialog headed
 * *About* with empty fields is worse than no dialog, because it looks like an
 * answer.
 */
export function showAboutCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'app.about',
    title: ABOUT_COMMAND_TITLE,
    placements: [{ surface: 'start-screen', order: 1 }],
    run: async (): Promise<void> => {
      const answer = await deps.client['app.info']({});
      if (!answer.ok) return;
      // Voided: this dialog declares no result and can only settle on
      // dismissal, so awaiting it would keep the command running until the user
      // closed a message about the build.
      void deps.ask(ABOUT_DIALOG_ID, {
        version: answer.value.version,
        installChannel: answer.value.installChannel,
      });
    },
  };
}
