# ADR-0088 — An ask about a document carries a bounded window of its text, read in `main`

- **Status:** Accepted
- **Date:** 2026-09-21
- **Amends:** nothing. It registers into `ai.ask`, which exists, and reads text through
  `#pageText`, the read search, the text layer and the word count already share.
- **Relates:** [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (extracted text is
  never resident in `main`; its answer to a document-wide need is *"a bounded window, not a
  resident document"*), [ADR-0081](0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md),
  [ADR-0082](0082-main-may-push-on-declared-event-channels.md),
  [ADR-0083](0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md).
- **Context:** Stage 9's assistant row, whose owed half is **document-aware**: an *Asking
  about* line naming exactly what is sent, clickable page references, *Ask AI · Explain ·
  Summarise · Translate* on selected text, reply-to-sticky-note and quick starts — the owner's
  design of 2026-09-15. `BUILD-PROMPT.md`: *"Document content goes to a provider only on
  explicit user action, and the consent copy in the assistant panel says which provider
  receives it."*

## The question the design has to answer first

A conversation *about the document* needs the document's words at the provider, and the
provider is reached from `main` — the renderer has no network and the key never leaves `main`
(ADR-0081). ADR-0035 says `main` **never holds a document's extracted text**, transiently or
otherwise: at 3.59× the file size, the text alone is three times `main`'s budget, and the
budget measures a peak. So *send the document* is not available in any form that gathers it
first.

## Decision

1. **The renderer names what to ask about; it does not send it.** `ai.ask` gains an optional
   `about`: a `docId` and one of three scopes — `selection` (the page and the text the person
   selected), `page` (one page) or `document`. A selection is the one scope whose text crosses
   from the renderer, and it is text the renderer already holds: the selectable layer is the
   kernel's own read (`pageTextLayer`), bounded per page, so this sends back a bounded piece of
   what `main` already gave it. The other two are bytes of intent.

2. **`main` reads the text page by page into a window whose bound is a constant**,
   `MAX_ASK_CONTEXT` characters, independent of the document. Each page is read through
   `#pageText` inside the document's lane, appended until the window is full, and dropped. What
   is resident is bounded by the window plus the largest page — ADR-0035's own answer for a
   document-wide need. **The bound is a choice, not a measurement**: 100,000 characters is
   roughly 25,000 tokens, inside the context of each provider's current general models, and a
   model with a smaller window answers with a refusal the panel already words.

3. **What was sent is answered, not implied.** `ai.ask` reports the pages the window covers,
   the characters it holds, and whether it stopped before the document ended. The *Asking
   about* line names the scope and the provider **before** a person presses Send, and the turn
   records what actually went — so a whole-document ask that covered twelve pages of forty says
   so, rather than letting a summary read as a summary of everything.

4. **The window reaches the provider as a system instruction**, in each adapter's own form:
   Anthropic's `system`, the OpenAI-format `system` turn, Gemini's `systemInstruction`. It
   marks each page as a person reads it — `[Page 3]`, **one-based** — and asks the model to
   cite pages as `[p. 3]`. The renderer turns those citations into links that go to that page.
   Both halves read the same frame because the marker is written in it: the kernel's zero-based
   index becomes one-based once, where the window is built, through the conversion every other
   shown page number takes.

5. **Nothing is sent without a person asking.** Opening the panel, choosing a scope and typing
   send nothing; the text is read in `main` only inside the ask that sends it.

6. **One conversation per document** (ADR-0083 Decision 4), held in the renderer by `DocId`
   and dropped when the document closes.

## Rejected

- **The renderer gathers the text and sends it.** It moves ADR-0035's problem across the
  boundary rather than solving it: the renderer would hold what `main` may not, for a document
  of any size. ADR-0035 rejected the same shape for search.
- **The whole document, unbounded.** Dead on ADR-0035's arithmetic, and document-scaled by
  another name for invariant 11. A provider's context limit would also cut it somewhere this
  build did not choose and could not report.
- **The engine host holds the text for a conversation.** ADR-0035 rejected a stateful host for
  search: a cache there is a second version question beside `DocVersion`.
- **A retrieval index — chunk, embed, fetch the relevant pages.** It needs an embedding model;
  the owner's design names no local model, and a provider's embeddings would send the whole
  document to find the part to send.

## Consequences

- A whole-document question about a long document is answered from its **first** pages, and
  the line and the turn say how many. Choosing which pages is a later refinement that this
  shape admits — the window is built by a loop over pages, and a range is a different start.
- `ChatRequest` gains a `system` instruction, and each adapter's request shape carries it; the
  cases that pin those shapes grow by one field each.
