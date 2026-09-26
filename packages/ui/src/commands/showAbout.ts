import type { ContractClient } from '@monstera/contract';

import { ABOUT_DIALOG_ID, ABOUT_RESULT } from '../dialogs/about.js';
import { ABOUT_COMMAND_TITLE, GROUP_APPLICATION } from '../messages/en.js';
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
    icon: 'Info',
    title: ABOUT_COMMAND_TITLE,
    placements: [
      { surface: 'start-screen', slot: 'footer', order: 2 },
      // SECONDARY since Help › About exists (ADR-0107).
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 920, prominence: 'secondary' },
      { surface: 'menu-bar', menu: 'help', group: 2, order: 30 },
    ],
    run: async (): Promise<void> => {
      const answer = await deps.client['app.info']({});
      if (!answer.ok) return;
      const chosen = ABOUT_RESULT.safeParse(
        await deps.ask(ABOUT_DIALOG_ID, {
          version: answer.value.version,
          installChannel: answer.value.installChannel,
        }),
      );
      // A DISMISSAL ANSWERS NOTHING the schema accepts, and opens nothing (ADR-0038).
      if (!chosen.success) return;
      // THE PAGE BY NAME: `main` knows the address, so this command cannot compose one (ADR-0095).
      await deps.client['app.openWebPage']({ page: chosen.data });
    },
  };
}
