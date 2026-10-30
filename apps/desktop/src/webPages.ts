import { type ChannelParams, releaseTag, type StorePage } from '@monstera/contract';

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
 * The donation page, as the owner gave it on 2026-10-23 (T4): the site's `/donate`.
 * Nothing else in the repository records a donation address, so this string is the only thing to correct.
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

/**
 * The Store application's pages by the contract's own names, so a page the contract adds is a compile error here.
 * `updates` is *Downloads and updates*, `ms-windows-store://downloadsandupdates` (Microsoft Learn, *Launch the
 * Microsoft Store app*, updated 2026-01-07, read 2026-09-26) — the owner's answer for *Check for updates* until the
 * project's own update check is live. `listing` is the Store application's page for this product,
 * `ms-windows-store://pdp/?ProductId=…` — *"the recommended way to link to a specific product"* (Microsoft Learn, *Using
 * ms-windows-store URIs*, updated 2026-01-07, read 2026-09-26) — where the update indicator sends a person (ADR-0110).
 */
export const STORE_URIS: Readonly<Record<StorePage, string>> = {
  review: STORE_REVIEW_URI,
  updates: 'ms-windows-store://downloadsandupdates',
  listing: `ms-windows-store://pdp/?ProductId=${STORE_PRODUCT_ID}`,
};

/** Every page's address, keyed by the channel's own union so a page with no entry is a compile error. */
export type WebAddresses = Readonly<Record<WebPage, string>>;

/** This project's repository, `package.json`'s `repository`, where the code is developed in public. */
const REPOSITORY = 'https://github.com/tenslorai-tar/monstera';

/**
 * About's *Source code* and third-party notices for the build that is running — the AGPL's offer of the
 * CORRESPONDING source (BUILD-PROMPT's *"'Source code' link in About"*): the tree and `NOTICE` at the version's tag,
 * which the pack step makes at the commit it packed ([ADR-0276](../../../docs/DECISIONS/0276-every-packaged-version-is-tagged-and-about-links-its-tag.md)).
 * `main` moves on after a release, so a link to it shows code the running build never had. A development build has no
 * tag, and opens the repository and `main`'s `NOTICE`.
 */
function sourcePages(version: string): { readonly source: string; readonly licences: string } {
  const tag = releaseTag(version);
  return tag === null
    ? { source: REPOSITORY, licences: `${REPOSITORY}/blob/main/NOTICE` }
    : { source: `${REPOSITORY}/tree/${tag}`, licences: `${REPOSITORY}/blob/${tag}/NOTICE` };
}

/**
 * The copyright holder's site, which "Tenslor Inc." in the © line opens — the owner's address, given in the review of
 * 0.1.16.0 (R5, 2026-10-19). Opened on a press only, like every page here; nothing is fetched at start (invariant 24).
 */
const PUBLISHER = 'https://tenslor.com';

/**
 * Where each AI provider hands out an API key (ADR-0184), for the setup window's *get a key* link. Each was asked for
 * with `curl -sIL` on 2026-10-06 and answered: Anthropic's console moved to `platform.claude.com` and is the address it
 * redirected to; Google, Mistral and OpenRouter sent the request to their sign-in with this page as the destination;
 * Groq answered 200 itself; OpenAI, xAI, Azure, Perplexity and DeepSeek answered 403 or 405 to a non-browser request,
 * which is their bot screen and not the page being absent. Azure's key is read from the resource it belongs to, so the
 * address is the portal — the setup window says where to look.
 */
const AI_KEY_ADDRESSES = {
  'ai-key-anthropic': 'https://platform.claude.com/settings/keys',
  'ai-key-openai': 'https://platform.openai.com/api-keys',
  'ai-key-gemini': 'https://aistudio.google.com/apikey',
  'ai-key-mistral': 'https://console.mistral.ai/api-keys',
  'ai-key-xai': 'https://console.x.ai',
  'ai-key-azure-openai': 'https://portal.azure.com',
  'ai-key-openrouter': 'https://openrouter.ai/keys',
  'ai-key-groq': 'https://console.groq.com/keys',
  'ai-key-perplexity': 'https://www.perplexity.ai/settings/api',
  'ai-key-deepseek': 'https://platform.deepseek.com/api_keys',
} as const;

/**
 * Where the OCR page sends a person to set up Azure Document Intelligence. Read on 2026-10-07: the Azure portal's create
 * blade for the Document Intelligence resource (type `Microsoft.CognitiveServicesFormRecognizer`) answered 403 to
 * `curl -sIL`, which is the portal's bot screen and not the page being absent, as the keys' pages above; Microsoft's guide
 * to creating the resource answered 200 at the address below (the `?view=` suffix it redirects to is dropped) and
 * carries the *Keys and Endpoint* step, found by fetching the page and reading that heading.
 */
const AZURE_DI_ADDRESSES = {
  'azure-di-create': 'https://portal.azure.com/#create/Microsoft.CognitiveServicesFormRecognizer',
  'azure-di-keys':
    'https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/create-document-intelligence-resource',
} as const;

/**
 * Every page's address for the build running `version` (`app.getVersion()`): only About's two pages depend on it.
 * @param version the running build's version
 */
export function webAddresses(version: string): WebAddresses {
  return {
    donate: DONATE,
    'store-listing': STORE_LISTING,
    ...sourcePages(version),
    publisher: PUBLISHER,
    ...AI_KEY_ADDRESSES,
    ...AZURE_DI_ADDRESSES,
  };
}

/**
 * Opens one of the pages above, answering whether this build had an address for it.
 *
 * `open` is the composition root's `openInBrowser`, which refuses anything but HTTPS — so the scheme
 * guard stays where it is and this module does not restate it (B3a). An empty address is answered
 * before that call rather than handed to it, because *this build has no address for that page* and
 * *that URL was refused* are two different facts and one of them is expected.
 *
 * **Every page has an address today**, since the Store assigned the product id on 2026-09-25. The empty
 * state stays because the table is where the next unassigned address goes.
 *
 * `addresses` has NO DEFAULT: the composition root passes {@link webAddresses} for the running version, and a default
 * would let a caller open About's links for no version at all — `main`, the gap ADR-0276 closes — without anything
 * reading wrong at the call site.
 */
export async function openWebPage(
  page: WebPage,
  open: (url: string) => Promise<void>,
  addresses: WebAddresses,
): Promise<boolean> {
  const address = addresses[page];
  if (address === '') return false;
  await open(address);
  return true;
}
