# ADR-0006 — Engine capability spike results, and the matrix amended to match

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** `docs/ARCHITECTURE.md` §3 (writer-of-record matrix) and lifts §3.1.
- **Supersedes:** `BUILD-PROMPT.md` Part C3's page-reorder and form-flatten rows,
  and their stated justifications.
- **Evidence:** `scripts/spike/engineSpike.mjs`, `docs/ENGINE-SPIKE.md`.

## Context

§3.1 held the matrix **provisional** until every row had been executed against a
real document, on the reasoning that a row nobody has run is a guess and guesses
about engine capability surface four months late with the architecture already
shaped around them.

The spike was run before `DocumentService` rather than after, because
`DocumentService` and `CommandBus` are exactly where the matrix becomes
load-bearing: `rotatePages` has to route to a writer of record. Building first
and spiking afterwards would have shaped the kernel around claims that turned
out to be wrong.

The fixture is self-generated and deliberately carries `/AcroForm`,
`/Outlines`, `/Names`, `/OCProperties` and a foreign annotation, because a
fixture without them lets a reorder that destroys all four pass the test.

## What was found

**Two of the matrix's three stated justifications were false.**

| Claim in the founding matrix | Reality |
|---|---|
| "MuPDF WASM has no reorder primitive (only delete/insert/graft)" | **False.** `PDFDocument.rearrangePages` exists. |
| "MuPDF WASM 1.28 exposes no `createWidget` and no flatten" | **Half false.** No widget creation — confirmed. But `bake(bakeAnnots, bakeWidgets)` flattens form fields, verified end to end. |
| pdf-lib is a suitable writer | **False on maintenance.** Last release 2021-11-06, nearly five years cold, while holding four rows of the matrix. |

**And the finding that matters most.** `rearrangePages` reorders pages
correctly and preserves `/Outlines`, `/Names` and `/OCProperties` — but
**drops `/AcroForm`**. It does so even when passed the *identity* permutation,
so merely calling it destroys the form. The widget annotations survive on their
pages, which makes it worse rather than better: the fields still render, but the
field tree is orphaned and the document is no longer a valid AcroForm.

A plain MuPDF save with no reorder preserves `/AcroForm` intact, which isolates
the cause to `rearrangePages` and not to the save pipeline.

**The fix was already written down.** Invariant L6 says page reordering
rewrites the page tree *in place*, because rebuilding into a new document drops
exactly these entries. Rewriting the `/Kids` array through MuPDF's own
`PDFObject` API — touching nothing else — reorders correctly **and preserves all
four catalog entries**. The founding record predicted this failure class; only
its stated reason was wrong.

`rearrangePages` also carries a semantic trap worth naming: it is a page
*selection* primitive, so an omitted index **deletes** that page. Passing 3 of 6
indices leaves a 3-page document.

## Decision

Amend the matrix:

| Concern | Was | Now | Why |
|---|---|---|---|
| Page reorder | pdf-lib | **MuPDF**, via an in-place `/Kids` rewrite | MuPDF has a reorder primitive, but it orphans `/AcroForm`; the in-place rewrite that L6 already prescribed preserves everything. Keeps MuPDF as the single structural writer (B3). |
| Form fields: flatten | pdf-lib | **MuPDF** `bake(false, true)` | Verified: widgets 2 → 0, `/AcroForm` removed, appearance retained. |
| Form fields: create | pdf-lib | **@cantoo/pdf-lib** | The one genuine MuPDF gap. |
| Content composition | pdf-lib | **@cantoo/pdf-lib** | Same capability, maintained. |

**`rearrangePages` is banned** for page reorder. It is not merely unused — using
it silently destroys forms, so it belongs in the banned-pattern ledger rather
than being left as a plausible-looking alternative for someone to reach for.

**pdf-lib is removed from the repository entirely**, including as a development
dependency. `@cantoo/pdf-lib` (2.8.3, MIT, published 2026-08-14) serves equally
well as the independent cross-engine reader the spike needs, so there is no
remaining reason to carry unmaintained code.

**§3.1 is lifted.** The matrix is evidence-backed and load-bearing.

**The spike becomes a regression gate.** Each case records the verdict the
architecture expects, and the script fails when reality differs — so a MuPDF
upgrade that changes any of these behaviours turns the build red instead of
silently invalidating the matrix.

## Correction — 2026-08-16, later the same day

**The decision above stands. Its evidence was incomplete, and this section
records what fuller verification found rather than editing the record above.**

The in-place rewrite was verified only against a **flat** page tree, where the
root's `/Kids` array holds the page objects directly. Re-tested against a
**nested** tree — `/Kids` holding intermediate `/Pages` nodes — the approach as
described ("rewriting the `/Kids` array, touching nothing else") is **wrong in
two ways**, neither visible on a flat tree:

1. **It permutes subtrees, not pages.** A six-page document in two branches of
   three, reversed, came back as `4 5 6 1 2 3` instead of `6 5 4 3 2 1`.
2. **It silently drops inherited attributes.** An intermediate `/Pages` node may
   carry `/Resources`, `/MediaBox`, `/CropBox` or `/Rotate` that its leaves
   inherit rather than declare. Flattening without pushing those down turns a
   landscape page portrait — and the page *order* still looks correct
   afterwards, so nothing announces the damage.

The correct algorithm, now proven against both tree shapes and kept as
`scripts/spike/reorderInPlace.mjs`:

1. Resolve every leaf via `findPage`, and for each, copy any **inheritable**
   attribute it does not declare onto itself — while the tree that carries it is
   still intact.
2. Rebuild the root `/Kids` as a flat array in the new order.
3. Set `/Count`, and reparent every leaf to the root.
4. `setPageTreeCache(true)` — MuPDF memoises the page tree, and without this
   `loadPage` still returns the old order.
5. Mutate the existing `/Pages` object; never assign a new one. Everything the
   catalog reaches hangs off identity, so replacing it is a rebuild wearing an
   in-place costume.

Verified end to end on the nested fixture: order `6 5 4 3 2 1`, orientation
`port port port land land land` → `land land land port port port` (the inherited
`/Rotate 90` followed its pages), `/AcroForm` preserved, and the form field
still readable on its new page.

**Two further claims in this ADR were asserted rather than executed when it was
written, and have since been verified properly:**

- *Content composition works in `@cantoo/pdf-lib`* — now executed: new document
  creation, a rotated translucent watermark drawn onto an existing page, and PNG
  embedding, each confirmed by MuPDF reading the result back.
- *`@cantoo/pdf-lib` is maintained* — now checked beyond a single publish date:
  116 published versions, ten of them in the last six months.

## Rejected alternatives

- **Use `rearrangePages` and re-attach `/AcroForm` afterwards.** Reattaching a
  catalog entry the engine just orphaned is the patch shape, and it assumes the
  field tree's own references survived — which was not verified and should not
  be assumed. The in-place rewrite avoids creating the damage at all.
- **Keep pdf-lib for page reorder as the founding matrix said.** It would work,
  but it puts a five-years-unmaintained parser on the critical path of an
  application that will be handed arbitrary and sometimes hostile PDFs, to do a
  job the structural writer of record can do correctly.
- **Keep pdf-lib as a devDependency for cross-engine verification.** Independent
  verification is genuinely valuable, but `@cantoo/pdf-lib` is equally
  independent of MuPDF and is maintained. Carrying abandonware for a benefit a
  maintained package already provides is cost with no purchase.
- **Trust the type declarations.** `mupdf.d.ts` declares `rearrangePages` and
  says nothing about `/AcroForm`. Reading the types would have produced exactly
  the wrong matrix with high confidence — which is the entire argument for §3.1.

## Consequences

- The kernel's page-reorder command is implemented against MuPDF's `PDFObject`
  API rather than a high-level call, so it needs its own proof that the four
  catalog entries survive. The spike is that proof's ancestor and the fixture is
  reusable.
- MuPDF now owns one more concern than the founding record gave it, which is a
  simplification: fewer engines writing means fewer opportunities for the
  sidecar and identity-join pathologies §3 exists to prevent.
- `@cantoo/pdf-lib` is a fork, and forks can stall too. Its maintenance is worth
  re-checking at each stage boundary; if it stalls, form field creation is the
  only concern affected, and MuPDF's low-level `PDFObject` API is the fallback
  — building an AcroForm field dictionary by hand, which the spike confirms is
  possible but which readers may disagree about, so it would need testing
  against Acrobat and PDF-XChange before adoption.
- The spike found this in one afternoon at Stage 0. Finding it at Stage 4, with
  page management and forms already built on pdf-lib, would have meant
  rewriting both.
