# ADR-0195 — A merge of several documents may choose pages of each

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0152](0152-a-merge-takes-several-documents-in-one-command.md) — its Decision on the command's two
  shapes, which `mergeDocumentSchema` records as *a merge of several documents with pages chosen of each is a widening of
  this union, made on purpose.* This is that widening. The rest of ADR-0152 (one command, one log entry, the bound on
  the documents, every part checked before any is grafted) stands.
- **Found by:** the owner's review, 2026-10-07 (Screenshot 2026-10-07 083411) — *Merge documents only merges whole files.*

## Context

`mergeDocument` took one of two shapes: ONE document with pages chosen of it (*Insert from PDF*), or one to thirty-two
documents each taken whole (*Merge*). The kernel already read each part's own page set — `applyMergeDocument` resolves
`pagesOf(part.sourcePages, …)` per part — so the restriction was in the contract only, and it was there for the
message's size, not for any reason in the engine: a page set may hold 4,096 entries in a paired command, and thirty-two
parts each free to carry one is 2.4 MB against the hosts' 262,144-byte frame. `maxEncodedBytes` reads the shape of a
schema, so a refine holding the total to one set's would be invisible to the check that owns the bound.

## Decisions

1. **Each part of the several-documents shape carries `sourcePages`: `'all'` or a page set of at most
   `MAX_MERGE_PART_ENTRIES` entries,** the same field the single-document shape has. The bound is in the shape, where the
   check can read it: `MAX_PAGE_SET_ENTRIES / MAX_MERGE_DOCUMENTS` is 256, so thirty-two parts at their worst are one
   page set's worst, which the contract already holds under three quarters of the frame. 256 entries is a person's
   selection many times over — *1-3, 5, 7-9* is three — and a selection of more separate runs than that is said to the
   person where it is typed (Decision 3), never refused by the host.
2. **The order of a part's pages is the order they land,** as in the single-document shape: pages 4 then 2 land as 4, 2.
   A source page the document does not have is refused before any part is grafted, by the one refusal `pageScope.ts`
   owns, so nothing lands from the parts before it.
3. **The renderer says what is wrong where it is typed.** The merge list's row for each document takes the page range
   as text, through the one parser (`parsePageRanges`) and the one set of sentences (`rangeProblemSentence`): a part
   that is not a page, a range that counts backwards, a page past the document's end, and a selection with more separate
   runs than a merge can carry are each named, with the part. Nothing is ignored in silence, and the button does not go
   on until each row is a range the document has.
4. **The default is every page.** A row opens on *All pages*, so a merge nobody changed is the merge it always was.

## Rejected alternatives

- **A refine on the sum of the parts' entries.** The bound would be real and invisible: `maxEncodedBytes` would read the
  schema as thirty-two full sets and the route check would refuse it, correctly by its own rule (B3a).
- **A second command kind for *merge these pages*.** The operation is declared once; `insertFromPdf` is already a second
  surface over `mergeDocument`, and a second kind would be two grafts to keep in step.
- **A lower bound on the number of documents when pages are chosen.** The number of documents and the number of runs
  are independent, and a rule coupling them is a rule nobody could state to the person.

## Consequences

- `mergeDocumentSchema`'s several-documents alternative widens; the single-document alternative is unchanged.
- The merge dialog's answer carries each document's pages. Its draft, restored after *Choose file…*, carries the typed
  text of each row.
- Page thumbnails in the picker need a document view the dialog does not have today (dialogs are given plain data, never
  a client); that is a separate decision and is not made here.
