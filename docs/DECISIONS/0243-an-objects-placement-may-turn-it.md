# ADR-0243 — An object's placement may turn it

- **Status:** Accepted
- **Date:** 2026-10-14
- **Amends:** the placement commands `placePageObject`, `placeDrawnObject`
  ([ADR-0240](0240-an-objects-placement-is-edited-where-it-is-drawn.md)) and `placePageObjects`
  ([ADR-0242](0242-edit-object-picks-text-by-the-block-edit-text-reads.md)), which gain an optional turn.
- **Decided by:** the owner's cloud run 4, Part 4 item E6: *"Only 4 corner handles: add side handles and a rotate
  handle."*

## The mechanism

A placement said *scale about the lower-left corner, then move*, and each engine spelt that matrix itself: PDFium's
single-object placement, its group placement, and the MuPDF writer's page matrix. A rotate handle needs a third term,
and adding it to three spellings is three chances for the engines to mean different placements by one command.

## Decision

1. **The placement commands carry `rotateBy`**: degrees, counter-clockwise as PDF measures them, bounded as
   `blockPlaceSchema`'s `rotate` is. Absent is none, so every placement written before means what it meant.
2. **One matrix, in one module** (`objectPlacementMatrix.ts`): scaled about the box's lower-left corner, turned about
   the centre of the box that scale left, then moved. Both engines apply it, PDFium by `FPDFPageObj_Transform` and the
   MuPDF writer by `q M cm … Q`, so a command means one placement whichever writer holds the object (B3a).
3. **The renderer turns about what SHOWS.** The engines turn about the box they hold, which for a clipped picture is not
   its window's; the renderer adds the move that puts the window's centre back, `(R − I)(c − v)`, as it does for a
   resize ([ADR-0240](0240-an-objects-placement-is-edited-where-it-is-drawn.md)'s E3 addendum).
4. **A placed picture is not turned.** Its writer is the annotation one, whose placement is a rectangle; it keeps its
   resize handles and has no rotate handle, rather than one that does nothing.

## Rejected

- **A matrix on the wire.** The anchor needs the engine's own box, which only the kernel holds; the reason
  `placePageObjectSchema` carries an intent stands.
- **Turning about the box's lower-left corner**, the scale's anchor. A turn a person drags spins an object about its
  middle; a corner turn would throw it across the page.

## Correction, 2026-10-21 — withdrawn with Edit object

Edit object is withdrawn from the application by the owner's decision of 2026-10-21 (R20; ADR-0153's correction has
why). The turn, its handle and the one placement matrix (`objectPlacementMatrix.ts`) served only its object commands
and are removed with them.
