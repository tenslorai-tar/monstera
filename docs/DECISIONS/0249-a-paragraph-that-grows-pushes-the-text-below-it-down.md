# ADR-0249 — A paragraph that grows pushes the text below it down

- **Status:** Accepted
- **Date:** 2026-10-16
- **Amends:** [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md), its stated limit *"Text
  added below a block can overlap what is under it … a block that grows pushes its own lines down and nothing else"*,
  and its Decision 3 (*"No renderer code decides anything from them"*), which gains one consumer stated below.
  [ADR-0097](0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md)'s rejection of
  moving the lines below is superseded for the in-place editor; a translated page is unchanged.
- **Decided by:** the owner, 2026-10-16: *"a longer paragraph pushes the text below it down; where it can't, Monstera
  warns"*, because they asked earlier that the editor never cover other text. The owner's answers of the same day
  (session 2's locked decisions 1 to 5) settle the five questions this ADR would otherwise have had to ask.

## The problem, in one sentence

A block that grows draws over the lines below it, so a person who adds a sentence, or picks a wider font, covers the
small print under the paragraph — fix session 1's text regression walk measured it at steps 5, 7, 8, 9 and 10, with no
word lost and every overlap said only after the write.

## Decision

**1. The text below a block, in its column, moves down by what the block grew — in the same command, one undo step.**
*Grew* is the block's old last baseline less its new one, the measure ADR-0097's fit already uses (a baseline, not a
box: a descender is not a line). A block that did not grow pushes nothing; a block that got shorter pulls nothing up, so
nothing is ever placed above where it started. Inside the open editor the push follows the words both ways (Decision 5),
so what the person sees while typing is what is written.

**2. The column, the margins and the room are decided in `main`, at the read, by one function.** `pushesOf` in
`textLines.ts`, beside `groupIntoBlocks`, the one place the grouping happens (ADR-0096 Decision 2), answers for each
block of a page:

- `below`: the blocks it pushes — every block that overlaps it horizontally and sits lower (ADR-0096 Decision 4's own
  two comparisons, `left < right` both ways and `top < top`), and, CLOSED UNDER THE SAME RELATION, every block that
  overlaps one of those and sits lower than it. A block the pushed text would land on is pushed with it, which is what
  *never cover other text* asks; the owner's wording, *overlaps the edited block's extent*, is the first step of it.
- the **margins**, which never move: the page's bottom margin mirrors its top one — as far up from the bottom of the
  page box as the page's highest text sits down from its top — and a block lying wholly inside it is the footer
  (headers, page numbers). Locked decision 3.
- `room`: how far the pushed text may go — from the lowest bottom of `below` down to the top of the footer, or with no
  footer to the bottom margin. A block with nothing below it has no room to state and pushes nothing.

No number is in any of it: the margin is the page's own, measured from its own text, and the column is ADR-0096's
relation. Both cross on `document.textBlocks` beside each block's box.

**3. The pushed blocks travel IN THE EDIT, and the writer moves them.** The renderer adds each block in `below` to the
edit as a block of its own, with its lines and its words as the read gave them, and names it in a new field
`pushes: [{ block, by, room }]` — pushed by block `by`, which comes before it and is not itself pushed. Each writer lays
out `by`, takes what it grew, and moves every pushed block by that amount through ADR-0180's `place` move, the path that
already moves a block as one thing with its decorations (`placeObjects` in the PDFium writer, one `cm` in the MuPDF
operator writer, ADR-0188):

- grew by nothing, or by more than `room`: nothing moves, and the edit is still written as typed;
- otherwise: every pushed block moves down by exactly that.

A pushed block's words are never written. The writer refuses an edit in which the diff names a run of a pushed block,
so a renderer that sent changed words for one is a refusal, not an edit nobody typed. Both writers answer, beside the
boxes they drew, how far each pushed block moved (`pushed`), which is the only thing Decision 4 needs.

**4. Markup on the moved text moves with it, written by its own writer, in the same undo step.** MuPDF stays the
writer of record for annotations (B3), and PDFium's writer never touches one. In the same lane, straight after the edit,
`main` reads the page's annotations and links and sends `placeAnnotation` for the marks and `editLink` for each link
whose rectangle's centre lies inside a moved block's old box, each moved down by that block's amount, each joining the
edit's undo step ([ADR-0200](0200-commands-the-person-made-in-one-gesture-are-one-undo-step.md)). Inside the lane nothing
can come between, so the join always holds. The kinds that ride are the ones that mark words: highlight, underline,
strikeout, caret, sticky note, and links (locked decision 4). A shape, a stamp, a text box, a form field and any
`other` mark stay where they are, as a picture does.

**5. The open editor shows the push live, and warns where there is no room.** The editor already grows as it is typed
into. While it is taller than when it opened, the blocks in `below` are drawn moved down by the same amount; this is a
drawing of the page under the editor and decides nothing written. When the growth passes `room`, nothing is drawn moved,
the lines the editor now runs into are highlighted, and the editor says, in the owner's words (locked decision 5):
*"This paragraph now runs into the text below it, and there's no room on the page to move that text down. Shorten the
paragraph, or press Undo after you finish."* The write still happens as typed. After the write, text that now lands on
a picture or a drawing is said by the existing covers note, with what it covers highlighted (locked decision 2).

**6. ADR-0096 Decision 3 gains one consumer.** The renderer still decides nothing that is written from a block's
extent: `below` and `room` are `main`'s, and the writer measures the growth. The renderer uses them to draw (Decision
5) and to put the blocks `main` named into the edit (Decision 3).

## Stated limits

- **A push never crosses a page.** Text with no room is not carried to the next page; the person is told and the edit
  is written as typed.
- **A header that grows pushes the body below it.** The margin rule finds a footer, not a header: the highest text on
  the page is what the top margin is measured to, so a header is the top of the column.
- **A footer taller than the bottom margin is not recognised as one.** Its blocks are then pushed like any other, and
  the room ends at the margin — so an edit on a page whose footer is unusually tall warns rather than pushes.
- **A shorter paragraph does not pull the text below back up after it is written.** Within the open editor the push
  follows the words both ways; once written, nothing records where the text below started, so a later edit that
  shortens the paragraph leaves the gap, and Undo is what takes the push back.
- **A translated page pushes nothing.** It is fitted (ADR-0097 4b), and sends no `pushes`.
- **A mark beside the text rather than on it** — a sticky note in the margin — stays where it is: its centre is not in
  the block.

## Rejected alternatives

- **Keep the overlap and say it after the write.** ADR-0096's limit, and what the owner rejected.
- **Warn only, and move nothing.** The person would have to move the text below by hand, which the editor cannot do.
- **Find the column in the writer.** A second grouping, in the host, beside `main`'s — two opinions about which text is
  below a block (B3a), and the renderer could then not show the push before it is written.
- **The renderer sends the move as a `place` it worked out.** The renderer's growth is the browser's layout of a font
  that is not the page's, so the amount would be a guess; the writer measures what it wrote.
- **PDFium moves the annotations in the same write.** A second writer of annotation geometry beside MuPDF's
  `placeAnnotation` (B3).
- **The renderer sends `placeAnnotation` after the answer.** A renderer that forgets leaves a highlight on the wrong
  words; the move belongs to the edit, so it is `main`'s, inside the lane, where the join cannot fail.
- **A fixed footer band, such as the bottom tenth of the page.** A constant with nothing to justify it (E2); the page's
  own top margin is a quantity the page already has.

## Consequences

- `pushesOf` in `textLines.ts`, with its cases: a column, a second column that does not move, a footer that does not
  move, the closure, no room.
- `document.textBlocks` carries `below` and `room` for each block; PDFium's text read carries the page box it is
  measured against.
- `blockEditSchema` gains `pushes`; both writers move pushed blocks and answer `pushed`; the proof reads the saved file
  with a second reader.
- `DocumentCommands.execute` moves the markup on moved text, joining the step.
- `TextEditLayer` draws the push and the warning; `textRegressionWalk` steps 5, 7, 8, 9 and 10 change only where they
  asserted the old overlap.

## Correction, 2026-10-19 — the "no room" warning is withdrawn; push-down stays

**The owner's decision of 2026-10-19** (the owner's review of 0.1.16.0, R10): the editor's sentence *"This paragraph now
runs into the text below it, and there's no room on the page to move that text down…"* misled, and is removed
completely, with the highlight of the lines it named. Decision 5's second half and locked decision 5 are withdrawn.
Everything else stands: the text below is pushed down where there is room, the editor still draws that push live, and
where there is no room **the edit is applied as typed and nothing below moves** (the writers already did this,
Decision 3: `pushMove` is zero past `room`). Undo is the way back. No other message replaces it.

**Why it showed on table cells before anything was typed — measured.** The owner saw it on cells as they were opened.
The editor reported *growth* the moment it opened: for a block of two or more lines, `useGrowth` measured from the
block's own lines at its pitch and counted every height above that from the first observation, typed or not
(`typed = opened !== undefined`). The editor sets the block's words again in the browser at the block's measure; where
it wraps them into one line more than the page did — a face wider than the page's, at a cell's narrow measure — the
editor is a line taller on opening. In `TextEditLayer.test.tsx`, a two-line block whose editor lays out three lines at
open, nothing typed, with no room below: `crowded: true, overlap: true` (run 2026-10-19). A table cell is the common
case because its measure is narrow and the next row is directly below it with no room before the footer.

**The same misjudgement drove the push PREVIEW, not the writer.** With room below, the same opening drew the next row
moved down before anything was typed. The writers measure their own layout of what they write (`grew`, from the old and
new last baselines), and nothing is written for an editor opened and left. So the correction is in the renderer: growth
is now measured from the editor's own height as it opened (never less than the block's lines at its pitch), and counts
only once the person has typed. **A table's next row is still "text below" a cell** (`pushesOf` knows no tables): when
a cell's words really grow, the row below moves down with them, as Decision 2 designs; that is unchanged.

**Removed:** the message and its key (`surface.text-edit.no-room`), the overlap highlight, the help article's sentence,
and the cases that asserted them. **Proof:** an edit grown past the room shows no message and no highlight, and the
write is sent as typed; opening a block whose editor is a line taller, nothing typed, moves nothing and shows nothing;
CONTROL: growth within the room still draws the text below moved down.

## Correction, 2026-10-26 — what sits with a moved line moves with it: bullets, rules and every drawing on its band

**The owner's test of 1.0.2152.0 (2026-10-26, document 2, page 2):** a character added to a paragraph above a bulleted
list wrapped it onto one more line; the list items moved down and their bullets did not, so every bullet stood a line
above its item and the first stood alone. *"It just pulls everything out."* Damage to content nobody touched.

**The mechanism, measured.** Decision 3 moves a pushed BLOCK, and a block is text: the runs `main` grouped. That page's
sixteen bullets are not text at all but filled squares, 3 points across, drawn as paths beside each item (PDFium's
reading of the page, `pageObjects`: no U+2022 among its runs, sixteen paths at x 77 to 80, one per item's line), and
the rules under its linked words are paths about a point tall. The operator writer sets a pushed block's words again under one `cm` and touches nothing
else of the page, so every drawing that belonged to a moved line stayed where it was. Decision 4 moved annotations and
links and nothing in the page's own content; the decorations the writer moved were only its own marked ones (ADR-0228).

**Decision 3 gains a sentence.** When a pushed block moves, **every drawn object that sits with one of its lines moves
with it, by the same amount, in the same write**: a path, an image or an inline picture whose box lies wholly inside
the band that line's words fill — `decorationBand('behind', baseline, size)`, where a highlight behind them is drawn,
within half a point — and across the column of the push, the horizontal extent of the growing block and the pushed one
together. One function answers which (`sitsWithLine`, `pushedShapes.ts`), and the corpus proof asks the same function.
Each is moved by Edit object's own placement (`placedSpan`, ADR-0240's E3 addendum and ADR-0264): its own instructions,
or the clip window it is drawn through where that window holds nothing else, wrapped in `q … cm … Q`. A bullet that is
TEXT already moves: as a run of the item's line it is in the pushed block, and as a block of its own it is in `below`,
since it overlaps the growing block's column and sits lower.

**What does not move, and why.** A drawing taller than one line's band — a picture beside the list, a table's ruling,
a box around several lines — is not a line's, so it stays, as Decision 4 left a shape annotation. A drawing that also
sets the clip for what follows is not moved, since moving its clip would re-cut what is drawn after it. A form XObject or a shading has no box this read can state, and stays. The growing block's own lines
are set again where its words now wrap; a drawing beside them is not carried, since no line of it keeps its place.

**The instrument could not see this, and that is part of the defect.** `proof:edittext` judged pixels outside where the
edited blocks may draw, and a pushed block may draw where it went: a bullet that does not move leaves its old pixels
unchanged and puts none where it should be, so the corpus count read 0 disturbed on document 2. The proof now asks the
same function for every drawn object on every moved line before the edit, and finds each after it at its box moved by
what the writer reports; one not found is disturbed. Its CONTROL: the check fed a page where the writer reported a move
and nothing moved names every such object.

**The PDFium writer's push is not changed.** Every page's text is the operator writer's (ADR-0266), so no surface reaches
PDFium's `placeObjects` for a push; stated here so that the day one does, this sentence is the first thing it falsifies.
