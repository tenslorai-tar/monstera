# ADR-0286 — A burn-in cuts drawings at the mark's edge before MuPDF removes the rest

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decided by:** the owner, 2026-11-05: *only what is inside the mark's box is removed, and everything outside it stays
  as it was*; strokes through MuPDF's own stroker (option (a) of the cloud agent's proposal of the same day); clip paths
  included; work/cloud-51-redact-line-art (`REMOVE_IF_TOUCHED`) is not merged.
- **Amends:** the native shim's ABI ([ADR-0124](0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md)), which
  gains one `mz_` export, and `applyApplyRedactions` (`packages/kernel/src/pageRedact.ts`), which calls it on each
  marked page before the burn-in and then asks MuPDF to leave line art alone.

## The problem, in one sentence

MuPDF can only keep or drop a whole subpath, judged by a box that over-reaches, so with *remove if covered* a drawn
signature under a mark stayed in the saved file, and with *remove if touched* a background, a line crossing the mark's
edge and a line 8 points clear of it went too.

## What was measured, and read

- MuPDF 1.28.0's burn-in culler (`culler` in `source/pdf/pdf-clean.c`) answers keep or drop per subpath from
  `fz_bound_path`, which holds every Bézier control point and grows a mitre-joined stroke by the miter limit times the
  width. On d594f808, 11 of 19 drawn shapes under a mark survived *if covered* (work/cloud-51's
  `redactionLineArt.test.ts`).
- MuPDF has **no vector clipping or path boolean** anywhere in fitz or in the third-party code it bundles.
- Its content-filter API is public (`include/mupdf/pdf/interpret.h`): a `pdf_filter_factory` chained through
  `pdf_filter_page_contents`, after MuPDF's own sanitize filter, sees every operator of the page and of each form the
  page draws (the sanitize filter instances forms), in PDF user space.
- Its stroker is not public: `fz_flatten_stroke_path` writes the outline it draws, dashes, caps, joins and miter limit
  included, as directed float edges into a `fz_rasterizer`, whose function table is declared only in the internal
  `source/fitz/draw-imp.h`. The plain rasteriser ignores the `rev` tag, so the edges alone, filled non-zero, are the
  ink.

## Decisions

1. **A new pass before the burn-in, in the shim, in C, through MuPDF's own parser and stroker:**
   `mz_cut_line_art(pdf_page *)`. It runs the page's content through `pdf_filter_page_contents` with the filter list
   *[MuPDF's sanitize filter, ours]* and `instance_forms`, so every form the page draws is cut in its own instance and
   a form drawn elsewhere is untouched.
2. **What is cut:** every path whose ink meets a mark — a fill, a stroke, both, a clip path (`W`, `W*`) whose boundary
   enters a mark, and an unpainted path (`n`) that enters one, which paints nothing and is dropped. A path whose ink
   does not meet any mark is passed on unchanged, so a line 8 points clear stays byte for byte as it was.
3. **How:** the ink is a set of directed edges — a fill's own flattened contours, a stroke's outline from MuPDF's
   stroker into a capturing rasteriser. Each edge closes into a triangle with one point, which keeps the winding number
   of every point, and each triangle is clipped (Sutherland–Hodgman) to the convex pieces of the area outside the marks.
   A mark is its quads where it has them (a text mark, slanted on turned text) and its `/Rect` otherwise; several marks
   and overlapping marks are taken one after another.
4. **What is written:** a fill keeps its operator and fill rule. A stroke's cut outline becomes a clip, painted by one
   synthetic wide stroke that lies away from every mark, so the stroke's own colour, pattern, alpha and blend mode paint
   it and no colour state has to be tracked. A hairline (a width under 0.1 point on the page) is cut on its centre line
   and stays a stroke, its dash phase carried along, because an outline would not stay one pixel wide at every zoom.
   Nothing of the original geometry inside a mark is written.
5. **Then the burn-in, with line art `NONE`:** MuPDF's box test can only add over-removal now, since nothing drawn is
   left inside a mark, and `REMOVE_IF_COVERED` judges a text mark by its quads' bounding box, so it would take pieces
   kept beside a slanted quad.
6. **The internal header is pinned by a proof:** `fz_rasterizer_fns`, `fz_new_rasterizer_of_size` and
   `fz_flatten_stroke_path`'s declarations are compared with the text this was written against, and a MuPDF upgrade
   that changes them is red until this pass is read again.
7. **Not cut, and said so:** tiling-pattern cells, soft masks and Type 3 glyph drawings (MuPDF's burn-in does not reach
   them either, `recurse = 0`), and gradients painted with `sh`, whose function cannot be cut. The dialog and the help
   say which can survive under a mark.

## Rejected alternatives

- **`REMOVE_IF_TOUCHED`** (work/cloud-51): no leak, but it removes what nobody marked. Not accepted by the owner.
- **`REMOVE_IF_COVERED`** (today): leaks a stroked curve under the mark.
- **A clip over the original path:** the data inside the mark would still be in the file.
- **Cutting a stroke's centre line and clipping its overspill** (option (b)): keeps strokes as strokes, but needs dash
  phases recomputed and a short extension into the mark at each cut end. The owner chose (a).
- **A content-stream interpreter in TypeScript:** a second opinion about MuPDF's parser (B3a), and no stroker.
- **A polygon-clipping dependency:** not needed for convex clip pieces, and a new dependency needs the owner.

## Costs, stated

- A cut stroke becomes a clip and a paint: Edit shapes later sees it as that, not as the stroke it was.
- Cut geometry is flattened to within 0.01 point, and a cut path is larger in the file.
- The pass reads each marked page's content once more before the burn-in; its time is measured and reported.
- The shim now reads an internal MuPDF header, held by decision 6.

## Note, 2026-11-06: the speed figure is accepted, and decisions 3, 4 and 7 as built

**The owner's ruling, 2026-11-06:** the speed target is met by option (a) as built, and option (b), cutting a
stroke's centre line, is not to be built.

**The figures the ruling rests on**, from `scripts/research/redactCutTiming.mjs`, 21 rounds, on this branch's build at
bc324628, in the Linux cloud container, 2026-11-05. Each side is the median time of the calls `applyApplyRedactions`
makes on one marked page; *today* is `applyRedactions` with line art *remove if covered*, as on d594f808:

| page | today | with the cut | today's spread |
|---|---|---|---|
| forty lines of text, three marks, sixty drawings no mark touches | 2.16 ms | 2.50 ms | 2.01 to 2.28 ms |
| 4,000 drawn paths, one mark over a corner (126 paths cut) | 5.51 ms | 26.27 ms | |
| one curved signature under one mark | 0.01 ms | 0.98 ms | |

On a page with no drawing under a mark the cut adds 0.34 ms, just beyond today's spread of 0.27 ms. On 4,000 paths it
adds about 21 ms, and the page's content grows from 132,274 to 402,373 bytes, because each cut path is written
flattened.

**Decision 3 as built.** Each edge a→b closes into the quadrilateral (a, b, (X, b.y), (X, a.y)), with X right of all
the ink, not into a triangle to one point. The quadrilaterals have the scanline winding MuPDF fills by, whether or not
the edges close up. Closing to one point left 7% of a dashed stroke's ink between its dashes, because MuPDF's stroker
sends a dash's two cap edges twice (measured 2026-11-05; `mz_fan_cut` in the shim).

**Decision 4 as built.** A stroke's cut outline is filled with the stroke's own paint where its fill and stroke alpha
and overprint agree; that draws the stroker's own pixels. Painted through a clip, the edge pixels differed by up to 81
of 255 (measured 2026-11-05). The clip and one synthetic wide stroke are the route only where alpha or overprint differ.
A clip cut to nothing is written as an empty clip, not left out. The hairline threshold is a stroke under **1 point**
on the page, not 0.1.

**Decision 7, read in the saved file** (`redactionLineArt.test.ts`, 2026-11-06):

- A **tiling pattern**: its cell stays whole in the file; the fill and the stroke it paints are cut, and nothing is
  painted inside the mark.
- A **soft mask**: its group stays whole in the file, the part drawn under the mark included; the fill it masks is cut,
  and nothing is painted inside the mark.
- **Type 3 glyphs**: the glyph procedures stay in the file; every glyph shown under the mark goes, and one across the
  mark's edge goes whole, as a letter does.
- **OPEN, reported to the owner, not fixed:** a glyph whose ink reaches past its advance, shown beside the mark, still
  paints inside it. MuPDF judges a glyph by its advance box (origin to advance width, descender to ascender), never by
  its ink (`source/pdf/pdf-op-filter.c`, the culler's `FZ_CULL_GLYPH` call). Measured on a Type 3 glyph that advances
  20 points and draws 60: 2,214 pixels painted inside the mark at 2×, whatever its FontBBox says, and none once its
  advance reaches the mark. That code path is the same for every font type; it was measured only for Type 3. The cut
  does not touch text, so d594f808 behaves the same.

## Note, 2026-11-06: the owner rules on the glyph finding — not fixed

**The ruling:** a letter is judged by its advance box, as MuPDF judges it, and no fix is built. The pixels came from
a Type 3 glyph built to draw three times its advance. In ordinary fonts a letter that stays has only a small tail under
the box, and that letter was not marked and stays readable beside it. The dialog keeps *not just covered*. The case in
`redactionLineArt.test.ts` now reads as stated behaviour, with the same assertions and control.

**The figures the ruling rests on**, from `scripts/research/glyphOverhang.mjs` (b1e34012), this container, MuPDF
1.28.0 native, 2026-11-06, 94 printable ASCII glyphs a font:

- **The test glyph under the default filled box:** 0 of 10,416 pixels inside the mark are anything but the box's
  black at 1 px a point; the glyph is still drawn beneath it, and with the box's one path taken out of the saved content
  588 pixels inside the mark are painted. Its letter extracts as *A*: it was shown beside the mark, not in it.
- **Ink past the advance box in ordinary fonts**, most, in hundredths of an em: Liberation Serif 3, its italic 12,
  FreeSans Oblique 16 (TrueType); Bitstream Charter 8, its italic 16 (Type 1); Inter Italic 10, Nimbus Roman 7, its
  italic 15, Nimbus Sans Oblique 16 (CFF).
- **The tenth MuPDF shrinks each box by:** a mark over the right 9% of a letter's box leaves the letter, with 2.9% (o)
  to 7.5% (Inter Italic W) of its ink under the mark; at 10% the letter goes, in every font tried.
- **Not built, and what it would have cost:** a two-pass glyph filter in the shim judging each glyph by its ink, about
  three to five days, touching every burn-in (Apply redactions, Redact matches, the prompt on save, close, export,
  print or send).

## Note, 2026-11-06 — the content's growth on a page of drawings was the cut's quadrilaterals, and is gone

The owner's document grew from 132,274 to 402,373 bytes of content under one mark (the cost note above). Reproduced on
a page of 4,000 drawings, this container, MuPDF 1.28.0: 151,983 bytes before, 222,086 after the cut alone, while
MuPDF's burn-in alone shrank the page to 144,873. Almost all of it was six cut shapes, each written as a stack of
four-point slices about 0.1 point tall: Decision 3's quadrilateral per edge, for every edge of a curve flattened at
0.01 point.

**Waste, and removed.** Consecutive edges that join end to start and go the same way up or down have quadrilaterals
whose y ranges touch and never overlap, so their union is one polygon, the run's points and two on x = X, with the same
winding everywhere. `mz_fan_cut` now writes each run as that polygon: the same page grew to 158,573 bytes, the cut took
6.6 ms against 7.8, and the burned-in page drawn at 4x by the cut before and after differs in 0 of 7,755,264 pixels.
`redactionCutSize.test.ts` holds the size (under a tenth of growth, where it was nearly half) and the picture.

**Found, the cut's own, not this change's, reported to the owner:** on that page at 2x, 45 pixels outside the mark
differ from the page before the burn-in by more than 2 grey levels, the same before and after this change. 36 are within
5 points of the mark, one of them ink lost (192 to 255, 3 points out); 9 are 3 to 5 levels along a cut shape redrawn as
its flattened outline, the farthest 10.5 points out.

## Amendment, 2026-11-07 — only what meets a mark is rewritten; the rest is written as it was

- **Decided by:** the owner, 2026-11-07: *fix the pixels outside the box; only what is inside the box is removed and
  everything outside stays.* Amends Decisions 2, 3 and 4 as to WHAT of a cut path is rewritten. What is removed, how a
  mark is read, the burn-in after it and Decision 7 do not change.

**Found, measured 2026-11-07 on MuPDF 1.28.0 in this container, at 4x:**

- **The ink lost 3 points out was a thin stroke's corner.** A closed subpath under a point wide, cut on its centre line
  (Decision 4), was written as runs that each started with a move, so the run ending at the subpath's start and the run
  beginning there met as two butt ends, and the corner's join went. It went whatever the corner's distance from the
  mark: on a 0.5-point square crossing the mark's edge, starting outside it, a pixel went from black to white.
- **The rest was the whole path being rewritten, flattened** (Decision 3), however far it reached: a 0.6-point wave of
  curves crossing the mark changed 1,116 pixels more than 5 points out, by up to 91 levels; a filled shape of forty
  curves, 370 by up to 10; a filled circle of 177 bytes came back as 11,006, a 3-point stroked circle of 157 as 180,999.
  On the owner's documents the local agent reported 315 of 324 changed pixels in two drawings crossing the box, and
  points going from 5,284 to 625,758: this mechanism by its description, not yet measured with this amendment.

**Decided:**

1. **The path is read as written**, subpath by subpath and segment by segment, line or cubic, in the stream's own
   numbers. A subpath that does not reach a mark is written as it was. A curve that does is split by its own control
   points (de Casteljau, at one half) until each piece either keeps its control box clear of every mark's box, and is
   written as the curve it is, or is no larger than half a point, and is flattened and cut. A curve lies inside its
   control points' hull, so no kept piece reaches into a mark.
2. **A fill (or a clip) keeps its winding exactly.** A closed subpath's winding is the sum, over its segments, of the
   loop (segment, (X, end.y), (X, start.y)), a curve's as a line's. A run of clear pieces is one such loop with its curves
   as written; where a mark lies to its right inside its height, the loop is split at x = c between the run and the mark
   into a part no mark meets and a rectangle, which is cut exactly. Only the flattened pieces' quadrilaterals are cut as
   before. A loop with no area is not written.
3. **A thin stroke keeps its joins**: what is drawn between two cuts is one run, and a closed subpath cut open writes the
   run ending at its start and the run beginning there as one, so the corner keeps its join. A dashed one keeps its runs
   apart, each at its own phase.
4. **A wide stroke's subpaths are stroked as written where their ink shares no pixel with a cut one** (their ink boxes,
   grown by a point, do not meet), only where a second coat changes nothing: opaque, no overprint, the Normal blend. A
   cut subpath is outlined whole, as before. Splitting inside a subpath was built and measured, and withdrawn: where a
   native stroke and an outline overlap, each antialiased edge pixel is painted twice and comes out darker (300 pixels,
   up to 64 levels, on the 3-point circle); cut at the seam instead, it would leave a light line there.
5. **The outline's edges are joined by their ends**, not taken in the order they come: MuPDF's stroker sends a stroke's
   two sides interleaved, so every edge had been its own quadrilateral. The same edges and the same winding.

**As built, the same pages:** none of the fills, the stroked circle, the grid of lines in one path or the drawings beside
the mark moves a pixel by more than 2 levels anywhere outside the mark, and nothing is drawn inside it; the 0.5-point
square keeps its corner. The filled circle is 100 bytes, the forty curves 2,798, the stroked circle 115,053.
`redactionOutside.test.ts` holds each, and with the cut before this amendment six of its ten cases fail.

**What is left, measured, and put to the owner:**

- **A thin stroke's end at the mark.** Cut on its centre line, a stroke under a point ends square where its centre meets
  the mark, so up to half its width of ink beside that end goes, inside half a point of the mark (3 pixels on the wave,
  up to 89 levels). Keeping that ink would put the stroke's ink inside the mark.
- **A segment cut short is drawn by the renderer a little differently along its length.** A thin line drawn from its
  start to where it meets the mark differs from the same line drawn whole by 3 levels up to 2 points back, and on the
  page of 4,000 drawings the 143 pixels left outside the mark are all on thin lines crossing it: worst 14 levels, the
  farthest 9 points out. MuPDF's burn-in alone moves none of them. A cut must shorten a segment that crosses the mark.
- **A wide stroke crossing a mark in one subpath is still outlined whole**: exact, and large (the 3-point circle 157 to
  115,053 bytes), because its outline at the cut's 0.01-point flatness is that many points. A coarser outline or a
  native stroke beside it would change pixels, as above.
- **The burn-in moves drawings no mark touches, and it is MuPDF's.** Its content filter folds nested `cm` operators into
  one (`pending.ctm = fz_concat(ctm, pending.ctm)`, `pdf-op-filter.c` 1.28.0 line 1354), and a reader of the original
  multiplies them in another order: on a page of 2,000 small curved shapes under nested transforms, none near the mark,
  215 pixels moved by up to 16 levels, the same with the cut, with MuPDF's burn-in alone, and with both.

## The owner's decisions of 2026-11-07 on what is left

All four stay as they are, and the cut is not changed for them. Each is held at its figure by a case in
`redactionOutside.test.ts`, at 4x, so a change beyond it goes red.

| what still changes outside the mark | how much | why it stays | held by |
|---|---|---|---|
| A thin stroke's ink beside the end cut where its centre meets the mark | 3 pixels within half a point of the mark, up to 89 levels; 2 more beyond it, 3 and 7 levels, where a split curve is flattened a little differently | **accepted: removal comes first**, so that ink stays gone; keeping it would put the stroke's ink inside the mark | the thin wave: at most 3 near, 2 far, 89 levels |
| A line cut short where it crosses the mark, drawn by the renderer a little differently along its length | 143 pixels on the page of 4,000 drawings, worst 14 levels, the farthest 9 points out; MuPDF's burn-in alone moves none | **accepted**: any cut shortens a segment that crosses the mark | the 4,000 drawings: at most 143, 14 levels, 9 points; the burn-in alone, none |
| A wide stroke crossing the mark in one subpath, outlined whole | no pixel moves; the 3-point circle is 115,053 bytes, from 157 (180,999 before this amendment) | **accepted**: the pixels stay exact and the size is already below what it was | the 3-point circle: no pixel moves, at most 115,053 bytes |
| Drawings no mark touches, under nested transforms, which MuPDF's own filter folds into one `cm` | on 2,000 small curved shapes: 215 pixels move, up to 16 levels (112 of them by more than 2 levels), the same with the cut and without | **not patched**: ADR-0011 already rejects carrying a private patch to MuPDF | the 2,000 shapes: the same with and without the cut, at most 112 by more than 2 levels, 16 levels |

## Note, 2026-11-10: where the page of 4,000 drawings' growth came from, and the part removed

The owner's figure: on `scripts/research/redactCutTiming.mjs`' page of 4,000 drawn paths and one mark, the content went
from 132,274 to 291,383 bytes with the cut and to 128,825 without it. Read from the content after the cut alone, this
container, MuPDF 1.28.0 native: the 126 paths the cut counts are almost all inside the mark and written as nothing;
ten replacements are written, seven of them under 1,100 bytes, and three of about 52 KB each. Those three are one
curve each, stroked 1.2 points wide, crossing the mark's right side.

**Two causes, one of them waste.** A stroke that wide crossing a mark is outlined whole (Decision 4 of the amendment,
accepted 2026-11-07), and MuPDF's stroker gives a bending curve's inner side as edges that double back, so they join
into runs of one: about 470 small polygons for the part outside the mark. That is the accepted cost. The waste was the
quadrilaterals' far end: they ran right to beyond the ink, so every edge INSIDE the mark left a sliver between the mark's
right side and there, which cancel and draw nothing. A curve across the mark's left side had none.

**Removed:** the quadrilaterals now end inside the first mark the ink meets, with rectangles for the edges' net crossing
where they do not close, so the picture is the same exactly (`mz_fan_cut`, `mz_fan_corrections`). The page now comes
back at 266,050 bytes, timed the same (21 rounds: 27.2 ms with the cut, 5.3 ms without). `redactionCutSize.test.ts`
holds it: the curve across the right side is no larger than its mirror image across the left (49,491 against about
34,000 before), and no pixel moves that the cut did not already move. Every case in the nine redaction files passes.

**What remains is the accepted outline**, 137 KB on this page for three curves, and making it smaller moves pixels by
this amendment's own measurements: a coarser flatness, or a native stroke beside an outline. It is put to the owner
again with this figure.
