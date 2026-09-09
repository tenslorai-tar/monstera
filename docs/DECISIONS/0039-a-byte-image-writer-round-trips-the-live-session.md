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

---

## Correction, 2026-09-04 — the cost argument's reason was backwards, and its scope is narrower than its sentence

The decisions above stand. **Question 3's stated reason does not**, and it was
found by review asking what keeps *"which every content command is"* true.

### What this document said

> **The input side is a cost this repository already pays, on this exact
> path.** `CommandBus.execute` calls `writer.serialise(session)` for **every**
> entry that records as `terminal` … The input image and the checkpoint are the
> **same bytes**.

The two bytes really are the same array. The **dependency runs the other way**,
read from the code rather than from the sentence:

- `CommandBus.#sessionFor` obtains a byte-image writer's session by calling
  `ByteImageAccess.current()` — a full serialise of the live engine session —
  and does so for **every** byte-image command, before `capture` has run and
  therefore before anything knows whether the entry will be terminal.
- `pdfLibWriter.serialise` is the **identity** (`pdfLibWriter.ts:70`). So
  `asCheckpoint(await writer.serialise(session))` hands back the array
  `#sessionFor` already produced.

So it is not that the input is free because a checkpoint was owed. **It is that
the checkpoint is free because the input was already produced.** Same
conclusion, opposite mechanism — and the difference matters, because the
original wording makes the cost sound conditional on the checkpoint when the
serialise is unconditional.

### What that changes, and what it does not

**Unchanged:** the refresh of `main`'s canonical image still costs a reference
assignment, because a byte-image `apply` returns its image. Every rejected
alternative stands. `rotatePages` still pays nothing.

**Narrowed:** *"none per command on a path that already performs one"* is true
for a **non-invertible** byte-image command, where the serialise doubles as the
checkpoint the bus was going to take. An **invertible** one takes no checkpoint,
so its serialise is a cost its live-session equivalent does not pay. That case
does not exist today and this document did not cover it.

### Why the type does not forbid it, and what does

The obvious repair is to make `writer: 'pdf-lib'` sit only on a non-invertible
declaration — the union already discriminates, so it would compile-error. **It
would also be wrong.** §3's matrix assigns *"Form fields: create"* to
`@cantoo/pdf-lib` as *"the one concern MuPDF has no API for"*, and creating a
field is plausibly invertible: its prior state is *the field did not exist*,
which is small and serialisable. A compile error would forbid a Stage 4 command
this architecture already anticipates.

So the fact is **true today and is not a rule**, and it is held by a case rather
than a type: `commandDeclarations.test.ts` derives the byte-image kinds from
`writerShapes` and requires each to be non-invertible, with a failure message
that says the declaration is legitimate and this document is what needs
amending. Derived rather than listed, because the failure feared is a member
**arriving** (checklist 4c's direction test).

**Not measured, and named as such:** what that serialise actually costs in
wall-clock on a large document. The bound is unchanged — one whole image
transiently in main, which ADR-0021 already prices.

## Correction, 2026-09-09 — PDFium is not the second live-session writer this document names

Decision 2a's closing sentence reads *"the note stays live for the day a
genuinely second **live-session** writer arrives, which is PDFium in Stage 5."*

**The clause after the comma is withdrawn.** The general half stands: a session
that does not outlive its command cannot hold a competing opinion, so
`savePipeline.ts`'s *which bytes win* remains unaskable rather than answered, and
it stays live for whatever second live-session writer may one day arrive.

What is false is the identification.
[ADR-0047](0047-an-in-place-text-edit-is-a-byte-image-command.md), 2026-09-09,
makes `writerShapes.pdfium` **`byte-image`**: a live-session PDFium edit would be
sound, undoable, savable and **invisible**, because the renderer reads main's
canonical image and the view model carries only rotations — which is Decision 3's
defect arriving in a second engine. So the note this document expected PDFium to
fire is one PDFium now cannot fire, and `commandDeclarations.test.ts` carries a
case asserting exactly one writer of record is live-session.

Recorded rather than edited, because what this document believed on 2026-09-04
is the record. **The prediction was not wrong to make** — it named the trigger
and the file, and that is what let the question be seen a day before the host
that would have answered it by accident.

## Addition, 2026-09-09 — an invertible byte-image command, priced against the choice a declaration actually makes

The 2026-09-04 correction closed with *"That case does not exist today and this
document did not cover it."* Stage 5's `replaceTextObject` is that case, and
`commandDeclarations.test.ts`' failure message names this document as what has
to be amended before it lands. This is that amendment; the command lands in a
later commit (B4).

### The comparison that correction made is not the comparison a declaration makes

It compared an invertible byte-image command against **its live-session
equivalent** — *"its serialise is a cost its live-session equivalent does not
pay"* — and that sentence is true and unchanged. It is not the choice in front
of whoever writes a declaration. A command's writer of record is settled by §3's
matrix before invertibility is asked; `BUILD-PROMPT.md`:257 assigns in-place
text editing to PDFium, and ADR-0047 makes PDFium byte-image. So the axis being
chosen is **invertible against terminal, both byte-image**, and against that
comparison the serialise is common to both.

Read from the code, the same way the correction above was:

- `CommandBus.#sessionFor` calls `ByteImageAccess.current()` for **every**
  byte-image command, before `capture` has run — so the serialise happens under
  either declaration, and neither pays for it.
- `RegisteredWriter`'s `serialise` is the identity for a byte-image writer
  (`pdfLibWriter.ts:70`; a remote PDFium writer's is the same, its session being
  the image). So a terminal entry's checkpoint is the array `#sessionFor`
  already produced, exactly as the correction says.

### So the marginal cost of invertibility here is negative, and it is in RETENTION

`CommandLog.trimTo` states the other half in its own comment: *"An invertible
entry retains no document-scaled bytes."* A terminal entry retains one whole
document image per command; an invertible one retains a prior string.

| | serialise per command | retained per entry |
|---|---|---|
| byte-image, terminal | one (the input) | **one document image** |
| byte-image, invertible | one (the input) | the inverse — for a text edit, a string |

Text editing is the workload that makes the difference structural rather than
tidy: a person replacing runs issues many small commands against one document,
and declaring them terminal would put a full image in the log for each. §4
reserves checkpoints for redaction, flatten, encryption and OCR *because* they
are the exception, and a text edit is not one of them.

### What is still NOT covered, said plainly

**The serialise itself remains unmeasured on a large document.** The 2026-09-04
correction says so and this addition does not improve on it. What is priced here
is the *difference* between two declarations, which is exactly the quantity a
declaration decides; the shared term is unchanged and still unread.

**And it prices nothing about a remote byte-image writer's round trip** — the
bytes out to a granted directory and back — which is ADR-0047's open *how do the
input bytes reach the host* and is answered by the commit that wires the first
PDFium command, not here.

### The case that fires becomes the case that holds this rule

`commandDeclarations.test.ts`' *every byte-image command is non-invertible* was
written as a **trigger**, with a message saying what to do. Its instruction has
now been carried out, so it stops being a trigger and becomes the wrong shape to
keep: a case asserting a fact this document has just made legitimate would be
red for a correct table. The commit that lands `replaceTextObject` replaces it
with the property this addition actually establishes — that a byte-image
command's declaration is a statement about **retention** — and keeps the control
that the byte-image set is non-empty, without which either version passes
vacuously.
