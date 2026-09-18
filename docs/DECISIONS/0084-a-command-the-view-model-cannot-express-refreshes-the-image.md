# ADR-0084 — Every command declares how its effect reaches the screen, and one the view model cannot express makes the session's bytes main's image

- **Status:** Accepted
- **Date:** 2026-09-18
- **Amends:** `docs/ARCHITECTURE.md` §2, whose paragraph *"A LIVE-SESSION mutation reaches the
  screen through the view model, not through the bytes"* is true of one command and false of
  the rest.
- **Fires:** [ADR-0032](0032-the-view-model-is-a-scoped-query.md)'s own trigger — *"the first
  command whose effect cannot be expressed in the view model puts the byte-refresh question
  back, and this rejection is not evidence against it then"* — which fired in Stage 2 and was
  not noticed.
- **Relates:** [ADR-0039](0039-a-byte-image-writer-round-trips-the-live-session.md) (a
  byte-image command already replaces main's image),
  [ADR-0047](0047-an-in-place-text-edit-is-a-byte-image-command.md) (the same argument, made for
  PDFium), [ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md).

## The finding, measured

A live run on 2026-09-18 merged a two-page document into a three-page one. The saved file read
back five pages in the right order; the window went on showing three, and the thumbnail strip
broke. Deleting a page did the same, with the view still drawing the page that was deleted.
Read over the debugging port from the running renderer: the page list for **version 2** held
`pageCount: 3` and `byteLength: 1846` — the opened file's length to the byte. `document.execute`
answered the canonical image's length, and nothing had replaced that image.

The mechanism is §2's own: a MuPDF command lands in the engine session, `document.readRange`
serves main's canonical image, and the view model carries `{version, pageCount, rotations}`.
Rotation is the one effect that model can carry. Removing, inserting, merging, replacing,
cropping, filling, flattening, redacting and annotating are drawn by PDF.js **from the bytes**
— including annotations, whose appearances PDF.js paints onto the page canvas — so each was
correct in the engine, correct on disk after a save, and **not on screen until the document was
closed and reopened**. Every wired-tools pair stayed green: the kernel proof reads the engine,
the UI test reads the dispatch, and the screen is between them.

## Decision

1. **Every command declaration names how its effect reaches the screen**, as a required field
   with three values:
   - `'view-model'` — `document.viewModel` carries it. **`rotatePages` only**, today.
   - `'image'` — PDF.js draws it from the document's bytes.
   - `'nothing-drawn'` — no surface draws what it changes. `setPageTransition` (a presentation
     dictionary no view reads) and `setDocumentProtection` (its `apply` records an option on
     the session that changes how the document is *written* and writes nothing drawn, per its
     own declaration).
   A byte-image writer's commands can only declare `'image'`: their `apply` returns the image,
   and the type says so.
2. **After `execute`, `undo` or `redo` of a command declared `'image'`, main's canonical image
   is the session's bytes**, inside the document's lane, before the version is bumped. Where
   the operation already holds those bytes — a byte-image `apply`'s result — they are used;
   otherwise the bus takes them from `ByteImageAccess.current`, the save pipeline's flush. The
   version the renderer is answered with then describes bytes that are what the engine holds,
   and the range transport it already rebuilds on every bump draws them.
3. **Undoing a terminal entry is included**, and read from the code it is a defect of the same
   class before this decision: `CommandBus.undo` rebuilds the session through
   `CheckpointRestore` and replaces no image, so after undoing a byte-image command main's
   image is still the post-command bytes. Read, not yet measured; the case this decision adds
   is what measures it.

## Rejected

- **Extending the view model with a page map.** It expresses a deletion or a move while every
  page still comes from the opened bytes, and nothing else: a merged, inserted or replaced page
  has no bytes in the image to point at, and a crop, a fill or an annotation is not a page
  order at all. It would be ADR-0032's rejected *delta* again, one command further on.
- **Refreshing after every command, undeclared.** The obvious repair and the one ADR-0032
  priced: it serialises for a rotate, whose effect the view model already carries, and it
  leaves the question *does this command need it* answered by nobody. The declaration makes it
  a choice each command's author must write, and the compiler refuses a missing one.
- **Inferring it from the writer.** MuPDF writes both a rotate and a merge; the writer says
  where the effect lives, not how it is drawn.
- **Rendering annotations from the kernel's model instead of the bytes.** It would take one
  class of command off this path and leave every page-structure command on it, and drawing an
  appearance stream is exactly what PDF.js is for.

## Consequences

- **A serialise per `'image'` command, and two images in main for the moment of the swap.**
  [ADR-0021](0021-the-canonical-image-is-retained.md)'s table measures two images at **2.00×**
  against ADR-0007's 1.5×, on both content shapes. This is not a new peak: a byte-image command
  has held its returned image beside the old one on every run since ADR-0039. It is the same
  peak reached by **more commands** — every page and content command routed to MuPDF — and
  that frequency, with the serialise's wall-clock on a large document, is **not measured** at
  the time of writing. `perf:gate` and §9.17 say whether it fits; a budget that fails is a
  finding about this decision, not a figure to raise.
- `commandDeclarations.ts` gains the field on every entry, and a case asserts that every
  live-session command other than the named exceptions declares `'image'` — so the next command
  added defaults to being seen rather than to being invisible.
- `docs/FEATURES.md` rows 90, 94, 98 and 225 and every page-structure and content row routed to
  MuPDF were **done** by their pairs and not on screen; their live runs are what re-certifies
  them.
