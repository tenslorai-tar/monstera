# ADR-0242 — Edit object picks text by the block Edit text reads, and moves it as one

- **Status:** Accepted
- **Date:** 2026-10-14
- **Amends:** [ADR-0153](0153-edit-object-is-a-mode-on-the-page-and-a-placed-picture-is-one-of-its-objects.md) (Edit
  object is a mode on the page), whose unit was one object of PDFium's walk; and the note on `placePageObjectSchema`
  that moving several objects is several commands.
- **Decided by:** the owner's cloud run 4, Part 4 item E4: *"Text is selected as single words or even single letters
  (clicking 'overview' selected only the final 'w'). Select a line or paragraph block, as PDF-XChange does."*

## The mechanism

Edit object outlined every object of PDFium's walk, and a producer that positions each word, or each glyph, writes one
text object for it. So the unit a person could pick was whatever the producer wrote, down to one letter, and a press on
a word picked the topmost letter under the pointer.

## Decision

1. **The text unit is the block `document.textBlocks` answers**, the one Edit text opens. A text object in a block is
   outlined, picked, moved and removed with the rest of that block; a text object in no block stays one object. One
   answer to *what is a block*, read where Edit text reads it (B3a): two tools that disagreed would be two opinions
   about the same words. The page's three reads are taken at one version, ADR-0153 Decision 3's rule; a block read that
   is refused leaves the text as single objects, never the mode refused.
2. **A new command, `placePageObjects`, places several objects as ONE thing**: a page, the objects' indices, the
   group's box, a move and a scale. PDFium applies one page matrix to every object, scaling about the GROUP's
   lower-left corner and then moving, regenerates once and reads back once; the capture records every object's matrix
   and the undo puts each back. The note on `placePageObjectSchema` refused a list because *each would scale about its
   own box and the group would come apart*; a group anchor named on the command is what makes a list coherent, so the
   note stands for a list without one, which is still not offered.
3. **Text keeps PDFium's route** ([ADR-0240](0240-an-objects-placement-is-edited-where-it-is-drawn.md) Decision 4), so a
   block on a page whose fonts PDFium cannot write back is refused with the moved-text sentence, as one object was.
4. **A single object keeps `placePageObject`**, so a picture's or a lone word's command is the one it was.

## Rejected

- **Grouping by geometry in the renderer** (same baseline, touching boxes). A second opinion about blocks beside the
  one Edit text already holds, which would agree with it most of the time and pick a different block the rest.
- **Picking by line.** The owner allows either; the block is what Edit text opens, so a press in either tool names the
  same words.
- **Several `placePageObject` commands, one per object.** Several undo steps for one drag, one regeneration each, and a
  group left half moved when one of them is refused.
- **The block edit's `places`.** It lays the words out again, which writes the text a move must not write.

## Consequences

- `KEEPS_THE_OBJECT_WALK` and `WALK_NAMED_BY` take the new kind beside `placePageObject`.
- The renderer's editable object carries the indices it stands for; a removal of a block names all of them.

## Correction, 2026-10-19 — the block edit's placement is the route after all, by the operator writer (R11)

Decision 3 kept text on PDFium's route, and the last rejected alternative said a block edit's `places` *"lays the words
out again"*. That is true of PDFium's block writer and **not of the operator writer**: placing a block there carries each
line's `Tj`/`TJ` operators into the placed object verbatim — their codes copied byte for byte under the same fonts
(`replay` in `operatorEdit.ts`) — and empties the originals, so nothing of the text is written again. Measured exact on 13
font kinds (ADR-0240's correction of 2026-10-19). PDFium's route regenerated every text object on the page and refused
a move on a page whose fonts it cannot write back, which the owner met (R11). So Decision 3 is withdrawn: a picked block
is placed by `editTextOperators` with its words unchanged and a placement naming the group's box, which takes ADR-0243's
one matrix — the same placement `placePageObjects` meant. A line whose operators are quote operators (`'`, `"`) is laid
out again in its own font, as before; nothing else is.

## Correction, 2026-10-21 — withdrawn with Edit object

Edit object is withdrawn from the application by the owner's decision of 2026-10-21 (R20; ADR-0153's correction has
why). On the owner's brochure this ADR's route — a text object moved or recoloured through the block Edit text reads —
refused every move and a heading's colour change. The tool, its pick-by-block and the placement about a box are
removed. **Edit text is unchanged by it**: the block reading, the operator writer and their ADRs (0176, 0249, 0256)
are Edit text's own, and its behaviour on a document of this kind is measured separately (R20's check).
