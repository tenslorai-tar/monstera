import type { ContractClient } from '@monstera/contract';

import { CHECK_FOR_UPDATES_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';

/**
 * *Help › Check for updates* (ADR-0107): opens the Microsoft Store's *Downloads and updates* page, where the Store
 * shows and takes this application's update — the owner's answer of 2026-09-26, until this project's own update
 * check is live (work list item 7, dormant). The application never installs itself (ADR-0018), so the page where a
 * person does is the whole of what this can honestly do.
 *
 * The answer is not read: `opened: false` is a build with no Store to open, and there is nothing further to say in
 * that case than the item already said by opening nothing.
 */
export function checkForUpdatesCommand(deps: { readonly client: ContractClient }): UiCommand {
  return {
    id: 'app.check-for-updates',
    icon: 'Download',
    title: CHECK_FOR_UPDATES_TITLE,
    placements: [{ surface: 'menu-bar', menu: 'help', group: 2, order: 10 }],
    run: async (): Promise<void> => {
      await deps.client['app.openStore']({ page: 'updates' });
    },
  };
}
