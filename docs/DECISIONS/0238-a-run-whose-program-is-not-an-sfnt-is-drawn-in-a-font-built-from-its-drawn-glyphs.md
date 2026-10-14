# ADR-0238 — A run whose program is not an sfnt is drawn in a font built from its drawn glyphs

- **Status:** Accepted
- **Date:** 2026-10-14
- **Amends:** [ADR-0175](0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md) Decision 1 (a run's
  font is built only from an embedded sfnt) and its Rejected entry *building a font from PDFium's glyph paths*. Its
  Decisions 2 to 5 (the check, the host building it, the read per block, the renderer's `FontFace`) are unchanged.
- **Decided by:** the owner's cloud run 4, addendum item A1: *"the editor changes the look. Serif with bold lead-ins turns
  into plain sans while editing."* Taken without asking, by the run file's rule: the recommendation is the owner's
  principle that the editor shows the page as it is.

## Where it stood

ADR-0175 draws a run in its own font only where the embedded program is an sfnt whose `cmap` glyphs read, edge by edge,
as PDFium draws them. Every other run is drawn in its *kind of face*: a Type 1 program, a bare CFF program, and a
TrueType program whose `cmap` names other glyphs than the page draws. Its Consequences say so: such a run *"is edited in
its kind of face, as today, and says nothing about it"*.

That is most of the documents the owner's A1 is about. pdfTeX embeds Type 1 (Computer Modern, and Times as
`NimbusRomNo9L`); LibreOffice converts an OpenType CFF face to a Type 1 program (measured 2026-10-14, the A1
investigation: Inter exported as `FontFile`); print drivers and Ghostscript write bare CFF. A serif page with bold
lead-ins from any of them turned into a sans in the editor the moment a block opened.

## Decision

1. **Where the program offers no font, one is built from what PDFium draws.** For an EMBEDDED font only (ADR-0175
   Decision 1's line about a substitute stands: a font that is not embedded is PDFium's choice, not the document's), each
   character the page sets in the font is read as PDFium draws it — `FPDFFont_GetGlyphWidth` and
   `FPDFFont_GetGlyphPath` at a size of one em — and an OpenType font with CFF outlines is written from those numbers
   (`pathFont.ts`): a glyph per character, its charstring the path's moves, lines and curves, its width PDFium's.
2. **CFF outlines, so nothing is converted.** PDFium's glyph paths are cubic, and so are CFF's: each segment is written as
   it was read. The `cmap` maps each character to the glyph built from its own path, so the font draws what the page
   draws by construction; ADR-0175's check compares a program's glyph with PDFium's, and here there is no second glyph to
   compare — the path IS the reading.
3. **Nothing of the document's program reaches the renderer.** The font is numbers this application wrote: no producer
   table, no hinting, no bytecode. Chromium's OpenType Sanitizer still runs over it, as over every run font.
4. **Under the same bounds**: `MAX_RUN_FONT_BYTES`, and at most `MAX_PATH_GLYPHS` (4,096) characters, past which the run
   is drawn in its kind of face as before.
5. **The program's own font still comes first.** Where ADR-0175's check passes, the program's rebuilt subset is used,
   since it also draws a letter the person types that the page holds nowhere. A built font holds only the page's
   characters; a typed one it lacks is drawn in the run's kind of face, which since 2026-10-14 reads the program's weight
   and the family's class (`fontFace.ts`, `familyClass`).

## Measured, 2026-10-14

PDFium 155.0.8044.0's Linux build and the pinned Chromium 151.0.7922.34:

- a simple font over pdf.js' Foxit Serif Bold (bare CFF, `FontFile3 /Type1C`) and one over URW's Nimbus Roman Bold
  (Type 1, `FontFile`), each setting `Findings keep it.`: `runFonts` answered no font for either before this decision,
  and a 2,276- and 2,352-byte font after it;
- HarfBuzz reads both, a thousand units to the em, each character's advance PDFium's;
- `FontFace.load()` accepts both in Chromium 151, and `Findings` sets 400.0 px wide at 100 px, eight advances of 500.

## Rejected

- **Wrapping a bare CFF program in an sfnt as it is.** It covers bare CFF and not Type 1, and it sends the producer's
  charstrings and subroutines to the renderer, which is ADR-0175's rejected *sending the document's program*.
- **Converting Type 1 charstrings to Type 2.** A second parser of hostile programs in the host, for one kind of font,
  where PDFium has already parsed it and answers the outline.
- **Leaving such runs in their kind of face.** The owner's A1 is that it changes the look.

## Consequences

- A run in a Type 1, bare CFF or check-failing TrueType program is edited in its own glyphs. A Type 3 font is drawn by a
  content stream, not a glyph program; PDFium answers it no path, and it stays in its kind of face.
- ADR-0175's Rejected entry is withdrawn on its stated cost, which was a cubic-to-quadratic conversion: CFF needs none.
  Its other half — *its check would be the same outline it was built from* — is true and is the point: the font is the
  page's drawing, not a claim about it to be checked.
