import type { ContractClient } from '@monstera/contract';

import { RATE_US_COMMAND_TITLE, REVIEW_STORE_NOT_OPENED } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import type { ShowToast } from '../toasts.js';

/**
 * Opens the Store's review page, and says so when it did not open.
 *
 * **The one way this window asks for a rating**, taken by *Rate Us* and by the prompt's *Rate now* alike, so
 * the two cannot disagree about what a failure looks like (B3a). A press that opens nothing and says nothing
 * is the display-only defect, and each of three things means the page is not on screen: the call rejected,
 * main refused it, or main answered that it opened nothing.
 */
export async function rateOnStore(client: ContractClient, toast: ShowToast): Promise<void> {
  const answer = await client['app.review']({ action: 'rate' }).catch(() => undefined);
  if (answer === undefined || !answer.ok || !answer.value.opened) toast('problem', REVIEW_STORE_NOT_OPENED);
}

/**
 * *Rate Us* — the design's second title-bar button (v5-01, v5-02), beside *Donate* (ADR-0095).
 *
 * **Through `app.review`, the rating prompt's own channel**, so a rating given from here and one given from
 * the prompt are the same fact in main's record — E3's `reviewedAt` has one writer, and a person who rated
 * from the title bar is not asked again. Main opens the Store's review page (the Store application's in a
 * Store build, the web listing otherwise); the page names no address.
 */
export function rateUsCommand(deps: { readonly client: ContractClient; readonly toast: ShowToast }): UiCommand {
  return {
    id: 'app.rate',
    icon: 'Star',
    title: RATE_US_COMMAND_TITLE,
    placements: [{ surface: 'title-bar', emphasis: 'normal', order: 2 }],
    run: () => rateOnStore(deps.client, deps.toast),
  };
}
