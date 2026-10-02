# ADR-0134 — An ask about every open document carries one window each, inside the one bound

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** nothing in `docs/ARCHITECTURE.md`. It widens `ai.ask` again, as
  [ADR-0089](0089-a-two-document-ask-carries-one-window-per-document-inside-one-bound.md) did, and **withdraws
  ADR-0089's rejected alternative** *"A list of documents"*, which it generalises.
- **Decided by:** the owner's answer of 2 October: *"Add All Open Docs to Context."* The item's terms: say each
  document's share of the bound; cite a document and a page for every claim; never refuse, and say which parts were
  read; include only the documents open when the person presses Send.
- **Relates:** [ADR-0088](0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md) (the window, the page
  frame, the citations), [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (no resident text in `main`),
  [ADR-0131](0131-side-by-side-compares-two-documents-by-content-in-the-renderer.md) (which left ADR-0089's pair with no
  route).

## Context

ADR-0089 let an ask carry a second document, named *Left* and *Right*, half the bound each, and rejected a list: *"a
bound divided by n is a window of nothing long before n is large."* That pair has no route today: it was offered with
the compare pane, which Side by Side replaced, and `App` passes the assistant no second document. The owner now asks
for every open document at once, from the Context menu.

The rejection's reason is real and is answered here rather than ignored: with *n* documents each gets a smaller share,
so the share is **said**, to the person and to the model, and the person sees from the answer's own lines how much of
each document went.

## Decision

1. **A scope, `documents`, naming the documents by id.** `ai.ask`'s `about` gains `{ scope: 'documents', docIds }`,
   at least two and at most `MAX_ASK_DOCUMENTS` (16), all different. Bytes of intent, like `document`: `main` reads
   each one's text. It does not pair (`alongside` stays the two-document scope's, and is never sent with this one).

2. **One equal share of the one bound each.** Each document is read as a whole-document window with
   `floor(MAX_ASK_CONTEXT / n)` characters, in its own lane, one after another, so `main`'s resident text is still
   one window's worth plus a page whatever *n* is (ADR-0088 Decision 2, ADR-0035). The share is written in the
   instruction and in the turn.

3. **The one page frame names the document.** Pages are marked `[Doc 2 page 3]` and cited `[Doc 2 p. 3]`, where the
   number is the document's place in the ask. **The same two functions and the same parser as the pair**:
   `askPageMarker` and `askCitation` take either a side or a document's place, and `citationsIn` reads `[Left p. 3]`,
   `[Doc 2 p. 3]` and `[p. 3]` alike, so there is one frame with three spellings rather than a second frame beside the
   first (B3a). The instruction lists each document by its place and its file name, and asks that **every claim cite
   its document and page**.

4. **Never refused for a document, and what was read is said.** A document that has closed, is busy or cannot be read
   when its turn comes is **skipped and named**, with its reason, and the ask goes on with the rest; only when no
   document could be read is the ask refused, with the first one's reason, since there would be nothing to ask about.
   The answer carries `among`: per document, in order, either the window's `sent` (its pages, characters and cut) or
   why it was not read. The turn shows one line per document.

5. **Only the documents open at Send.** The renderer composes the list when Send is pressed, from the tabs open then:
   the focused document first, then the others in tab order. A document opened afterwards is not in that ask. More than
   sixteen open: the first sixteen go and the turn names the ones that did not, rather than refusing.

6. **A citation is a link only while its document is open.** It takes the person to that document's tab and page; a
   citation of a document closed since is text. A turn records the documents it asked about, by id and name, so the
   link never resolves *Doc 2* against today's tabs.

7. **Offered with two or more documents open**, as *All Open Docs* in the Context menu, the owner's words. With one
   document open it is not in the menu.

## Rejected

- **A share weighted by length.** It would read every document's length before reading any text, in every lane, to
  divide a bound; an equal share is stated in one number and a long document is cut as a whole-document ask already
  is.
- **A second frame for many documents.** Two sets of markers and two parsers would be a second opinion about how a
  page is named to the model and back (B3a); the pair's *Left* and *Right* and this ADR's *Doc n* are spellings of one.
- **Refusing when one document fails.** The owner's principle is that a person is never refused because of their
  document; the rest are read and the failure is named.
- **Rebuilding the pair on the list now.** The pair has no route (ADR-0131) and the owner has not said where *Left ·
  Right · Both* belongs; when a route returns, it is this ADR's list of two, and its separate request field goes then.

## Consequences

- A sixteen-document ask carries at most 6,250 characters of each document, about two pages, and its lines say so; the
  person can narrow the question to one document from the same menu.
- `ai.ask`'s answer gains `among`, bounded at sixteen entries; chat history keeps a turn's `sent` as before and does not
  yet keep `among` (the pair's `alongside` is not kept either).
- ADR-0089's pair stays in the contract unreached, and its eventual removal or rebasing is recorded above rather than
  done under this feature.
