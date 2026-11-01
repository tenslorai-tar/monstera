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

## Correction, 2026-10-31 — the letters cross in a file beside the answer; a rare character is paired, not dropped

**Decided by:** the owner, 2026-10-31, on cloud run 30's report.

**The letters cross in a FILE BESIDE THE ANSWER**, binary, two bytes an advance. The precedent is `engine/page-content`
([ADR-0210](0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)), which answers its
JSON in the answer file and writes its pictures' bytes into a second file `main` names in the request. The MuPDF host
already writes into a file `main` names, through the one mechanism `engine/extract` and `engine/form-pages` use: `into`
in the request (`outputNameSchema`), `writeOutput` into the session's granted output directory, the count in the answer,
and `main` taking it held to that count before reading (`takeAnnounced`) and removing it on every other path
(`removeOutput`). `engine/page-text` takes the same: no second way of writing a file beside an answer (B3a). The
page's JSON keeps its full 8 MiB, and the structured text is built once: the walk reads the object the JSON was written
from. Only a read that asks for letters — the text layer's — names the file, so search and the other readers of the
same page text pay nothing.

Rejected, the three options of the report: a split of the one answer into 6 MiB of JSON and 2 MiB of letters (it cuts
the JSON of a page it did not need to), a second channel (the structured text built twice a page, against a 10%
target), and a larger ceiling (a host-wide bound moved for one feature).

**The file's bound is derived from the text layer's own,** since the host writes letters only for the lines the layer
keeps, clipped as the layer clips them: `MAX_TEXT_LAYER_LINES` lines of at most `MAX_TEXT_LAYER_LINE` advances.

**A character past U+FFFF is PAIRED, not dropped,** withdrawing the first correction's fallback for it. The binding cuts
the character's value (`String.fromCharCode`) but still calls `onChar` once per character with its own origin and
quad. So each walked character is compared with the same cut applied to the JSON line's code point at the same place:
an exact check on both sides, needing no change to the binding, and a line holding an emoji or a rare Chinese character
gets exact positions. Such a character is two UTF-16 units of the line's text; its second unit advances 0.

## Correction, 2026-10-31 — the walk cannot read the text layer's lines, and costs too much where it can

Measured by cloud run 30, after the second correction and before any producer was built, on the Linux native shim:

- **The walk sees none of the substrate read's characters.** `stextOptionsFor('substrate')` asks for `segment`, and a
  segmented page puts every line inside a `structure` block (`"type":"structure","raw":"Split","std":"Div"` on a plain
  pdf-lib Times page). `StructuredText.walk` (`mupdfRaw.ts`) does nothing for a block of type 2 and the binding offers
  no accessor into one, so it walked no line and no character. `wordBoxes.ts` walks characters only because its read
  (`WORD_BOX_READ_OPTIONS`) asks for no `segment`.
- **A second read without `segment` does not pair, and costs too much.** On a dense page (45 lines of 95 letters) it
  walked 45 lines, of which 23 paired with the JSON's by text and origin, and in another order; on `chromium-type3.pdf`
  0 of 3; on `editor-fidelity.pdf` 15 of 15, out of order. It took 14.8 to 25 ms a dense page against the JSON read's
  1.7 to 2.5: about seven FFI calls and a new `Font` object per character. Against a 10% target, the walk through the
  binding is not a producer at any segmentation.

So the second correction's *the walk reads the object the JSON was written from* does not hold. What does: the route
(a file beside the answer, through the MuPDF host's one `into` mechanism), the format and `main`'s checks
(`textLetters.ts`, committed with its cases), and Decisions 1, 2 and 4 to 6. Which producer writes the letters — an
export of the shim that walks structure blocks in C and writes the format itself, or another — is a change to the
shim's ABI ([ADR-0124](0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md)) and is the owner's to decide (B4).

## Correction, 2026-10-31 — the producer: a shim export walking with MuPDF's own iterator

**Decided by:** the owner, 2026-10-31, in two answers to cloud run 30's reports.

**The producer is a Monstera export in the shim, `mz_text_letters`,** of the `mz_*` family ADR-0124 Decision 1 already
compiles beside MuPDF's `mupdf.c` (`mz_rewrite_images`, `mz_save_compacted`, `mz_keep_inline_images` are called by the
product today). It is not a hand-written wrapper of a MuPDF member, which is what ADR-0124 rejected; it needs no
amendment to it. It takes the structured-text page the JSON is written from, by its pointer, so one page read builds one
structured text; writes `textLetters.ts`' format into a buffer of the size it is given, checking each write against
that size before making it and reporting a page that does not fit; and keeps every `fz_try` in its own frame, as the
shim's README requires. It does none of `main`'s checking: the bound, the counts, the check values and the fallback
stay in `textLetters.ts`.

**It walks the blocks with MuPDF's own depth-first iterator,** `fz_stext_page_block_iterator_begin_dfs`, `_next_dfs`
and `_eod_dfs` (MuPDF 1.28.0, `include/mupdf/fitz/structured-text.h` lines 1175, 1227 and 1252: *"The iterator never
stops on struct blocks, and instead steps into them"*; defined in `source/fitz/stext-iterator.c`; walked by MuPDF's
own segmentation in `source/fitz/stext-raft.c` lines 90 and 144), using its functions and its `.block` and nothing
else of it (*"The parts of this are subject to change"*, line 1151). It keeps its place through the structures' parent
pointers, so it does not recurse, and there is no depth cap: a cap would place some lines as today for a reason
nothing records.

**The shim's own note, answered.** `native/mupdf-shim/monstera_mupdf.c`, where `mz_stext_json` was removed, says:
*"`fz_print_stext_page_as_json` is the authority's own answer to "what did the structuring produce"; a struct walked
here would be a second opinion about a format MuPDF owns, and it would silently stop describing the tree the day
MuPDF adds a block type (B3a)."*
- Its first clause does not apply: the letters are something the JSON does not carry, not a second description of
  what it describes. The line's text, order and box stay the JSON's alone.
- Its second clause is answered twice. Which blocks are stepped into, and in what order, is MuPDF's iterator's
  answer, the one its segmenter walks with, so a structure MuPDF changes is followed by MuPDF. And the export reports
  how many lines it walked: `main` compares that with the JSON's line count for the page, and where they differ every
  line keeps today's placement and the shortfall is written to the diagnostics log as an engine change, naming the
  page and both counts — never shown as an error, never refused. A block type MuPDF adds that holds lines is found
  there rather than silently.

The order the iterator gives is asserted equal to the JSON's (whose writer recurses, `source/fitz/stext-output.c`
lines 1122 to 1210) on the corpus fixtures, the angled-text fixtures and a page with nested structure blocks.

## Correction, 2026-10-31 — the page text's JSON is read at MuPDF's own precision scale

**Decided by:** the owner, 2026-10-31, answering cloud run 30's question about line origins.

**Measured first, by cloud run 30's `scripts/research/glyphPlacement.mjs` (commit 7b291c9c):** PDF.js draws every
glyph within 0.007 pt of where MuPDF reads it, on every font tried. What the text layer would have placed was 0.56 to
0.90 pt out at the median and up to 1.069 pt at worst, and the worst letter on every fixture was a line's first. The
cause is not the letters.

**MuPDF's serialiser truncates every geometric number it writes.** `fz_print_stext_page_as_json(ctx, out, page, scale)`
writes each one as `(int)(value * scale)` (MuPDF 1.28.0, `source/fitz/stext-output.c`, `as_json`):

| field | lines |
|---|---|
| a text block's `bbox` x, y, w, h | 1139 to 1142 |
| a line's `bbox` x, y, w, h | 1151 to 1154 |
| a line's font `size` | 1173 |
| a line's origin `x`, `y` (its first character's) | 1174, 1175 |
| an image block's `bbox` x, y, w, h | 1196 to 1199 |

Every product call passes no scale, and the binding's default is 1 (`mupdfRaw.ts`, `asJSON(scale = 1)`), so every one
of those numbers reaches its reader cut to a whole point toward zero. A box's right edge, x plus w, can be nearly 2 pt
short, and a 10.5 pt font reads as 10.

**The class, not the instance.** Every reader of the page text's geometry takes these numbers: the text layer, search
matches, `lineUnder`, `caretBesideLine`, markup quads made from a selection, spell check's marks, the Word export's
picture placement, `pageKindOf`'s areas, and `flatFields.ts`, which requests and parses the JSON itself. Correcting the line origin alone would have left all of them on truncated
boxes and sizes, and given the text layer's lines two sources of geometry.

**The decision: ask MuPDF for the JSON at its own precision scale, and undo the scale in the one reader.**
- `PAGE_TEXT_SCALE = 100`, ONE named constant in `textStructure.ts`. The JSON is requested through
  `pageTextJsonOf(structured)` beside it, which passes that constant, and `textStructure.ts`' reader divides by it.
  No second literal exists, and no request spells its own scale (B5). Every number then arrives in hundredths of a
  point, still truncated by MuPDF but by less than 0.01 pt.
- **The reader divides exactly the fields `as_json` multiplies**, the five rows above, and nothing else. The grid
  block's `xpos` and `ypos` are written with `%g` and are not scaled (lines 1235 and 1247), and its `w` and `h` are
  counts of columns and rows (lines 1254 and 1255), which `parsePageTables` reads and must keep as they are. A reader
  that divided every number would turn a table's three columns into 0.03.
- The text, the structure and the order of the JSON are unchanged; only those numbers change.
- The letters' file is unchanged. Its advances are measured from the line's first character's exact origin, which is
  now also the origin the JSON carries.

**Rejected, and why:**
- **The exact origin carried in the letters' file**, or a new field in the shim's export: it corrects the text layer's
  lines and no other reader, and makes the line's geometry come from two places, one exact and one truncated. That is
  a second opinion about where a line is (B3a), and it fixes the instance.
- **A shim export that serialises the structured text with floats:** a second serialiser of a format MuPDF owns, which
  is what the note quoted in the fourth correction warns against.
- **Rounding instead of truncating in the reader:** the reader cannot recover what the writer threw away. Only the
  writer's scale can.

**The shim's older note, answered.** Where `mz_stext_json` was removed, `native/mupdf-shim/monstera_mupdf.c` keeps the
note *"SCALE 1.0f, so coordinates arrive in the page's own units. Scaling here would bake a rendering decision into an
extraction path, which is the coordinate confusion invariant L3 exists to prevent."* It was written for that withdrawn
export, and its concern holds: a reader must never receive a coordinate in some other space. A precision scale does not
do that. It changes how many digits the serialiser keeps, not which space a number is in: the values are still the
page's display space, in points, and they leave `textStructure.ts` in exactly the units they did before, because the
one reader that receives the scaled integers is the one that divides. No consumer ever sees a scaled number, and no
zoom, device pixel ratio or render scale enters the path. The note is amended to say so where it stands.

## Correction, 2026-10-31 — a cut page's lines are counted against what the JSON kept

**Built by cloud run 30's step 4, the letters' file wired into `engine/page-text` as the second correction decided.**

**The fourth correction's count check was wrong on a page whose JSON was cut.** `pageTextBound.ts` answers a page past
one answer's ceiling with a prefix of its lines and `truncated`, while the letters' walk covers the whole page, so the
JSON's line count and the walk's could never be equal there: every cut page would have logged an engine change that did
not happen and lost its letters. Found while designing the wiring, before any build; a case on a real page cut by the
real bound shows the false entry on the fourth correction's rule and none on this one.

**The rule:** on a whole page the walk must give exactly the JSON's line count, as before; on a cut page it must give
AT LEAST the lines the JSON kept. A cut page whose walk falls short of what was kept still places every line as today
and logs the engine change, and a control holds that.

**The fifth correction's cost on the densest page, stated as the owner asked:** asking for the JSON at
`PAGE_TEXT_SCALE` made it about 6% larger (7,051,845 to 7,483,075 bytes on textWalk's L6 page, a stress fixture of
39,201 lines), so that page, already cut at the answer's 8 MiB ceiling, keeps 36,014 lines where it kept 37,800. A
normal page is about 13 KB and is not cut. Accepted by the owner, 2026-10-31; `ENGINE_PAGE_TEXT_MAX_BYTES`' own trigger
stands, and the first real page cut is the evidence to look at the bound again.

## Correction, 2026-11-01 — a line with letters is found by its band and laid along it; the browser's clicks are corrected, not cancelled

**Found by cloud queue item A2, building every reader's case on pages turned three ways and on angled text.** Three
things Decision 6 left to the browser's layout of the substitute were wrong wherever that layout is not the page's:

1. **Which line a pointer is on.** Decision 6 said `lineUnder` and `caretBesideLine` read the engine's line BOX. On an
   angled line that box is upright and covers its neighbours, and the browser's hit test, which `lineUnder` started
   from, met another line's text: a drag on a line turned 20 degrees selected the line below it. For a line with
   letters both now read its **band** — 0.25 of the glyph size below the baseline to 0.9 above it, from the first
   letter's start to the last letter's end, at the line's own angle (`bandPlace`). A line placed as before keeps its
   box.
2. **Where the line's element is.** Decision 1 keeps one element per line, and it was placed in the line's upright box.
   On a page turned 90 degrees that box is as tall as the line is long, so the fit scaled the line's text by
   `scaleX(0.000828)` (Chromium 151, read off the element). The browser's own handling of a click inside a selection
   met text with no width there, and after a drag a double click's word was removed by Chromium itself, every
   `Selection` method traced and none called. A line with letters is now laid along them: the band's rectangle, turned
   to the line's angle (`linePlacement`), still one element and one text node.
3. **A double and a triple click.** Decision 6 named both and nothing built them: the browser chose the word under the
   substitute's letters. The engine's letter now chooses (`letterAt`), the word is the platform's own word segment
   holding it, and a triple click takes the line under the pointer by its band. **The browser's handling of the press
   runs first and is corrected afterwards, never cancelled:** cancelling it left the browser's state from the click
   before standing — a first click inside a selection — and a double click followed by a triple click on one word
   ended with nothing selected.

A search's matches are painted by the layer (Decision 5's last sentence); the Highlight API's registry still records
which ranges match, and draws them transparent. The cases are `textLayerReaders.pw.ts`, 25 of them. On the text layer
before this build (909c0430's `packages/ui/src`) 20 fail; the five that pass are the three turned pages' triple clicks,
which the browser already chose correctly there, the double then triple click, which guards item 3's own regression,
and the double click's control.

**And a 26th, written after that count:** Edit › Translate on selected text read the platform's text of the selection
rather than `readTextSelection`'s, so a selection across a line end was sent as *term oftwelve*. It now takes the one
reading, required in its dependencies; the case fails on the text layer before this build with exactly that string.

