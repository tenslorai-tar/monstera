# ADR-0196 — PowerPoint export may be editable, from the page's own text, images and shapes

- **Status:** Proposed — **nothing is built; this waits for the owner's yes** (the owner's order of 2026-10-07, item 6).
- **Date:** 2026-10-08
- **Would amend:** [ADR-0072](0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md) — its PowerPoint row,
  *one slide per page, and each slide IS the page*, and the sentence that the text is part of the picture and not editable.
- **Found by:** the owner's question, 2026-10-07 — *could Claude make the PowerPoint export editable?*

## Context

Today a slide is one picture of the page (`presentationDocument.ts`): it looks right and nothing in it can be edited. The
question was whether Claude could make it editable. **The question has a false premise worth stating first: an AI is not what
makes a page editable.** A PDF that was made on a computer already says, for every word, where it is, in which font and size
and colour. Monstera reads exactly that for Edit text (`engine/text-runs`) and for the word boxes. A page can therefore be
written as a slide with real text boxes, real pictures and simple shapes **deterministically, privately, offline and for
nothing**. Claude (or any recogniser) is only needed where the page has no text to read: a scan.

## Proposed decisions

1. **Editable, native, no AI.** For a page with text, the slide is built from the page's own content:
   - each line (or paragraph, where the lines join by the existing `textRunJoin`) becomes a PowerPoint **text box** at its
     position, with the font, size, colour, bold and italic the page states, wrapping off so it cannot reflow onto its
     neighbour;
   - each picture becomes a real **picture** at its box, from the image's own bytes — not a crop of a rendering;
   - each rectangle, ellipse, line and filled polygon becomes a **shape** with its fill and stroke; anything more
     complicated (a clipped path, a shading, a pattern) is kept as a **picture of that object** rather than dropped (*preserve,
     never drop*), so the slide is never missing something the page had.
2. **A scanned page is recognised first, then written the same way.** A page whose content is one picture and no text goes
   through the OCR the person already chose (Tesseract, Azure or Claude, ADR-0057), and its words become text boxes.
   **Open question for the owner:** a scan's original picture cannot be taken out from under the words. Either the picture
   stays as the slide's background and the text boxes sit over it (it looks right, the text is editable, and an edit shows the
   old word beneath), or the picture is dropped and only the text boxes remain (clean to edit, loses any drawing). The
   proposal is the first, with the recognised text boxes set to *no fill*, and a plain sentence in the dialog.
3. **The picture export stays, as *Exact look*.** The dialog gains a choice, **Editable** (the default for a page with text)
   and **Exact look** (today's export, unchanged), because a deck made to be shown is better as a picture and the
   owner's own words were *whether it could be made editable*, not *instead*.
4. **The pages are read in the contained host, never in `main`** (invariant 20). Text runs are already a host read. What is
   new is **two reads the host does not have**: a page's picture objects with their bytes and matrices, and a page's simple
   path objects with their segments, fill and stroke. They are new channels in `packages/contract`, in the PDFium host's
   routing table, bounded the way every list is (`schemaBound.ts`) — which is a B4 change and its own ADR when the owner says go.
5. **Writing stays this build's** (ADR-0072): `presentationDocument.ts` grows from a picture slide into a slide of `p:sp`
   (text), `p:pic` and `p:sp` with `a:prstGeom` / `a:custGeom` (shapes). No library is added.

## What it will and will not do — stated so nobody expects more

- **Fonts are named, not embedded.** A slide names the page's font; PowerPoint uses it if the viewer's machine has it and
  substitutes the nearest if not, so line breaks can differ from the page. With wrapping off a word never lands on another.
- **Reading order is the page's drawing order**, not a reflowed layout: this is a slide that looks like the page with the
  words editable, not a re-typeset presentation.
- **Not guaranteed to match to the pixel.** *Exact look* is the guarantee of that.

## Estimate (read from the code on 2026-10-08; not measured by building it)

| Piece | Work |
|---|---|
| Two new host reads (picture objects with bytes; simple path objects), contract entries, bounds, their own ADR | about 700 lines and their proofs |
| Page model: runs, pictures, shapes to one slide model, with the fallbacks that keep every object | about 600 lines |
| Slide writer: text boxes, pictures, shapes in `presentationDocument.ts` | about 900 lines |
| Scanned pages: the existing OCR into the same model | about 300 lines |
| Export dialog: Editable / Exact look, its text and its help article | about 300 lines |
| Proofs with controls: round trip through the written package, positions and runs equal; a control that fails without the fix; the fallback case; a scan | about 500 lines |

**Roughly 3,300 lines and four to six working days**, of which the two host reads and their ADR are the part that carries
risk. Not estimated, because it cannot be from here: how PowerPoint itself lays out a given file — that is the owner's to open
once a build exists.

## Questions for the owner

1. **Yes or no to building it** as above.
2. **Scans:** the picture stays under the recognised text (proposed), or only the text boxes?
3. **The default** when the dialog opens: *Editable* for a page with text (proposed), or *Exact look* as it is today?

## Rejected alternatives

- **Claude reads every page and writes the slide.** It sends the document's pages to a third party for what the file already
  states, costs money per page, and answers positions *approximately* by Anthropic's own word. A page is never sent to a
  service to learn what it contains when the file says so.
- **Laying the existing Word export's text over the picture.** Draws every word twice (ADR-0072's own reason).
- **Only text, no pictures or shapes.** Drops what is not text — *preserve, never drop*.
