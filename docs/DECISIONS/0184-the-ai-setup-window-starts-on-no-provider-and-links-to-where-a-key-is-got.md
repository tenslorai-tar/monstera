# ADR-0184 — The AI setup window starts on no provider, and links to where a key is got

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** nothing. It widens `app.openWebPage`'s closed union
  ([ADR-0095](0095-the-title-bar-projects-the-applications-own-commands.md)) and changes the setup window's first state.
- **Found by:** the owner's list of 2026-10-06 — *"The Provider dropdown opens on Groq. Start it on 'Choose a provider'
  (nothing pre-selected), say which key the chosen provider needs and link to where you get one, and make the dropdown
  the same width as the key field."*

## Context

The window opened with a provider already chosen, and a person who pastes a key without looking has sent it to a service
it does not belong to — the check then fails with a refusal that does not say why. It also never said where a key comes
from, which is the first thing a person without one needs. A link is an address, and **the renderer composes none**:
`app.openWebPage` takes a closed union of places and `main` holds the addresses, so that the guard is the type
(ADR-0095, B5).

## Decisions

1. **The provider list starts on *Choose a provider*, a placeholder that is not a provider.** Nothing is selected; the
   check stays disabled until one is, whatever has been typed in the key field. Where a previous attempt named a provider
   (a retry after a refused key), the window starts there, as it did.
2. **Choosing one says which key it needs and offers *Get a {provider} key*.** The sentence names the provider chosen;
   Azure OpenAI adds where in the portal its key and endpoint are.
3. **The link is a place per provider** — `ai-key-<provider>` in `app.openWebPage`'s union, written out in
   `AI_KEY_PAGES` and held equal to the provider table as a set from both sides (`aiProviders.test.ts`), with
   `AI_KEY_PAGE_OF` a `Record` so a provider added without a page is a compile error. `main`'s `webPages.ts` holds the
   ten addresses; each was requested on 2026-10-06 (`curl -sIL`): Anthropic's console now redirects to
   `platform.claude.com`, three providers sent the request to their sign-in with the keys page as the destination, Groq
   answered 200, and five answered 403 or 405 to a non-browser request, which is their bot screen and not a missing page.
   **No key was sent to any of them and none was needed.**
4. **The link is a REPORT, not an answer** (ADR-0094): the window stays open while the page opens in the person's
   browser, and the opener opens it through `app.openWebPage`, so the window composes no address.
5. **The provider list takes the key field's width** — both take their row's whole width — so the two read as one column.

## Rejected alternatives

- **Showing the address as text to copy.** A person who must select, copy and paste a web address into a browser is not
  helped; the browser route already exists and is the one place the HTTPS rule is applied.
- **A free `url` parameter on `app.openWebPage`.** It would hand `shell.openExternal` a destination the page chose — the
  runtime check invariant 2 rejected in favour of a type.
- **Keeping a default and reordering the list.** Any default is a provider the person did not choose; the placeholder is
  the only state with no wrong answer in it.

## Consequences

- No live AI call is made by any of this, and no key is read, printed or logged; the cases use made-up key text.
- `docs/FEATURES.md`'s AI setup row gains the placeholder and the link.
