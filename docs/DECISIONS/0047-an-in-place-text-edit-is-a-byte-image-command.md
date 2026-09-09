# ADR-0047 — An in-place text edit is a byte-image command, and it generates content once

**Date:** 2026-09-09
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §2 and §8's seam** —
`writerShapes.pdfium` becomes `'byte-image'`. The amendment lands in the same
commit as this ADR, which carries no code (B4). **Nothing is built on it here.**

---

## The problem, in one sentence

Five `docs/FEATURES.md` D4 rows replace text through PDFium; `engineSeam.ts` has
declared `pdfium: 'live-session'` since Stage 0 with nothing behind it, and
building the second host on that declaration would answer **by accident** a B4
that `savePipeline.ts` has been carrying in writing since it was written.

## The question was already queued, and it names this moment

**It is stated in two places, and they are not redundant.**
`apps/desktop/src/documentCommands.ts` carries it beside `SaveSource`, which is
where the thunk is composed and therefore where an answer would have to live;
`packages/kernel/src/savePipeline.ts` carries it where the constraint bites,
beside the pipeline that calls the thunk. ADR-0039 cites the first, this ADR
quotes the second, and a reader arriving at either lands somewhere real.

`savePipeline.ts`:

> *"The day a second writer holds a session for one document, §4's sentence
> stops being a procedure: two live-session writers each return the whole
> document from `serialise`, and nothing in the law says which bytes win. That
> question is answered where the thunk is composed, and it is not answered here,
> because inventing a merge rule under a feature is what B4 exists to stop."*

And [ADR-0039](0039-a-byte-image-writer-round-trips-the-live-session.md)
Decision 2a says when it fires:

> *"the note stays live for the day a genuinely second **live-session** writer
> arrives, which is PDFium in Stage 5."*

This is that day. It was found by reading, not by hitting it — which is the only
reason it is being answered before the host rather than inside it.

## What was NOT the problem, recorded because both were carried into this range

**"The host must be generalised first."** True, and not first: the writer's
shape decides *how much* of it there is. A host serving a writer that holds
nothing between commands needs no session table, so the shape is the cheaper
question and it comes before.

**"PDFium is native, so it cannot be a byte-image writer."** Byte-image is a
statement about a session's **lifetime**, not about placement. Invariant 20
keeps native code out of `main` and says nothing about how long a session lives.
[ADR-0030](0030-a-remote-writer-does-not-open-from-an-image.md) already built
the remote route, and it opens from a **path**.

## Decision 1 — PDFium's writer shape is `'byte-image'`

**And the argument needs no timing at all**, which is worth saying plainly
because the instrument that prompted this ADR measures something else.

**A live-session PDFium edit is invisible.** The renderer reads the document
through `PDFDataRangeTransport` over `main`'s canonical image
([ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)),
and `document.viewModel` carries `{version, pageCount, rotations}` — there is no
honest way to express replaced text in it. So an edit that mutated a session
inside a host would be correct, undoable, savable and **unseen**: the
display-only defect wearing a green check, which is the exact failure ADR-0039
Decision 3 was written to prevent, arriving in a second engine.

Making it visible means the new bytes become `main`'s canonical image. **That is
what a byte-image command already does**, on a path the bus already has:
`CommandBus`'s `#sessionFor` obtains the input from `ByteImageAccess.current`
and `#install` adopts the result. So a live session would have to perform the
same round trip to be seen — it buys nothing the renderer can use, and it costs
the question above.

Three things follow rather than being chosen:

- **`savePipeline.ts`'s B4 becomes unaskable rather than answered.** That is
  ADR-0039 Decision 2a's move, applied in the case that ADR named as the one
  which would force the question. A writer that holds nothing between commands
  cannot hold a competing opinion about the document.
- **The PDFium host needs no session table**, so the `hostBody.ts`
  generalisation is the seven engine-agnostic channels rather than a second copy
  of the MuPDF host's machinery.
- **`SessionsByWriter` gains no second live entry**, so its own sentence — *"a
  document acquires a session per engine lazily"* — stays true without acquiring
  a second meaning.

## Decision 2 — content generation happens once per COMMAND, never once per object

Measured, `npm run proof:editcost` (`scripts/research/editCost.mjs`, seven
controls, figures from one machine and labelled as such):

| cell | KB | `FPDFText_SetText` | `FPDFPage_GenerateContent` |
|---|---|---|---|
| 1 × 40 | 3 | 0.007 | **0.17** |
| 100 × 40 | 199 | 0.022 | **5.44** |
| 500 × 40 | 997 | 0.016 | **29.18** |
| 500 × 1 | 203 | 0.029 | **12.54** |
| 50 × 400 | 820 | 0.017 | **23.93** |

Setting the text is free and flat. **Regenerating the content stream is the
whole cost of an edit**, and it is not the edited page's cost: 500 × 1 has the
same five hundred pages as 500 × 40 and costs a fifth as much, while 50 × 400
has a tenth of the pages and costs nearly as much. It tracks the **document's
content**.

What inside PDFium makes that true is **not established here and is not guessed
at**. The scaling is measured; the mechanism is not, and naming one would be a
label wearing an observation's clothes (B6).

| k replacements, one page of a 199 KB document | generate per call | generate once |
|---|---|---|
| k = 1 | 15.5 ms | 14.8 ms |
| k = 40 | **199.6 ms** | **14.6 ms** |

One generate is **flat in k**; per-object generate is linear — **13.7× at forty
replacements**, growing without bound. The k = 1 row is the control rather than
a data point: with one replacement the two strategies are the same two calls in
the same order, so they must agree, and a win there would mean the comparison
measures something else.

So `pdfiumFfi.ts`'s `replaceTextObject`, which sets **and** generates in one
call, is correct for exactly one replacement and wrong for every command that
touches more than one. Document-wide replace-all is a row in this stage.

**The rule: the adapter exposes setting and generating separately, and a command
generates once.** That is
[ADR-0045](0045-a-removals-garbage-collection-belongs-to-the-command.md)'s shape
one operation along — *a removal's garbage collection belongs to the command
that removes, not to the save pipeline* — and it fails the same way if not
taken: an expensive document-level operation performed once per small edit.

**The adapter's spelling is not decided here**, only that the two halves are
separable and that a command owns the second.

## What this does not decide, each with what would settle it

**How the input bytes reach the host.** `ByteImageAccess.current` answers a
`ByteImage` — the document's bytes, **in `main`**. That is right for pdf-lib,
which runs there. For a remote writer it is the cost ADR-0030 exists because of:
`engineSessions.ts` prices `main` holding a second image at *1.00× becoming
2.00× against a 1.5× ceiling*. The candidate is the shape `adopt` already has —
a `SnapshotWrite` into the granted directory, which is ADR-0023 Decision 14's
route — so the input side owes what the output side was given. **Settled by the
commit that wires the first PDFium command**, and named here so it is not
discovered there.

**Whether capture and apply share one open.** A byte-image `capture` receives
the image, so capturing a text object's prior string is its own open of the
whole document. Two opens per edit is a real cost and a real question; nothing
here answers it. `FPDFTextObj_GetText` **is** exported (checked against the
shipped DLL, unlike `FPDFTextObj_SetText`, which is not), so the prior is small
and the question is about the opens rather than about the capture.

**HD render's session.** HD render rasterises pages through PDFium repeatedly,
which wants a session that outlives a call. **That is a READER**, and a
read-only session recycled when the document's version moves is not the
two-writers problem — nothing about it can answer `serialise`. Recorded so the
row is not blocked by a rule that does not reach it.

**The host's generalisation.** The seven core channels, the per-writer command
schema and where `hostEntry.ts` learns which engine it is are the next unit and
are not decided here.

## Rejected alternatives

**PDFium as a live-session writer — the Stage 0 declaration.** Rejected on
Decision 1's mechanism: its edits cannot reach the renderer without a byte
refresh, the refresh *is* the round trip, so it pays the same cost and
additionally owes the *which bytes win* rule and a session table inside a
contained host. The declaration was made before anything was built on it and is
being corrected on the first evidence, which is the cheapest moment it could
have been.

**Keeping set and generate coupled and accepting the cost.** Rejected on the
measurement rather than on taste: replace-all over forty objects is 13.7× and
the factor grows with the count. A row in this stage would ship unusable.

**Generating once per SAVE rather than once per command.** Rejected because it
is not a cost trade, it is a correctness one: without `GenerateContent` the edit
is present in memory and absent from serialised bytes — `pdfiumFfi.ts` refuses
on exactly that — so every checkpoint, capture and range read between the edit
and the save would see the unedited document. That is the two-states failure
ADR-0031 and ADR-0039 both refuse, arriving through a performance optimisation.

**Inferring the writer's shape from what the adapter returns.** Rejected by
ADR-0039 and restated because this ADR changes `writerShapes`, which is the one
table where a shape is stated and from which `WriterShapeOf` is derived. An
adapter that forgets its `return` must be a `TypeError` at the writer, not a
document that silently stops updating.

**Deferring the shape until the host exists.** Rejected: the host's size depends
on the answer, so deferring means building the larger host and discovering the
smaller one was available — and it answers `savePipeline.ts`'s B4 in passing,
which is what B4 exists to stop.
