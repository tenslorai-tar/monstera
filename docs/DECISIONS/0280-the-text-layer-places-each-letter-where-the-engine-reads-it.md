# ADR-0280 — The text layer places each letter where the engine reads it

- **Status:** Accepted
- **Date:** 2026-10-31
- **Decided by:** the owner, 2026-10-31, approving cloud run 29b's draft (candidate A): *keep today's line, add the
  engine's letter positions and the two rules.*
- **Amends:** `docs/ARCHITECTURE.md` §3's writer-of-record table, whose first row gave the text layer, text selection and
  search display to PDF.js as reader. The layer's lines have come from the kernel's structured text since 2026-09-08
  (`document.pageTextLayer`); from this decision its letters' positions do too.
- **Supersedes:** the section *Why the text is scaled rather than positioned per glyph* of `packages/ui/src/TextLayer.tsx`'s
  header, which says a partial selection *lands within a character or two of where the pointer is*. Measured, it lands
  up to 3.35 pt from the page's letter and picks the wrong letter (below). No ADR states that rule; the header is its
  only statement.

## Context

Each line of the text layer is one element holding its words in a substitute face, scaled once so the line spans the
box the engine reported (`fitLines`). The line's two ends are right; every letter between them stands where the
substitute's own widths put it.

Measured in Chromium 151.0.7922.34 on run 18's agreement page (Times, standard 14, not embedded, 11 pt), by cloud runs
29 and 29b (2026-10-30 and 2026-10-31, branch `work/cloud-29-svg-trial`, commits 3f9d090e, c650f4c1 and 7aafa9a5; the
raw results and their commands in `packages/ui/src/textLayerTrial/evidence/run29/README.md` and `run29b/README.md` on
that branch):

| measurement (application face / serif / sans-serif) | today |
|---|---|
| worst letter, laid out against the page | 2.88 / 0.81 / 3.35 pt |
| a press 30% into each letter, wrong letter (of 146) | 34 / 2 / 38 |
| a press 70% into each letter, wrong side (of 142) | 7 / 8 / 34 |
| where a press flips sides, against the letter's middle | up to 2.65 / 0.83 / 3.08 pt |
| a drag ending 70% into each letter of a line, wrong end (of 63) | 7 |
| a press on a page turned 90, 180, 270 degrees, wrong (of 146) | 142 / 145 / 143 |

The turned-page row is NEXT-UPDATE item 52: the line is laid out across the screen while the page's line runs down it.

## Decisions

1. **The text layer keeps one element per line, the scaled line it has today.** Every press and selection rule from
   runs 24 and 32 (`pressAnchor.ts`, `lineUnder`, the blank-space press, `caretBesideLine`, `holdAnchorAtPress`)
   assumes one text node per line, and keeps it.

2. **`document.pageTextLayer` carries, per line, where its letters are:** the first letter's origin, the line's
   direction as a unit vector, each letter's advance along it as a signed 16-bit integer in hundredths of a point (one
   per UTF-16 unit of the line's text; the second unit of a pair advances 0, the last letter's runs to the line's end),
   and the glyph size. All in the page's display space at scale 1, as the line's box already is. One direction per line
   is enough and is needed: an angled line (ADR-0273) advances in x and y at once, measured on a line at 30 degrees,
   which MuPDF reads as direction (0.866, -0.5).
   - **Bounded per page in the schema.** The advances of one line are bounded by `MAX_TEXT_LAYER_LINE` and the lines by
     `MAX_TEXT_LAYER_LINES`, so a page carries at most 2,048 × 1,024 advances: about 4 MiB at the worst, against the
     2 MiB of text the same two bounds already allow. A dense real page (4,275 letters) carries about 8.5 KB. Invariant
     L11 asks only that it not grow with the document, which it does not.
   - **A line whose positions cannot be carried crosses without them** — a letter advancing further than 327.67 pt
     either way, or a walk whose characters are not the line's text — and the layer places that line as today. A person
     is never refused because of their document; a line placed as today is the honest fallback, said in the code.

3. **The positions are read where MuPDF is: in the contained host, by MuPDF's structured-text walk**
   (`StructuredText.walk`, as `wordBoxes.ts` reads words), beside the JSON the host already answers. `main` pairs them
   with the lines it parses from that JSON (`parsePageText` stays the one reader of MuPDF's format, and stays out of
   the host); a page whose walk and JSON do not pair line for line crosses with no positions, by Decision 2's fallback.
   The line's text, its order and its box are unchanged, and that is asserted across the corpus and the angled-text
   fixtures. The binding builds each character with `String.fromCharCode`, which truncates a code point past U+FFFF;
   the walk reads such a character's code point whole.

4. **One answer to where a letter is, in the renderer.** Each line's geometry — its letters' edges along the line, its
   direction, and the engine's box — is computed once from Decision 2 and read by everything below. Nothing asks the
   browser where a letter of the layer is.

5. **Rule (i): the layer paints the selection itself, from the browser's Selection range alone,** with the browser's own
   highlight transparent. The painter and `readTextSelection` take one function of the range (B3a), so the look and
   the words cannot disagree. A search's matches are painted from the same geometry.

6. **Rule (ii): the side of a letter is decided from the engine's positions** — for a press, for a drag's moving end
   (corrected once the browser has moved it), for a double or triple click's word and line, and for the two ends
   `readTextSelection` answers, which markup, copy and every selection command take. `lineUnder` and `caretBesideLine`
   read the engine's line box from Decision 4's geometry.

## Rejected, with the figures

- **SVG text with a position per letter** (route b; runs 29 and 29b). As accurate as Decision 6 once given the same two
  rules, and it reads as text to a screen reader only with `role="none"`. It costs layout: 7.1 to 29.4 ms per page as
  pages arrive during a scroll, one arrival at 37.3 ms, against today's 2.1 to 5.8 ms; this decision's candidate A
  measured 2.3 to 8.2 ms. Without the two rules its highlight is banded, the substitute's glyph cells overlapping and
  parting at the page's positions.
- **One element per letter** (route a; run 29). Exact without rules, at 1,296,605 elements and about 177 ms of layout
  per dense page.
- **Mapping the ends through the engine while the browser's highlight stays where the substitute put it** (route c).
  People trust what they see: the highlight would not cover the letters the copy and the markup take.

## What candidate A measured (run 29b)

Every press at 30% and 70% of every letter, on pages turned 90, 180 and 270 degrees and at zoom 50% and 400%: 0 wrong.
Drag ends: 0 pt. A drag ending 70% into each letter of a line: 0 wrong, fast or slow, with the browser's focus corrected
7 and 181 times and never left elsewhere. Painting a whole dense page's selection: 1 ms; a growing drag: 0.31 ms a
frame. Per arriving page: 2.3 to 2.5 ms against today's 2.1 to 2.4 on the same runs.

## Correction, 2026-10-31 — two things read after this was written, before any build

**A character past U+FFFF cannot be read whole by the walk.** Decision 3 said the walk reads such a character's code
point whole. It cannot: `mupdfRaw.ts`' `StructuredText.walk` builds the character it hands `onChar` with
`String.fromCharCode` (line 2151) before any caller sees it, so the code point is already cut. Such a line's walked
text differs from its JSON text, and it takes Decision 2's fallback: placed as today. Reading it whole is a change to
the binding, and is not part of this decision.

**The letters do not fit beside the JSON as Decision 3 assumed.** `engine/page-text` answers MuPDF's JSON up to
`ENGINE_PAGE_TEXT_MAX_BYTES`, 8 MiB, over the file route, whose ceiling is also 8 MiB; and the host's pipe carries JSON,
so an advance crosses as a number of up to seven bytes, not two. How the letters cross is the owner's to choose before
the kernel half is built: the options and a recommendation are in cloud run 30's report. Decisions 1, 2 (the renderer's
contract), 4, 5 and 6 stand.
