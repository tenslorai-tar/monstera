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
 * `store-listing` is the Microsoft Store's page for this application, and **its product id does not
 * exist until the application is reserved in Partner Center** — ADR-0018 keeps exactly this kind of
 * seam as an empty config value rather than as a guess, alongside the signing certificate. An empty
 * entry answers `opened: false` rather than opening something wrong, and the place declared here is
 * what a *Rate Us* command will take when the id exists.
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
 * The Store listing, which needs a product id Partner Center assigns at reservation.
 *
 * **Deliberately empty**, never a placeholder id: a plausible-looking id would send a person to
 * somebody else's listing, and it would read as configured in every check that looks at this file.
 */
const STORE_LISTING = '';

const ADDRESSES: Readonly<Record<WebPage, string>> = {
  donate: DONATE,
  'store-listing': STORE_LISTING,
};

/**
 * Opens one of the pages above, answering whether this build had an address for it.
 *
 * `open` is the composition root's `openInBrowser`, which refuses anything but HTTPS — so the scheme
 * guard stays where it is and this module does not restate it (B3a). An empty address is answered
 * before that call rather than handed to it, because *this build has no Store listing* and *that URL
 * was refused* are two different facts and one of them is expected.
 */
export async function openWebPage(
  page: WebPage,
  open: (url: string) => Promise<void>,
): Promise<boolean> {
  const address = ADDRESSES[page];
  if (address === '') return false;
  await open(address);
  return true;
}
