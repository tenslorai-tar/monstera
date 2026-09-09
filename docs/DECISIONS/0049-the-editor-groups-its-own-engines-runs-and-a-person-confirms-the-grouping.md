# ADR-0049 — The editor groups its own engine's runs, and a person confirms the grouping

**Date:** 2026-09-09
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §3.2 and takes
[ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)'s
route 2**, which reserved *"a recorded engine gap — name what was checked and
what is missing, in an ADR, so the matrix stays truthful"* for the case where
the engine's own answer is unavailable. The architecture amendment is a separate
commit (B4). It does **not** disturb ADR-0034's decision for the reading
substrate: MuPDF still groups, we still own only its options, and nothing here
is consumed by search, extraction or export.

---

## The problem, in one sentence

`docs/FEATURES.md`'s *in-place text editing: line-level* row asks for a visual
line, and the only two engines that could say what a line is either answer about
a document model the edit cannot address, or do not answer at all.

## Why the obvious answer is banned, and by a measurement rather than a rule

The reader already has lines: `document.pageTextLayer` carries MuPDF's structured
text, and the user is looking at them. Joining a line there to the page objects an
edit replaces is the shape this stage has refused since its first command —
`commandDeclarations.ts` gives `replaceTextObject` `targets: 'text-object'`
precisely because a page-object index is *a different engine's numbering*.

It is refused on evidence, not on principle. `npm run proof:lineagreement`, over
the three corpus documents that carry text, scored **52.9% of our lines verbatim**
among an independent reader's. Two engines agree about half the time on what a
line is, so a join would replace the text the user pointed at about half the time
— silently, with an undo that restores something they did not mean to change.

## What was measured, and the commands that established it

**`scripts/research/pdfiumTextExports.mjs`, PDFium 155.0.8044.0, 2026-09-09.**
The pinned DLL exports **467** names, of which `FPDFText_` is **37**,
`FPDFPageObj_` **40** and `FPDFTextObj_` **7**. The script prints all three
families in full, because *there is no such call* is a search and a search's
silence is its most convincing failure — a reader can inspect the set rather than
take the claim.

**`scripts/research/pdfiumLines.mjs`, same build, same day.** Two findings, and
the second is what makes this row buildable at all.

- **PDFium does not group runs into visual lines.** `FPDFText_CountRects` answers
  **4** for a page of four runs — two of them sharing a baseline — and answers
  **4** again when those two are moved from 170pt apart to 3pt apart. The rects
  are per-RUN, and a per-run grouping is a restatement of the object list. So
  ADR-0034's route 1, *an option on the engine's own answer*, has nothing behind
  it here: there is no answer to configure.
- **`FPDFText_GetTextObject` maps a character to its page object, and it works.**
  40 of 45 characters resolved to the four text objects. The other five are
  PDFium's **generated** characters — spaces it believes are implied by spacing
  rather than drawn — which belong to no object and which `FPDFText_IsGenerated`
  identifies. So a range of text converts to a set of editable objects **inside
  one engine's frame**, with no join.

## Decision

**1. The editing engine's text is read through PDFium alone.** No line, offset or
index produced by the reading substrate ever names an editing target. This is
`targets: 'text-object'` restated one layer up, and it is what the 52.9% figure
buys.

**2. The editor owns a grouping of PDFium's runs into visual lines, and it has no
tunable constant.** Runs are grouped when their vertical extents **overlap** —
a relation, not a threshold. Exact equality was rejected on the measurement
above: two runs drawn on one baseline in one font came back with tops of 237.9
and 238.0, so equality splits the very case the grouping exists for. Overlap
groups them and separates lines 40pt apart, and there is no number for anybody to
tune, which is the property ADR-0034 chose over an algorithm in the first place.
`BUILD-PROMPT.md` E2's *"constants change only with a corpus score in the commit
message"* survives with nothing to govern here, exactly as ADR-0034 left it for
the reading side.

**3. A person confirms the grouping before anything is written, and that is what
keeps it outside ADR-0034's ban.** That ADR's test is *does it read a coordinate
to decide grouping* — this does, and the reason it is not the second extraction
path E2 forbids is what the output reaches. An extraction path's grouping becomes
text somebody reads as the document's content: it feeds search, export and the
text layer, and a wrong answer is silent. This grouping reaches **a dialog and
nothing else**. The user sees the words that will be replaced, types their
replacement, and can dismiss.

So the rule is checkable rather than a judgement, which is the property ADR-0034
insisted on: **does this grouping's output reach any consumer other than a dialog
a person answers?** If it ever does, it has become an extraction path and this
ADR stops covering it.

**4. What the user chooses from is TEXT, not indices.** `FPDFText_GetTextObject`
is what makes this possible and it is why the *region replacement* row shipped a
chooser of bare numbers: that row's channel deliberately carries no text, on the
grounds that an object's string is prior state. This row does not inherit that,
because the text here is not prior state to restore — it is the thing being
edited, and a person cannot edit what they cannot see.

## Rejected alternatives

- **Join MuPDF's lines to PDFium's objects by geometry.** Measured at 52.9%
  line agreement. It is the failure `pageNumbering.ts` exists to prevent, one
  engine worse, and with no shown value to disagree with.
- **Use `FPDFText_CountRects` as the line grouping.** Measured: 4 rects for 4
  runs at both separations. It is the object list wearing a grouping's name, and
  building on it would have produced a *line* editor that edits one run.
- **A vertical-overlap TOLERANCE rather than plain overlap.** A constant
  "required to mirror exactly" is the exact failure Part E2 describes, and it
  would owe a corpus score this project has already recorded it cannot produce
  from three documents.
- **No line-level editing.** The region-replacement row ships the primitive, and
  its own body says what that leaves: a chooser of numbers. A stage that stopped
  there would have built the mechanism and none of the feature.
- **Ask MuPDF for the grouping and PDFium for the objects, joined by TEXT rather
  than geometry.** Matching a line's string against object strings is a second
  opinion about a correspondence neither engine states, and it fails on exactly
  the documents where it matters — repeated text, hyphenation, and PDFium's
  generated spaces, which MuPDF does not insert.

## Consequences

- `pdfiumFfi.ts` binds `FPDFText_CountRects`, `FPDFText_GetRect`,
  `FPDFText_GetBoundedText`, `FPDFText_GetTextObject` and `FPDFText_IsGenerated`.
  Each is exported by the pinned build (`pdfiumTextExports.mjs`).
- The grouping lives in `packages/kernel`, beside the adapter and behind one
  interface, and its only caller is the channel that feeds the dialog. A second
  caller is the trigger for re-reading Decision 3.
- **The editor's line count and the reader's may differ on one page, visibly.**
  That is honest rather than a defect: the two are answers about two document
  models, and this stage's whole position is that pretending otherwise is what
  replaces the wrong text. The dialog shows the runs it will replace, so what a
  person confirms is the editor's grouping and not the reader's.
- `docs/ARCHITECTURE.md` §3's engine matrix gains the gap this ADR records:
  PDFium groups characters into per-run rects and offers no line, and the
  character-to-object mapping it does offer is what the editor is built on.
