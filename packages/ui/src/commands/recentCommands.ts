import type { ContractClient } from '@monstera/contract';

import { CLEAR_RECENT_TITLE } from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';

/**
 * *File › Recent › Clear list*
 * ([ADR-0143](../../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)).
 *
 * ## One implementation, two triggers
 *
 * Placed in the Recent submenu, and the start screen's *Clear list* over the cards runs this same `run` — as the tab
 * strip's *+* runs `document.open` — so emptying the list is one thing whichever control a person used.
 *
 * ## Cleared on main's answer, never on the press
 *
 * Main holds the list. `onCleared` is called only when main answers that it emptied it, and it is what makes both views
 * read the list again; a refusal or a lost answer leaves every entry where it was, which is the true state.
 */
export function clearRecentCommand(deps: {
  readonly client: ContractClient;
  /** Main has emptied the list: whatever shows it reads it again. */
  readonly onCleared: () => void;
}): UiCommand {
  return {
    id: 'document.clear-recent',
    // THE LIST THE PERSON IS LOOKING AT EMPTIES: the start screen's cards go, and File › Recent says *No recent files*.
    feedback: VISIBLE,
    icon: 'ListX',
    title: CLEAR_RECENT_TITLE,
    // AFTER THE FILES, inside File › Recent, which sits where this placement's order falls: right after Open.
    placements: [{ surface: 'menu-bar', menu: 'file', group: 0, order: 15, submenu: 'recent' }],
    run: async (): Promise<void> => {
      const answer = await deps.client['document.clearRecent']({});
      if (answer.ok) deps.onCleared();
    },
  };
}
