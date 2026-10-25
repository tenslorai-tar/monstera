# ADR-0256 — A Type 3 run's face is read from its font's descriptor, by MuPDF

- **Status:** Accepted
- **Date:** 2026-10-19
- **Amends:** `docs/ARCHITECTURE.md` §5 (one engine channel, `engine/text-faces`, read by `main` where a page is
  rewritten by its operators) and ADR-0176 (the page that writer edits is now also read by it for its runs' faces).
- **Decided by:** the owner's review of 0.1.16.0, R13: *"The editor shows the words in that same face while typing, so
  what the person sees is what is written. A bold lead-in shows bold."*

## The problem, measured

On a web-made page whose fonts are all Type 3 — Chromium prints a variable face that way — opening a line in Edit text
showed its words in a plain sans, a bold lead-in not bold. Measured 2026-10-19 on our own page printed by Edge 155 in a
Windows variable face: PDFium's text read answers every run of the page with `font: ""`, `serif: false`, `bold: false`,
and `document.runFonts` answers no font for any of them. The fonts themselves say otherwise: each has a
`/FontDescriptor` with `/FontFamily (…)`, `/FontWeight 700` or `400` and `/FontName /AAAAAA+…-Bold`.

**Why PDFium says nothing:** a Type 3 font has no `/BaseFont` and no font program. `FPDFFont_GetBaseFontName` answers
empty, `FPDFFont_GetWeight` answers 0, and `FPDFFont_GetFontData` has nothing to give, so every witness `fontFace.ts`
reads (the program, the descriptor's weight through PDFium, the name) is silent, and PDFium's public API reaches no
other key of the descriptor. **MuPDF reads the descriptor already**: `pageFonts.ts`, the operator writer's own read of
the page's fonts, takes `/FontName` (less its subset tag) and `/FontWeight` for every font on the page, Type 3 included,
and `textOperators.ts` numbers each showing operator by PDFium's own object index (ADR-0176 Decision 3).

## Decision

1. **`engine/text-faces`**, a MuPDF host read of one page: the faces of the page's fonts as their descriptors state
   them (`face`, the name less its subset tag; `weight`, or none), and which of PDFium's text objects shows in which,
   as runs of consecutive object indices sharing a font. Framed and bounded (`ENGINE_TEXT_FACE_RANGES_MAX` ranges;
   past it the answer says `truncated` and the objects past the bound keep what PDFium read). Numbered by
   `textOperators.ts`, the one module that owns the numbering (B3a), so the objects named are the objects PDFium read.
2. **`main` asks it only where the page is rewritten by its operators** (`rewrite: 'operators'`, the page Decision 1
   of ADR-0176 sends to MuPDF), alongside the read that already decides that, and fills **only a run PDFium left
   unnamed** (`font: ""`): its font becomes the descriptor's face; bold, italic and serif are decided by the rules a
   named run already takes — `fontFace.ts`' weight and name, the resolver's `familyClass` for serif and mono. A run
   PDFium named is never overwritten: two witnesses about one run, and the one that speaks first keeps its word.
3. **The editor then draws such a run in its face's kind, bold where its weight says**, through the routes a named run
   already takes (the run font where the host rebuilds one, else the class face, ADR-0175). A Type 3 font has no
   program to rebuild, so the glyphs drawn while typing are the class face's, not the page's; the weight, slant and
   kind are the page's. The writer still writes the words in the page's own Type 3 font where it carries them (ADR-0176
   Decision 5), so the face the person sees while typing is the face's kind, and what is saved is the page's own.

## Rejected

- **Read the descriptor in the PDFium host.** PDFium's public API has no route to a font's dictionary; reaching it
  would mean a second parser of the PDF beside the engine's, which is the second opinion B3a forbids.
- **Send every run's object indices from `main` and answer per run.** The request would grow with the page; the answer
  as ranges is as small as the page's font changes, which on the measured page is a handful.
- **Classify by the descriptor's `/Flags`.** Chromium writes `/Flags 4` (symbolic) on every Type 3 font it emits, serif
  or not (measured on the same page), so the flag says nothing; the family name is the witness, as `styleOf` already
  rules for a clear flag.
- **Build a font from the Type 3 glyph procedures** so the editor draws the page's own glyphs. ADR-0238 builds one from
  drawn paths, and PDFium answers no path for a Type 3 glyph; a renderer of glyph procedures is a separate piece of
  work, recorded here as the next step if the class face is not close enough.

## Proofs

- The kernel read: on a page of Type 3 fonts with descriptors, the faces and weights are the descriptors', and the
  ranges name PDFium's object indices; CONTROL: a page of named TrueType fonts answers its own names and is never asked.
- `main`: a run read with `font: ""` on an operators page takes its face and is bold where the weight is 700;
  CONTROL: a run PDFium named keeps its own name and weight even where the read names another.
- The editor: such a run opens in its kind and bold (the existing run-style cases, over the filled style).

## Consequences

- One more MuPDF read per text read of an operators page — the same page MuPDF already reads to decide the route.
- A Type 3 run's font field in Properties names the face the descriptor names, where it said nothing before.

## Correction, 2026-10-25 — what is saved for a new word is the face's kind too (Decision 3)

Decision 3's last sentence — *the writer still writes the words in the page's own Type 3 font where it carries them* — no
longer holds for a NEW word: by the owner's font principle (ADR-0176's correction of 2026-10-25), a word the run did not
already say is written in the closest ordinary face from the chain, never in drawn letters. So the kind of face the
editor draws a Type 3 run's typed words in while typing is now the kind they are saved in, rather than a preview of
letters the page would have drawn itself. The run's own words still keep its own glyphs.
