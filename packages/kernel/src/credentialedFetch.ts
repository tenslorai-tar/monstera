/**
 * The one transport rule for a request that carries a credential: a key header, a bearer token, or the person's pages
 * behind one (addendum 5's X3).
 *
 * `fetch` follows a redirect by default, and a 307 or 308 re-sends the method, the body and every header the caller
 * set, custom key headers included, to wherever the answer pointed. So an Azure key, an Anthropic key, a cloud token
 * and the page bytes beside them could be handed to a host nobody declared, by one answer. Every such request goes
 * through {@link credentialedFetch}, which refuses a redirect (`redirect: 'error'`, so `fetch` rejects and the caller
 * names it unreachable) unless the caller asks for `'manual'`, where it sees the hop and decides; `'follow'` cannot be
 * spelt here at all.
 *
 * An address an ANSWER names, which is a redirect by another name, is held to the declared origin where it is read:
 * Azure's `Operation-Location` by `onOrigin` (`@monstera/shared`), a cloud upload session by its provider's hosts.
 */

/** A request's options, with a redirect that never follows. */
export type CredentialedInit = Omit<RequestInit, 'redirect'> & { readonly redirect?: 'error' | 'manual' };

/** `fetchImpl(url, init)`, with a redirect refused unless the caller asked to see it (`'manual'`). */
export function credentialedFetch(fetchImpl: typeof fetch, url: string | URL, init: CredentialedInit = {}): Promise<Response> {
  return fetchImpl(url, { ...init, redirect: init.redirect ?? 'error' });
}
