# ADR-0211 — A text box with styled words has an appearance Monstera writes itself

- **Status:** Accepted 2026-10-08 on the owner's order to build it (Step 8 of the run that follows the one that wrote this): all
  seven Decisions as written, with the two open questions answered as proposed — a script outside the base 14 keeps the engine's
  appearance and the panel says why (Decision 2), and the per-word styles are built with the box-level ones, on the same
  `/RC` writer (Decision 7). *Justify* and *line spacing* are stored in `/DS` and drawn in the appearance; `/Q` keeps the
  nearest of left, centre and right, so a reader that ignores `/AP` and `/DS` shows the words against the side the box says.
  Written before any of it is built, in its own commit (B4).
- **Date:** 2026-10-08
- **Amends:** nothing yet. Building it amends the architecture's annotation row (the engine draws a FreeText) and
  [ADR-0154](0154-words-are-typed-on-the-page-and-the-page-is-asked-for-them.md) Decision 3, which reads a box's style from `/DA` and `/Q`
  alone.
- **Found by:** the owner's order of 2026-10-08: bold and a colour on SOME words of a text box, a fill behind the box, line
  spacing — and `format-text-in-a-text-box.md`'s own line saying they are *"not offered, because PDF readers would not all show
  them"*.

## Context

MuPDF 1.28.0 draws a FreeText's words in one of three faces, with one `/DA`, and nothing else (measured 2026-10-08, the comment
on `writeWordsStyle` in `pageAnnotations.ts`):

- any `/DA` face other than `Helv`, `TiRo` and `Cour` is **stored and painted in Helvetica** — `/TiBI 20 Tf` stays in the file
  and the appearance says `/Helv`;
- `setInteriorColor` is **refused** for a FreeText (*"FreeText annotations have no IC property"*), and `/C` is the box's
  background, so a fill and the box's border colour cannot be told apart through the engine;
- there is no per-word run at all: `/RC` (rich text, PDF 32000 §12.7.3.4 and §12.5.6.6) is not read, and `/DS` is not read.

So a bold word, a red word or a filled box is **not representable through the engine**, and writing `/RC` alone would be a mark
that looks different in every reader: readers that draw `/RC` (another widely used PDF editor) would show the styles, and readers that draw `/AP`
(everything else, MuPDF and PDF.js among them) would show plain words. A mark that looks different in different readers is the
defect the help article was written to avoid.

## Decision (proposed)

1. **Monstera writes the FreeText `/AP` itself**, for a text box, a callout and a typewriter that carry styled words or a fill,
   from three stored facts: `/Contents` (the plain words, unchanged — search, the panel and every reader that ignores the rest
   still have them), `/RC` (the styled runs, the XHTML subset the format defines: `<p>`, `<span>` with `font-weight`,
   `font-style`, `color`, `text-decoration`, `font-size`) and `/DS` (the default style string, which carries the alignment and
   the line height). The three are written together by ONE writer (B3), and `/AP` is a function of them.
2. **The faces are the base 14**, which every reader has: Helvetica, Times and Courier in regular, bold, italic and bold italic.
   Nothing is embedded for Latin text, so a file stays small and cannot be missing a face on another machine. A script outside
   the base 14's coverage (Hebrew, Arabic, CJK) is **not** drawn by this writer: such a box stays on the engine's appearance with
   the plain words, and the Properties tab says the styles are not available for it — a refusal said in words, never a style
   dropped silently (*preserve, never drop*).
3. **Width and line breaking come from bundled font metrics** (the base 14's published AFM widths), in the one module that also
   draws, so the line a person saw break is the line the appearance breaks. The module is the single owner of *where a line
   ends* (B3a); the properties panel and the editor ask it and never measure.
4. **A box the writer cannot draw is left to the engine, and says so.** A foreign FreeText that already has `/RC` is **kept**
   (its `/RC` is not rewritten unless the person changes its words or styles), and its appearance is only regenerated when the
   person edits it. Opening a document never rewrites an appearance.
5. **A fill is `/IC` on the FreeText**, which the format allows (§12.5.6.6) and MuPDF refuses to set through its API; the writer
   puts it in the dictionary directly and draws it in the appearance. The box's border colour stays `/C`.
6. **The proof renders the file in another reader.** A stored key that changes nothing is what an inert write looks like, so the
   control for each style is the page rasterised by PDF.js and by Poppler, with the styled word's pixels compared against the
   plain word's — not a read-back of the dictionary.
7. **Editing styled words is a range edit on the box's runs** (a selection of words inside the open editor gets Bold, Italic,
   Underline and a colour; a box with nothing selected styles the whole box, which is what the Properties tab does today). The
   editor and the properties panel send one command that names the runs; the kernel is the only writer of `/RC`.

## Rejected alternatives

- **Write `/RC` and leave `/AP` to MuPDF.** Rejected: MuPDF ignores `/RC`, so the page shows plain words, and the styles exist
  only for readers we are not drawing with. The mark would be right in one reader and wrong in another.
- **Flatten the styled words into the page as ordinary text.** Rejected: the box stops being a text box (it cannot be edited or
  restyled), and *preserve, never drop* is broken for the structure.
- **Offer bold and italic as the base-14 variants through `/DA` alone.** Measured above: stored and painted in Helvetica. Useless
  for any reader that draws the appearance.
- **Embed a font for the styled runs.** Rejected for Latin text: size and licence cost for a face every reader already has. It
  is the likely route for the scripts Decision 2 leaves out, and is a separate decision.

## What is not decided

The owner's order was *an ADR, then the build*. This ADR is the first half: **the build is not done in the run that wrote it**,
because the work is not one change. It is an appearance writer with its own metrics, a wrapping owner, the `/RC` and `/DS`
reader and writer, the capture and invert halves of a restyle (ADR-0200's undo), the interchange round trip
(`annotationInterchange.ts`), the editor's range selection, and the two-reader proof — and a half-built version would put a
control on the screen that styles words in one reader only, which the owner's principles forbid (*never show an unfinished
screen*). Open for the owner: whether a script outside the base 14 should block the styles (Decision 2) or embed a face, and
whether the per-word editor may wait behind the box-level styles (bold and italic for the whole box, a fill, line spacing),
which need only Decisions 1 to 6 and none of Decision 7.

## Amendment, 2026-10-11: Decision 2 is superseded — a text box is set in a real font and embeds what it uses (the owner's K2)

The owner's K2 (the cloud bundle's resolutions, accepted): **text boxes use real installed fonts.** Decision 2's *the faces
are the base 14* and its rejected alternative *embed a font for the styled runs* are withdrawn together. What replaces them:

1. **The face is the one font picker's**, the same list the in-place editor and the Annotation font setting take (B3a): a
   family on this computer, a family Monstera bundles, or one of the base 14. The base 14 stay a choice and stay unembedded.
2. **A face that is not base 14 is embedded, subset to the characters the box draws**, by the resolver that already makes
   the in-place editor's subsets in a contained host (ADR-0172). A family whose licence forbids embedding is set in the
   resolver's stand-in, and the Properties tab says so in words, as the picker does.
3. **Decision 3's metrics come from the face itself**, read in the host through the resolver's own face reader, so the line
   a person saw break is still the line the appearance breaks, with one owner of where a line ends.
4. **A script outside the base 14** (Decision 2's refusal) is drawn by the same route, since an embedded face can carry it.

Rejected: keeping the base 14 and listing installed fonts in the picker. A font chosen and silently drawn as Helvetica is the
defect this ADR's Context records of MuPDF's `/DA`, moved one layer up.

**Built: nothing of this amendment yet, 2026-10-11.** What did land in the same run is the part that does not need the
writer: the Annotation font setting stores a real family name (Helvetica, Times or Courier) chosen in the one picker, and the
picker offers only those three for a text box, so no family is offered that the writer would not set. The writer's half is
the appearance writer's font program (embedding a subset into the `/AP` stream's resources), host-side metrics for wrapping,
and the two-reader proof per face; it is owed and recorded as not built.

## Correction, 2026-10-13: a family whose licence forbids embedding is not offered (the owner's N12)

The amendment's Decision 2 says a family whose licence forbids embedding *"is set in the resolver's stand-in, and the
Properties tab says so in words, as the picker does."* The owner's N12 reverses the second half: *"Simply list the fonts that
are available and usable without all these descriptions."* The one picker now **leaves such a family out** of every group
built from the computer's list, and says nothing of any font beneath or beside its name: no licence sentence, no *looks
like*, no *partial*. So no sentence is owed in the Properties tab either, since nothing there can choose such a family.

What stays: the resolver's stand-in for a family that arrives by another road (a setting kept from before, or a document's
own font under *In this document*, which the owner keeps listed), and Decision 2's embedding of every family that is
offered. The first half of the sentence is still true; the second is withdrawn.
