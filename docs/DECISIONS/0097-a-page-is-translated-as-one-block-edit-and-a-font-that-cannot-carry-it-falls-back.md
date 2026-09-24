# ADR-0097 — A page is translated as one block edit, and a font that cannot carry the words falls back to a standard one

- **Status:** Accepted
- **Date:** 2026-09-24
- **Amends:** [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md) Decision 2 (the
  grouping's one consumer), Decision 5 (*one command per block*; *refuses the whole edit … if any says
  something other than what was typed*) and its first stated limit.
- **Amends:** `docs/ARCHITECTURE.md` §3.2's checkable rule — *"does this grouping's output reach any consumer
  other than the in-place editor a person answers?"* — and §3's in-place editing row.
- **Context:** Stage 10, the owner's order of 2026-09-23: *"Translate document text: build it"*. Its row was
  blocked on two things, and both have landed: the provider registry (Stage 9, ADR-0081) and in-place
  editing (ADR-0096), whose own consequences say *"translate may write through this one"*.

## The problem, in one sentence

A translation writes words the document never used, into fonts that were embedded to carry only the words it
did use — so the write ADR-0096 built refuses most of a translated page, and one command per block would make
a translated page forty undo steps and forty whole-document checkpoints.

## What was measured, and the command that established it

**`scripts/research/pdfiumFallbackFont.mjs`, PDFium 155.0.8044.0, 2026-09-24**, over the eleven-file corpus
(counts only; no file named), writing `Façade déjà vu: Straße, niño, Ærø, crème brûlée, 12 €` beside every
text run on each first page and reading it back from the live text page:

- **The run's own font carries it for 132 of 457 runs.** ADR-0096's refusal is right for a person typing one
  block; applied to a translation into French it refuses about seven runs in ten.
- **A twin in PDF's nearest standard font carries it for 308 of 325** of the rest. The positive control — the
  same twin writing plain ASCII — reads back for 316 of 325, so the misses are placements the instrument's
  stacked test objects put outside the text page's reading, not letters. **The control**: the twin asked for
  `中` reads back for 0 of 325.
- The twin is chosen from the run's font flags and weight; its width for the run's own text is a median
  **0.997** of the original's (Helvetica 296, Helvetica-Bold 27, Helvetica-Oblique 2 — the corpus is mostly
  sans-serif).
- `FPDFText_LoadPage`, the read-back's cost: median about 6 ms, maximum 45 ms, over 336 loads.

**The first run of that script reported the twin at 0 of 325, and it was the instrument**: the twin had
written every character and the read-back carried one extra trailing space, which the text page generates
between objects stacked at one position. The positive control exposed it.

## Decision

**1. A string a run's font cannot carry is written in a standard-font TWIN, and refused only when the twin
cannot carry it either.** Each write is read back from the live text page as it is made. Where it differs,
the object is replaced by a new one in the standard font nearest the run's — Courier where the font is fixed
pitch, Times where it is serif, Helvetica otherwise, each bold and italic as the flags and weight say — at
the same size, matrix and fill colour, saying the same text. A replaced original is removed with the edit's
other removals, last, for ADR-0096's use-after-free reason. Only if the twin also reads back wrong is the edit
refused with `TextNotWritableError`, before generation, as before. **A standard font is never embedded**:
every conforming reader supplies the fourteen, which is why they exist.

This changes what in-place editing does for a person too, and that is the reason it is one rule and not a
translation feature: typing `é` into a subset that lacks it used to be refused, and is now written.

**2. `editTextBlock` carries a LIST of blocks on one page.** `{ page, blocks: [{ lines, text }] }`: one
command, one checkpoint, one undo step and one content generation for a whole translated page — ADR-0047
Decision 2's *once per command, never once per object*, one level up. The in-place editor sends one block.
Every block's runs are resolved against the untouched page before anything is written, so a later block's
indices are the page's own and not an earlier block's aftermath.

**3. The grouping gains exactly ONE more consumer: translating the page it groups, written back into the same
blocks.** §3.2's rule becomes *does this grouping's output reach any consumer other than the in-place editor,
or a translation written back into the very blocks it was read from?* What made the first consumer legal is
kept: the output is never text somebody takes as the document's content — search, export, extraction and the
text layer still read MuPDF's structured text and nothing else — and whatever the grouping decided is on the
page, outlined by Edit text and written where it was read, where a person sees it and undo reverses it. A
third consumer still ends the licence, and a grouping that feeds a provider for any purpose but writing back
into its own blocks is that third consumer.

**4. `main` reads the page and asks the provider; the renderer dispatches the write.** `ai.translatePage`
takes a `DocId`, a page, a version, a provider, a model and a language. `main` reads the blocks the way
`document.textBlocks` does, in the document's lane; sends ONE request through `streamChat` — the one resolver
of how each provider is asked (B3a) — holding a JSON array of the blocks' texts; reads back an array of the
same length or refuses the answer as unreadable; and answers the blocks with their translations. The renderer
then dispatches `editTextBlock` through `document.execute` like every other edit, so the version, the view's
refresh, the undo and the save are the paths every edit already takes. Document content leaves this machine
only on that explicit action, to the provider the dialog names (E5).

**5. The languages offered are the ones a standard font can write.** The fourteen are encoded in
WinAnsiEncoding, so the list is the Latin-alphabet languages whose letters it holds — English, French, German,
Spanish, Italian, Portuguese, Dutch, Catalan, Galician, Danish, Swedish, Norwegian, Finnish, Estonian,
Icelandic, Irish, Afrikaans, Indonesian, Malay and Swahili. A language needing a letter outside it would be
paid for and then refused block by block, so it is not offered.

## Stated limits, which the row carries

- **A page at a time.** A whole document is one request per page, each its own undo step; the dialog
  translates the page on show.
- **Other scripts are not offered** — Cyrillic, Greek, Arabic, Chinese, and Latin languages with letters
  outside WinAnsi such as Polish and Czech. Writing them needs a font embedded for the purpose, which is its
  own decision.
- **A twin looks like the standard font, not the original** where the two differ. The corpus measures a
  median width of 0.997, and a decorative or condensed original will visibly change.
- **A translation longer than the original runs further down the page** and can overlap what is below it —
  ADR-0096's limit, reached more often, because translations grow.
- **One answer is capped at `MAX_OUTPUT_TOKENS`** (4,096). A page whose translation would not fit arrives cut
  short, is not an array of the right length, and is refused as unreadable rather than written in part.

## Rejected alternatives

- **Refuse, as ADR-0096 does, and report the blocks left untranslated.** Seven runs in ten would stay in the
  original language, on a page the person asked to have translated.
- **Embed a system font for the fallback.** It would write any script, and it is a font file handed to a
  contained host that is granted no filesystem, a licence question per font, and a page that grows by the
  font's size. It is the route to other scripts, and it is not taken for Latin text a standard font carries
  with nothing embedded.
- **A `translatePage` command beside `editTextBlock`.** Two commands writing a page's text blocks are two
  writers of one concern (B3), and the second would duplicate the wrap, the layout and the read-back.
- **One `editTextBlock` per block.** Forty undo steps, forty checkpoints of the whole document, forty content
  generations for one action.
- **The renderer sends the blocks' text to the provider channel.** The renderer holds the blocks, but ADR-0088
  keeps *what a page says* read in `main`, in the lane, for every ask; a translation reading it elsewhere would
  be a second reader of the same question.
- **Translation units from MuPDF's structured text.** They are the reading side's units and cannot be written
  back: they name no PDFium object.

## Consequences

- `pdfiumFfi.ts` binds `FPDFText_LoadStandardFont` and `FPDFFont_Close`; `editTextBlock` takes a list.
- `@monstera/contract` gains `TRANSLATION_LANGUAGES` and `ai.translatePage`; `editTextBlockSchema` takes
  `blocks`.
- `docs/FEATURES.md`'s *Translate document text* row is unblocked to this design and closes when a real page
  is translated, survives save and reopen, and has its pair — its live test on the cheapest Claude model, by
  the owner's order.
