# ADR-0096 — Text is edited in place on the page, in blocks that reflow

- **Status:** Accepted
- **Date:** 2026-09-23
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row and §3.2's grouping rule, whose consumer
  was *"a dialog a person answers"*.
- **Amends:** [ADR-0049](0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)
  Decision 3 (the consumer) and its *"the extent does not leave"* consequence. Decisions 1, 2 and 4 stand.
- **Context:** Stage 10. The owner rejected the Edit text workflow on 2026-09-23 and supplied a screen
  recording of the standard they want.

## The problem, in one sentence

Edit text opens a dialog listing a page's lines, and the owner's objection is the whole argument: *"what if
the page is full of text, how do you rightly list that on a dialog box?"* — a person edits the words they
are looking at, where they are, and a list of a page's lines is neither.

## The standard, from the owner's recording

The recording is of another editor (49 s, 1600×852, read frame by frame on 2026-09-23). Clicking *Edit
text* **outlines every editable text block on the page, in place** — a heading, a date line, a bulleted
list with a wrapped line inside it, each one rectangle. Clicking a block puts a caret in it and shows
selection handles. Typing edits the words where they are, and the paragraph reflows as it is typed into.
Clicking away commits; undo reverses. Nothing is listed anywhere.

## Why this is a B4 and not a new surface over the old seam

Three things the law says stop it, and each was written for the dialog:

1. **ADR-0049 Decision 3 licenses the editor's grouping only while its output reaches a dialog.** The
   rule is checkable — *"does this grouping's output reach any consumer other than a dialog a person
   answers?"* — and an editor drawn on the page is not a dialog, so the grouping would be unlicensed the
   moment it drew an outline.
2. **The grouping's extent may not leave the kernel** (`textLines.ts`: *"a consumer holding it would be one
   step from deciding something else with a coordinate"*). An outline on the page is the extent.
3. **Nothing writes a LINE THAT WAS NOT THERE.** `replaceTextObject` sets the text of objects the page
   already has. A paragraph that reflows as it is typed into needs a line the page did not have — a new
   text object, in the font of the run it continues — which no command does.

## What was measured, and the command that established it

**`scripts/research/pdfiumReflow.mjs`, PDFium 155.0.8044.0, 2026-09-23**, over a standard-font fixture and
the eleven-file corpus (counts only; no file named).

- Every call the write needs is exported by the pinned build: `FPDFTextObj_GetFont`,
  `FPDFTextObj_GetFontSize`, `FPDFPageObj_CreateTextObj`, the font's flags, weight and names.
- **A new text object in a font the page already uses round-trips for 426 of 457 runs** — each corpus run
  rewritten, in its own font, saying its own text, read back from reopened bytes.
- **Reading it back from the LIVE text page, before anything is saved, agrees exactly: 426 of 457.** And
  the control — the same fonts asked to write `中`, which no Latin font carries — reads back **0 of 642**.
  So a write the font cannot carry is detectable before generation, and the detector is not vacuous.
- **The width a line will have is measured by laying out the object that will be written.** An uninserted
  object, made and set by PDFium, agrees with the original run's width for 355 of 457; summing
  `FPDFFont_GetGlyphWidth` agrees for 176. The first is the right instrument for a reason stronger than
  its score: it is the object that will be drawn, laid out by the engine that draws it. The disagreements
  are original runs set with spacing a plain rewrite does not carry, which is a fact about the old run and
  not about the new one.

## Decision

**1. Edit text is a MODE on the page, not a dialog.** The command toggles it; while it is on, each visible
page outlines its editable blocks. A click opens an editor exactly over the block, in its size, colour and
style; typing wraps inside the block's width. Escape, or a click outside, commits. An edit that changed
nothing writes nothing. Undo reverses a committed edit. The line-picking dialog is removed, not kept beside
it — two ways to edit a page's text, one of which the owner rejected, is the second wiring place.

**2. ADR-0049's rule keeps its shape and changes its consumer.** It now reads: *does this grouping's output
reach any consumer other than the in-place editor a person answers?* What made the dialog legal survives
the move and is stronger on the page: a person sees the block the grouping formed, drawn around the very
words it will replace, before anything is written — and nothing is written until they type. Search,
extraction, export and the text layer still read MuPDF's structured text and nothing else; the grouping
still has one channel and one surface.

**3. The extent leaves the kernel, to place the editor and for nothing else.** A block's box and its
lines' boxes cross in PDF user space and the renderer converts them through `PageTransform`, as every
overlay does. No renderer code decides anything from them — hit-testing is the browser's, on the elements
they position.

**4. A block is lines joined by a relation measured in the text's own height.** Within a line, two runs are
one segment unless the horizontal gap between them is wider than the line is tall; consecutive segments
join one block when they overlap horizontally and the vertical gap between them is smaller than the
shorter one's height. That is one comparison, against a quantity every line carries, and it has no number
in it — so it is the same kind of rule as ADR-0049's overlap, and E2's *"constants change only with a
corpus score"* still has nothing to govern. **It is a choice, and it is on screen**: a person sees the
outline before editing, which is Decision 2's condition.

**5. The write is ONE command per block: `editTextBlock`.** It carries the block as the person saw it — its
lines, each the runs it is made of — and what they typed, lines separated by line breaks. The kernel:

- diffs each line against what it said, by `lineEdit`'s rule (common prefix and suffix), so a word changed
  inside one run names that run and every other run keeps its font. The rule moves to `@monstera/shared`,
  because the kernel now owns the write and the renderer no longer computes it — one module, one opinion;
- measures each changed line by laying out the object that will be written, and WRAPS a line wider than
  the block at a word boundary into continuation lines, each a new object in the font, size, colour and
  matrix of the line's last run;
- moves every later line of the block down by the lines inserted, at the block's own line pitch — the
  distance between its first two baselines, or the line's height where there is only one;
- removes the objects of lines the person deleted;
- reads every written object back from the live text page and **refuses the whole edit, by name, before
  generation** if any says something other than what was typed;
- generates the page's content once (ADR-0047 Decision 2).

**6. It is a TERMINAL command, and undo takes a checkpoint.** It creates and removes objects, and PDFium
can describe an object and cannot rebuild one — `deletePageObjects`' reason, unchanged. A prior of the old
strings would restore the set text and not the removed lines.

**7. `document.textLines` becomes `document.textBlocks`.** Converted rather than joined by a sibling: its
only consumer was the dialog, and two channels answering one page's editable text in two shapes would be
two opinions about it.

## Stated limits, which the row carries

- **A font that cannot carry what was typed refuses the edit** — about 7% of runs in the corpus, by the
  round trip above. The person is told which, and nothing is written.
- **Text added below a block can overlap what is under it.** A PDF has no flow; a block that grows pushes
  its own lines down and nothing else. Moving the rest of the page would be re-laying out a document that
  has no layout to re-lay.
- **Continuation lines take the line's last run's style.** A new line has no run of its own, and that is
  the run its words were typed after.
- **Rotated or skewed text is not wrapped**: its lines are edited as they are and the edit refuses a wrap
  it cannot place, rather than placing it wrongly.
- **Justified text loses its justification where it is rewritten**: the spacing that stretched it belongs
  to the old run's text state, and the measurement above is of the rewrite, not of the original.

## Rejected alternatives

- **Keep the dialog and add the on-page editor.** Two controls for one job, one of them rejected by the
  owner, and ADR-0049's rule would have to name two consumers.
- **A text-area dialog per block.** A block of text on a page is edited where it is; a dialog showing one
  block is the list with one row.
- **Measure widths by summing `FPDFFont_GetGlyphWidth`.** 176 of 457 against 355 of 457, and it measures
  our arithmetic rather than the engine's layout of the object that will be drawn.
- **Let the renderer lay out and send positions.** The renderer does not have the page's fonts, so its
  widths would be a guess about a font it cannot load, and a list of positions is a payload that scales
  with the text rather than an intent.
- **An invertible command whose prior is every touched string.** It would restore set text and leave the
  lines it created and the ones it removed — an undo that restores half an edit.
- **Blank a deleted line's text instead of removing its objects.** Keeps objects nothing shows, whose
  indices every later command would still have to skip.
- **Group blocks by a spacing constant** (a gap under 1.2 em, say). A number with nothing to justify it,
  which is the failure E2 describes; the line's own height is a quantity the text already has.

## Consequences

- `pdfiumFfi.ts` binds `FPDFTextObj_GetFont`, `FPDFTextObj_GetFontSize`, `FPDFPageObj_CreateTextObj`,
  `FPDFFont_GetFlags` and `FPDFFont_GetWeight`, and `FPDFTextObj_GetText` for the read-back.
- `docs/FEATURES.md`'s three in-place rows are reopened to this design and close when it works on a real
  document, survives save and reopen, and has its pair.
- Document-wide replace-all and translate's write-back stay on their own commands; translate may write
  through this one, block by block, which is where its overflow would otherwise go.

## Amended 2026-09-24 by ADR-0097 — a standard-font twin, a page's blocks in one command, and a second consumer

[ADR-0097](0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md).
Decision 5's refusal now applies only where a **standard-font twin** cannot carry the text either: a run's
own font carries an accented Western string for 132 of 457 corpus runs, the twin for 308 of 325 of the rest.
`editTextBlock` carries **a list of blocks** on one page, so a translated page is one command and one undo;
the in-place editor sends one. Decision 2's consumer gains exactly one more — a translation written back into
the blocks it was read from. The first stated limit reads accordingly. The last consequence above said
*"block by block"*, and the decision taken is one command for the page, for the checkpoint and undo reasons
ADR-0097 gives.
