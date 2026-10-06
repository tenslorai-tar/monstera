# ADR-0175 — The typing box draws a run in its own font, rebuilt in the host

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row (what the editor is drawn in), and the rule stated on
  `textBlockStyleSchema` and on `RunStyle.font`, that the page's own font never reaches the renderer. Adds a third
  sanctioned byte crossing to the two ADR-0031 permits (`document.readRange`, `document.renderPage`).
- **Relates:** [ADR-0145](0145-the-text-editor-shows-each-run-in-its-own-style.md) (each run in its own style, the face
  chosen by kind), [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
  (HarfBuzz in the host), [ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md) (what bytes may cross),
  [ADR-0019](0019-the-renderers-csp-is-pinned.md) (the pinned CSP, §9.27), invariant 25 (a host contains a hostile
  document).
- **Context:** Part B Phase 1, the owner's approval of my Decision 4 (*the typing box shows the document's fonts*) with
  the instruction that it widens the renderer's security policy and so goes through an ADR with `proof:rendererpolicy`.
  Today the editor draws each run in a face of the right KIND (sans, serif, mono) and the right size, weight, slant and
  colour, and not in the run's font: `textBlockStyleSchema` says *the page's own font cannot travel — a renderer that
  loaded it would be a second parser of the document's bytes*.

## Is this the right question

Two premises in the question are wrong, and both were mine.

**It does not widen the security policy.** Measured 2026-10-06 on Chromium 151.0.7922.34 under the renderer's own
`default-src 'none'` and `font-src 'self'` (scratch probe `fontCsp.mjs`): a `FontFace` built from an `ArrayBuffer` loads
and draws with no violation, while a font named by a `data:` URL is refused under `font-src` and a `fetch` under
`connect-src`, the controls that the policy was in force. A font that crosses as BYTES is not a load the CSP governs, so
§9.27 is unchanged and `proof:rendererpolicy` with it. What this ADR adds to the policy is a pin, not a widening: a rendered
case that a URL font stays refused.

**What would cross is not the document's font.** The rule on `textBlockStyleSchema` is right about the document's
program: a renderer parsing it would be a second parser of the document. So the program does not cross. A font the HOST
builds does: rebuilt by HarfBuzz inside the contained process from the program's glyphs, with the parts a hostile font
uses to attack its parser left out, and checked against what PDFium draws before it is offered.

## What was measured

PDFium 155.0.8044.0's Linux build, generated fixtures (scratch probe `fontProgram.mjs`), 2026-10-06:

- `FPDFFont_GetFontData` answers the program of an embedded font, and for a font that is not embedded the program of
  PDFium's substitute: for Helvetica, 15,025 bytes of bare CFF, no sfnt wrapper and no `cmap`, which no browser loads.
- For an embedded TrueType subset (an Arimo piece an edit made), the program is an sfnt whose `cmap` maps 14 characters.
- `FPDFFont_GetGlyphPath(font, c, size)` takes a CODE POINT and answers the path PDFium draws for it, in ems whatever the
  size; `FPDFFont_GetGlyphWidth` likewise, in thousandths.
- For H, e, l, o, П and р, the program's `cmap` glyph against PDFium's: the ink box of every one agrees to 0.00 thousandths
  on each edge, and the advance to within 0.75 (722 against 722.17). The same H in PDFium's Helvetica substitute differs by
  5 thousandths on its left edge, so the check separates two fonts.
- Segment counts do not compare: PDFium splits a quadratic outline into cubics (13 against 14 for H, 51 against 23 for e).

## Decision

1. **A run's font crosses only as a font the host builds**, and only from an EMBEDDED program that is an sfnt (TrueType,
   or OpenType with CFF). The substitute of a font that is not embedded never crosses: it is PDFium's choice and not the
   document's, and PDF.js draws the page with its own.
2. **Every character of the run is checked before the font is offered**: the program's `cmap` glyph for it must have an
   ink box within ONE thousandth of an em of PDFium's path for it on every edge, and an advance within one thousandth of
   PDFium's width. One character that fails, or a character the `cmap` does not map, and the run has no font: the editor
   draws it in its kind of face as today. A font that draws a different glyph than the page is worse than none.
3. **The host rebuilds it with HarfBuzz** (`hb-subset`, in the PDFium host): the glyphs the program's `cmap` maps, with
   hinting dropped (`HB_SUBSET_FLAGS_NO_HINTING`, which removes TrueType bytecode, the `fpgm`, `prep` and `cvt` a hostile
   font attacks its rasteriser through), under a cap of `MAX_RUN_FONT_BYTES`, 1 MiB. Chromium then runs its own OpenType
   Sanitizer over the bytes, a second check the renderer did not have to write.
4. **It crosses on its own read, per run, when the editor opens** (`document.runFont`, answered `null` where there is no
   font): never in `document.textBlocks`, whose parts are sized for outlines and are read for every page in the mode. The
   host answers through the output directory as `engine/render-page` does (`engine/run-font`), and main reads the bytes it
   was told of.
5. **The renderer loads it as `FontFace` from the bytes**, named for the document, the version and the run, and draws the
   run in it with its kind of face after it, so a character the person types that the subset lacks is drawn in the kind of
   face rather than as nothing. Dropped when the document closes or its version moves.

## Rejected

- **Widening `font-src` to `data:` or `blob:`.** Unneeded (measured above), and it would admit fonts by URL.
- **Sending the document's program as it is.** It is the second parser the rule refuses: a hostile program would reach the
  renderer's font stack with its bytecode intact.
- **Building a font from PDFium's glyph paths** for every kind of program, Type 1 and bare CFF included. It needs a font
  writer and a cubic-to-quadratic conversion, and its check would be the same outline it was built from. Kept for later,
  since it is the only way a Type 1 or CFF run could be drawn in its own font.
- **Checking by segment count.** Measured not to compare.
- **Offering the font without the check.** A subset whose `cmap` names other glyphs than the page draws is common in PDFs
  whose producers rewrite codes, and an editor drawing the wrong letter in the right style is the worst of both.

## Consequences

- A run in an embedded TrueType or OpenType font is edited in its own glyphs; a Type 1, bare CFF, Type 3 or substituted
  run is edited in its kind of face, as today, and says nothing about it.
- The renderer parses a font the host built from the document's glyphs, sanitised twice. `textBlockStyleSchema`'s and
  `RunStyle.font`'s comments are corrected to say what crosses and what does not.
- A third byte crossing, with its cap in the schema's own predicate, where `payloadBounds.test.ts` can name it.
