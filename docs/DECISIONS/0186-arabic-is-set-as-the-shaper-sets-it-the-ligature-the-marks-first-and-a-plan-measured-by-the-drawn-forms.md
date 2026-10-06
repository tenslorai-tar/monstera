# ADR-0186 — Arabic is set as the shaper sets it: the ligature, the marks first, and a plan measured by the drawn forms

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** [ADR-0181](0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md) Decision 4's *not done* clause
  and its stated limit on lam-alef and marks. [ADR-0185](0185-a-line-of-several-objects-is-read-and-written-as-one-line.md)'s
  limit *the plan's widths for Arabic are the letters drawn alone*, which this removes.
- **Relates:** [ADR-0173](0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md) (the setter of a resolver face's text),
  `textShaping.ts` (the HarfBuzz face the host already holds).
- **Context:** Part B leftovers, the owner's R41: *Arabic lam-alef ligatures and mark placement using the HarfBuzz shaping
  already in the host, instead of Presentation Forms only.* Written 2026-10-06 against ADR-0181's own limits.

## Is this the right question

*How do we make PDFium draw what HarfBuzz would shape?* That asks for a shaped glyph run, and a PDFium text object holds a
string that its font maps to glyphs: no object takes a glyph run with positions. So the exact answer (every glyph at the
offset the font's positioning table names) is not reachable from this writer, and the question that is reachable is
*which of the shaper's choices can a text object carry, and which does this writer still make a worse choice of?* Measured
2026-10-06 on PDFium 155.0.8044.0's Linux build and the bundled Noto Naskh Arabic:

- **A mark in an object of its own cannot be read back.** The composer (`markdownCompose.ts`), which does place each shaped
  glyph itself, writes a mark as its own show, and a text page reads that line scrambled. So the exact placement is
  available to a writer that never needs to read its output and to none that does, and an edit reads what it wrote.
- **The ligature is a glyph a text object can carry.** The face's `cmap` holds U+FEF5 to U+FEFC, and the width HarfBuzz
  answers for `لا`, `بلا` and `الله` is the width of those glyphs to the unit (518, 885 and 1147 of 1000), where the two
  letters drawn joined are 10% narrower (465). The ligature was left out of ADR-0181 because a text page reads one glyph
  standing for two letters in the reverse of their order; that was a fact about expanding the form BEFORE reversing, and
  the page expands AFTER, so a lone U+FEFB reads `لا`, lam then alef, as typed.
- **HarfBuzz answers a right-to-left cluster with its glyphs reversed.** `مُ` comes back as the damma then the meem, and a
  mark is a glyph of no advance, so a mark drawn before its letter stands at the letter's own left edge, where the shaper's
  offset begins. ADR-0181 drew it after the letter, a whole letter's advance away.
- **The plan measured each letter alone, and the probe measured it wrongly for right-to-left letters.** A character's width
  is the right edge of the character beside a reference less the reference's own, and the pair was set in DRAWING order, so
  a right-to-left pair stood the other way round and the second measurement was the first character's. Measured: 135 pt
  planned for a line drawn in 64.

## Decision

1. **A lam beside an alef is one glyph** (`arabicForms`). The four alefs (plain, with a hamza above, below, and with a madda)
   have a ligature each in the Presentation Forms-B block, isolated or final by whether the letter before the lam reaches it,
   and the table is read from the platform's normaliser like the forms are, so no list of letters is kept beside the standard.
   The line reads back as typed because the reading model expands the forms AFTER reversing (`lettersOfForms(readBackOf(drawn))`).
2. **A letter's marks are drawn before it, in the order a shaper answers a right-to-left cluster** (`rightToLeftUnits`). The
   cluster is reversed by code point, so the marks come first and the mark nearest the letter is drawn last. A mark stays
   inside its letter's object, since a mark in an object of its own is not readable. `reorderedFrom` answers where each unit
   came from, and for a reversed cluster that is the mirrored place; it said the cluster's own order, and a line made of
   several objects was then assigned a mark's text to the letter beside it.
3. **The plan measures the shapes that are drawn** (`blockMeasure`). A word is measured as `arabicForms` of it, so the
   ligature and the joined forms are what a width is of, and the probe pair is set left to right as given, so a width is
   the second character's for either direction. Hebrew, whose letters do not change shape, is measured the right way round
   by the same change.

## Limits stated now

- **Mark anchors are the writer's, not the font's positioning table's.** A mark drawn first in its letter's object sits at the
  letter's own left edge with the offset its glyph carries. What `pdfiumCommand.proof.mjs` pins is the ORDER the shaper
  answers for six base and mark pairs (fatha, damma, kasra, shadda, sukun), not the offsets: the offset a mark gets from a
  GPOS anchor on a particular base was not measured against every base, so a mark may stand a little off where the shaper
  would put it. Exact anchoring needs each glyph set at an offset, which is a mark in an object of its own, which a text
  page cannot read back.
- **Only the letters the Presentation Forms blocks hold are joined**; the table is the normaliser's, so a script whose
  shapes are not in those blocks is drawn as typed, which was not checked here for any script but Arabic.

## Rejected alternatives

- **Marks as their own objects at the shaper's offsets.** Exact, and unreadable: measured, the composer's own output reads
  scrambled, so every later edit of the line would diff against a corrupt reading.
- **Load a CID TrueType font with our own ToUnicode (`FPDFText_LoadCidType2Font`) and write the shaper's glyph run.** It
  would carry every shaping choice, and it needs a binding PDFium's build here does not yet have, a font per shaped span and
  a ToUnicode we write beside the engine's. It is the route if exact anchors are ever owed, and it is a seam change of its
  own, so it is not taken inside this decision.
- **Keep the plan by the letters.** A paragraph of Arabic then wraps early, and the page is wrong by the difference.
