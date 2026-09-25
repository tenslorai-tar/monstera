import type { ChannelParams } from '@monstera/contract';

/**
 * Where this project's own pages are — the addresses behind `app.openWebPage`
 * ([ADR-0095](../../../docs/DECISIONS/0095-the-title-bar-projects-the-applications-own-commands.md)).
 *
 * ## The renderer names a place and `main` knows the address
 *
 * That split is the channel's whole shape, and this module is the half the renderer cannot reach. A
 * page composes `{ page: 'donate' }`; it can compose nothing else, because the parameter is a closed
 * union. So there is no allowlist to forget to consult — the illegal state is unrepresentable rather
 * than caught (B5), which is invariant 2's argument for `FileHandle` applied to a URL.
 *
 * ## An address this build does not have is `undefined`, and that is a state
 *
 * `store-listing` is the Microsoft Store's page for this application, from the product id Partner Center
 * assigned. An address a build does not have is an empty string answering `opened: false` rather than a
 * guess (ADR-0018's seam for the signing certificate is the same shape); the listing itself is live only
 * once the application is published.
 */
export type WebPage = ChannelParams<'app.openWebPage'>['page'];

/**
 * The donation page.
 *
 * **Derived, and the derivation is here so one string is the only thing to correct**: `package.json`'s
 * `homepage` is `https://monsterapdf.com`, which `BUILD-PROMPT.md`:42 names as this project's site, and
 * this is the conventional path on it. Nothing else in the repository records a donation address.
 */
const DONATE = 'https://monsterapdf.com/donate';

/**
 * The application's Microsoft Store product id, assigned when it was reserved in Partner Center and given
 * by the owner on 2026-09-25 (with the package identity `TenslorInc.MonsteraPDFEditor`).
 */
export const STORE_PRODUCT_ID = '9NHV3B1PV3XS';

/**
 * The Store's web listing — the web build's *Rate now* (E3). The address form is the Store's own: the same
 * form resolved for a published application on 2026-09-25, and this one answered **410 Gone** that day,
 * which is an application reserved and not yet published. It resolves once the listing is live.
 */
const STORE_LISTING = `https://apps.microsoft.com/detail/${STORE_PRODUCT_ID}`;

/**
 * The Store build's *Rate now*: the Store application's own review page for this product (E3). Not a web
 * address, so `openInBrowser`'s HTTPS rule refuses it; `entry.ts` opens this one constant through the
 * platform, and no page can name it.
 */
export const STORE_REVIEW_URI = `ms-windows-store://review/?ProductId=${STORE_PRODUCT_ID}`;

/** Every page's address, keyed by the channel's own union so a page with no entry is a compile error. */
export type WebAddresses = Readonly<Record<WebPage, string>>;

const ADDRESSES: WebAddresses = {
  donate: DONATE,
  'store-listing': STORE_LISTING,
};

/**
 * Opens one of the pages above, answering whether this build had an address for it.
 *
 * `open` is the composition root's `openInBrowser`, which refuses anything but HTTPS — so the scheme
 * guard stays where it is and this module does not restate it (B3a). An empty address is answered
 * before that call rather than handed to it, because *this build has no address for that page* and
 * *that URL was refused* are two different facts and one of them is expected.
 *
 * **Every page has an address today**, since the Store assigned the product id on 2026-09-25. The empty
 * state stays because the table is where the next unassigned address goes; `addresses` is how a case
 * reaches it without this build having one, and the application never passes it.
 */
export async function openWebPage(
  page: WebPage,
  open: (url: string) => Promise<void>,
  addresses: WebAddresses = ADDRESSES,
): Promise<boolean> {
  const address = addresses[page];
  if (address === '') return false;
  await open(address);
  return true;
}
