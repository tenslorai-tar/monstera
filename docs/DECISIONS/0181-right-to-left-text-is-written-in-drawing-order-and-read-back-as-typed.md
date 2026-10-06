# ADR-0181 — Right-to-left text is written in drawing order and read back as typed, and the editor says what it cannot edit

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row (what the PDFium writer writes for a line that runs right
  to left, how a line is read back, and which kinds of text the editor names as not editable).
- **Relates:** [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md) (the one
  resolver, and `bidiOrder.ts`, the one reading of UAX #9),
  [ADR-0173](0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md) (a word its font cannot
  carry is its own piece), [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md) and
  [ADR-0177](0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md) (the second
  writer),
  [ADR-0180](0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)
  (the block wire, which P4 reopens for turned text).
- **Context:** Part B Phase 4, *the hard cases*: right-to-left and shaped scripts; rotated, slanted and vertical text;
  nested form XObjects; marked content kept; scanned pages recognised and then edited; a translated page on a Type 3
  font. The owner's rule: *a user is never refused because of their document, preserve and never drop, never show an
  unfinished screen*, and, for Type 3 translation, that *a lasting refusal is not acceptable*.

## Is this the right question

*Can the writer set Hebrew and Arabic?* It could, from the first stage: a face carries the letters and `FPDFText_SetText`
sets them. Measured 2026-10-06 on PDFium 155.0.8044.0's Linux build, **it set them and refused them**: a single Hebrew
letter wrote and read back, and every word of two letters or more was refused as a font that cannot carry the text. The
font could. The refusal was the read-back's, and the read-back was right: it compared what a text page read with what was
typed, and a text page reads a right-to-left object **reversed**. So the question is not about fonts. It is two:

- *In what order is a line stored?* A PDF content stream holds the glyphs in the order they are drawn, left to right.
  Hebrew typed in the order it is read, set as it was typed, is drawn backwards. The writer had no notion of drawing
  order for a script that runs the other way, so it was refused by a check that was working.
- *In what order is a line read?* A text page gives each word of a right-to-left object reversed in place and leaves the
  words in the order they are drawn. So the same page that makes a word readable makes a sentence read backwards, and the
  editor would show a person Hebrew in the order the page draws it, and a write of that would reverse the line.

The two premises checked rather than taken: *shaping needs a shaping engine in the writer* (it does not: Arabic
Presentation Forms hold one code point per shape, and a text page normalises them back to the letters), and *the
read-back must match the typed text exactly* (it must match what the font drew, which is a difference of characters and
not of order).

## Decision

1. **A right-to-left line is written in drawing order** (`bidiOrder.ts`, `drawnOrder`). Each right-to-left span of the
   line, by the Unicode Bidirectional Algorithm's levels, is written last letter first, a letter keeping its marks after
   it, and a character with a mirror image (a bracket) is written as its mirror (rule L4). A line with no right-to-left
   letter is returned as it came, so left-to-right text is written exactly as it always was.
2. **The direction of a line is its majority's** (`lineDirection`), the first strong letter's where the two are level,
   not the algorithm's own rule. A page stores no paragraph direction, so a line read from a page has to be given one
   again, and the first letter of what is read is the wrong place to ask: a right-to-left line that begins with a Latin
   word reads, in drawing order, as left to right. The majority is the same set of letters in either order, so it is the
   same answer for the line as typed and as drawn, which is what makes writing what was read change nothing.
3. **A line is read as typed** (`logicalOf`, in the one read `walkRuns` answers every reader from). PDFium's reading is a
   rule of its own: each unbroken run of right-to-left letters reversed in place, a neutral between two such runs, or after
   one at the end, reversed and mirrored with them, and everything else left where it stands (`readBackOf`, a MODEL
   measured on this build, with the cases it was fitted to named in its tests). It is its own inverse, so the drawn string
   is rebuilt by applying it again and then ordered back by the algorithm in the line's direction. Every reader of a run's
   text, the editor's diff included, therefore sees the line as it was typed, from one place.
4. **Arabic letters are set in their joining forms** (`arabicForms`): each letter is replaced, before it is drawn, by the
   Presentation Forms code point for its isolated, final, initial or medial shape, found from the platform's own NFKC (a
   run of consecutive code points that normalise to one letter is that letter's forms, in the block's order). They are set
   in the same subset by the same setter, and read back as the letters. **Not done, and said so:** a lam followed by an
   alef is drawn as two joined letters and not as the ligature, because a text page reads one glyph standing for two
   letters in the reverse of their order and the line could not be read back as typed; and a mark is drawn at the font's
   own offset for it rather than at the anchor the font's positioning table names.
5. **A line is cut into objects by direction as well as by font, and one object where one face carries all of it.**
   `inDrawingOrder` cuts a line's pieces at every change of level, orders them as a reader sees the line from the left,
   and joins a piece of neutrals alone to the piece beside it (a space is never an object of its own, which a text page
   reads as nothing, so the words would run together). **A line that runs both ways is one object where one face carries
   all of it**, which overrides ADR-0173's *the rest of the line keeps the document's font* for these lines and these
   alone: a text page reads the objects of a line in the order they stand and each in its own direction, so a line split
   between two fonts reads back with its parts in drawing order. The line's Latin words are then in the catalogue's face
   and not the document's, and only a line with right-to-left letters in it pays that. **The decision is the owner's to
   review** (ledger row R39).
6. **The live read-back compares by glyph for these lines.** A text page reads an object among the line's other objects
   in the line's direction, with a bracket mirrored and a space on the other side of its word, so an exact comparison
   would refuse a faithful write. The read-back exists to find a character the font did not draw, which reads as another
   character or none, and that is a difference of characters, so for text with right-to-left letters it compares the
   characters in any order, a bracket and its mirror image as one. The isolated probe of a single object stays exact.
7. **The editor says what it cannot edit, by kind.** The count of characters not offered for editing because they are not
   set upright becomes three, from the matrix the read already holds: *turned* (a rotation, including a quarter turn, which
   is how vertical lines are set), *slanted* (a shear) and *mirrored*. The note names each present, so a person is told
   which text is not theirs to edit and why, and the contract's `rotated` stays the total.
8. **Marked content is kept.** An object that replaces a run carries the marks the run had (the marked-content name and
   its parameters, an `MCID` among them), so a tagged page keeps its structure through an edit. PDFium's mark calls are
   used, and a mark whose parameter is of a kind the calls cannot copy is named in the read-back's refusal rather than
   dropped.
9. **A scanned page is recognised, then edited.** Edit text on a page that holds only a picture offers to recognise it,
   through the existing OCR command (one undo step), and then reads the recognised words as any others. An edit of
   recognised words (set invisibly over their picture) writes the new words **visible**, and covers the picture under the
   words it replaces with a rectangle of the page's own paper colour (sampled from the rendered page around the block), set
   above the picture and below the text. The picture is not changed: nothing is dropped, and Undo, a checkpoint, puts the
   page back.
10. **A translated page on a Type 3 font is written by the operator writer.** `ai.translatePage` answers which writer the
    page belongs to, as the read does, and the dialog sends `editTextOperators` for such a page; the operator writer
    implements `fit: 'shrink'` by the PDFium writer's own rule (a block fits when its last line sits no lower than it did),
    found by bisecting the size, so a translation keeps the page's layout on either writer.
11. **Nested form XObjects need nothing new.** Text inside a form inside a form is promoted to the page by the writer
    already (measured 2026-10-06 against the nested-promotion fixtures), and stays in the P4 list only so that nobody
    reads its absence as an omission.

## Limits stated now, so a reader does not find them first

- **A line that runs both ways and that no one face carries is written as several objects and reads back in drawing
  order**, so the editor shows its parts in the order the page draws them and an edit reorders them. Measured: a line
  mixing Arabic and Latin, since the bundled Arabic faces carry no Latin letters. The control in
  `pdfiumCommand.proof.mjs` pins it, so the limit cannot be removed by accident or kept after it is fixed.
- **The editor's own bidirectional layout is the browser's** (`unicode-bidi: plaintext`, the first strong letter of each
  paragraph), and the writer's is the majority's. They agree for every line that is wholly or mostly one script and may
  differ for a short word of one script in a longer line of the other.
- **PDFium's reading is a model, not its source.** Where it differs from the model, the write is refused naming the
  characters, and the document is exactly what it was.

## Rejected alternatives

- **Write the typed order and let the reader reverse it.** A PDF stores the drawn order; a renderer does not run the
  algorithm. The page would show Hebrew backwards.
- **Shape with HarfBuzz and write glyph ids.** It would be exact for ligatures and mark anchors, and it needs the
  subsetter to keep glyph ids the subset was not built for, a `ToUnicode` the PDFium path cannot write (its map is the
  font's `cmap`), and a font per shaped span. Presentation Forms use the whole existing path and a reader's own
  normaliser; the ligature and the mark anchors are the cost, stated above.
- **Order the objects of a line in the grouping.** The writer takes a line's first run as its origin and the editor keys
  its marks by run order; reordering runs would move the origin of every right-to-left line.
- **Refuse a right-to-left line the writer could not read back exactly.** The owner's rule: a person is never refused
  because of their document.
