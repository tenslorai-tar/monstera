# ADR-0267 — Find & replace and spelling replacements write through the block writer

- **Status:** Accepted
- **Date:** 2026-10-24
- **Amends:** the find bar's *Replace all* and the spelling review's *Replace* and *Replace all* on page text, which sent
  `replaceAllText` and `replaceTextAt` (PDFium's whole-page rewrite). `docs/ARCHITECTURE.md` §3's in-place editing row
  gains them. [ADR-0200](0200-commands-the-person-made-in-one-gesture-are-one-undo-step.md) (one gesture, one undo step)
  is used, not changed.
- **Relates:** [ADR-0266](0266-edit-text-writes-only-the-edited-blocks-own-instructions.md) (Edit text's writer, and the
  measurement that PDFium's page rewrite re-fonts and moves text nobody edited),
  [ADR-0249](0249-a-paragraph-that-grows-pushes-the-text-below-it-down.md) (a block that grows pushes the text below).
- **Decided by:** the owner, 2026-10-24, answer B: *"same class as item 3, so fix it in THIS round: route them through
  the same writer that changes only the edited blocks' bytes (one writer for every text change, B3a), never PDFium's
  whole-page rewrite."*

## Context

ADR-0266 moved every Edit text change to the operator writer because PDFium's page rewrite writes every object of a page
again: on the owner's brochure it merged two font subsets of one name, and on a page with text packed in a form it moved
text and pixels on every edit. *Replace all* (find bar and spelling) and a spelling replacement of one word reach page text
through `replaceAllText` and `replaceTextAt`, both PDFium writes of the same kind, so they carry the same defect. Two
writers for one property of a page — its words — is B3's second writer.

## Decisions

1. **Page text is replaced by the block writer, `editTextOperators`, page by page.** For a *Replace all*, each page
   where the page search (`document.searchPage`, the find bar's own) finds the query is read as Edit text reads it
   (`document.textBlocks`, every part); in each block's words, as the editor joins them, every match of the find bar's
   own compiled query (`compileQuery`, normalisation `none` so offsets index the words) is replaced by the one splice,
   `replaceMatches`; and the page's changed blocks go in ONE command, each carrying the blocks below it in its column
   that the replacement did not change, to be pushed down by what it grew (ADR-0249). Every page's command joins the one
   before it (ADR-0200), so a *Replace all* is one undo step. A match that crosses two blocks is not reached, as a match
   crossing two objects was not.
2. **One function decides the edit, `blocksReplaced`, in the contract beside `blockEditOf`**: the blocks of a page, a
   compiled query's matcher and the replacement in, the block entries out. The surfaces and `proof:edittext` call it,
   so what the proof writes is what a person's *Replace all* writes.
3. **A spelling replacement of one word** names the word's point on its page (as it did for `replaceTextAt`): the block
   whose box holds the point is read, and the occurrence of the word replaced is the one whose run holds the point, by
   the runs' order in the block; it is one command of that block, with its pushes.
4. **`replaceAllText` and `replaceTextAt` stay registered and are sent by no surface.** Their proofs stay. Nothing about
   text in comments and form fields changes: those are their own edits already.

## Rejected

- **A document-wide MuPDF command** carrying every page's blocks: the operator writer needs PDFium's numbering of each
  page as a pre-read, which a command declares for one page; a document-wide one would make `main` pre-read every page
  the search did not rule out inside one command, for an undo step ADR-0200 already gives.
- **Keeping PDFium's replace and refusing where it would disturb**: its read-back does not see the disturbance
  (ADR-0266's correction), and on the brochure every page refuses.
