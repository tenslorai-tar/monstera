# ADR-0187 — A scan's edited words are covered where the ink is, with the paper that is there

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** [ADR-0181](0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md) Decision 9 (*covers the
  picture under the words it replaces with a rectangle of the page's own paper colour*) and the limit the ledger recorded
  for it: *ink outside a recogniser's box, and a gradient behind a word, show*.
- **Relates:** [ADR-0179](0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md) (invisible
  text over no picture stays invisible).
- **Context:** Part B leftovers, the owner's R44: *a scan edited over a paper-colour cover; ink outside the recogniser's box
  and a gradient behind a word must not show through; cover what the edit replaces, sampled from the real background, and
  handle a gradient.* Written 2026-10-06 against the cover ADR-0181 built.

## Is this the right question

*How big should the margin round the recogniser's box be, and how should the colour be averaged?* Both halves of that are
the wrong question. The margin (1.5 pt) was a guess about how far a scanned word's ink runs past a box the recogniser
drew from its own estimate, and any fixed guess is wrong on some page: too small shows the tail of a descender, too large
covers the neighbouring line. And a median of the ring answers *what colour is most of the paper here*, which is a colour
and not a shading. The questions that have an answer are:

- *Where does this word's ink end?* The raster says, so the cover is grown from the recogniser's box through the ink that
  touches it.
- *What is the paper at each place behind it?* A page's shading is, across one word, a plane, and a plane can be fitted to
  the ring round the word and read at any point of it.

## Decision

1. **The cover grows from the recogniser's box through the ink that touches it** (`inkExtent`). A pixel is ink where it
   differs from the paper at that place by more than 32 in any channel. Ink joins across a gap of one point at most (the
   space inside a letter, not the space between two words), and the growth is capped at five points sideways and at a
   third of the box's height, at least two points, up and down, so that a neighbouring line the stroke happens to touch
   cannot be taken whole. The cover is the grown box with a pixel to spare, because the soft edge of a stroke is not ink by
   the threshold and is not paper either.
2. **The paper is a plane per channel, fitted to the ring** (`paperAround`): least squares through the pixels of the ring
   round the box, with the pixels that are not paper (a neighbour's ink crossing the ring) left out and the plane fitted
   again, starting from the median so that the first rejection is by distance from what most of the ring is. The paper that
   ink is judged against, and the paper a cover is filled with, are the same plane (B3a).
3. **Flat paper is one rectangle, as before; shaded paper is a grid** (`paperCoverFor`). Where the plane changes by 14 or
   less across the box in every channel the cover is one rectangle of the plane's colour at its centre. Otherwise it is cells
   six points wide at most, up to sixteen across and six down, each the plane's colour at its centre, and each cell overlaps
   its right and lower neighbour by a pixel so that no seam shows what is under it.
4. **The cover is worked out on the raster and written in page space**, so the writer reads the page's own mapping and
   inverts it (`coversRoundBoxes`): three corners of the page carried to the device give the affine map and its inverse,
   rotation included. Assuming the page upright puts the paper beside the ink on a page turned a quarter, which the proof
   pins.

## Limits stated now

- **Shading that is not linear across one word** (a sharp edge of a shadow, a fold line through the word) is covered by the
  best plane through the ring, which is wrong by the part that is not linear. The tolerance is the point at which a
  difference reads as a patch, and a fold through a word is a limit of a rectangle cover.
- **Ink that touches the word's own ink and is the next line's** (a descender touching the line below) is covered within the
  cap and no further. A cover that took the neighbour whole would be the worse error.
- **A word on a picture that is itself not paper** (a photograph with text over it) has no paper to read, and the plane
  through its ring is the picture's average there. The edit is still never refused, and the picture is never changed.

## Rejected alternatives

- **A larger fixed margin.** It covers more of the tail and the neighbouring line together, and the right size differs by
  scan.
- **A cover that is the picture's own pixels resampled over the word (inpainting).** It would follow a texture, and it
  changes the picture, which is the one thing this decision keeps: nothing is dropped and one Undo puts the page back.
- **A median per strip round the ring instead of a plane.** Measured on the proof's own fixture, a neighbouring mark
  inside the ring made a strip's median ink and the cells took a colour between ink and paper; a plane fitted with the
  outliers left out does not.
