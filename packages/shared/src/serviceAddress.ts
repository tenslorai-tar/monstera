/**
 * Where a key may be sent when a person typed the address: the one rule, for every caller that sends one.
 *
 * Azure's two services are addressed by the person's own resource, so the address is a setting rather than a
 * constant, and whatever it names receives the key and what is being read. **A scheme check alone lets every https
 * host through**, so the address is also held to the hosts the service itself is reached on.
 *
 * ## The hosts, as Microsoft's documentation states them, read 2026-10-03
 *
 * From the source of Microsoft's own pages on GitHub (learn.microsoft.com is not reachable from where this was
 * written, and its source is the same text):
 *
 * - **Azure OpenAI**: `<resource>.openai.azure.com` and `<resource>.services.ai.azure.com`, both accepted as the v1
 *   API's base (`MicrosoftDocs/azure-ai-docs`, `articles/foundry/openai/includes/api-version-lifecycle-content.md`,
 *   line 292); `openai.azure.us` in Azure Government (`MicrosoftDocs/azure-docs`,
 *   `articles/azure-government/compare-azure-government-global-azure.md`, line 69).
 * - **Azure Document Intelligence**: `<resource>.cognitiveservices.azure.com` and the regional
 *   `<region>.api.cognitive.microsoft.com` (the `azure-ai-documentintelligence` package's README on PyPI);
 *   `cognitiveservices.azure.us` in Azure Government (the same comparison, line 68).
 *
 * Azure operated by 21Vianet (`azure.cn`) is **not** here: no primary source for its hosts was reachable, and a host
 * on this list is one a key goes to.
 *
 * ## A host under a domain, with the dot load-bearing
 *
 * The zone's owner is what makes a host safe to send to, so any name under one of these domains is accepted and
 * `evilopenai.azure.com` is not under `openai.azure.com`. A trailing dot, a port other than HTTPS's own, a user name
 * or a password is refused rather than normalised away: none is part of a resource address, and each changes where
 * the request goes or what it carries.
 *
 * ## The answer is the ORIGIN
 *
 * The resource is the host; every route under it is this build's. An address pasted with Azure's own `/openai/v1/`
 * path therefore names the same resource as one without, and both are asked at the origin.
 */

/**
 * The platform's URL parser, which decides what a host and a port are; a pattern here would be a second opinion about
 * a grammar that already has one. `URL` is a WHATWG global in every runtime this package reaches and absent from its
 * `ES2023` lib, so it is declared here as `linkUriSchema` declares it in the contract, with only the parts this reads.
 */
declare const URL: new (input: string) => {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly port: string;
  readonly hostname: string;
  readonly origin: string;
};

/** Whether `hostname` is `domain` or a name under it. Both are compared in lower case. */
export function hostWithin(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const zone = domain.toLowerCase();
  return host === zone || host.endsWith(`.${zone}`);
}

/** Each service a person addresses by their own resource, and the domains its resources are reached on. */
export const SERVICE_DOMAINS = {
  'azure-openai': ['openai.azure.com', 'services.ai.azure.com', 'openai.azure.us'],
  'azure-document-intelligence': ['cognitiveservices.azure.com', 'api.cognitive.microsoft.com', 'cognitiveservices.azure.us'],
} as const satisfies Record<string, readonly string[]>;

export type AddressedService = keyof typeof SERVICE_DOMAINS;

/**
 * The origin a typed address names, or `null` where it is not one of the service's own.
 *
 * @param service whose hosts the address must be on
 * @param typed what the person typed; an empty string is `null` too, and a caller that treats *no address* apart
 *   asks that first
 */
export function serviceOrigin(service: AddressedService, typed: string): string | null {
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(typed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  return SERVICE_DOMAINS[service].some((domain) => hostWithin(url.hostname, domain)) ? url.origin : null;
}

/** Whether `address` is on `origin` itself, which is where a service's own answer may send a key next. */
export function onOrigin(address: string, origin: string): boolean {
  try {
    return new URL(address).origin === origin;
  } catch {
    return false;
  }
}
