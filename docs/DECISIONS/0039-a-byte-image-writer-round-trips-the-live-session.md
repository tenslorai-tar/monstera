# ADR-0039 — A byte-image writer round-trips the live session

**Date:** 2026-09-04
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §2 and §8's seam**, and
answers the byte-refresh trigger
[ADR-0032](0032-the-view-model-is-a-scoped-query.md) wrote into
`docs/FEATURES.md`. The architecture amendment is a separate commit (B4); this
ADR is the reasoning behind it.

---

## The problem, in one sentence

Seven `docs/FEATURES.md` rows — page transitions, TOC, Bates numbering, headers
and footers, watermark, background, insert from image — route to
`@cantoo/pdf-lib`, which §3's matrix names by name and `engineSeam.ts` declares
as a writer of record, and **not one of them can be built**, because nothing
says where a byte-image writer's input bytes come from or what happens to the
live MuPDF session after it produces new ones.

## What was NOT the problem, and had been recorded as one

Two blocks were named in a handoff and both dissolve on a read. They are
recorded because the cost of each was a relay, and because the same two
misreadings are available to the next author.

**Invariant 20 does not apply.** `docs/ARCHITECTURE.md:1046` reads *"**No native
engine code** runs in the main process"*. `@cantoo/pdf-lib` is pure JavaScript
with no native binding, no WASM and no shared library. The invariant's mechanism
is that *"a native fault is uncatchable wherever it happens"*; a JavaScript
throw is catchable in the process that made it. So pdf-lib needs no engine host,
and the whole of §5's containment argument is silent about it.

**The placement was already made.** §3's matrix at `:381` assigns *"Content
composition: new document generation (markdown/CSV/TOC/image-to-PDF), drawing
onto pages (watermark, headers/footers, Bates, OCR text layer)"* to
`@cantoo/pdf-lib`, and `engineSeam.ts:110` declares `readonly 'pdf-lib':
ByteImage` beside `WriterShapeOf`'s `'byte-image'`. `Apply<W, K>` has returned
`Promise<ByteImage>` for a byte-image writer since the seam was written, and
`scripts/proofs/contract.proof.mjs` holds a type-level fixture that builds one.
The seam is not being extended here. It is being **used for the first time**,
which is a seam meeting its first real caller.

## The three questions the law does not answer

1. A byte-image `apply` consumes an image. **Which image?**
2. It produces a new one. **What happens to the MuPDF session** that was the
   document a moment earlier?
3. Does main's canonical image move?

### Question 1 — the input is the live session's bytes, never main's image

Main's canonical image is **stale for the whole life of an open document**, and
that is measured, not suspected: finding OOOOO-1, 2026-08-30, recorded at
`documentService.ts:484` — *"A record's `bytes` is `readonly` and a command
never replaces it: the mutation lands in the engine session, and main's
canonical image stays what was opened."*

So a watermark applied to main's image would be applied to the document **as
opened**, and its result would then replace a session carrying every command
since. Delete page 3, then watermark, and page 3 comes back. That is not a
degraded result; it is a document built out of two states, which ADR-0031
already refuses one layer down for exactly this reason.

**Decision 1: the input image is produced by the live writer's `serialise`, at
the moment the command runs.** That is the same call the save pipeline's
`flush` makes, so there is one implementation of *what the document currently
is* and not two (B3a).

### Question 2 — the result replaces the live session, by the restore path

**Decision 2: the new bytes replace the MuPDF session through
`DocumentRestore`** — release, then reopen from the bytes — which is the exact
mechanism [ADR-0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)
built for undoing a terminal entry, reached through `EngineSessions.recycle` so
the document keeps its entry, its failure count and its poisoned state.

Nothing new is built for this. `composition.ts:409` already composes
`(docId, write) => engine.recycle(docId, (id) => engineHost.restoreSessions(id, write))`,
and its whole parameterisation is *which bytes*.

**Decision 2a: a `pdf-lib` session is minted for one call and never stored.**
It is not put into `DocumentSessions`, which holds live sessions only.

This is B5 over a rule, and the rule it makes unnecessary is written down and
waiting: `documentCommands.ts`'s `SaveSource` note says that *"the day a second
writer holds a session for one document, two live-session writers each return
the WHOLE document from `serialise` and nothing in the law says which bytes
win. That is a B4 question."* A session that does not outlive its command cannot
hold a competing opinion about the document, so the question is not answered
here — it is made unaskable, and the note stays live for the day a genuinely
second **live-session** writer arrives, which is PDFium in Stage 5.

### Question 3 — main's canonical image DOES move, and the refresh is free

**Decision 3: a byte-image command replaces main's canonical image with its
result.**

This is the byte-refresh ADR-0032 rejected, and that ADR wrote its own trigger:

> **A trigger is written into `docs/FEATURES.md`:** the first command whose
> effect cannot be expressed in the view model puts the byte-refresh question
> back, and this rejection is not evidence against it then.

The trigger has fired. A watermark is drawn content, not a page transform;
`document.viewModel` carries `{version, pageCount, rotations}` and there is no
honest way to express a drawn rectangle in it. The renderer reads the document
through `PDFDataRangeTransport` over main's canonical image (ADR-0031), so
without this decision a watermark command would be correct, undoable, savable —
and **invisible**, which is the display-only defect wearing a green check.

**What made the rejection right then does not apply now, and the difference is
arithmetic rather than judgement.** ADR-0032 measured a refresh on *every*
command at 2.00× against a 1.5× ceiling. The quantity here is different in two
ways, and both are read from the code rather than modelled:

- **The output side costs nothing.** A byte-image `apply` *returns* the image.
  The bytes are already in main, held by the bus, before any decision about what
  to do with them. Storing them is a reference assignment; discarding them is
  what today's bus does with the return value.
- **The input side is a cost this repository already pays, on this exact
  path.** `CommandBus.execute` calls `writer.serialise(session)` for **every**
  entry that records as `terminal`, which is every command declaring
  `invertible: false`. `deletePages` is one and shipped on 2026-09-03. Drawing
  content onto a page is non-invertible for the same reason — the prior state is
  the page's whole content stream — so a content command was always going to
  serialise once. The input image and the checkpoint are the **same bytes**.

So a content command's total is one full serialise, which is what it would have
cost with no refresh at all. **Not measured, and named as such:** the wall-clock
of that serialise against a large document. What is bounded rather than
estimated is the *peak*, and it is bounded by an existing shape — one whole
image transiently in main, which is what `asCheckpoint(await writer.serialise())`
already produces on the terminal path, and which ADR-0021 prices at 2.00× of
file size for exactly that reason.

## What this does not do

- **It does not refresh main's image after a live-session command.** ADR-0032's
  rejection stands untouched for `rotatePages`, `movePage` and their siblings:
  the view model is still how a page transform reaches the screen, and no
  serialise is added anywhere on that path. The refresh happens where the bytes
  already exist and nowhere else.
- **It does not make pdf-lib a second opinion about the page tree.** Every
  command routed to it draws or generates; none reorders, deletes or crops. The
  matrix row is the boundary and `commandDeclarations.ts`'s `writer` field is
  where it is enforced.
- **It does not give the host a byte-image session.** `hostBody.ts` is unchanged
  and takes one `CommandExecution<'mupdf'>`; pdf-lib runs in main, where §5's
  containment has nothing to say about it.

## Rejected alternatives

**Running pdf-lib in the engine host.** It is where the spec table already
lives, so no module-graph question arises. Rejected on three counts: the host
exists to contain *native* faults and holds pure-JS work for no reason; the
host's channels are typed around `MupdfSession` and a second session kind
crosses the pipe, which is the `hostBody.ts` generalisation this ADR's whole
premise says is not needed; and it would put the produced bytes on the far side
of a pipe from the canonical image they must become, adding a crossing to buy
nothing.

**Applying pdf-lib to main's canonical image directly.** The cheapest thing that
compiles, and it silently discards every command since the document opened. It
is rejected not on cost but because the failure is invisible: the produced
document is well-formed, opens, and is wrong.

**Refreshing main's canonical image after every command**, so that the input is
always to hand. This is ADR-0032's rejected option restored in full, at its
measured 2.00×, to spare one serialise on a path that already performs one.

**Keeping a `pdf-lib` session in `DocumentSessions` across commands**, mirroring
MuPDF. It buys nothing — pdf-lib re-parses on every `PDFDocument.load` anyway —
and costs the exact question `SaveSource` names as a B4: two sessions for one
document, each able to answer `serialise`, with nothing saying which wins.

**Making the bus decide by inspecting the return value** (`if (applied !==
undefined)`). It infers a writer's shape from what an adapter happened to
return, so an adapter that forgets its return is a document that silently stops
updating. The shape is declared, so the bus reads the declaration:
`writerShapes` in `engineSeam.ts` is the one table and `WriterShapeOf` is
derived from it, which is why a writer cannot be given two shapes.

**Deferring until a second byte-image writer exists**, on the B7 argument that
one instance does not justify a seam. The seam is not being added — it was
written with two shapes on purpose and holds a fixture proving it. What is being
added is the first adapter behind it, which is the thing that finds out whether
the seam is right, and every test of it so far has injected its own surfaces.

## The consequence, stated

`context.byteLength`'s comment records that it *"reads the same number before
and after — which is the honest description of a field whose purpose arrives
with the refresh that does not exist yet."* That sentence is now false for a
byte-image command and stays true for a live-session one, and it is corrected in
the same commit as the code rather than left to a sweep.
