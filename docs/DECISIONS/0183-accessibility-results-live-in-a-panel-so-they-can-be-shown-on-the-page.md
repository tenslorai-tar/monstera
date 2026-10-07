# ADR-0183 — Accessibility results and reading order live in a panel, so they can be shown on the page

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** [ADR-0078](0078-the-accessibility-check-is-pdf-ua-object-rules-and-names-what-it-cannot-see.md)'s
  presentation only — a dialog of rules — and the *Reading order* dialog of
  [ADR-0065](0065-a-tagged-documents-structure-is-the-engines-read-on-its-own-request.md). What each check decides, and
  the four verdicts, are unchanged.
- **Found by:** the owner's run of both tools on two test files, 2026-10-06 — *"The checks are correct; the
  presentation is not usable by a normal person."*

## Context

Four things were wrong, and they have two causes.

**An engine's name reached the screen.** The Reading order dialog showed a structure element's name exactly as the
engine reported it, and for one element that name was `NonDtruct`. Mechanism, read 2026-10-06 in the MuPDF 1.28.0 source
this build compiles (`.tools/mupdf/1.28.0/mupdf-1.28.0-source/source/fitz/device.c`, line 966):
`fz_structure_to_string` returns the literal `"NonDtruct"` for `FZ_STRUCTURE_NONSTRUCT`, a misspelling of the standard
type `NonStruct` that the same file's parser (line 1096, `strcmp(str, "NonStruct")`) spells correctly. Nothing here
introduced it and nothing here could have noticed it: the dialog passed `std` through as text. The class is *a name an
engine made reaches a person*, and the next misspelling, or a name a document invents, would arrive the same way.

**A result could not be shown where it is.** The accessibility check lists failures by page, and the Reading order lists
tags by line count, in a modal dialog — which covers the page the result is about. A person told *"Pages 2 and 4"* has to
close the report to look, and then remember it.

The rest follows: the labels were the specification's words (`H1`, `P`, `Lbl`, *0 lines*, *Every link has a description*),
and a failed check said what was required and never what it meant or what to do.

## Decisions

1. **No engine name reaches the screen.** The kernel corrects the engine's own spelling once, where it reads the name
   (`structureTypeName` in `textStructure.ts`: `NonDtruct` is `NonStruct`), so every consumer takes one spelling (B3a). The
   surface shows a name from its own table of the standard structure types, in plain words and through i18n keys, and for
   a type it does not know shows *Other element* — never the string. The document's own tag name, before the role map, is
   no longer shown at all: it is the document's private vocabulary and means nothing to the person reading.
2. **The two reports are one context-panel tab, *Accessibility*,** the fourth beside Properties, Assistant and Spelling
   ([ADR-0156](0156-spelling-is-reviewed-a-word-at-a-time-beside-the-page.md)'s pattern: a tab, state held per document in
   its store, the command that opens it also starts it). The panel is not modal, so the page stays in view.
   *Accessibility check* and *Reading order* open it at their own section. The two dialogs are removed.
3. **Clicking a result or a reading-order item shows it on the page.** The page scrolls to it and a box is drawn over it
   by a layer that takes no pointer (`SpotlightLayer`, the comparison layer's shape). A box is the engine's own display
   space at scale 1 and is placed by `engineBoxOnScreen`, the one conversion every engine box takes. What the
   engine can locate is located: a reading-order item is the union of the text lines inside it; a link, comment or form
   field without a description is the annotation's own bounds. A result the engine can place only on a page — a figure
   without alternative text, a tag that maps to no standard one — outlines that whole page. A result about the file as a
   whole (metadata, the title, the tag tree) has no place and says it applies to the whole file.
4. **Each failed or undecided check says, in one line each, what it means and how to fix it.** The label stays short; the
   meaning is the sentence a person reads (*A link has no description: screen readers cannot say where it goes.*), and the
   fix names what a person can do. Where Monstera cannot make the repair, the line says whose it is — the program that
   made the file — rather than promising a tool that does not exist.
5. **The help articles for both tools are rewritten to match,** with their screenshots re-captured.

## Rejected alternatives

- **Keep the dialogs and add a *Show on page* button that closes them.** The report is gone the moment it is used, and
  the next result needs the command run again. It treats the modal as fixed and the page as the thing to move.
- **A non-modal dialog.** The dialog primitive's whole contract is a trapped focus and a scrim (`Dialog.tsx`); a
  non-modal one would be a second primitive beside the panel the project already has for exactly this.
- **Highlight through the text layer's lines** (the way Find paints a match). The structure read breaks lines
  differently from the plain read on 8 of 12 tagged corpus pages (ADR-0065's correction), so a line index from one is not
  a line of the other. Boxes from the structure read itself cannot disagree with it.
- **Fix the misspelling by patching the MuPDF source.** The engine is a pinned, checksummed build; the correction
  belongs in the one place this repository reads the name, and survives an upstream fix because the correct spelling maps
  to itself.
- **Show the raw name when the table has no entry.** That is the defect: *no engine or tag name reaches the screen* is
  checkable only if the fallback is a word of ours.

## Consequences

- A proof that cannot be satisfied by the typo: the table covers every standard type the kernel recognises, a name the
  table lacks renders as *Other element*, and the engine's misspelling is read as `NonStruct` (the control — without the
  correction the case reads `NonDtruct` and fails).
- The visual baselines that show either dialog are replaced by the panel's; `docs/FEATURES.md` rows for both tools change.

## Correction, 2026-10-07

Decision 2 made the two tools a fourth tab of the right panel. The owner's review of 0.1.12.0 refused it: four tabs do
not fit the panel's default width, so the Assistant — the panel's main tool — was drawn as an icon, to give room to a
tool opened once per file. [ADR-0189](0189-the-accessibility-tools-open-in-the-document-panel-while-in-use-not-as-a-fourth-tab.md)
moves the tools to the left document panel, shown only while they are in use. Decisions 1, 3, 4 and 5 stand unchanged,
and the click-to-highlight in particular is kept.
