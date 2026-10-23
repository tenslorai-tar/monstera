# ADR-0261 — A page command is shown at once from the pages already drawn, and an edit's look is held until replaced

- **Status:** Accepted
- **Date:** 2026-10-23
- **Extends:** [ADR-0257](0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md)'s rule, *the final
  look at once, held until the page draws it*, from Comment marks to page rotate, move and delete, to a form field's
  design change and to Edit text's committed words, including their undo and redo.
- **Amends:** `docs/ARCHITECTURE.md` §6's account of what a surface draws between a command and the page's drawing of
  its result.
- **Decided by:** the owner's LOCAL-FIX-SESSION-4, N1, 2026-10-23: *"the result is shown at once, and the saved version
  replaces it with no visible change"*, and the owner's answer 1 of the same day (a field's size, position, colour and
  border at once; a font change keeps the field as drawn until the page draws it).

## The problem, measured

`markLatencyWalk.mjs` on 0.1.18.0 (2026-10-21): the final look of a rotate takes about 0.5 s, a page move 0.8 s, a page
delete 0.9 s, a field design change 0.7 s and an Edit text commit 1.0 s. In each, nothing changes on screen until
`main` has applied the command, the parser has opened the new version and the page has drawn it.

Three facts decide the design, read from the code on 2026-10-23:

1. **No page command is predicted.** A page's rotation comes only from `document.viewModel` at the store's version
   (`usePageRotations.ts`), and slots are keyed by page index (`PageList.tsx`, `Thumbnails.tsx`).
2. **The store's version moves before the view does.** `onApplied` moves `open.version` at once, and the parser's view
   of the new bytes follows (`useDocumentView.ts`). So between the two, a slot pairs the OLD view's page `i` with the
   NEW version's rotation of page `i` — after a move or a delete these are different pages.
3. **Edit text's editor leaves at `onApplied`**, before the page draws the new words (`TextEditLayer.tsx` derives the
   open editor from the blocks' version, which moves with `open.version`), so the old words show, with no editor, for
   the redraw's length.

## Decision

1. **A page plan, per document, beside the held looks (one holder each, ADR-0257 Decision 3).** At dispatch, a page
   command (rotate, move, swap, delete) becomes a plan: the pages the person will see, each as *which page of the view
   on screen* and *at what rotation*. Every surface that draws pages — the main view, the thumbnail strip and Organize
   — draws the plan's pages from the view it already holds, in the same update as the command is sent. The plan is
   built by one pure function (`pagePlan.ts`) from the command, so what is shown is what was sent (ADR-0166 Decision 3).
2. **A plan is made only over a view that is current.** If the view on screen is older than the store's version (an
   earlier command still being drawn), a plan would rearrange the wrong layout; the command is then shown as today,
   when the page draws it. A second page command while a plan is pending composes onto it.
3. **The handover is ADR-0257 Decision 4's.** The plan stays until the page shows a view at least as new as the version
   the last planned command produced; a slot keeps its canvas until the new drawing is presented, so no frame shows
   neither. While a plan is in force a slot takes its rotation from the plan, never from the view model at the store's
   version, which is fact 2's mismatch closed.
4. **Undo and redo** of a planned command are planned from its inverse, which the renderer records when the command
   is answered. An undo of a **delete** is not planned: the deleted pages are in no view the renderer holds, so there is
   nothing to draw them from. It is shown when the page draws it, and reported as a target not met.
5. **A refused command drops its plan at once**, and the surfaces draw the view on screen as it is, with the existing
   message. Never a page left showing something that was not saved.
6. **A field's design change is held as a look** through ADR-0257's holder: its size, position, fill colour and border
   are drawn from the command over the page drawn without the widget (`drawWithout`), at once. A font change is not
   drawn ahead; the field stays as drawn until the page draws it (the owner's answer 1).
7. **Edit text's committed words stay** in the editor, which no longer takes the pointer, until the page presents a
   view at least as new as the version the edit produced.

## Rejected

- **Rotating the canvas with CSS.** Instant, but the saved page is then a re-render at another size, and the handover is
  a visible change of sharpness; drawing the plan's page from the view with PDF.js is the same pixels the saved version
  will draw.
- **Keying slots by a page identity across versions**, so a moved page's canvas moves with it. It needs an identity the
  view model does not carry, and a slot that changes key unmounts its canvas at the handover, which is a blank frame.
- **Asking `main` for the new layout first.** The answer comes after the command is applied, which is the wait being
  removed.

## Correction, 2026-10-23 — a planned page takes the pixels already drawn, and PDF.js only when there are none

**What was measured.** Built as Decision 1 first said — each planned page drawn again by PDF.js from the view on
screen — the page's own pixels changed 270 to 350 ms after the command (`markLatencyWalk.mjs --changes`, rotate, move
and delete, two runs each, 2026-10-23, the dev build at b34642ae plus this session's tree). The changes before that,
at 35 to 70 ms, were the elements over the page; the canvas itself waited for a whole page's raster. Against 0.5 to
0.9 s before, and against the owner's 100 ms, short.

**The mechanism.** Every page a plan shows is one the screen already has: a moved page's drawing is in the slot it is
leaving, a page after a delete is in the slot above, and a turned page is its own drawing turned by quarter turns. So
at the moment a plan changes, the page list keeps a copy of each page canvas's drawing with what it shows — the view's
page and its turn — and a planned slot presents the copy of its source at once, turned by the difference, through the
one presenter that sizes the pixel ledger (`renderPage.ts`). PDF.js draws a planned slot only where no copy is held
(a page scrolled in during the plan, a tiled page). The new version's drawing replaces it as before.

**Why this is not the rejected CSS rotation.** That was rejected because a resampled picture is a visible change of
sharpness at the handover. A quarter turn of a bitmap at the device size it was drawn at moves whole pixels and
resamples nothing; a copy of a moved page is the same pixels. What could still differ at the handover is PDF.js
rasterising a turned page with sub-pixel placement unlike the upright one, which `blinkWalk.mjs` reads as an untouched
change if it shows.

## Proof

A rendered case per category (rotate, move, delete, undo and redo of each, field design, Edit text commit) with a
control: with the plan or the hold switched off the case is red. A failure case: the shown result goes back.
`markLatencyWalk.mjs`: the visible result within 100 ms, the final within 200 ms or replaced invisibly; `blinkWalk.mjs`:
0 bad frames.
