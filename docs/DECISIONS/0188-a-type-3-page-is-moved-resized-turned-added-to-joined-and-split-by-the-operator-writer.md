# ADR-0188 — A Type 3 page is moved, resized, turned, added to, joined and split by the operator writer

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md) Decisions 4 to 6 (where
  an edit's object is placed, and what the writer changes) and [ADR-0180](0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)'s
  statement that a Type 3 page *says it does not move or add text yet*, which this removes.
- **Relates:** [ADR-0177](0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md)
  (the resolver's face for a word the page cannot draw).
- **Context:** Part B leftovers, the owner's R31: *R31 is NOT accepted as a limit: build it.* A Type 3 page gets move, resize
  by the sides, scale, turn, Add text, join and split, in the operator writer, through the same block command and placement
  fields as the PDFium writer (R30), not a second command shape. Written 2026-10-06.

## Is this the right question

*How does the operator writer apply `places` and `inserts`?* The premise is that those fields need new machinery. They
need less than that. Join and split are already edits of the block wire (ADR-0180 Decision 7): a join is one block with
the lower's words and the lower emptied, a split is a block each with the second moved. The operator writer already lays a
block out as paragraphs and sets words afresh, and it already inserts one object per block. What it lacks is exactly three
things: a way to carry a line it did not change somewhere else, a measure to lay out at, and a run to stand for a box that
is not on the page. Measured on the committed Chromium print, 2026-10-06, the writer's refusal of the fields was the only
thing standing between the editor's handles and a working Type 3 page, and a join of the two headings, which needs none of
the three, was refused for a different reason that the same change fixes (Decision 5).

## Decision

1. **A block that is placed, or given a measure, is set again whole, under one `cm`** (`placementMatrix`, `replay`). Every
   old line is emptied as an edited line is, and the block is written as one `q M cm BT … ET Q` where `M = C · P · C⁻¹`:
   `C` is the CTM the block was drawn under, `P` is the PDFium writer's own placement (scaled about the block's top left,
   turned about the centre of what that leaves, then moved), so a point of the block ends at `C·P` of where it was and the
   writer composes nothing the page's own matrix does not already say. A line the person did not change is carried **as
   its operators were** (`replay`): each operator at the origin it was drawn from, with its own codes, its own kerning, the
   spaces between its runs, and the settings it was drawn under, written in hexadecimal so no byte past ASCII is written. A
   line the person did change is set afresh as words, as before. Placing a block therefore changes no glyph of a line that
   was not edited, and needs no width the font does not state.
2. **A measure is the block's left origin plus the width given** (`blockRight`), as the PDFium writer takes it from the
   block's ink, and it sets every paragraph again, since the lines the old measure broke are not the lines the new one does.
3. **An added box is an edit of a run that is not on the page.** The writer makes an operator for each (`seeds`): upright,
   at the box's left and baseline, in its size, with its colour as a settings instruction and its family, weight and slant
   asked of the resolver's face as a mark's are. The layout that writes every block writes it. It goes **at the end of the
   content**, after the `Q` that closes each `q` the page never closed (said once, however many boxes there are), under the
   CTM the page is drawn under once they are closed (`contentEnd`, which reads it from the one scanner that owns the `q`
   and `Q` rule). With no face bound, or no face that carries a word, the box is refused naming its characters, and the page
   is as it came.
4. **A line carried as it was needs no width of its own.** Its operators are placed by the origins they were drawn from, and
   the settings they were drawn under are said once where the operator after one was drawn under the same ones. A width
   is asked only for a turn's centre, and then of the line's own ink, which PDFium's reading gives.
5. **Lines only added below a block are placed after its last run's text object, not before its `BT`** (`textObjectEnds`).
   They were put before it so as to stay inside the marked content it continues, and after its `ET` is inside the same
   marked content and under the same graphics state. Measured 2026-10-06 on the Chromium print: a join of the two headings
   put the appended words in front of the heading they follow, MuPDF read them in that order (`A second heading in the same
   face. Monstera fixture heading.`), and the structural read-back, which asks that a block's words be one stretch of the
   reading, refused a correct join. The object follows a line break, since the text object it comes after ends at its `ET`
   and a `q` set against it would be one token (the first version wrote `ETq`, and MuPDF said `encountered syntax errors`).

## Limits stated now

- **A turn's centre is estimated for lines set afresh**: the extent of the lines the writer sets itself is taken from the
  block's old ink above and below a baseline, or 0.8 and 0.2 of the size, since no ink exists for a line before it is drawn.
  A carried line's ink is PDFium's.
- **A line with a quote operator, or a font the page lacks, is set again as words** where a block is placed, as before.
- **A block turned is no longer upright**, so editing it again says it is not edited in place (the PDFium writer's own
  rule). A person turns a block back with the handle, which needs no edit of its words.
- **`fit: shrink` with a placement is not combined**; a translation does not place.

## Rejected alternatives

- **A `cm` around each old operator.** Operators in one text object are positioned by what the ones before them advanced,
  and a `cm` cannot be set inside a `BT`, so each would be its own object and every operator after it would move.
- **Rewriting each old operator's `Tm` in place.** The same dependence: the operators after one are placed by its advance.
  The emptied operator keeps its advance for that reason (ADR-0176), and an operator set again in its place must too.
- **Keeping the refusal.** The owner's decision of 2026-10-06 (R31), and a person is never refused because of the font of
  their document.
