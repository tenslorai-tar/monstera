# ADR-0177 — A word a Type 3 page cannot draw is set in the resolver's face or the box, by the MuPDF host

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row (what the MuPDF writer of a Type 3 page sets a word in)
  and its engine host rows (the MuPDF host is handed the font folders). Amends
  [ADR-0174](0174-a-pdfium-apply-answers-the-characters-it-drew-as-boxes.md) Decision 1 (only a PDFium apply answers
  boxes) and [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
  Decision 2's list of the hosts that read fonts.
- **Relates:** [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md) Decision 5
  (a word in its own font, a sibling, the resolver's face or the box), [ADR-0173](0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
  Decisions 4 and 7 (a sibling, the box), ADR-0172 Decisions 1, 5 and 8 (the resolver's order, subsets made in the
  host, one code per glyph and characters).
- **Context:** Part B Phase 1. Since 2b73ca12 a page showing Type 3 text is edited by `editTextOperators`, which writes
  a word in its run's own font or a sibling on the page and refuses any other word, naming the letters, with the typed
  words kept in the editor. The owner's answers say a word goes to the nearest matching font, a character no font has
  is a visible box that keeps the real character, and the edit is never refused for either.

## Is this the right question

The question is *how does the MuPDF writer set a word in a face the page does not hold*. Two premises are worth
checking first.

The first is that the word belongs in another font at all, rather than in a new glyph of the page's own Type 3 font.
A Type 3 font can be given a glyph: its `/CharProcs` take a content stream drawing the outline. That keeps one font,
and it is rejected below for what it costs, not because it cannot be done.

The second is that MuPDF's own embedding is the tool. MuPDF has `pdf_add_cid_font`, and using it would be the shortest
code. But this project already writes a CID font, once, in `cidFont.ts`, with ADR-0172 Decision 8's rule (one code per
glyph AND characters, so the box drawn for two different characters reads as each) and Decision 5's (a HarfBuzz subset
made in the host, MuPDF's own subsetting off). MuPDF's function derives `ToUnicode` from the font's `cmap`, which maps
the box glyph to one character at most, and writes `W` from its own reading. A second embedder is a second opinion
about what a code means (B3a), and it would differ from the first exactly on the box, the case this ADR exists for.

## What was measured

- `composeHostLive.mjs`, windows-latest, run 37416673829 (2026-10-06): the compose host, contained, reads the bundled
  fonts through ALL APPLICATION PACKAGES' grant and the installed folder, and sets the ideograph in an installed face.
  The MuPDF host's container takes the same principal's grants (`containerGrants.mjs`), so the folders are reachable
  from it by the same rule; its own live case is owed with the build (below), because a containment claim is measured
  where it ships.
- A CID font `cidFont.ts` writes is read by MuPDF, PDFium and pdf.js: P1.5's composers (77f33e66), whose output both
  hosts read back word for word on both legs.
- Not measured, and owed before this ships: SSSSSSS-1, the contained PDFium host misreading after the write what it set
  in an installed face. Whether the MuPDF host is handed the installed folder follows that finding's answer; the bundled
  set is handed either way.

## Decision

1. **The MuPDF host reads the fonts the PDFium host reads**: its factory passes the bundled folder and, as ADR-0172
   Decision 2 and SSSSSSS-1 decide, the installed one, and the host binds them through `editFaces.ts`, the one binding,
   read on the first word that needs a face. A host given none refuses such a word as today.
2. **The writer's order is ADR-0176 Decision 5's, unchanged**: the run's own font, a sibling on the page, the
   resolver's face (`candidatesFor`, ADR-0172 Decision 1), the box. A word goes to one font whole; a character no face
   carries is boxed alone, as `editPieces.ts` plans the PDFium writer's pieces, and by that planner, not a second one.
3. **A face is embedded by the one CID-font writer.** `cidFont.ts` is split into what it decides (the codes, `W`,
   `CIDToGIDMap`, the `ToUnicode` text, the subset program and its name) and how its dictionaries are written, so
   pdf-lib's document and MuPDF's object model each write the same decision. The subset is HarfBuzz's, made in the host
   with glyph ids kept; MuPDF's subsetting stays off.
4. **The box is `boxFont.ts`' one-glyph font, embedded the same way**, its code mapped by `ToUnicode` to the real
   character, so the page reads, searches and copies the character the person typed.
5. **An added font is a page resource under a fresh name**, never one the page uses, and the inserted `q BT … ET Q`
   sets `Tf` to it for its word and back to the replayed state for the next word in the run's own font.
6. **The read-back is ADR-0176 Decision 6's, over the added fonts too**: `pageFonts.ts` reads them like the page's own,
   so the structural check and MuPDF's reading cover every word written.
7. **The apply answers its boxes** (amends ADR-0174 Decision 1): `editTextOperators`' apply answers
   `{ boxed, more }`, the shape and cap ADR-0174 set, through `engine/apply-file`'s answer, and the bus passes them to
   `document.execute` as it passes PDFium's. The other MuPDF commands set no text and answer none.

## Rejected

- **A new glyph in the page's Type 3 font.** One font, and the word would sit in the page's own resource. It needs the
  face's outline turned into a content stream per glyph, a `/Widths` and `/Encoding` slot per code in a font whose
  codes are one byte (256 at most, and a subset font arrives with most taken), and a `ToUnicode` the page's font may not
  have. The resolver's face is what a PDFium page gets for the same word, so a person sees one behaviour.
- **MuPDF's `pdf_add_cid_font`.** A second embedder, disagreeing with the first on the box (above).
- **Sending such a word to PDFium.** PDFium drops the page's Type 3 text (ADR-0176), which is why this writer exists.
- **Keeping the refusal.** The owner's answer: never refused for a font.

## Consequences

- A word on a Type 3 page is written whatever its letters, in the nearest face or as a box, and the person is told
  which characters are boxes, as on any other page.
- The MuPDF host reads font files. Its containment check names them; a font folder it cannot read fails only the word
  that needed it.
- `cidFont.ts` has two writers of its dictionaries and one source of their contents, and the composers' output is
  unchanged byte for byte (its proof says so).
