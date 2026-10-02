# ADR-0137 — A word's box is the engine's, read on request

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** nothing in `docs/ARCHITECTURE.md`'s invariants. It adds one engine host channel, `engine/word-boxes`, and
  one renderer channel, `document.pageWordBoxes`, and withdraws ADR-0131's first stated limit.
- **Decided by:** the owner's answer d of round 4: *build the kernel channel that answers each word's real box, and
  replace the renderer's estimates with it; prove it on a font where the estimate is visibly off, with that case
  failing on the estimate.*
- **Relates:** [ADR-0131](0131-side-by-side-compares-two-documents-by-content-in-the-renderer.md) (Side by Side, whose
  word marks this places), [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (one page, never the document),
  [ADR-0125](0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md) (an answer that grows with the document is
  a file).

## Context

ADR-0131 stated as a limit that *a word's box is estimated inside the kernel's line box by its share of the line's
characters*. In a proportional face that is wrong by the difference between narrow and wide letters: in Helvetica a
run of `i` is about a quarter as wide as the same count of `M`, so a changed word after a run of narrow letters is
marked well to the right of where it is printed. The line box is the only geometry the text layer carries, because
MuPDF's structured-text JSON (`engine/page-text`, read by `parsePageText` alone) prints lines and not characters.

## Decision 1 — the host walks the characters and answers token boxes

A new engine host channel, `engine/word-boxes`, takes a session and a page and walks the same structured text the
substrate read makes (`stextOptionsFor('substrate')`), character by character, with MuPDF's own `walk` and each
character's quad. For each line, in reading order, it cuts the line's text into tokens with the shared `tokensOf`
(`wordCount.ts`, the one segmenter, B3a) and answers each token's box as the union of its characters' quads, in the
page's display space at scale 1, which is the text layer's space (`textStructure.ts`' `DisplayedRect`). A union of
quads rather than a span of x is what makes a box right on a turned page and in vertical text, where a word runs down
rather than across.

The answer is a file (ADR-0125's route), because a page's tokens are bounded by its content rather than by a schema.
It carries `MAX_PAGE_WORD_BOXES` (16,384) tokens at most and says when it stopped.

## Decision 2 — the renderer pairs boxes with the text layer's lines and checks that they agree

`document.pageWordBoxes` answers, per line, the flat list of token boxes and the line's token count, for the version it
read. Side by Side reads it beside the text layer for each page and gives each line its boxes **only when the counts
agree** with `tokensOf` over the text layer's own line, which is the same segmenter over the same read; a line clipped
by the text layer's 1,024 characters, or past the 16,384, keeps the estimate. That is a stated fallback rather than a
refusal: a mark is drawn either way, and the owner's rule is that a document is never refused for its size.

`placeWords` takes a line's own boxes when it has them and the estimate otherwise, so the estimate remains the answer
for exactly the lines the engine did not box.

## Decision 3 — ADR-0131's first stated limit is withdrawn

Recorded there as a dated correction; this ADR is what replaced it.

## Rejected

- **Characters' edges on every text layer read.** The text layer is read for selection, search highlighting and the
  assistant's window; carrying a box per character on every read would multiply its size several times for one
  consumer.
- **The JSON with per-character output.** MuPDF's JSON writer has no such mode, and a second serialisation of the
  same tree in this repository is the second opinion `parsePageText` exists to prevent.
- **Measuring glyphs in the renderer.** The renderer does not have the document's fonts, and PDF.js is never a source
  of truth.
