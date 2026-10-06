# ADR-0166 — A tool's preview is placed as its commit is, so a move shows where the mark goes

- **Status:** Accepted
- **Date:** 2026-10-05
- **Amends:** `docs/ARCHITECTURE.md` §6, *Annotations use one geometry vocabulary*: the controller member `preview`,
  which took the gesture alone, and `ToolPreview`, which described one shape. Keeps the member list, ADR-0042's
  `complete`, and ADR-0154's `reopen`.
- **Decided by:** the owner's list for 0.1.10.0, item 14d: *"SELECT TOOL move/resize: ghost box, jumps on release.
  Object must move/resize live."*

## Context

The select tool turns a drag on the selection into `placeAnnotation`: inside a selected box it moves every selected
mark by the drag, on a corner it resizes that one mark with the opposite corner fixed (`selectTool.ts`,
`placementFor`). `commit` is given the page and its `PageTransform`, because those rectangles are PDF rectangles
reached through the one converter.

`preview` is given the gesture alone, so it can describe only what the gesture is in the overlay's pixels: the box
from the press to the pointer. For a marquee that is right. For a move or a resize it is the **ghost box** the owner
saw, a rectangle that is neither the mark nor where the mark is going. The overlay then holds the same shape after the
release until the page redraws (`AnnotationOverlay`'s `drawnWith`), so what the person watched was a marquee, frozen, and then
the mark appearing somewhere else: **the jump**.

What the select tool would need to draw the truth is exactly what `commit` already has: the page, to know the
selection is on it, and the transform, to place each selected rectangle on screen.

## Decision

1. **`preview(gesture, page, transform)`**, the same three values `commit` is given, read at the same moment. A tool
   whose preview needs neither ignores them; the select tool needs both.
2. **`ToolPreview` gains `boxes`**: several rectangles in the overlay's pixels, drawn as one shape. A multi-selection
   moves as several marks at once, and one rectangle cannot say that.
3. **The select tool's preview for a move or a resize is the placement itself**, each selected mark's rectangle as
   `placementFor` will commit it, converted back to the overlay's pixels. The preview and the command are computed by
   one function, so what is shown is what is sent.
4. **What is held after the release is therefore where the marks went**, by the overlay's existing rule and with no
   change to it: the held shape is the preview at the release, so the boxes stay where they were let go until the
   page draws the marks there.

## What this does not do, stated so it is not read as done

The mark's own pixels do not travel with the pointer. An annotation's appearance is part of the page's raster, drawn
by PDF.js, and PDF.js 6.2.108 has no way to leave one annotation out of a draw (its render parameters carry
`annotationMode` for all annotations, nothing per annotation). Lifting the mark's pixels out of the canvas was
considered and refused: a highlight's crop includes the words beneath it, so the words would move with the mark.
So the outline moves live and exactly, and the mark is drawn at its new place when the page redraws after the
command, which on an ordinary page is the next frame or two.

Moving the pixels as well would need the app to draw annotations itself over a raster drawn without them, which is a
change to how every page is drawn, and it is the owner's to ask for.

## Rejected

- **Expressing the preview in PDF space and letting the overlay convert it.** A move is a translation either way,
  but a resize keeps the opposite corner fixed, and the overlay would then have to know which corner, which is the
  select tool's rule in the dispatcher.
- **Handing the transform to the tool once, at the gesture's start.** A zoom during a drag would place the preview
  with a stale scale; `commit` reads it at the release for that reason.
- **A preview for the select tool alone, outside the controller.** A second preview path beside the registered one
  is the second wiring place §7 forbids.
