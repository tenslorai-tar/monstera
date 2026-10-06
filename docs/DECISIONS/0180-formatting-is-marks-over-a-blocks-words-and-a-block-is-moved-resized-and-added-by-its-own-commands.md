# ADR-0180 — Formatting is marks over a block's words, and a block is moved, resized and added by its own commands

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row (what an edit may say about how its words are set, and
  the three commands that act on a block rather than on its words). Extends the block wire of
  [ADR-0142](0142-a-text-edit-carries-one-list-of-objects-and-one-text.md) and
  [ADR-0179](0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md) with two optional
  fields, and adds `transformTextBlock` and `insertPageText` beside `editTextBlock` and `editTextOperators`.
- **Relates:** [ADR-0153](0153-edit-object-is-a-mode-on-the-page-beside-edit-text.md) (Edit object moves, scales and
  removes whole page objects), [ADR-0173](0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
  (a word set in another face is its own piece), [ADR-0156](0156-spelling-is-reviewed-a-word-at-a-time-beside-the-page.md)
  (spelling), [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
  (the second writer).
- **Context:** Part B Phase 3, the brief's *tools: formatting (family, size, colour, bold, italic, underline, alignment,
  spacing, super/sub, lists); add page text; move/resize/rotate/delete with handles, split/join; right-click menu with
  spelling; shortcut for Edit text; Tab inserts tab; one refused page doesn't end the mode; click block to block never
  loses typing*, and the owner's R15, *resizing a block*.

## Is this the right question

The brief lists tools, and the question underneath is *what may an edit say?* Today an edit says **words**: a block's
lines, the text typed, and the style each word gets is decided by the writer from the run it came from (ADR-0179). A
bold button cannot be added to that without a place to say *these words, bold*. And three of the tools (move, resize,
rotate) are not about words at all: sending them as an `editTextBlock` with the same text would make the writer re-set
every line to say nothing new, and the read-back would refuse it as *changed nothing*. Two premises are checked rather
than taken:

- *Edit object already moves things.* It moves **one object**, and a block is many (a run per style, a line per run, a
  glyph per object on some pages). A person who drags a paragraph must move all of it, wrapped as it is, by one command,
  or the first undo puts back half.
- *Formatting is a style on a run.* It is a style on a **span of the person's words**, which crosses runs, starts
  mid-word and is not the run's. The run is the page's; the span is the person's.

## Decision

1. **Formatting is `marks` over the block's text.** `editTextBlock`'s and `editTextOperators`' block entry gains an
   optional `marks`: a list of `{from, to, set}`, `from` and `to` UTF-16 offsets into that entry's `text`, `set` any of
   `bold`, `italic`, `underline`, `size` (points, absolute), `colour` (RGB), `family` (a family name the resolver knows)
   and `rise` (`superscript` or `subscript`). A mark says what the words ARE after the edit, not what changed, so an
   edit that re-sends the block's own formatting is idempotent, and a word with no mark keeps the style of the run that
   wrote it (ADR-0179). Marks are validated by `blockEditAgrees`: ordered, non-empty, inside the text, at most
   `MAX_BLOCK_MARKS` (invariant L11), never overlapping.
2. **A paragraph says how it is set by `paragraphs`.** A second optional field, one entry per paragraph of the text:
   `align`, `firstIndent` and `leftIndent` (points), `lineSpacing` (a multiple of the block's pitch) and
   `spaceBefore` (points). Absent means *as the read found it* (ADR-0179 Decision 5), so a block nobody formatted writes
   exactly as before.
3. **A list is words and an indent, not a structure.** A bullet or a number is a prefix of the paragraph's words (`• `,
   `1. `), set in the paragraph's own style, with a hanging `leftIndent`. The editor adds and removes the prefix in its
   text; nothing on the wire says *list*, because a page holds none.
4. **The writers apply marks as pieces.** A piece is a run of words of one run and one mark set (`planBlock`'s `Piece`
   gains it). PDFium: size by the object's matrix, colour by its fill, bold, italic and family by the resolver's face
   (`editPieces` is asked for that style and the run's own font is not preferred), underline by a filled rectangle
   under the piece, `rise` by a smaller size and a baseline offset. MuPDF (Type 3 pages): colour, size, underline and
   rise by the operators it writes; bold, italic and family by a face it adds (ADR-0177) or, where none is bound, the
   edit is refused naming the style it cannot set, writing nothing. A page is never refused because of its document
   being unusual; a **style** this process cannot set is named.
5. **A block is moved, resized and rotated by `transformTextBlock`, one command.** It names the block's runs as
   `editTextBlock` does and says `move` (points), `width` (a new measure: the block is laid out again at it, which is
   how a text box is resized), `scale` (about the block's top left, a size change) and `rotate` (degrees about its
   centre). The writer applies one matrix to every object of the block, so the block moves as the one thing it is, and
   a `width` re-plans it through `planBlock` at the new measure. Undo is a checkpoint, as `editTextBlock`'s.
6. **A page's new text is `insertPageText`.** A box on the page (left, baseline, measure) holding words and marks, set
   in a face the resolver picks for the family asked, written as a block of its own paragraphs. It is the same writer
   as an edit with no old lines, so it reflows, reads back and boxes characters no face carries as any edit does.
7. **Join and split are an edit.** Two blocks are joined by one `editTextBlock` entry naming both blocks' runs, in
   reading order, with the joined paragraph's text; a split is an entry per half. The grouping is derived on every
   read, so nothing is stored: a joined pair reads as one block only while its lines sit as one block does, and the
   command moves the lower one up to the pitch to make them do so.
8. **The editor's keys are the person's.** Tab inserts a tab (a run of spaces to the next stop of the block's own
   measure, since PDFium text sets no tab), Escape ends editing, and a click on another block writes the open one first
   and opens the next without losing what was typed, as one ordered sequence; a refused page leaves the mode on and says
   so at that page.

## Rejected alternatives

- **A style per run on the wire.** Runs are the page's objects and a person's span crosses them; a mark list is the
  person's selection and survives a reflow, which re-cuts runs.
- **Formatting as a separate command from the words.** A word typed and bolded in one gesture is one change, and two
  commands would be two undo steps and two reflows of one paragraph.
- **Move as page-object commands over the block's objects.** One command per object is N versions and a half-moved
  block between them.
- **Resize as scale only.** A text box's width is what a person means by resizing it; scale is the corner handle's.
- **A stored grouping for join and split.** Grouping is geometry (ADR-0049); a stored override is a second opinion
  about what a block is (B3a).

## Correction, 2026-10-06: placement and added text ride the block wire; there is no `transformTextBlock` or `insertPageText` (Decisions 5 and 6)

Decisions 5 and 6 named two new commands. Building the first showed what each would cost and what it would do twice.

- **Each new command is a routing entry in seven places** (its declaration, the writer's spec, the host's channel
  schema, the remote switch, `typedBy`, the command log's prior table and the contract's union), and every one of them
  would carry the same block wire `editTextBlock` already carries, because a move that also reformats, or a box that
  also bolds, needs the paragraphs, the marks and the measure.
- **The layout is `layOutBlocks`' and a second command would call it a second way.** A resize is a layout at a new
  measure; an added box is a layout with no old lines. A separate command for either would duplicate the plan, the
  reflow, the read-back and the box for a character no face carries (B3a), or reach into them from outside.
- **Two commands are two undo steps.** This ADR rejected formatting as its own command for exactly that reason (*a word
  typed and bolded in one gesture is one change*); a box dragged and widened in one gesture is the same.

So the block wire gains two more optional fields, absent meaning nothing placed and nothing added, and a command that
sends neither is byte for byte what it was:

- **`places`**: per block, `{block, move?, scale?, rotate?, width?}`. `move` is points added to every object of the
  block; `scale` multiplies the block about its top left; `rotate` is degrees about its centre; `width` is the measure
  the block is laid out at (`blockRight` becomes `blockLeft + width`), which re-plans every paragraph even where its
  words are the same. They are applied after the layout, to every object the block ended as (its kept lines, the lines
  set afresh and the rules under underlined words), as ONE matrix per object, so the block moves as the one thing it
  is.
- **`inserts`**: per added box, `{left, baseline, measure, size, family?, colour?, text, marks?, paragraphs?}`. The
  writer makes one seed text object in the standard face the family names and lays the words out as an edit of that
  one run, so the box reflows, reads back and boxes a character no face carries as any edit does, and its marks are
  Decision 4's. An edit may hold only inserts.

A block rotated by `places` is no longer upright, and an upright block is what edits are offered for (the stated limit
the writer keeps); P4 reopens that.

Decisions 7 and 8 stand: join and split are an edit, and the editor's keys are ordered.
