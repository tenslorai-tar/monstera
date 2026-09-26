# ADR-0108 — The web is the provider's own search, chosen per chat, and its sources stay in `main`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Decided by:** the project owner's work list of 2026-09-26, item 5 (a new D11 row), and the owner's answers of the
  same day: build web search for every provider whose documentation supports it; only Anthropic runs live, on Haiku 4.5,
  with at most five searches; a model that always searches is labelled so, and *Document only* never sends to it.
- **Relates:** [ADR-0081](0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md) (providers are
  declared adapters), [ADR-0082](0082-main-may-push-on-declared-event-channels.md) (the answer streams on events),
  [ADR-0088](0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md) (what an ask carries about a
  document), [ADR-0069](0069-a-writers-apply-takes-one-named-request.md) (a required field over a dropped one).

## Context

The Assistant answered from the document's text and the model's own knowledge. The owner asked for a switch on the
*Asking about* line — **Document only**, the default for every new chat, or **Document + web** — and three guards: the
instruction must keep *"If the answer is not in the text, say so"*; an answer about a document that cites none of its
pages is marked; and an answer asked with the web on that did not search says so.

Four questions had to be answered by the design rather than per provider:

1. **Whose search?** Each provider's own hosted tool, read from its documentation on 2026-09-26. Not a search engine
   this application calls itself: that would be a new network destination with its own key, terms and privacy
   statement, and the owner's list names the provider's tool.
2. **Who can search?** It differs by provider **and by model** — OpenAI's chat search models always search, Groq's
   browser search runs on its `gpt-oss` models only, Gemini's grounding must be displayed with Google's own HTML
   snippet, which the pinned CSP (§9.27) refuses, and DeepSeek documents no search at all.
3. **How does a source open?** A source is an address a provider's search returned. The renderer opening an address it
   was handed is the navigation `app.openWebPage` was shaped to rule out.
4. **Where is the choice held?** Per chat, defaulting off, so a new conversation never inherits a choice to send text to
   a search engine.

## Decision 1 — one resolver says who can search, and everything takes it

`webSearchOf(provider, model)` in the contract answers `optional`, `always` or `none` with a named reason
(`no-hosted-search`, `display-terms`, `model-cannot`). The renderer's switch, `main`'s request and `main`'s refusal all
call it (B3a): the switch disables *Document + web* with the reason's sentence, and disables *Document only* for a model
that always searches. Each rule cites the page it was read from.

## Decision 2 — the switch is a required field, and *Document only* is enforced in `main`

`ai.ask` carries `web: boolean`, **required** — a sender that forgot it would otherwise ask whichever way a default
said, and whether a document's text may reach a search engine is not a default's to decide (ADR-0069's lesson: a dropped
field must be a compile error). With `web: false`:

- no search tool is sent, and Perplexity — which searches by default — is sent `disable_search: true`;
- a model that always searches is **refused in `main` before anything is sent** (`searches-the-web`), whatever the
  renderer did;
- the instruction adds *"Use only this text, not outside knowledge."* beside the not-in-the-text sentence.

With `web: true` the instruction keeps the not-in-the-text sentence and allows the web, kept apart from the document.

## Decision 3 — the request moves where the provider's search lives

A provider's search is not always on the endpoint its plain answer uses. OpenAI, Azure OpenAI and xAI search through
the **Responses** API; Mistral through **Conversations** (with `store: false`, so nothing is kept on Mistral's side,
which a chat completion never was). Anthropic, OpenRouter and Groq keep their endpoint and gain a tool; Perplexity keeps
its endpoint and loses its flag. `aiChat.ts` prepares the request and names the stream's shape, and one reader takes
the text, the evidence that a search ran, and the cited pages from each.

## Decision 4 — sources stay in `main`; the renderer gets a title and a host, and opens one by its place

`ai.done` carries `web: { answer, searched, sources }`, **required** on every answer's end, where each source is a
**title and a host — never the address**. `main` keeps each finished answer's addresses (the most recent fifty) and a
new channel, `ai.openSource { answer, index }`, opens one through the composition root's HTTPS-only browser route. Only
HTTPS sources are kept at all. So the renderer holds nothing a provider or a document could turn into a navigation —
`app.openWebPage`'s rule, applied to addresses that are not the project's own.

Sources are not saved with a conversation: the addresses live in `main` for the session, so a reloaded answer shows its
text and no sources to open. Stated rather than solved, since saving them would put third-party addresses in the
encrypted history file for a feature nobody asked to persist.

## Decision 5 — the answer says what it rested on

Under a finished answer: *No page cited — check this against the document* when it was about a document and names no
`[p. N]`; the web's sources as a labelled list; and *No web search was used for this answer* when the web was on and the
provider reported no search. A *Document only* answer never carries the last line.

## Rejected

- **A search API of our own** (Bing, Brave, a scraper) — a new destination, key and set of terms, and not what the
  owner's list asked for.
- **Sending the address to the renderer** and letting it open links — the navigation `app.openWebPage` forbids, with the
  address supplied by a third party.
- **One global switch in Settings** — a choice that outlives the chat it was made in is the default this ADR refuses.
- **Rendering Gemini's grounding** — its terms require Google's HTML snippet, which the CSP refuses; changing the CSP is
  an amendment nobody has asked for, so Gemini is *none, display-terms*.

## What is unverified, and where

- The live run is Anthropic's alone (owner's answer); every other provider's request and stream shape is built from its
  documentation and proven against fixtures, not against the service.
- Where Groq and OpenRouter place their search results inside a stream is not stated in their documentation; both are
  read wherever a chunk carries them.
- Anthropic's `pause_turn` (a long search turn paused by the service) ends the answer with the text so far; resuming it
  is not built.
- Perplexity's Sonar API ends on 2026-09-27 (its own pages); moving to its Agent API is its own row.
