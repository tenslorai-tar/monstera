# ADR-0228 — The formatting set is whole in both text writers, and a tab is a marked gap

- **Status:** Accepted
- **Date:** 2026-10-11
- **Amends:**
  [ADR-0180](0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)
  Decision 1 (the properties a mark may name) and Decision 2 (a paragraph's settings), and its Decision 8 (*Tab inserts
  spaces to the next stop*), which K8 withdraws;
  [ADR-0211](0211-a-text-box-with-styled-words-has-an-appearance-monstera-writes-itself.md) Decision 1 (the facts `/DS`
  and `/RC` carry), and records how its 2026-10-11 amendment (K2, real fonts) is built;
  [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md)'s reasoning, extended to the ribbon's
  Format group, which gains two value controls of its own.
- **Decided by:** the owner's instruction of 2026-10-11 to build every row still marked NOT BUILT: B3.3 (strikethrough,
  highlight, justify, space after), B3.4 (Ctrl+J), B1.29 (character spacing), B1.8 and K8 (*Tab in Edit text inserts a
  tab character*), B5.7 and K2 (text boxes in real fonts), B5.8 (per-word formatting while typing a text box), and the
  TEXT spec's C3 (Font and Size boxes in the ribbon's Format group).

## What was measured

`scripts/research/pdfiumPositions.mjs`, 2026-10-11, PDFium 155.0.8044.0 (Linux, the pinned build) and MuPDF 1.28.0 (the
shim), on one generated page in Helvetica 20:

| written | content stream | PDFium's text page reads | MuPDF reads |
|---|---|---|---|
| `AB CD`, no positions (control) | `[<4142204344>] TJ` | the advances | `AB CD` |
| each character 1 pt, 2 pt, 2.5 pt further on (`FPDFText_SetPositions`) | `[<41> -50 <42> ...] TJ` | `AB CD` | `AB CD` |
| each character 3 pt and 4 pt further on | the same shape | `A B C D` | `A B C D` |
| each character 1 pt and 2 pt closer | negative adjustments | `AB CD` | `AB CD` |
| the space 6 pt and 12 pt wider | `[<414220> -300 <4344>] TJ` | `AB CD` | `AB CD` |
| the space 30 pt wider | `-1500` | `AB CD` | `AB \nCD` |
| `A\tB` as text | `<41FF42>`: the tab became `ÿ` | `AÿB` | `AÿB` |
| `A`, then a lone space marked `/Span <</ActualText (\t)>>`, then `B` at the next stop, three objects | `/Span <<...>> BDC ... EMC` around the space only | `A B` (the mark is not read) | `A\t` then `B` |
| the same mark on ONE object holding `A B` | the mark around the whole object | nothing | `\t` (the whole object's text replaced) |

PDFium's public edit API has no setter for `Tc` or `Tw`; `FPDFText_SetPositions` (experimental) is the one way a text
object states a glyph's own position, and it writes `TJ` adjustments.

## Decision

1. **The formatting set is the TEXT spec's C2, in both writers** (page text and a text box), each property written by
   the one writer that writes the words it belongs to (B3):
   - **Strikethrough** is a filled rectangle through the words, the page-text writer's underline turned up to the
     x-height; a text box already draws one.
   - **Highlight** is a filled rectangle of the chosen colour BEHIND the words: inserted before the line's text
     objects on the page, drawn under the piece in a text box's appearance. A mark carries it as `highlight`; a text
     box run as `background-color` in `/RC`.
   - **Justify** joins `PARAGRAPH_ALIGNMENTS`. The page-text writer widens a wrapped line's spaces with
     `FPDFText_SetPositions`; the last line of a paragraph, and a line a hard break ends, are not stretched (the text
     box writer's rule, one rule).
   - **Space after** joins a paragraph's settings beside space before, in points.
   - **Character spacing** is a mark property, `spacing`, in points, **bounded to ±0.12 of the size**: the measurement
     above reads cleanly at 0.125 em and invents a space between every letter at 0.15 em in both readers, so a wider
     value would make a block that search, copy and the editor's own read no longer see as words. The page-text writer
     writes it with `FPDFText_SetPositions`; a text box writes `Tc` and `letter-spacing` under the same bound, one
     meaning for one control.
2. **A tab is a marked gap** (K8, withdrawing ADR-0180 Decision 8). The editor holds U+0009. The page-text writer never
   writes the character itself (measured: it becomes `ÿ`): it writes a lone space in the run's font, as its own text
   object, marked `/Span <</ActualText (\t)>>`, and starts the next words at the next stop, every 36 points from the
   block's left edge (the editor's `TAB_STOP`). The block's read takes a marked object's `/ActualText` as its text, so
   the tab comes back to the editor; MuPDF and every reader that honours `/ActualText` read a tab. A text box keeps the
   tab in `/Contents` and `/RC`, and its layout advances to the next stop. In form filling Tab still moves to the next
   field.
3. **A text box in a real font (K2) is set word by word.** A word a base-14 face can write, in a box whose family is
   Helvetica, Times or Courier, is drawn in that face, unembedded, as before. Every other word goes to the resolver
   (ADR-0172) over the catalogue the MuPDF host already binds for Type 3 pages (ADR-0177): the chosen family where it
   carries the word, the nearest face otherwise (K9), the box glyph for a character no face has. Those words are drawn as
   codes of a CID font subset to what the box draws, written through `mupdfCidSink`, so a text box and a Type 3 page
   embed fonts by one opinion. Widths are the faces' own (`ShapingFace`), so the line that breaks is the line drawn.
   `/DS` and `/RC` carry the family by name; `/DA` keeps the nearest base-14 face, from the face's own class, for a
   reader that draws neither. A process with no catalogue bound draws base 14 only and refuses what they cannot write,
   as today.
4. **Per-word formatting in a text box is the open editor's selection** (ADR-0211 Decision 7). While a box is being typed
   in, Bold, Italic, Underline, Strikethrough, a colour, a highlight and character spacing apply to the selected words;
   with nothing selected they apply to the whole box, as the Properties tab does now. The editor holds the runs and
   commits them as the restyle's `words`; the kernel stays the only writer of `/RC`.
5. **The ribbon's Format group gains two value controls of its own, Font and Size**, beside its commands, as the status
   bar has its page field and zoom slider (ADR-0067): each holds a value, so neither is a command, and each sets the
   value through the same path as the Properties panel's Text section. The commands in the group stay projections of the
   registry.

## Rejected alternatives

- **Character spacing and justify as one text object per character or word.** The readers infer spaces from gaps the
  same way for separate objects, so it costs objects and reads no better; and an edit's own read would see dozens of runs
  where there was one.
- **A tab as a raw U+0009.** Measured: written as `ÿ`.
- **The `/ActualText` mark on the run that holds the tab.** Measured: it replaces the run's whole text in MuPDF.
- **Character spacing unbounded.** Measured: past 0.15 em both readers read a space between every letter.
- **Embedding a whole installed font for a text box.** ADR-0172 subsets; a whole face is kept only where the subsetter
  fails, as there.

## Consequences

- A paragraph's `align` may be `justify` on the wire; a mark may name `strike`, `highlight` and `spacing`; a paragraph may
  name `spaceAfter`. Older blocks read as before: absence is *as the read found it*.
- `proof:pdfiumcommand` gains cases for each property against PDFium's and MuPDF's reads, and the text box proof reads
  each style back from the page in a second reader.

## Correction, 2026-10-11 — what the build measured that the table above did not

Three statements above were recorded more strongly than the probe supported, and the build found each:

- **The table's *"`A B` (the mark is not read)"* row hid where the space came from.** On an edit's own bytes the lone
  marked space produces NO character in PDFium's text page; the space it reads there is one the text page GENERATES for
  the gap. So *"the block's read takes a marked object's `/ActualText`"* could not be done by reading characters: the walk
  (`walkRuns`) adds each marked text object the text page skipped as a run of its own, in index order, takes back the
  generated space it stands for, and lets it reach the words after it so the line stays one line. Read with
  `scripts/research/pdfiumPositions.mjs`' calls on the bytes `proof:pdfiumcommand` writes.
- **Decision 1 put character spacing on the wire *"in points"*.** It is a fraction of the size, bounded by the schema
  (`MAX_CHARACTER_SPACING`), so the bound is the wire's own rather than a check each writer makes against a size it may
  not be told; the panels take points and convert at the words' size (`spacingOf`).
- **A no-break space was tried as the tab's glyph** so that the text page would give it a character. An embedded subset
  font refused it (`TextNotWritableError` on the proof's fixture), so the gap stays a plain space, which every font a
  page sets text in carries.

The build also found a defect older than this decision: a block's edges were read from each run's first object only, so a
line an earlier edit wrote as several objects was measured at that object's width. It is fixed where it was found
(`b2be9256`), with a case in `proof:pdfiumcommand`.

## Correction, 2026-10-13 — the ribbon has no Format group (the owner's N10), reversing Decision 5

The owner's decision: *"The options in the properties panel are enough."* The ribbon's Format group, shown while Edit
text is active, is removed whole: its Font and Size boxes (Decision 5) and its formatting commands' ribbon placements —
bold, italic, underline, strikethrough, superscript, subscript, the four alignments with justify, bullets, numbering and
indent. Nothing they did is lost:

- Every one of those commands stays registered, so the command palette and the Properties panel's Text section, which
  act through the same `formatOpenEditor`, keep them; only the ribbon placement goes. The registry stays the one place a
  feature is wired; a projection is what was removed.
- The keyboard shortcuts stay: they are the editor's own keys, handled where the words are typed, and never depended on
  the ribbon.
- The Font and Size boxes stay in the Properties panel's Text section, the one `TextFontSize` component with one place
  fewer.

The C3 row of `docs/FEATURES.md` that Decision 5 built is corrected in the same change.

**And the first bullet overstates, found by the rendered case the same day.** The command palette does not reach these
commands while words are being edited: opening it moves the focus out of the words, which ends the edit, and each
command is offered only while an editor is open (`when`). So the Properties panel's Text section and the editor's own
keys are where formatting is, and the palette is not. The commands stay registered, which is what the panel acts
through.

## Correction, 2026-10-13 — an underline, a strike and a highlight are read back as the words' (L2)

Decision 1 draws each as a filled rectangle beside the page's text objects, and the writer's own comment calls them NOT
READABLE: nothing on the page said a rectangle was a word's underline. The consequence was the owner's L2. When a block
was edited again, its words were set afresh and moved, and its rectangles stayed where they were drawn, over nothing or
over other words; and the editor showed the words with none of them, so what it wrote next carried none either.

What replaces it, for the page-text writer (PDFium's):

1. **Each rectangle Monstera draws is marked as what it is**: an `/Artifact` (PDF 32000-1, 14.8.2.2, so a reader and a
   screen reader leave it out of the words) whose parameter `MonsteraDecoration` names `under`, `through` or `behind`.
   A rectangle another producer drew is not marked, stays a drawing, and is left alone.
2. **One resolver says which run a marked rectangle belongs to** (B3a): the run whose extent it spans, at the place its
   kind is drawn relative to that run's baseline. The read uses it to give each run its `underline`, `strike` and
   `highlight`, which the editor draws and the formatting state reads; the writer uses the same answer.
3. **An edit of a block removes the block's marked rectangles and draws them again** from each piece's run style with
   the edit's marks over it, so they move with the words, a mark that turns one off is obeyed, and a line kept as it
   was keeps its own at its new baseline.

The operator writer (a page read as `operators`) is not covered by this correction: its rectangles are content-stream
operators that its structural read-back and its byte edit do not yet name, and it is recorded as owed.

## Correction, 2026-10-16 — a run of two or more spaces is a marked gap too (the owner's decision a)

The text regression walk's step 5 typed two spaces into a paragraph, saved, and reopened the words with one. The saved
file held both; the reading lost one. PDFium's text page reads a run of drawn spaces as one, within an object and across
adjacent ones. The walk puts a dropped space back (`restoreDroppedSpaces`, 2026-10-14) only by comparing the gap against
the gaps after the object's OTHER spaces, so where the object holds no single space to compare with, nothing can be
compared and the run stays one short. Measured with
`proof:textspaces`'s fixture on 2026-10-16: `Amount  due   now`, written without a mark, reads back `Amount due  now`.

What replaces it, in both writers, as a tab is written (Decision 2):

1. **Each run of two or more spaces is drawn as its own object**, in the words' style, and marked
   `/Span <</ActualText (...)>>` with exactly those spaces. On its own object for Decision 2's measured reason: a mark
   on an object is all of that object's text in MuPDF, so a mark carrying a word's spaces cannot sit on the word.
2. **The reading is unchanged**: the walk already takes a marked object's `/ActualText` as its text (the 2026-10-11
   correction above), and MuPDF honours it, so the editor's reading and the page's text layer, which a copy takes, both
   read the spaces typed, each an ordinary U+0020.
3. **A single space is not marked**, so a page is changed only where a run is.

The owner's words were *"the exact words for runs that contain more than one space"*. The mark carries the spaces
alone, not the run's words, for two reasons, both measured: a mark on the words' object replaces their text in MuPDF
(Decision 2's table), and PDFium's `FPDFPageObjMark_SetStringParam` takes a C string, so a word outside ASCII reaches
the file as UTF-8 bytes and is read back in PDFDocEncoding; spaces are ASCII and pass unchanged.

`proof:textspaces` writes the edit through the PDFium writer and reads it back by both readers; its control is the same
words drawn unmarked. The operator writer's case is in `operatorEdit.test.ts`, with single spaces as its control.

