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
