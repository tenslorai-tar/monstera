# ADR-0133 — A signature's mark is drawn by one module, for the signing writer and for MuPDF alike

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** `docs/ARCHITECTURE.md` §3's writer matrix, the annotation-appearance row and the digital-signature row,
  each of which now names the module that draws a signature's mark. Neither row changes its writer of record.
- **Decided by:** the owner's answers of 2 October: *"Signature: route B"*, *"An uploaded signature image follows Save
  for reuse too"*, *"Home shows only the simple Signature. Sign with certificate is under Protect only."*
- **Relates:** [ADR-0044](0044-an-image-reaches-the-engine-the-way-the-document-does.md) (a command's asset),
  [ADR-0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md) (undo by checkpoint),
  [ADR-0103](0103-an-annotation-carries-its-author-its-creation-time-and-its-blend.md) (a placed mark's author and
  date).

## Context

*Sign with certificate* draws a visible signature from a typed name, a drawn mark or a picture, in
`documentSign.ts`, and it draws it with pdf-lib, because the signing writer's placeholder is pdf-lib's. The owner's
split asks for a plain *Signature* beside it: the same three looks, placed on the page with no certificate, then moved
and resized like any other mark.

A placed mark that moves and resizes is a `/Stamp`, and annotations are MuPDF's (§3). So the plain signature is a
MuPDF command, and the question this ADR answers is where its picture comes from. Two answers were put to the owner:

- **Route A**: the renderer draws the look into a PNG and places it through `placeImage`.
- **Route B**: one module draws a mark, and both the signing writer and MuPDF take its drawing.

The owner chose B.

## Decision 1 — one module draws a mark; each writer embeds what it names

`packages/kernel/src/signatureDrawing.ts` is engine-agnostic: it imports neither pdf-lib nor MuPDF. Given a mark and the
size of the box as the page is seen, it answers a **drawing**:

- the **content stream**, as PDF operators in text;
- the **resources it names**: `F0`, a base-14 Type 1 font in `WinAnsiEncoding`, for a typed mark; `Im0`, the mark's own
  picture, for an uploaded one; nothing for a drawn one;
- the **form matrix** that keeps the mark upright on a page turned by `/Rotate`, and the box's seen width and height.

Each writer turns the names into objects of its own document and wraps the stream as a form: the signing writer as the
signature widget's `/AP /N`, MuPDF as the `/Stamp`'s appearance through `setAppearance`. What a typed name measures, how
drawn ink fits its box, and how a picture is scaled are decided once (B3a), so a signature placed with a certificate and
one placed without look the same from the same mark.

**The typed mark's metrics are the base-14 fonts' own AFM data**, `@pdf-lib/standard-fonts`, which pdf-lib already reads
for the same question and which `NOTICE` already lists. It becomes a declared dependency of the kernel, and the module
loads it on demand, so the MuPDF host's fixed cost (§9.17) does not grow with a font table no other command reads.

**A width is measured as the stream draws it.** A `Tj` applies no kerning, and pdf-lib's `widthOfTextAtSize` adds the
AFM's kerning pairs, so the certificate's typed name was centred on a width it was not drawn at. The module measures
glyph advances alone, which is what `Tj` draws.

## Decision 2 — two MuPDF commands, a look and a picture

- **`placeSignatureMark`** places a typed or drawn mark: page, rectangle, mark, stamp. It carries no asset.
- **`placeSignaturePicture`** places a picture: page, rectangle, media type, stamp, and its **bytes**, which reach the
  host the way `placeImage`'s do (ADR-0044's asset axis).

Two kinds, because the asset axis is a declaration per kind and `CommandAsset` admits `'bytes'` only for a payload that
always carries them. One kind with optional bytes would need a third value on that axis for one command. Both kinds are a
`/Stamp` with its appearance written from the drawing, the authored mark and the renderer's author and date (ADR-0103),
refused whole before anything is written, and undone by checkpoint, as `placeImage` is.

## Decision 3 — main resolves the look once, for both routes

The renderer asks `document.placeSignature` with the look it chose (typed, drawn, a kept one, or a picture still to be
picked), the page, the rectangle, whether to keep it, and the stamp. Main turns that look into a mark through the **same
function** *Sign with certificate* uses, generalised from its appearance step: a kept entry is read from the library, a
picture is picked and read by main, bounded and typed by its bytes. The renderer never holds a picture's bytes or its
path.

**Keeping happens in main, after the mark is placed**, for every look: a typed or drawn mark through the library's
`keepSignature`, a picked picture through its `addPicture` as a `signature`, with the bytes main already read. So *Save
for reuse* means the same thing for all three, which is the owner's answer. A library that is full places the mark and
says it was not kept, rather than refusing the placement.

**One library**, `library.list({ kind: 'signature' })`, offered by the Signature dialog and by *Sign with certificate*'s,
with one rendering of a kept entry shared by the two.

## Decision 4 — click, then move and resize as any mark

The Signature dialog answers a look; the person then clicks on a page. The mark is placed at a default size, three to one
as the page is seen, centred on the click and moved inside the page's displayed region. When it lands, the select tool
holds it as the selection, so a drag moves it and a corner resizes it through `placeAnnotation`, which keeps a written
appearance and scales it to the new box (measured for an image stamp; asserted here for a typed and a drawn one).

**The corners are drawn.** The select tool has always resized from an eight-pixel reach around a selected box's corner,
and nothing drew one. `SelectionLayer` now draws a handle at each corner of a selected box that can be resized, from the
same constant the tool's reach is, so the drawn handle and the hit target cannot disagree.

## Decision 5 — a picture is picked after the click

An uploaded look is picked by main when the mark is placed, as *Sign with certificate*'s picture and *Place image* are
today. Picking it inside the dialog, to show it there before the click, would need main to hold a picked file between
the dialog and the click, under a handle the renderer keeps. That is a question for the owner, recorded with this round's
report, not a decision taken under the feature.

## Rejected

- **Route A, a PNG drawn by the renderer and placed by `placeImage`.** A typed name becomes pixels at whatever
  resolution was guessed, a second drawing of the mark exists beside the signing writer's, and the two disagree about the
  same signature. It was the owner's other option and was not chosen.
- **pdf-lib writing the `/Stamp`.** It works (ADR-0044 executed it) and loses on cost: a load and save of the whole
  document per placement, where a signature is a repeated gesture.
- **MuPDF's own FreeText and Ink for the typed and drawn looks.** Two annotation kinds for one thing a person sees as one,
  a FreeText's text does not scale with its box, and neither kind can be the picture look, so the three looks would be
  three different objects.
- **One command with optional bytes.** A third value on the asset axis for one kind; two kinds keep the axis as it is.
