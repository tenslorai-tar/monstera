# ADR-0179 — A paragraph is the editor's unit, and a reflow keeps each word in its own style

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row (what a block edit's text means, and how a block is
  laid out when it changes). Amends [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)
  Decision 5 (*each typed line is diffed against the line it replaces*, and a line that grows wraps into a new line) and
  [ADR-0142](0142-a-text-edit-carries-one-list-of-objects-and-one-text.md) (`text` is a block's lines separated by line
  breaks). Adds one field to the block wire and two to `document.textBlocks`' lines and blocks.
- **Relates:** [ADR-0097](0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md) 4c
  (a block's soft-wrapped lines are joined before translation: the rule this extracts), [ADR-0145](0145-the-text-editor-shows-each-run-in-its-own-style.md)
  (each run drawn in its own style), [ADR-0173](0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
  (a word in another face is its own piece), [ADR-0175](0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md)
  (the box draws a run in its own font), [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
  (the second writer, which takes the same wire).
- **Context:** Part B Phase 2, the brief's *paragraphs: model (soft/hard ends, alignment, indents, spacing); reflow;
  styles follow words; box draws page fonts, wraps as kernel, caret at click, no flat patch over shading, outline
  overlap; keep spacing, colour space, render mode*. Root cause R3: the editor edits **lines**, so a paragraph is never
  one thing to it.

## Is this the right question

The brief says *add paragraphs to the editor*, and the measured defect is narrower and worse: **the writer already wraps,
and it wraps in the wrong place.** `editTextBlocks` diffs typed line `k` against old line `k` and, when line `k` grows
past the block's right edge, moves the overflow into a NEW line made below it (`continueWith`). Old line `k+1` is not
touched. So typing one word into the first line of a five-line paragraph leaves a one-word line under it and the other
four lines as they were: a ragged paragraph the typesetter would never set, and the more a person types the worse it
gets. A model with alignment and indents laid over that writer would draw the same ragged paragraph in the right
alignment. The unit has to change before any attribute of it means anything.

Two premises are checked rather than taken:

- *The paragraph is already in the wire.* It is not. `text` is the block's lines separated by line breaks, so a soft
  wrap and a hard break are the same character, and ADR-0097 4c already needed the difference (`paragraphText`) for
  translation and kept it out of the edit. The editor can only send what it shows, so the editor must show paragraphs.
- *Styles are per run, so a reflow keeps them.* It does not: a continuation line is made in `styleOfRun(last)`, the
  style of the line's last run, so a bold word that wraps comes out in whatever the line ended in.

## Decision

1. **The block's `text` is its paragraphs: hard breaks as line breaks, soft wraps joined by one space.** The wire gains
   `softLines`, the indices (in `lineStarts`' numbering) of the lines whose END was a soft wrap when the block was read,
   strictly ascending, never a block's last line, and checked by `blockEditAgrees`. The writer takes the soft ends from
   the wire and never re-derives them: the read and the write measure the same page with two different geometries
   (a run's text rectangle, an object's bounds), and a soft end decided twice is a diff mapped onto the wrong lines the
   first time they disagree at the margin (B3a).
2. **One function decides a soft end.** `softEnds` in `textLines.ts` is `paragraphText`'s rule — *the next line's first
   word would not have fitted at this line's end* — extracted, so reading, translation and the editor's base text call
   one thing. `document.textBlocks` answers `soft` on every line, REQUIRED (a renderer that omitted it would send lines
   as paragraphs and the diff would be wrong in silence), and the editor builds its text from it.
3. **Every character of the new text belongs to a run (styles follow words).** The block's runs, in order, with a virtual
   one-character join between lines (a space at a soft end, a line break at a hard one), are diffed against the new text
   by `lineEdit`'s rule, widened from a line to a block: common prefix, common suffix, the changed span's new
   characters go to the first touched run. Where the block holds as many paragraphs as the text does, each pair is
   diffed on its own, so a translation keeps each paragraph's own runs, as the line-by-line pairing did. What comes out
   is the paragraphs as **words, each carrying the run that wrote it**; a word set in two runs stays one word that does
   not break between them. A run left with no words is removed.
4. **A paragraph reflows from its first changed line, and stops where it comes back into step.** Lines above the first
   changed line are not touched. From it the words are set greedily to the block's measure, breaking where
   `breakOpportunities` allows (so Thai and Chinese reflow too), and each new line's end is compared with the old line
   ends: where a new break falls on an old one, every line below it is unchanged and is left alone, so typing in the
   middle of a paragraph rewrites the lines the change reaches and no others. Widths are PDFium's own laid-out bounds of
   the object that will be written (ADR-0096's measure: 355 of 457 runs against 176 for summed glyph widths), cached per
   style and word. A line is written as one piece per run of consecutive words, the join space going to the piece before
   it.
5. **A paragraph has a shape, read from its lines by relations and with no constant** (`paragraphShape`, pure): its
   alignment (`left`, `center`, `right`), the first line's indent against the rest (negative for a hanging indent), and
   the space that separates its paragraphs. Two edges agree when they differ by less than one character's width of the
   line they are on, the unit `paragraphText` already uses. Centred lines agree on their centres and not their edges,
   right-aligned ones on their right edges and not their left. A new line takes its shape's edge, so a reflowed centred
   paragraph stays centred. **Justified text is written left-aligned**: PDFium sets a text object's text, not the word
   spacing that spreads it, and the lines a reflow rewrites are ragged on the right where the untouched ones are flush.
   That is stated here and in the help article rather than found by a person. The writer measures the shape from the
   objects' bounds; `document.textBlocks` answers the same function over the read's boxes so the editor can draw it, and
   only the writer's answer decides what is written.
6. **A new paragraph takes the spacing its block already shows.** A block that holds hard breaks with a gap wider than
   its pitch gives a paragraph typed below the same extra gap; a block with none gives none. No constant.
7. **The box draws what the kernel will write.** It wraps at the block's measure in the page's fonts (ADR-0175), takes
   the paragraph's alignment and indent, puts the caret where the click fell, and draws no flat patch over a shaded
   background: where the page behind a block is not one colour the block's own text is hidden by the engine drawing the
   page without it, not by an opaque rectangle. Decided here, built in the UI commits that follow, with a look at each
   state.
8. **Spacing, colour space and render mode are kept, or the edit says what it did not keep.** Measured first
   (`scripts/research/`), because PDFium offers `FPDFPageObj_SetFillColor` in RGB only and `FPDFTextObj_GetTextRenderMode`
   and `SetTextRenderMode`: invisible text from OCR stays invisible only if the mode is copied, and a CMYK or spot fill is
   kept only if the object that carries it is the one written. Any of the three the writer cannot keep is a refusal that
   names it and saves nothing, never a silent change to the page.
9. **Both writers take the wire.** `editTextOperators` (ADR-0176) lays out its words with its own wrap; it takes the same
   paragraphs, soft ends and styled words, from the same pure module, so the Type 3 and the ordinary page do not write a
   paragraph two ways.

## Rejected

- **Alignment and indents on the line writer, left for a later reflow.** Draws the ragged paragraph in the right
  alignment.
- **The renderer sending line breaks and the writer re-joining them.** The renderer shows what is on the page, and a soft
  end re-derived from a different geometry maps the diff onto the wrong lines.
- **A new line for every overflow, as today, with a pass that merges short lines.** Two passes that disagree about where a
  line ends, and the second has to guess the first's style.
- **Re-setting the whole paragraph on every edit.** Rewrites objects the person never touched, moves lines that were
  right, and makes every undo entry a whole paragraph. The re-sync of Decision 4 costs one comparison per line.
- **Justifying by word spacing.** PDFium cannot set it on a text object, and an object per word is a document nobody can
  edit afterwards.
- **A constant for *the same edge* or *a paragraph gap*.** ADR-0096's rule: a quantity the text already carries.

## Proofs

- `paragraphFlow.test.ts`: `softEnds` decides as `paragraphText` did on its existing cases (it now calls it); every
  character of an edited text is attributed to one run and the attributions rebuild the text exactly; a word set in two
  runs does not break between them; the greedy fill breaks where `breakOpportunities` says and a word wider than the
  measure is broken last, by grapheme; the re-sync stops at the first old break a new one lands on. **Control:** a fill
  that ignores the old breaks rewrites every line below, which the case asserts it does not.
- `paragraphShape.test.ts` on generated line boxes: left, centred, right, hanging and first-line-indented paragraphs,
  and a block of one line, which is `left` by the stated limit. **Control:** the same boxes with an edge off by two
  character widths are not read as agreeing.
- `proof:pdfiumcommand`, measured on Linux PDFium 155.0.8044.0: typing a word into the first line of a five-line
  paragraph rewrites lines 1 to the re-sync and leaves the rest byte for byte the same objects; a bold word that wraps is
  bold on the next line; a centred paragraph stays centred; a hanging indent is kept. **Control:** the line-by-line
  writer, put back, leaves the one-word line, so the case fails without the change.
- The same cases through `editTextOperators` on `chromium-type3.pdf`.
- The editor, in the browser: the box wraps where the kernel will, the paragraph's alignment shows, a click puts the caret
  at the click. **Control:** a box that wraps in a different font breaks a line the kernel does not.

## Consequences

- `editTextBlock`, `editTextOperators` and `ai.translatePage`'s answer share the wire, so the change is one in the three.
  The translation already sent paragraphs; it now also says where the old ones end.
- A reflow rewrites more objects than a line edit did, and one undo entry still covers it (the command is terminal and
  undone by its checkpoint, ADR-0096).
- `document.textBlocks` is wider by `soft` and `shape`, REQUIRED, `historyDropped`'s reason.
- Justified text loses its justification on the lines a reflow rewrites. Stated above, in the help article, and not hidden.

## Correction, 2026-10-17 — the proof bullet names a function the build removed (finding VVVVVVV-13)

The first proof bullet says `softEnds` *now calls* `paragraphText`. `4ef4f776`, which carried this ADR's wire, deleted
`paragraphText`: `softEnds` in `textLines.ts` is the rule itself, and the one join between two lines of a paragraph is
`joinAfterLine` in `packages/shared/src/lineEdit.ts`, taken by the editor and the kernel both. The join changed in the
same build from `trimEnd() + ' '` to keeping every trailing space a line already ends in — one space where the line ends
without white space, none where it ends in some, a line break at a hard end. That rule is pinned by
`lineEdit.test.ts`' first case, *one space at a soft end, none where the line already ends in white space, and a line
break at a hard one*, whose control is the hard end that keeps the space a person typed.

## Correction, 2026-10-18 — Decision 8 says what is kept and what is converted (the owner's answer to VVVVVVV-8, (c))

Decision 8 said each of spacing, colour space and render mode is kept *or is a refusal that names it*. The owner's rule
is that a person is never refused because of their document, and PDFium 155's API cannot read an object's character
spacing, word spacing or fill colour space. The owner answered (c) on 2026-10-18, and Decision 8 now reads:

- **Character and word spacing are KEPT.** The writer measures them — each drawn character's origin
  (`FPDFText_GetCharOrigin`) against where the same text set in the object's own font starts naturally — and sets the
  words again with them (`keptSpacing`, `pdfiumFfi.ts`). Measured exact on a fixture set at 1.5 and 4 points, and none on
  every fixture set with none. Not kept, and stated: a run drawn as several joined objects, a run in a right-to-left
  script, and a run whose characters cannot be read one to one; their words are set at the font's own spacing.
- **The fill's colour space is CONVERTED, never refused.** PDFium sets a fill in RGB only, so a line set again in CMYK or
  a spot colour is drawn in the RGB the page showed it as: the same on screen, and printed from RGB.
- **The render mode is kept**, as before (`FPDFTextObj_SetTextRenderMode`).

The help article on editing text says this in one plain line. Proof: `pdfiumCommand.proof`'s `keptSpacingCases`, read by
a second reader, pdf.js: a line set with character and word spacing keeps both when an edit sets it again; the same
reading of the untouched line is the instrument's positive control; CONTROL: the same line with no spacing reads none.
With the measurement disabled the case reads 0.1 of 60.5 points and fails.

## Correction, 2026-10-24 — each paragraph is set by its own edges, and a line starts where its paragraph sets it

Decision 5 gave a BLOCK one shape, its first paragraph of two lines, and the writer set every paragraph from the
leftmost start of any line after the block's first. A block is often several paragraphs with different edges: a
bulleted item and the plain paragraph after it, a hanging-indented item and a line left over from the item before it, a
column of values each at its own place. Measured 2026-10-24 with `editText.proof.mjs` and the writer's planned rows:

| document | the block | what the edit did |
|---|---|---|
| 8, page 3 | two bulleted paragraphs at 95.3 pt and a plain one at 77.3 | measured every line from 77.3, drew the bulleted ones from 95.3: up to 18 pt past the right edge |
| 8, page 4 | an arrow item hanging from 109 to 127, and a one-line paragraph at 127 | set a refilled line of the item under the arrow, at 109 |
| 12, page 1 | one paragraph whose second line stands 19.2 pt right of its edge | refilled that line to the width from the edge, drew it from its own start: 17.4 pt past the right |

The editor drew the same blocks with one shape too, so on opening it put the bulleted paragraphs' words where the page
does not have them. Two decisions, each one rule in one place:

1. **Each paragraph has its own left edge and first-line indent**, read from its own lines by the shape's relations
   (`paragraphEdges`, `paragraphShape.ts`): the leftmost of its lines after the first, and how far its first line
   stands from that. A paragraph of one line has nothing to compare, so it takes the block's indent only where it stands
   where the block's first lines do, and otherwise keeps its own start. Alignment stays the block's. The read sends the
   edges with the block, and the editor draws each paragraph with them; the writer measures and places each paragraph
   with them. A new paragraph is set in the edges of the old paragraph it is — the planner's own answer, by its first
   word that was not typed — which is where the editor's paragraph comes from when Enter splits one.
2. **A line set afresh starts where its paragraph sets it.** The line it replaces keeps its own start only where that
   start agrees with that place, in the shape's unit (a glyph's side bearing); otherwise it is drawn where the editor
   draws it and where its width was measured from. Two equal edges agree whatever the unit, a unit of 0 included.

Decision 2 is built first, in the writer alone, and measured: `operatorEdit.test.ts` sets the refilled line from the
edge and not from its own start, CONTROL a line a side bearing off keeps its own start; over the corpus with
`proof:edittext`, document 12 reads 0 disturbed where it read 2. Decision 1 is built after the editor's own placement of
paragraphs (cloud run 19) is merged, so the two take one function; until then document 8's five disturbed edits, all of
this shape, are its open evidence.

## Correction, 2026-10-26 — Decision 7's box is the rebuilt editor kit's, drawn in the faces ADR-0271 names

[ADR-0271](0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) replaced and deleted the editor that built
Decision 7. The editor kit still wraps a paragraph at the block's measure, takes its alignment and indent, and puts the
caret where the click fell, now on the second click of two (ADR-0271 section 3); but it no longer draws in fonts the
host rebuilds (ADR-0175): unchanged words in the face the page already loaded, changed and new words in the face the
writer will write, and only the paragraphs that changed are drawn, the page's own pixels showing for the rest.
Decisions 1 to 6, 8 and 9, and the corrections above, are the wire's and the writers', and are unchanged.

## Correction, 2026-10-29 — a word wider than the measure is no longer broken

[ADR-0275](0275-a-word-is-never-broken-and-a-word-wider-than-its-block-widens-it.md) supersedes this record's rule,
stated in its Proofs, that *a word wider than the measure is broken last, by grapheme*: in a reference marker's block,
about 17 pt wide, it chopped typed words two letters to a line. A word is now never broken, and a word wider than the
measure widens it for the whole block, in the editor and the writer alike. Everything else here is unchanged.
