import type { ContractClient, UpdateStatus } from '@monstera/contract';

import { UPDATE_AVAILABLE_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { isUpdateOffered } from '../updateStatus.js';

/**
 * *Update available* — ADR-0018's in-app indicator, at the menu row's centre beside Donate and Rate Us (ADR-0113,
 * ADR-0110), in the row's plain tone: it is a notice, not a third appeal.
 *
 * ## It exists only when there is something to update to
 *
 * `when` reads main's answer for this start, so the button is absent — not greyed — on every build that did not ask,
 * that found nothing newer, or that has no answer yet. A dormant build never shows it, because main never asks.
 *
 * ## It opens the Store's page for this application, and installs nothing
 *
 * `app.openStore({ page: 'listing' })` names a page; main holds the address. The Store installs the update, as it
 * already does in the background — Monstera never installs its own package (ADR-0018).
 */
export function updateAvailableCommand(deps: {
  readonly client: ContractClient;
  /** Main's answer for this start, or `undefined` before it arrives. */
  readonly status: () => UpdateStatus | undefined;
}): UiCommand {
  return {
    id: 'app.update-available',
    icon: 'Download',
    title: UPDATE_AVAILABLE_TITLE,
    placements: [{ surface: 'menu-bar-commands', tone: 'plain', order: 3 }],
    when: () => isUpdateOffered(deps.status()),
    run: async (): Promise<void> => {
      await deps.client['app.openStore']({ page: 'listing' });
    },
  };
}
