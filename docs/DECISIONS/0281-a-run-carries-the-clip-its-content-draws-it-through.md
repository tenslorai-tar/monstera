# ADR-0281 — A run carries the clip its content draws it through, and a block never spans two

- **Status:** Accepted
- **Date:** 2026-11-01
- **Decided by:** the owner, 2026-11-01, answering C4: *yes, build the per-run clip identity*: carry each run's clip from
  the host's read, through the contract, to the grouping; the grouping splits a block where the clip changes; the
  writer does not learn multi-clip blocks; today's silent wrong write never becomes a refusal (ADR-0271).
- **Amends:** the PDFium host's two run reads, `textRuns` and `pageRuns` (ADR-0176 Decision 3's pre-read), which take
  the clips as an input; the engine host gains one read, `textClips`.

## The problem, in one sentence

The operator writer sets a block's lines in one text object where the block's first line stood, inside that line's
clip, so a line the page drew through another clip is written into a clip it was never drawn through and can vanish,
with no warning.

## What was measured

- **The writer checks clips only between lines under different transforms** (`operatorEdit.ts`, *lines under
  different CTMs*): two lines under one transform and two clips are written as one object, in the first line's clip.
- **PDFium cannot say which clip a text object is drawn through.** Its content parser drops an object's clip when the
  clip is a rectangle that holds the object's bounds. Measured 2026-11-01 with PDFium 155.0.8044.0 through
  `FPDFPageObj_GetClipPath`: `q 0 696 612 64 re W n` around a line answered no clip, and `q 0 600 100 96 re W n`,
  which cuts the next line, answered one. C4's own shape is the first: each line clipped to a rectangle around itself.
  So a clip identity read from PDFium is blind exactly where it is needed.
- **The kernel's own parse of the content already answers it.** `contentLayout` gives the clip windows in force at any
  offset, the same reading the writer places its text by (ADR-0266's correction of 2026-10-25, `pastHidingClip`).

## Decisions

1. **One rule says which clip a text object is drawn through:** `clipIdentitiesAt` in `textOperators.ts`, the clip
   windows in force at the object's `BT` (`contentLayout`), hashed (SHA-256, the first 64 bits in hex), absent where no
   window is in force. The writer's check of lines under different transforms takes the same function, so the read and
   the writer cannot disagree about whether two lines share a clip (B3a).
2. **The engine host reads it**, as it reads a page's Type 3 faces for the same grouping (ADR-0256): `textClips` answers
   each text object of the page's content, in content order, its identity or none. Bounded by the text object bound the
   PDFium wire already uses.
3. **The PDFium host takes the clips as an input** to `textRuns` and `pageRuns`, and gives each object the identity of
   its place among the page's text objects, which is the numbering the writer already joins PDFium's objects to the
   content by (ADR-0176 Decision 3, `PageRuns.textObjects`). The identity is part of a run's style for the join
   (`textRunJoin.ts`): objects drawn through two clips are never one run. Both reads take the same clips, so the run a
   person is shown and the run an edit writes are one join's answer. Where PDFium's count of text objects is not the
   content's, no object is given a clip: the writer refuses that page's numbering on its own (ADR-0270 Decision 4).
4. **The grouping splits by clip as it splits by frame** (`groupInFrames`): runs drawn through different clips are
   never one block. Each block then has one clip and is a block the writer already writes. A page drawn through one
   clip, or none, is grouped exactly as before.
5. **The clip never reaches a renderer.** It is the grouping's, as the font name in a run's style already is on that
   wire.
6. **Text inside a form keeps today's grouping.** A placement is read by PDFium as a page of its own document, which the
   engine host's session does not hold, so its runs are given no clips. Stated, not fixed: a form block drawn through
   two clips is grouped as before.

## Rejected

- **PDFium's clip path as the identity**: blind to a clip that holds its object, which is C4's shape (measured above).
- **The writer learning multi-clip blocks**: the owner's answer; one inserted object stands in one place.
- **Refusing a block whose lines are in two clips**: ADR-0271 and ADR-0270, *never refuse an edit*.
- **"Whether the clip narrows the run" as the identity**: a line clipped to a rectangle around itself is narrowed by
  nothing, and the line below written into that rectangle is hidden.

## Consequences

- On a page whose producer clips every line to its own rectangle, a paragraph is offered as one block per line. Each
  edit is written where it belongs; such a paragraph no longer reflows across its lines.
- Opening a page for Edit text costs one more engine host read, a pass over the page's content the writer already makes.

## Proofs

- `textLines.test.ts`: two lines of one paragraph in two clips are two blocks; CONTROL, one clip or none, one block.
- `textRunJoin.test.ts`: two abutting objects in two clips are two runs; CONTROL, one clip, one run.
- `proof:edittext`: a paragraph's two lines in two clips, and one line's two halves in two clips, are edited, saved and
  reopened, and each line is read back through the clip it was drawn through, by the content's own parse; CONTROL, the
  same paragraph in one clip is one block of two lines and reads back through that clip.
