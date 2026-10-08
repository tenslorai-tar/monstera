import type { ContractClient } from '@monstera/contract';
import { type MessageKey, asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { FOLLOW_LINK_DIALOG_ID } from '../dialogs/followLink.js';
import type { FollowedLink } from '../LinkLayer.js';
import {
  LINK_FOLLOW_GONE,
  LINK_FOLLOW_NOT_OPENED,
  LINK_FOLLOW_STALE,
  LINK_FOLLOW_TOO_LONG,
  LINK_FOLLOW_UNAVAILABLE,
} from '../messages/en.js';
import { followLink } from './followLink.js';

/**
 * The one route a pressed link takes, from the page and from the Links panel (ADR-0167 Decisions 2 and 4).
 *
 * What these cases read is what was CALLED — the jump, the dialog, the channel — and with what, because the state a
 * correct decision leaves is often the state an absent one leaves too: a link never sent and a link sent and refused by
 * `main` both end with no browser open.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000dd');
const VERSION = asDocVersion(6);

type OpenLinkAnswer = Awaited<ReturnType<ContractClient['document.openLink']>>;

function route(answer: unknown, opened: OpenLinkAnswer = ok({ kind: 'opened' })) {
  const sent: unknown[] = [];
  const asked: { id: string; props: unknown }[] = [];
  const said: { kind: string; message: MessageKey }[] = [];
  const jumped: number[] = [];
  const deps = {
    client: {
      'document.openLink': (params: unknown) => {
        sent.push(params);
        return Promise.resolve(opened);
      },
    } as Pick<ContractClient, 'document.openLink'>,
    ask: (id: string, props: unknown) => {
      asked.push({ id, props });
      return Promise.resolve(answer);
    },
    toast: (kind: 'done' | 'problem', message: MessageKey) => {
      said.push({ kind, message });
    },
    jumpTo: (page: number) => {
      jumped.push(page);
    },
  };
  return { deps, sent, asked, said, jumped };
}

const BOUNDS = { x0: 1, y0: 2, x1: 3, y1: 4 };
const TO_PAGE: FollowedLink = { page: 2, index: 0, link: { kind: 'internal', page: 9, bounds: BOUNDS, outline: 'thin' } };
const TO_WEB: FollowedLink = {
  page: 2,
  index: 3,
  link: { kind: 'external', uri: 'https://example.org/a', bounds: BOUNDS, outline: 'thin' },
};

describe('followLink', () => {
  it('a page link GOES THERE, zero-based, and asks and sends nothing', async () => {
    const { deps, sent, asked, jumped } = route({ open: true });
    await followLink(deps, DOC, VERSION, TO_PAGE);
    expect(jumped).toStrictEqual([9]);
    expect(asked).toStrictEqual([]);
    expect(sent).toStrictEqual([]);
  });

  it('a web link ASKS first, naming its address, and goes nowhere on the page', async () => {
    const { deps, asked, jumped } = route(undefined);
    await followLink(deps, DOC, VERSION, TO_WEB);
    expect(asked).toStrictEqual([
      { id: FOLLOW_LINK_DIALOG_ID, props: { address: 'https://example.org/a', followable: true, scheme: 'https:' } },
    ]);
    expect(jumped).toStrictEqual([]);
  });

  it('CLOSING the dialog sends nothing — CONTROL: Open link sends the link by its PLACE, never its address', async () => {
    const dismissed = route(undefined);
    await followLink(dismissed.deps, DOC, VERSION, TO_WEB);
    expect(dismissed.sent).toStrictEqual([]);

    const opened = route({ open: true });
    await followLink(opened.deps, DOC, VERSION, TO_WEB);
    // The version the link was read at, and its page and place: `main` reads the address itself (ADR-0167 Decision 3).
    expect(opened.sent).toStrictEqual([{ docId: DOC, version: VERSION, page: 2, index: 3 }]);
    expect(opened.said).toStrictEqual([]);
  });

  it('a scheme that is NOT FOLLOWED is said in the dialog and never sent, whatever the dialog answers', async () => {
    const refused: FollowedLink = { ...TO_WEB, link: { ...TO_WEB.link, kind: 'external', uri: 'javascript:alert(1)' } };
    // The dialog offers no way on for such an address. This answers Open anyway, so the case proves the route's own
    // check rather than the dialog's absence of a button.
    const { deps, asked, sent } = route({ open: true });
    await followLink(deps, DOC, VERSION, refused);
    expect(asked[0]?.props).toStrictEqual({ address: 'javascript:alert(1)', followable: false, scheme: 'javascript:' });
    expect(sent).toStrictEqual([]);
  });

  it('SAYS each answer that is not opened, in its own words', async () => {
    const cases: readonly [OpenLinkAnswer, MessageKey][] = [
      [ok({ kind: 'stale' }), LINK_FOLLOW_STALE],
      [ok({ kind: 'no-such-link' }), LINK_FOLLOW_GONE],
      [ok({ kind: 'too-long' }), LINK_FOLLOW_TOO_LONG],
      [ok({ kind: 'not-opened' }), LINK_FOLLOW_NOT_OPENED],
      // main reading a scheme the shortened listing hid: said as a link that could not be opened.
      [ok({ kind: 'scheme-refused', scheme: 'file:' }), LINK_FOLLOW_NOT_OPENED],
      [err({ code: 'document-busy' }), LINK_FOLLOW_UNAVAILABLE],
    ];
    for (const [answer, message] of cases) {
      const { deps, said } = route({ open: true }, answer);
      await followLink(deps, DOC, VERSION, TO_WEB);
      expect(said, JSON.stringify(answer)).toStrictEqual([{ kind: 'problem', message }]);
    }
  });

  it('CONTROL: an ANSWER that is not the one Open gives sends nothing', async () => {
    const sentFor: unknown[] = [];
    for (const answer of [{ open: false }, { open: true, extra: 1 }, 'open', null]) {
      const { deps, sent } = route(answer);
      await followLink(deps, DOC, VERSION, TO_WEB);
      sentFor.push(...sent);
    }
    expect(sentFor).toStrictEqual([]);
  });
});
