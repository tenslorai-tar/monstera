# ADR-0235 — Watermark, headers and footers, and Bates are drawn by the MuPDF writer in the text boxes' faces

- **Status:** Accepted
- **Date:** 2026-10-13
- **Amends:** `docs/ARCHITECTURE.md` §3's content composition row, which names `@cantoo/pdf-lib` for *drawing onto pages
  (watermark, headers/footers, Bates, OCR text layer)*. The OCR text layer is unchanged.
- **Decided by:** the owner's L3, taken on the reviewer's recommendation (the owner may revisit it): *"Watermark, Headers
  and footers and Bates draw through the SAME font path as the rest of the app (the MuPDF host's font resolver), so they
  can use every font in the picker. No second font path through pdf-lib (B3a)."*

## Where it stood

The three page stamps are routed to the pdf-lib byte-image writer (`commandDeclarations.ts`) and draw with
`document.embedFont(STAMP_FONT[family])`, where `STAMP_FAMILIES` is Helvetica, Times and Courier: pdf-lib's standard
fonts, WinAnsi only. So their dialogs offer three faces (`StampFontRow.tsx`), a word outside WinAnsi cannot be drawn,
and the font question has a second answer in the code beside the one every text box, form field and in-place edit takes:
`settersFor(document)` (`textBoxAppearance.ts`), the base 14 where a standard face writes the word in a standard family
and the catalogue's faces otherwise, a `□` for a character no face carries (ADR-0172, ADR-0228 Decision 3).

## Decision

1. **The three commands move to the MuPDF live-session writer** (`writer: 'mupdf'`), and their words are set by
   `settersFor(document)` — the text box's own typesetter, so a stamp and a text box in the same family are the same
   glyphs, subset and named by the same code. Helvetica, Times and Courier stay the base 14's own WinAnsi faces where
   they write the word, so an existing stamp's look does not move.
2. **`family` is any family the picker offers** (`composedFamilySchema`), and each dialog takes the one `FontPicker`
   with this computer's fonts, as Insert from Markdown does. The default stays Helvetica.
3. **The drawing is one appended content stream per page**, the page's own content first bracketed by `q`/`Q`
   (`pageContentWrap.ts`), so nothing the page left in its graphics state reaches the stamp. Each face is written into
   the page's `/Resources /Font` under a name the page does not already use; a watermark's opacity is an `/ExtGState`.
   Positions are taken in the displayed page through the one `PageTransform` (`@monstera/shared`), as `pdfLibFrame.ts`
   did, so a turned page or a cropped one is stamped where the reader sees it.
4. **Undo stays a checkpoint**: capture refuses as before (`CommandPrior` stays `never`). An inverse that restored
   `/Contents` would leave the fonts and graphics states it added in the page's resources, which is a half-restore.
5. **Reproducible stays declared, measured rather than assumed**: a subset's tag is derived from its bytes
   (`fontSubset.ts`' `subsetTag`), so the same command on the same document writes the same bytes; a case asserts it.

## Rejected

- **Keeping pdf-lib and embedding the catalogue's faces through it** (`composeFonts.ts` already does for compositions).
  It would be the second font path L3 rules out: two writers subsetting the same face for the same page, each with its
  own answer to *which face carries this word*.
- **Making the stamps invertible.** Decision 4's half-restore; a checkpoint is what they had.
- **Widening the family and leaving the drawing in pdf-lib with a lookup of the resolver's choice.** A second opinion
  about the resolver's answer (B3a), the shape that agrees with it most of the time.

## Consequences

- `pageWatermark.ts` and `pageStamp.ts` draw through MuPDF; `pdfLibFrame.ts` keeps its other callers.
- The three dialogs list the computer's fonts; their baselines change.
- The proofs and perf scripts that name these three as byte-image commands are updated; the byte-image writer's example
  command becomes `setPageBackground`.
- **Owed on Windows**: the walk stamps in an installed face and reads it back from the saved file.
