# ADR-0173 — An edit's word its font cannot carry is its own piece, in the resolver's face

- **Status:** Accepted
- **Date:** 2026-10-05
- **Amends:** `docs/ARCHITECTURE.md` §3's *In-place text editing* row: how an edit in the PDFium host sets a word the
  run's own font cannot carry, now that [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
  has withdrawn the standard twin that did it.
- **Relates:** [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
  (the resolver, Decisions 1, 5 and 8, and its correction of the same day),
  [ADR-0169](0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md) (every write read back before it is
  saved), [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md) (the block editor's layout),
  [ADR-0097](0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md) (the twin).
- **Context:** Part B, Phase 1. ADR-0172 Decision 1 names the in-place editor and Replace as the resolver's callers and
  the owner's Q6 (b) as their rule: *the whole word goes into the nearest matching font, and the rest of the line keeps
  the document's font*. The block editor today replaces a whole run with a twin in a standard font when the run's font
  cannot carry what was typed (`pdfiumFfi.ts`, ADR-0097), which is a whole-run change, not a word's, and WinAnsi only.

## What was measured

All on PDFium 155.0.8044.0's Linux build, pinned for development and tests (c10d9807), with the bundled Arimo and
Noto Sans Symbols 2, generated text, 2026-10-05 (scratch probes `editWordFace.mjs` and `astralReadBack.mjs`):

- **A word in another face beside the run's own font reads back whole.** A line made as three objects, Helvetica
  `Hello`, a uniquely named Arimo subset loaded with `FPDFText_LoadFont` as a CID TrueType font carrying ` Привет`, and
  Helvetica ` world`, each placed after the one before at its measured `FPDFPageObj_GetBounds` right edge: PDFium's text
  page reads `Hello Привет world`, MuPDF reads `Hello Привет world`, and pdf.js reads `Hello`, ` `, `Привет`, ` `,
  `world`.
- **The space before such a word belongs to the word's piece.** With the space at the end of the Helvetica object
  instead (`Hello ` then `Привет`), pdf.js read `Hello` and `Привет` with no space between: it drops a standard-font
  item's trailing space when the next item starts flush against it. PDFium and MuPDF read it either way.
- **PDFium writes no Unicode for a character past the BMP.** `!` U+10140 `!` set through `FPDFText_SetText` in Noto
  Sans Symbols 2: `SetText` answers 1, the text page counts three characters and answers code point 0 for the middle
  one, the saved file's ToUnicode has no entry for it, and MuPDF reads U+FFFD. Today's read-back refuses such an edit,
  correctly, because PDFium did write it wrong.
- **A ToUnicode written by us after the save is what every reader reads.** The missing-character box, U+25A1, set in
  a one-glyph Arimo subset of its own, reads `□` everywhere as PDFium wrote it (`<0001> <25A1>`). With that font's
  ToUnicode replaced after the save to map its one code to 中, PDFium reads `Box 中 here`, MuPDF `Box 中 here` and pdf.js
  ` 中`.

## Decision

1. **A word the run's own font cannot carry is its own piece**, a new text object in the face the resolver chooses for
   it (ADR-0172 Decision 1), and the rest of the run stays in its own font. A run whose new text is `a b c`, with only
   `b` beyond its font, becomes three objects, `a`, ` b` in the chosen face, and ` c`, where it was one. The word is an
   `Intl.Segmenter` word segment, the resolver's unit; where no face carries a whole word, the resolver's split by
   grapheme (ADR-0172's correction) decides the pieces.
2. **The space before such a word is in the word's piece**, which the face carries (measured above). A word at the
   start of a run has none to take.
3. **Each piece is placed by its measured bounds**, the next piece starting at the right edge of the one before, and the
   runs after it on the line move by the difference as ADR-0096 Decision 5 already moves them for a run that grows. No
   width is computed by arithmetic of ours.
4. **The faces are the resolver's, in its order**: the run's own font first, then a font already in the document for
   another run of the same base name (a sibling, whose font handle PDFium hands back for a new object), then the
   catalogue the PDFium host reads from the bundled fonts folder, as the compose host does. The installed fonts join
   when ADR-0172 Decision 2's measurement of the host's reach is made.
5. **A face is loaded once per command, as one uniquely named subset** (`TAG+Name`, ADR-0172 Decision 5) of exactly the
   characters its pieces need, with `FPDFText_LoadFont` as a CID TrueType font. A face HarfBuzz cannot subset goes in
   whole where its licence allows, or is passed over.
6. **Every font a command loads has its ToUnicode written by us after the save**, from what the command set: for each
   glyph of the subset, the text it stands for. That is what makes a character past the BMP readable (measured above),
   and it is what keeps the real character under a box.
7. **A grapheme no face carries is the missing-character box** (ADR-0172 Decision 8): the U+25A1 glyph, in a one-glyph
   subset of its own per distinct character, so its one code can stand for that character in the ToUnicode of point 6.
   The person is told which characters and where, as the composers tell them.
8. **The read-back reads the bytes point 6 wrote**, by code point (`FPDFText_GetUnicode`), never one UTF-16 unit per
   index. The ToUnicode is written between PDFium's save and the read-back, inside `serialise`, so nothing is saved that
   was not read back.
9. **Replace takes the same pieces** (ADR-0169's Replace, ADR-0172 Decision 1). Its line rule
   (`replaceLineRule.ts`) still refuses a replacement that would move the text after it; a piece is placed inside the
   object's own run and changes nothing about that rule.

## Rejected

- **Keeping the whole-run twin, in a resolver face rather than a standard one.** It would carry more scripts and still
  set every word of the run in another font for one letter, against the owner's Q6.
- **Setting the box glyph and leaving PDFium's ToUnicode.** Every reader would copy `□`, not the character, against
  the owner's Q5.
- **`/ActualText` for the real character.** pdf.js ignores it (measured for ADR-0172).
- **One box font for every missing character.** Its one glyph has one code, and one code maps to one text in a
  ToUnicode: two different characters under one code would copy as one of them.
- **Writing the new text through MuPDF.** The editor's host holds no MuPDF, and the edit's reflow is PDFium's layout
  (ADR-0096).

## Consequences

- An edited run can become several objects where it was one, and its undo is the checkpoint ADR-0169 already takes for
  a write that adds objects.
- The PDFium host reads the bundled fonts folder, by argument and the grant the compose host has.
- A document can now carry a subset font an edit embedded, inside its encryption when it has one (ADR-0171).
- The overflow of a block past the page (the owner's Q7) is not this decision's; it is the next piece of P1.
