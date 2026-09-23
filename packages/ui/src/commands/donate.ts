import type { ContractClient } from '@monstera/contract';

import { DONATE_DIALOG_ID, type DonateAnswer } from '../dialogs/donate.js';
import { DONATE_COMMAND_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';

/**
 * *Donate* — the title bar's filled button (the owner's design, 2026-09-22;
 * [ADR-0095](../../../../docs/DECISIONS/0095-the-title-bar-projects-the-applications-own-commands.md)).
 *
 * ## The command names a place, and `main` knows the address
 *
 * `app.openWebPage` takes `'donate'`, not a URL: this module cannot compose a destination, so there is
 * nothing here for an injection to aim at and no allowlist in `main` for a later caller to forget.
 * That is invariant 2's argument for `FileHandle`, one noun along.
 *
 * ## One placement, and it needs no document
 *
 * No `when`: supporting the project is not a thing you do to a PDF. The title bar is drawn in every
 * layout mode including Focus **and on the start screen** — the owner's `start-*.png` show it there
 * with Donate in it — so one placement already reaches every state the application has. A second in
 * the start screen's footer was written first and removed on reading those exports: the footer there
 * is *Settings · About · Help centre*, and a button the design does not draw is a deviation, not the
 * enhancement the order asks deviations to be.
 */
export function donateCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'app.donate',
    icon: 'Heart',
    title: DONATE_COMMAND_TITLE,
    placements: [{ surface: 'title-bar', emphasis: 'primary', order: 1 }],
    run: async (): Promise<void> => {
      const answer = (await deps.ask(DONATE_DIALOG_ID, {})) as DonateAnswer | undefined;
      // DISMISSAL AND *Not now* ARE ONE ANSWER, which is what the result schema's own header says:
      // anything but `open` leaves the application exactly as it was.
      if (answer !== 'open') return;
      // The answer is not read: `opened: false` means this build has no address for the page, and the
      // donation page has one in every build. A destination that can be absent — the Store listing —
      // gets a control that knows it, rather than a silent nothing here.
      await deps.client['app.openWebPage']({ page: 'donate' });
    },
  };
}
