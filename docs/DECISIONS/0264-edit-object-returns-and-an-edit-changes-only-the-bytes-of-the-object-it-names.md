# ADR-0264 — Edit object returns, and an edit changes only the bytes of the object it names

- **Status:** Accepted
- **Date:** 2026-10-23
- **Decided by:** the owner, approving the local agent's design on 2026-10-23 (cloud run 17): *"Last time, PDFium wrote
  the WHOLE page again after any change … This time nothing writes the page again. Every edit changes only the bytes of
  the one object it names, in the page's own content, and every other byte is copied as it was. PDFium only reads the
  page (to find objects and draw outlines); it never writes."*
- **Supersedes, where they differ:** [ADR-0153](0153-edit-object-is-a-mode-on-the-page-and-a-placed-picture-is-one-of-its-objects.md),
  [ADR-0240](0240-an-objects-placement-is-edited-where-it-is-drawn.md),
  [ADR-0241](0241-a-ribbon-menu-may-run-its-last-choice-from-its-face.md),
  [ADR-0242](0242-edit-object-picks-text-by-the-block-edit-text-reads.md),
  [ADR-0243](0243-an-objects-placement-may-turn-it.md) and
  [ADR-0244](0244-arrange-reorders-an-object-through-pdfiums-own-list.md), all withdrawn on 2026-10-21 (R20). What each
  decided and this one keeps is named below; the rest stays withdrawn.
- **Amends:** `docs/ARCHITECTURE.md` §7's `Placement`: the context menu gains the `object` context again, and a ribbon
  placement may again declare `menuRuns: 'last'`.

## Why it was removed, and what is different now

R20 (2026-10-21) removed Edit object because on a design tool's brochure it refused a heading's colour change and every
move of a body text object, and took seconds to pick and apply. The mechanism behind every refusal was one call:
`FPDFPage_GenerateContent`, which writes the page's whole content stream again from PDFium's objects after any change to
one of them. Every text object on the page is re-encoded, and a font PDFium cannot write back loses text, which the
read-back (ADR-0169 Decision 2) then refuses. A move of a picture failed because of a font it does not use.

**This time nothing writes the page again.** PDFium reads the page, to list its objects and draw outlines, and never
writes. Every edit is a splice into the page's own content by MuPDF: the bytes of the one object it names are changed,
moved or removed, and every other byte is copied as it was. A font is never asked anything by an edit that does not
change words.

## Decision 1 — which writer handles each kind

| object | move / resize | recolour | forward / backward | delete |
|---|---|---|---|---|
| picture, shape, group (form XObject) on the page | `editDrawnObject`: the object's own bytes wrapped in one placement, `q M cm … Q` | shapes: a colour set inside that same wrap | `editDrawnObject`: the object's bytes moved one step, carrying its drawing state | `editDrawnObject`: the object's bytes removed |
| a text block (the block Edit text opens) | `editTextOperators` with a placement: the block's own text instructions carried as they are, fonts untouched | `editTextOperators`: the block's instructions carried as they are with a colour set | `editTextOperators`: the block carried as one, to its new place in the order | `editTextOperators`: the block emptied |
| a picture placed with Comment › Image (a stamp) | `placeAnnotation` | — | — | `removeAnnotation` |

**One drawn-object command with four edits, not four commands.** `editDrawnObject` names a page, the object (by kind and
ordinal, Decision 2), the box PDFium listed for it, the version that listing was read at, and one `edit`: `place`,
`recolor`, `arrange` or `delete`. The four edits share their naming, their check that the object is the listed one, their
read-back and their undo, and one writer owning them is B3: four kinds would be four declarations, four routes and four
places to keep the naming in step.

**Text goes to the operator writer on every page** a block was read from as it is (not unpacked, ADR-0232), whatever the
page's fonts, as an Edit text placement already does (ADR-0240's correction of 2026-10-19). Never to PDFium's block
writer, which regenerates the page.

## Decision 2 — an object is named by kind and ordinal, checked against the box PDFium listed

Kept from ADR-0240: `textOperators.ts`' one pass numbers what a page draws as PDFium does — PDFium's k-th path, image,
form or shading object is the page's k-th instruction of that kind outside every form, where a path runs from its first
segment to the paint that ends it and `n` makes no object (measured on three pages, ADR-0240's table). The renderer
reads the kind and the box off PDFium's listing (`document.pageObjects`) and derives the ordinal from the listing's
order; the writer finds the object by the same rule and refuses it, in words, where it does not land on the listed box.
A different object is never edited in its place.

## Decision 3 — what each drawn edit writes

- **place.** A move and a scale on each axis about the listed box's lower-left corner (a side handle scales one axis).
  The instructions that draw the object are wrapped in `q M cm … Q`, `M` the page-space change expressed in the space the
  object is drawn in (`CTM × T × CTM⁻¹`). A picture shown through a clip window that holds nothing else moves with its
  window (ADR-0240's E3 addendum, kept). **A shape that also sets the clip** (`W` before its paint) is not wrapped,
  since `Q` would end the clip early for everything after it: its own coordinates are rewritten in place, every segment
  operand taken through `M` in its own space, so the shape and the clip it sets move together and nothing else changes.
- **recolor.** Shapes only. The path is drawn inside `q <colour> … Q`, the colour set for the channels its paint uses:
  fill for `f`, `F`, `f*`; stroke for `S`, `s`; both for `B`, `B*`, `b`, `b*`. A shape that also sets the clip is drawn
  twice: once painted in its colour inside `q … Q` without the clip, then once more as `W n`, so the clip it sets for
  what follows is exactly the one it set before.
- **arrange.** The object moves one step in the page's drawing order: past the next object in PDFium's order that
  overlaps it (forward), or before the previous one that does (backward). The renderer names that neighbour, since it
  holds every object's box; the writer moves the object's **unit** — its instructions widened over every `q … Q` and
  `BDC … EMC` that holds it alone — to just after (or before) the neighbour's unit. The state it was drawn under is
  carried with it inside a `q … Q`: a graphics state that sets every `gs` parameter to its initial value, the initial
  value of every other parameter the object's instructions do not set, the instructions in effect where it stood (the
  same `settings` list Edit text replays), the clip windows it stood in, and the CTM it stood under. So it draws exactly
  as it did, one step higher or lower.
- **delete.** The object's instructions are removed. A shape that also sets the clip keeps its path and loses only its
  paint (the paint becomes `n`), so what follows is clipped as before.

## Decision 4 — the one case that cannot keep the page intact is said in one line

Bringing an object forward (or sending it back) into a place where the page clips drawing to an area that does not hold
the object's box would crop it. Then the edit is refused and the page left as it was, with one plain line:
*"This object would be cut off there, so it was not moved. The page is as it was."* Every other refusal of this command
is a defect, counted by the check in Decision 7.

## Decision 5 — the text block's four edits through the operator writer

- **move / resize:** Edit text's own placement (`place.move`, `place.scale`), which carries every line's operators as
  they were under one `cm`. A text block is resized by its corners only, keeping its proportions: the operator writer's
  placement is one factor, and a side handle on text would ask for a new measure, which lays the words out again.
- **recolour:** a block whose words are unchanged and whose one mark sets only a colour over all of them is carried as
  a placement with no move is: each line's operators as they were, with the colour set before them. Their glyphs, codes,
  kerning and fonts are the page's. Edit text gains this too, since a whole-block colour change sent to this writer is
  the same edit.
- **forward / backward:** a placement may name `arrange`, the neighbour it goes past and the direction. The block's
  lines are carried as for a placement with no move, and the new object is put at the neighbour's unit with its state
  carried by the same function a drawn object's arrange uses (one function, B3a).
- **delete:** the block's words become none: every operator of it is emptied, its advance kept where a later operator
  is placed by it.

## Decision 6 — undo is the checkpoint

`editDrawnObject` declares `undo: 'checkpoint'`, as `editTextOperators` does: the whole-document copy restores the
page's content stream. One stream after the edit, ADR-0176's rule.

## Decision 7 — proven before the build

Before any UI, a kernel check (`proof:editobject`) runs every edit on every object of the brochure-shaped document
(`scripts/research/brochureFixture.mjs`, the fixture `brochureEditWalk.mjs` built) and of the PDF fixtures in the
repository, through PDFium's listing and the MuPDF writer, as the application does. It counts refusals, and it renders
every page before and after with MuPDF and requires every pixel outside the edited object's own box, before and after,
to be identical. **The UI is built only if the brochure's refusal count is 0.** The owner's corpus is not in the
repository; the local agent runs the same check over it.

## Decision 8 — the surface

- **One mode on the page**, in the tool slot, Edit text's shape (ADR-0153 Decision 1, kept). Edit › Edit object is a
  ribbon menu of four filters, *All*, *Text*, *Images*, *Shapes* (ADR-0153 Decision 2's table, kept), whose face runs
  the filter chosen last in this window (ADR-0241's `menuRuns: 'last'`, reinstated with its 2026-10-14 corrections: the
  face's name is the menu's caption, the member's title its description).
- **Outlines on the objects of the chosen kind**; a press selects one; a drag moves it; corner and side handles resize a
  drawn object, corner handles a text block; a picture placed with Comment › Image keeps its own writer.
- **Properties** shows the selected shape's or text block's colour, Bring forward, Send backward and Delete. The
  `object` context menu carries the same, drawn from placements (ADR-0153 Decision 5, kept).
- **One selection**, one object on one page at one version (ADR-0153 Decision 4's rule): a place or a recolour keeps
  the walk and re-selects the same object by kind and ordinal; an arrange or a delete drops the selection.

## Decision 9 — the speed plan

- The Edit helper starts when the Edit tab is first shown (`startEditingHosts`, already built). While a page's objects
  are being read, the page says *"Finding objects…"* at once.
- One read per page: its objects, its text blocks and its marks, together and at one version, the page on show first.
- A press selects from the outlines already in the window, with no trip to the helper.
- A drag moves a lifted copy of the object's own pixels. On release the copy stays in its new place, in its final look,
  until the page draws the saved version, through ADR-0257's one holder per page (*held until replaced*).

## Not in this version

Changing words (that is Edit text); rotating objects; selecting several objects at once; recolouring pictures; editing
inside a group (a group moves as one).

## Rejected

- **PDFium's object calls** (`FPDFPageObj_Transform`, `FPDFPage_RemoveObject`, `FPDFPage_InsertObjectAtIndex`) followed by
  `FPDFPage_GenerateContent`. R20's cause; every edit wrote every text object again.
- **Four drawn commands.** Decision 1.
- **The writer choosing the arrange neighbour.** It would need every object's box, including text objects' widths, which
  PDFium's listing gives the renderer and the content stream alone does not give the writer.
- **Reordering by PDFium's list without overlap** (ADR-0244's one place in the list). On a page of 88 objects most steps
  pass an object that does not overlap, and a press changes nothing a person can see.
- **Resetting the drawing state with nothing but operators.** `gs` parameters (opacity, blend mode, soft mask) have no
  operator of their own; only an `ExtGState` resets them, so the writer adds one plain graphics state to the page's
  resources when an arrange needs it.
