# ADR-0142 — A text edit carries one list of objects and one text

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** `docs/ARCHITECTURE.md` §5's host pipe, for PDFium's two text-edit commands; takes the remedy
  [ADR-0138](0138-a-command-whose-intent-can-outgrow-a-frame-crosses-in-a-file.md) Decision 4 proposed and left to the
  owner.
- **Decided by:** the owner's list of 2 October, item H: *"reshape PDFium `replaceTextObject` (12.6 MB) and
  `editTextBlock` (4.59 GB) to one list of indices and one text each; prove the worst case is under 8 MiB"*, and table A
  row 10 of the JOURNAL's *No document-size refusals* (a translated block over 4,096 characters refuses the whole page,
  with a message that blames the provider).

## Context

ADR-0138 measured every command kind against its writer's route. Two did not fit PDFium's 8 MiB file ceiling at their
schema's worst, because each nests per-entry bounds whose real limit is a total:

| command | shape | worst, as the walk reads it |
|---|---|---|
| `replaceTextObject` | up to 512 entries, each an index and a text of 4,096 | 12,601,952 B |
| `editTextBlock` | up to 1,024 blocks of 512 lines of 512 run indices, and a text of 4,096 each | 4,589,655,126 B |

A schema cannot state a total across nested arrays — a refinement holds at parse and the size walk still reads the
product — so the call above the ceiling was refused as itself. And the per-entry bounds are too small for real pages
while the products are too large for the wire: a translated paragraph past 4,096 characters is refused as an
unreadable answer, though the page is ordinary; and the edit cannot name more than 512 runs on a line while the read
offers up to 45,800 on a page.

## Decision

1. **Each command carries one list of object indices and one text, with where each entry starts** — the drawing's
   shape ([ADR-0133](0133-a-signatures-mark-is-drawn-once-for-both-writers.md)'s correction), so the bound is in the
   shape and the walk reads a sum:
   - `replaceTextObject`: `objects` (the runs, in the page-object walk's numbering), `text` (every run's new words,
     joined), `starts` (where each run's words begin in `text`).
   - `editTextBlock`: `runs` (every run every block names, blocks in order, lines in order, runs in reading order),
     `lineStarts` (where each line begins in `runs`), `blockStarts` (where each block begins in `lineStarts`), `text`
     (every block's words, joined), `textStarts` (where each block's words begin), and one `fit` for the command. No
     caller mixes fits — a person typing reflows one block, a translation shrinks every block — so the shape says what
     the callers do (B5), ADR-0138 Decision 3's move.
2. **The bounds are a page's, written once:** `MAX_EDIT_RUNS` (65,536) is above the read's hostile-host bound on a
   page's runs (45,800), so any page the read answered can be written whole; `MAX_EDIT_TEXT` (786,432 characters) is
   a page's text with room, and a block's words are bounded only by it; an object index is bounded at 16,777,215.
   Measured with `maxEncodedBytes` on the wire's side (2026-10-02, `commands.test.ts`): `replaceTextObject`
   5,767,280 B and `editTextBlock` 6,553,755 B at worst, against the 8,388,608 B ceiling; the same walk reads the
   nested shape this replaces as past it. So PDFium's `engine/apply` and `engine/capture` leave the pinned exceptions.
   `recolorPageObjects` and `deletePageObjects` name objects by the same index and the same page's count, so their
   bound is derived from `MAX_EDIT_RUNS` too.
3. **One encoder and one decoder, in the contract** (B3a): a caller builds the command from its runs and texts through
   the encoder, and the kernel's writer reads them back through the decoder into the structure it already lays out.
   The refinements left are order and agreement — starts ascending from 0, lists the same length, every object named
   once — which no size depends on.
4. **`ai.translatePage` answers the edit in this shape**, so main composes the command's fields once and the renderer
   adds the page, the version and the fit; its text is bounded by `MAX_EDIT_TEXT`, so a long translated paragraph is
   written rather than refused.
5. **A read run's text gets its own bound, `MAX_RUN_TEXT` (65,536)**, the PDFium host's own bound on a run, so any run
   the host answers can cross; it was the command's 4,096 reused, which two bounds that agree are not.

## Rejected

- **Raising the per-entry bounds.** The products grow with them; the walk reads them and the ceiling stays crossed.
- **A refinement on the totals.** It holds at parse and the size walk cannot see it, which is the defect.
- **Splitting a long block's write into several commands.** A translation becomes many log entries and many undos,
  and a person who undoes once gets half a page in each language.
- **Keeping the nested shape and refusing above the ceiling** (ADR-0138's interim). A real page's edit fits; a
  translated paragraph past 4,096 characters did not, and that refusal blamed the provider.
