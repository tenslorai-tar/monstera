# ADR-0176 — A page holding Type 3 text is edited in its own content stream, by MuPDF, changing only the edited instructions

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row (which engine writes an edit, and when). Adds a command,
  `editTextOperators`, routed to the MuPDF writer, and a per-page field to `document.textBlocks`' answer.
- **Relates:** [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md) (blocks edited in place),
  [ADR-0169](0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md) (a PDFium rewrite is saved only when
  it reads back as edited, the read-back that refuses a Type 3 page today), [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
  (the resolver), [ADR-0173](0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
  Decisions 4 and 7 (a sibling font, the box), [ADR-0047](0047-an-in-place-text-edit-is-a-byte-image-command.md) (PDFium
  is a byte-image writer).
- **Context:** Part B Phase 1, the brief's *Type 3 via a MuPDF-side writer changing only edited instructions (new seam,
  ADR)*. A page Chromium prints carries its text in Type 3 fonts, and since ADR-0169 every PDFium command on such a page
  refuses at its read-back with *This page uses a font Monstera can't rewrite yet, so nothing was changed*. Nothing is
  lost, and nothing can be edited.

## Is this the right question

The question as the brief puts it is *how does a Type 3 RUN get edited*, and the measurement below says the unit is
wrong: the defect is the PAGE's. `FPDFPage_GenerateContent` regenerates every text object of a page it touches, and
writes each Type 3 one with no `Tf`, no text and no `ET` (`fontKindEdits.mjs`, 2026-10-04: 1,518 text operators before,
1 after; deleting a Helvetica line on a Type 3 page erased the Type 3 lines beside it). So a page holding any Type 3 text
cannot be edited through PDFium at all, whichever line is edited and whatever font that line is in. The switch is per
page, and on such a page the whole edit, Helvetica lines included, goes to the writer this ADR adds.

The second premise worth checking is that the new writer must re-derive what the editor names. The editor names runs
by PDFium's index (`document.textBlocks`), and a writer that does not run PDFium needs the same numbering from the bytes.
Measured, it has one (below), so the editor and its reading are unchanged and only the writer differs.

## What was measured

`scripts/research/type3Correspondence.mjs`, 2026-10-06, PDFium 155.0.8044.0's Linux build, generated fixtures and the
committed Chromium print (`packages/testing/fixtures/text-edit/chromium-type3.pdf`):

- **PDFium's k-th text object is the page's k-th text-showing operator (`Tj`, `TJ`, `'`, `"`) at page level that shows
  at least one character code.** An operator that shows none (`() Tj`, a `TJ` of spacing alone) makes no object. Every
  shape agrees: an ordinary Helvetica page 3 of 3 (the instrument's positive control), the hand-built Type 3 page 3 of 3,
  a page of hard shapes 8 objects for 10 operators (the two empty ones skipped; the quote operators, clip-only text,
  marked content, a saved state and a `Tf` naming an absent font all counted), and the Chromium page 60 of 60. The only
  length differences are PDFium giving a space's character to the object before it, and two-byte CID codes.
- **Chromium writes one `BT` per line**, one `Tm`, then each glyph as `dx 0 Td <code> Tj`: a glyph's position is a move
  from the line's origin, not the advance of the glyph before it.
- **Its Type 3 fonts are subsets**: codes are glyph numbers, `/Differences` names them `g0`…, a ToUnicode maps only the
  glyphs present, and the descriptor names the face (`AAAAAA+LiberationSans`, weight 400). The same page's body text is a
  Type0 font of the same face, a sibling by ADR-0173 Decision 4's rule.

## Decision

1. **A page needs this writer when its own content shows text in a Type 3 font**: a page-level text-showing operator
   whose `Tf` names a font resource of `/Subtype /Type3`. MuPDF reads it (the PDFium API has no font-type query) with the
   numbering module of Decision 3, and `document.textBlocks`' answer carries it per page as `rewrite: 'objects' |
   'operators'`. The renderer sends `editTextBlock` for the first and `editTextOperators` for the second, with the same
   block wire (`blockEditOf`), so the editor's surface does not change.
2. **`editTextOperators` is its own command, routed to the MuPDF writer** (one writer per kind, B3). MuPDF holds the
   document, saves incrementally and keeps a protected document protected (ADR-0171), which a splice through another
   library would have to re-derive. It carries the page, the version the blocks were read at, the blocks, and the number
   of text objects PDFium read on that page: a content stream whose count of showing operators differs is refused whole,
   so the numbering of Decision 3 is checked on every edit and never assumed.
3. **One module, `textOperators.ts` in the kernel, owns the numbering**: it tokenises a page's content (its streams
   joined as ISO 32000 joins them), interprets the text state (`Tf`, `Tm`, `Td`, `TD`, `T*`, `TL`, `Tc`, `Tw`, `Tz`, `Ts`,
   `Tr`, the quote operators' own moves), and answers each showing operator's byte span, font resource, text state and
   codes, numbered by the rule measured above. Nothing else spells the rule (B3a).
4. **Only the edited instructions change.** Each operator of an edited run keeps its place and loses its glyphs: its
   operand becomes a `TJ` of spacing alone with the same advance, so nothing after it moves, whether the page positions
   glyphs by move (Chromium) or by advance. The new words are one self-contained text object, `q BT … ET Q`, placed
   immediately before the `BT` of the run's first operator and so inside the same marked content: it sets its own font,
   size, render mode, spacing and matrix from the state measured there, and saves and restores everything it sets. No
   other byte of the page changes.
5. **Each word is set in the first face that carries all of it**, ADR-0172's order with the page's own fonts first: the
   run's font (its ToUnicode read backwards to a code that has a glyph); a sibling on the page, the same face by
   descriptor name less its subset tag and the same weight, of any font type; the resolver's face, its HarfBuzz subset
   added to the page's resources as a Type0 font with a ToUnicode; the missing-character box of ADR-0173 Decision 7.
   Lines are broken at the block's width, measured from the old operators' own extents, at the old lines' pitch; a block
   that grows past the page is ADR-0096's and the owner's Q7 rule, kept.
6. **It is read back before it is kept.** Every operator outside the edited runs must be byte-identical and in order,
   every edited operator must show nothing, and MuPDF's own reading of the page must hold the typed words where the block
   was. Anything else refuses the whole command, writes nothing, and says *This page uses a font Monstera can't rewrite
   yet, so nothing was changed*.
7. **Undo restores the page's content and the fonts the edit added**, which are its prior; a prior past the bound the
   undo log records is a checkpoint, as every MuPDF command's is.
8. **Scope.** In-place editing and Translate, which send `editTextBlock`. Replace, Replace All, move, recolour and
   delete on such a page keep refusing with the owner's sentence until a later piece gives them the same writer; that is
   stated on their `docs/FEATURES.md` rows, never left to be discovered.

## Rejected

- **Making the page's Type 3 text regenerable first** (every Type 3 object rewritten in a resolver face, then PDFium
  edits as today). It changes how every untouched line looks, which is the loss this ADR exists to prevent.
- **Building or patching PDFium.** The branch that drops a Type 3 object is in PDFium's own generator
  (`core/fpdfapi/edit/cpdf_pagecontentgenerator.cpp`, main branch read 2026-10-04); this repository ships pinned
  binaries and does not build PDFium.
- **MuPDF's content filter.** It re-emits every operator through its own processor, so the page is rewritten whole and
  normalised, which is not *changing only the edited instructions*, and the bound object model does not expose it.
- **A splice in the PDFium host with pdf-lib.** pdf-lib re-serialises the whole file and does not write encryption.
- **Choosing the writer in `main` from the command.** A second router beside the routing table; the page's need is a
  fact of the read the renderer already holds, and the renderer choosing from it is visible in one place.
- **Inserting the new words inside the run's own `BT`.** It must then restore a text matrix and a line matrix that
  `Tj` advances apart, which one `Tm` cannot; a separate object before the `BT` restores nothing because it changes
  nothing outside itself.

## Consequences

- A Chromium print, and any page whose text is Type 3, is editable in place; every untouched glyph keeps its exact bytes.
- The editor's reading stays PDFium's. The writer reproduces PDFium's numbering from bytes and checks it against
  PDFium's count on every edit, so a page where the two diverge refuses rather than edits the wrong run.
- A second in-place writer exists, for a different page condition. The condition is decided once, in the reading, and
  both writers take the same block wire.

## Correction, 2026-10-06: the writer is handed PDFium's joined runs, and the count rides with them (Decision 2)

Found while reading the block wire before building the writer. A run crosses as its FIRST object only, and on a page
drawn a glyph per object a run is many objects joined by `textRunJoin.ts` (ADR-0130), whose members are an explicit
list rather than a range: an inkless space between two glyphs is not one of them. The MuPDF writer cannot recompute
that join, which reads PDFium's glyph boxes, and a join of its own would be a second opinion about which objects a run
is (B3a).

So `editTextOperators` declares a pre-read (ADR-0040's `reads`, ADR-0051's `PreReadKinds`): `pageRuns`, PDFium's walk of
the page as the PDFium host answers it, its joined runs with their members and the number of text objects it walked.
The bus resolves it against the version the command names. The count Decision 2 put on the command comes from that
pre-read instead, which is the same check from the reading that already holds it, so the command carries exactly
`editTextBlock`'s fields.

**Note on Decisions 4 and 5, 2026-10-06, as built (`packages/kernel/src/operatorEdit.ts`):** three things the writer had
to decide that the text above leaves open.

- **Which operators an edit sets again.** Each typed line is diffed by `replacementsForLine`, the PDFium writer's own
  rule. The runs before the first run the diff names keep their operators; from that run to the end of the line every
  run is set again in its own state, keeping the gap it had to the run before it, because a run that grows has to push
  the ones after it and an operator positioned by a move cannot be pushed without being rewritten. A line that a wrap
  above it moved down is set again whole. A line the edit did not reach keeps every byte.
- **A sibling's weight.** *The same weight* is read as *no stated weight that differs*: the committed Chromium print's
  Type0 body font states no `/FontWeight` beside its Type 3 heading's 400, of the same face, and requiring both to be
  stated would have refused every word the heading's subset lacks on the one page this ADR was written for.
- **A word space neither font draws** is moved, never drawn, by 0.278 em, the space advance of Liberation Sans and of
  Helvetica. The Chromium subsets draw their spaces (code 3), so on that page the gap comes from the font itself.

**Note on Decision 2, 2026-10-06: how the command and its pre-read reach the MuPDF host.** Two facts decide it, and
neither is a choice. The command carries `editTextBlock`'s block wire, which ADR-0138 Decision 4 measured past the frame
at its schema's worst, so it cannot travel by MuPDF's framed `engine/apply`, whose route ADR-0138 Decision 2 declares
`frame` and keeps there. And the `pageRuns` pre-read has never crossed into a MuPDF host: no MuPDF command declared
`reads` before this one, as `remoteEngine.ts`' apply records, naming this day as the one `engine/apply`'s schema has to
grow.

So the MuPDF host gains `engine/apply-file`: `engine/apply`'s request and handler, file-requested by ADR-0125 Decision
7's route, for the MuPDF kinds declared to need it, with the pre-read in the same request under the 8 MiB ceiling.
**Declared per kind, never chosen by size**, ADR-0138's rule: `editTextOperators` is the kind, and a MuPDF kind that
grows past the frame still turns the request rule red. The pre-read is the PDFium host's `engine/page-runs` answer,
which crossed under the same ceiling, so it joins `engine/applyPdfLib`'s pre-read in ADR-0138 Decision 4's pinned
exceptions for the same reason. One schema, `host/pageRunsWire.ts`, is that answer and this request's field.

**Rejected:** moving every MuPDF kind to a file route (a file write per rotation, for the one kind that needs it); a
pre-read slot on the framed `engine/apply` (the kind is past the frame without it); the host computing the runs (it has
no PDFium, and the join reads PDFium's glyph boxes).

## Correction, 2026-10-06 — Decision 7's prior is not built; the checkpoint is the undo

The owner decided, asked directly, that the whole-document checkpoint the bus already takes for this command is its
undo and stays so. Decision 7's content-and-fonts prior — restoring only the page's content and the fonts the edit
added, with the checkpoint as the fallback past the undo log's bound — is not built. The reason given: the checkpoint
restores the whole document and loses nothing an inverse would have put back, and "safe over small." So Decision 7
above records the prior as the **rejected** alternative rather than owed work; `captureEditTextOperators` answers
`CHECKPOINTED` and `invertEditTextOperators` is unreachable, by decision rather than pending a next piece. This changes
no behaviour — the command has always checkpointed — only the standing of the prior, which until now read as owed in
this ADR, `docs/ARCHITECTURE.md` §9's in-place editing row, and the two kernel sites named above.

## Correction, 2026-10-06 (later): where a block's object goes, and what the writer now carries (Decisions 4 to 6)

[ADR-0188](0188-a-type-3-page-is-moved-resized-turned-added-to-joined-and-split-by-the-operator-writer.md) changes two
things this ADR states. The object a block's added lines are written as goes **after its last run's text object** where only
lines were added below the block, and not before that object's `BT`: measured, a join of two Type 3 headings was read by
MuPDF in the wrong order and refused by the structural read-back. And the writer now places a block (one `cm` in front of
its object, the lines it did not change carried as their operators were) and writes a box added to the page, which
Decision 5's *changing only the instructions it edits* did not mention because neither was asked of it then.
