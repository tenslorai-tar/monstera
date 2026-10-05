import { type ContractClient, isFollowable, shownSchemeOf } from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';

import { FOLLOW_LINK_DIALOG_ID, FOLLOW_LINK_RESULT } from '../dialogs/followLink.js';
import type { FollowedLink } from '../LinkLayer.js';
import {
  LINK_FOLLOW_GONE,
  LINK_FOLLOW_NOT_OPENED,
  LINK_FOLLOW_STALE,
  LINK_FOLLOW_TOO_LONG,
  LINK_FOLLOW_UNAVAILABLE,
} from '../messages/en.js';
import type { ShowToast } from '../toasts.js';

/** What following a link needs: the dialog, the channel, a sentence, and a way to go to a page. */
export interface FollowLinkDeps {
  readonly client: Pick<ContractClient, 'document.openLink'>;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly toast: ShowToast;
  /** Takes the reader to a zero-based page, recording the jump as every jump is. */
  readonly jumpTo: (page: number) => void;
}

/** The sentence each answer that is not *opened* says. `opened` says nothing: the browser coming up is the answer. */
const SAID: Readonly<Record<'stale' | 'no-such-link' | 'too-long' | 'not-opened', MessageKey>> = {
  stale: LINK_FOLLOW_STALE,
  'no-such-link': LINK_FOLLOW_GONE,
  'too-long': LINK_FOLLOW_TOO_LONG,
  'not-opened': LINK_FOLLOW_NOT_OPENED,
};

/**
 * Follows a link a person pressed, on the page or in the Links panel — the ONE route (ADR-0167 Decisions 2 and 4).
 *
 * A link to a page goes there. A link out of the document asks first, naming the address; only the answer *Open link*
 * sends anything, and what is sent names the link by its place at the version it was read at, never its address. A
 * scheme that is not followed is said in the dialog, which then has no way on, so it is never sent at all.
 */
export async function followLink(
  deps: FollowLinkDeps,
  docId: DocId,
  version: DocVersion,
  followed: FollowedLink,
): Promise<void> {
  const { link } = followed;
  if (link.kind === 'internal') {
    deps.jumpTo(link.page);
    return;
  }
  const answer = await deps.ask(FOLLOW_LINK_DIALOG_ID, {
    address: link.uri,
    followable: isFollowable(link.uri),
    scheme: shownSchemeOf(link.uri),
  });
  if (!FOLLOW_LINK_RESULT.safeParse(answer).success || !isFollowable(link.uri)) return;
  const opened = await deps.client['document.openLink']({ docId, version, page: followed.page, index: followed.index });
  if (!opened.ok) {
    deps.toast('problem', LINK_FOLLOW_UNAVAILABLE);
    return;
  }
  const { kind } = opened.value;
  // A REFUSED SCHEME HERE is main reading what the renderer's courtesy check did not: an address the listing showed
  // shortened. Said as a link that could not be opened, since the dialog already explained the rule.
  if (kind === 'opened') return;
  deps.toast('problem', kind === 'scheme-refused' ? LINK_FOLLOW_NOT_OPENED : SAID[kind]);
}
