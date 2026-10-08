# ADR-0185 — A line of several objects is read and written as one line

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** [ADR-0181](0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md) Decisions 3 and 5 and
  its first stated limit (*a line that runs both ways and that no one face carries is written as several objects and reads
  back in drawing order*), which this removes. `docs/ARCHITECTURE.md` §3's in-place editing row.
- **Relates:** [ADR-0130](0130-a-documents-size-never-refuses-an-action.md) (the join of glyph objects into runs),
  [ADR-0049](0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md) (the grouping is ours),
  [ADR-0179](0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md) (a block's words are its
  runs' text, in the order of its lines' runs).
- **Context:** Part B leftovers, the owner's R42: *a mixed line that no single font carries must not reorder when edited.
  Keep the visual order across the several objects.* Written 2026-10-06 against ADR-0181's own limit, which said the line
  *reads back in drawing order and an edit reorders its parts*.

## Is this the right question

*How do we write the objects of a mixed line so that a text page reads them in the order typed?* We cannot. Measured
2026-10-06 on PDFium 155.0.8044.0's Linux build, three one-line pages of Helvetica objects `AAA` and `BBB`: drawn
`AAA` then `BBB`, drawn `BBB` then `AAA` (the stream the other way round), and drawn with the second a little lower, all
read `AAA BBB`. A text page reads a line's objects **by position**, and runs a bidirectional pass over the whole line it
has gathered, so the order of the content stream cannot carry the order typed.

The question is therefore two, and ADR-0181 asked neither of them:

- *What is the unit that the order typed is a property of?* The **line**. The algorithm's reordering is of the whole drawn
  line (rules L1 and L2). ADR-0181 reordered each OBJECT's reading, which is right for a line in one object and wrong for
  one in several: measured, a line the editor wrote in two objects, `Hello مرحبا العالم`, was read back as
  ` مرحبا العالمHello`, the space on the wrong side of the Arabic and the Latin word at the end, because the space is at the
  edge of the Arabic object and each object was turned back alone. The corrupt reading is what an edit then diffed against
  and wrote, so an edit moved the parts.
- *Is the line written in the order it is seen?* It was written in the order it was typed whenever it spanned more than
  one run: a coloured Latin word in an Arabic sentence is a run of its own, the layout set its pieces left to right as
  typed, and `Hello` came out at the left of an Arabic sentence that began with it. Measured: the sentence's first word
  stands at the right of an Arabic line, so the page showed the line wrongly, and the second edit wrote the corrupt
  reading back.

## Decision

1. **A line is read as one line** (`bidiLine.ts`, `logicalLine`). The runs of a line, each with the glyphs it draws in the
   order they are drawn (`drawn`, what the text page read with `readBackOf` undone), are put left to right by where they
   are, their glyphs concatenated, the line's direction taken by its majority (`lineDirection`, as before), and the line as
   typed is that string reordered by the algorithm. Each run's text is the part of the line as typed that its glyphs
   became, and the runs are returned in the order of those parts, so joining their texts is the line as typed and an edit
   names runs by the words they hold. `reorderedFrom` is the one implementation of the reordering, answering the text and
   where each unit came from, so the permutation and the text cannot be two readings of it (B3a).
2. **The line is read in the host, once, by the reading the editor is answered from and the edit diffs against**
   (`readInLineOrder`, `readWalk`): `textRuns` and `layOutBlocks` both take it, so the words a person is shown for a line
   and the words an edit compares what they typed against are one reading's. The runs keep their slots in the page's list,
   so nothing about the wire changes: a line in the order typed is a line whose runs come in that order, which the block
   grouping already took (*the order within a line is the runs' order*).
3. **Objects that run opposite ways are two runs** (`joinRuns`). A run is a stretch of one direction, so that a line can be
   named by whole runs: `world` and the Arabic after it, both unmarked and abutting, were one run, and a coloured `Hello`
   between them in the line as typed split it. Digits, spaces and punctuation have no direction and join either. A joined
   run's text is the reordering of all its glyphs together, found once the run is whole.
4. **A line's pieces are found by position** (`piecesOf`, one function for the grouping and for the reading). The sweep for
   a gap between neighbours went in list order, which for a line in the order typed visits a right-to-left phrase before the
   word beside it and measures from the wrong side: measured, the three runs of one line were two pieces 47 pt apart. A
   piece keeps its runs in list order, and pieces keep the order their first run came in, which is the order a person Tabs
   through them.
5. **A row that runs both ways is written in the order it is seen** (`visualUnits`, `writePieces(…, forced)`). The row's
   pieces (the words of one run and one mark each) are cut where the line changes level and where a piece ends, set left to
   right as a reader sees them, and each stretch is drawn in the direction the line runs there, which its own letters do
   not decide (a stretch of digits, or of marks and neutrals, has none). A stretch of white space alone is taken into its
   neighbour from the same piece, since a text page reads an object of spaces alone as nothing. Each stretch begins where
   the one before it ended, **measured on the scratch page** (`endOf`, the loose boxes of a copy of the last object, alone):
   the plan's width adds the advance of each letter drawn alone, which for joined Arabic is wider than the joined letters
   are, and the live page cannot be read, because a text page leaves out a character lying exactly over another and the
   old line is still there.
6. **A line is rewritten from where it begins**, the leftmost run's origin and not the first run's: in the order typed a
   right-to-left line's first run is at its right edge.
7. **A line of as many letters one way as the other has no direction in what a page stores.** It is typed in one direction
   and read in the other when its first letter drawn differs from its first letter typed (`مرحبا World` is read
   `World مرحبا`): the page is the same, which is the point, and writing what was read changes nothing. Measured by the
   proof.

## Limits stated now

- **A run whose glyphs are split by another's in the line as typed** (a style change in the middle of a phrase of the other
  direction, so that the run's stretch is not one stretch of the line) cannot be named by whole runs. Each run then keeps
  the text it has read alone, in the order the page gave it: the document is as it was, the editor shows each run's own
  words, and an edit of the line writes what the person typed. Decision 3 makes it rare for what this editor writes and for
  a producer that starts a run at each change of direction; a producer that does not can still produce it.
- **A line in one object that holds both directions** (the one-object rule of ADR-0181 Decision 5) is read as before.
- **The plan's widths for Arabic are the letters drawn alone**, so a paragraph of Arabic wraps earlier than it need. Where a
  row is written, its stretches are placed by where the pen ended, so the page is right; the wrap is the next decision's
  (ADR-0186 measures the plan by the drawn forms).

## Rejected alternatives

- **Write the objects in the order typed, with positions in the order seen.** Measured above: a text page reads by position.
- **Read each character's place and sort by it, with no model of PDFium's reading.** The character a text page answers for a
  mirrored glyph is already the mirrored one, and which of the two is right depends on the line; the model is fitted and
  tested and the geometry is still used to put the runs in order.
- **A `drawn` field on the wire so that `main` finds the line.** The host owns the glyphs; `main` would hold a second copy
  of the reading and a larger run (the host pipe's bound is by the smallest run).
- **Keep the limit.** The owner's rule: a person is never refused because of their document, and an edit that corrupts a line
  while reading as a success is worse than a refusal.
