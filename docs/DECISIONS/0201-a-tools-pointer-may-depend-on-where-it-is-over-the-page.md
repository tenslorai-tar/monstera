# ADR-0201 — A tool's pointer may depend on where it is over the page

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0042](0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md) and
  [ADR-0166](0166-a-tools-preview-is-placed-as-its-commit-is.md), which shaped `ToolController` — a tool's `cursor` is one
  value for the whole page, and the controller has no read that is not part of a gesture. Their rules stand for every tool
  that does not use the addition.
- **Found by:** the owner's order of 2026-10-08, item 5.6 (item 14 of the 2026-10-07 review): *the resize cursors on the
  handles — a move pointer in the middle of a selected mark, and the right resize arrow on each corner and edge.*

## Context

`UiTool.cursor` says `arrow`, `text` or `eraser`, and the overlay puts it on the drawing surface as `data-cursor`. The select
tool's pointer is `arrow` everywhere, so a person grabbing the corner of a selected rectangle sees the same pointer as over
empty page, although a press there resizes. The pointer should say what a press will do, and what a press will do is the
tool's own hit test: `placementFor` decides among *a corner*, *a side midpoint*, *inside a selected box* and *nothing*.

Three routes were considered.

## Decision

1. **`ToolController` gains a read, `pointer(at, page, transform)`,** answering `ToolPointer | undefined` — `move`,
   `resize-nwse`, `resize-nesw`, `resize-ns`, `resize-ew` — for a point over the page with NO gesture in flight. `undefined`
   means the tool's own `cursor`. **It is a required member with a default in `pointerPath`** (`() => undefined`), as `complete`
   and `reopen` are (ADR-0042 Decision 2): not an optional one, which ADR-0042 rejected as a runtime branch standing in for a
   type where a misspelling gets the default silently. Every tool that spreads `pointerPath` is unchanged.
2. **It is the hit test a press uses, not a second one.** The select tool's corner, side and inside tests move into one
   function, `grabbedAt`, which `placementFor` (the press) and `pointer` (the hover) both call (B3a). The pointer cannot say
   *resize* where a press would move, because there is one rule.
3. **The overlay applies it by attribute, not by state.** On a pointer move with no gesture it calls `pointer` and writes
   `data-pointer` on the drawing surface — removing it when the answer is `undefined` — so a moving pointer re-renders
   nothing. The stylesheet maps each value to its cursor and wins over `data-cursor`.
4. **During a drag the pointer stays what the press chose.** The overlay does not ask again while a gesture is in flight, so a
   resize keeps its arrow however the pointer moves, and a move keeps `move`.
5. **The resize arrows are the screen's.** The select tool works in the overlay's viewport frame, which is already rotated and
   zoomed to what is drawn, so the top-left and bottom-right corners are `nwse` and the other two `nesw` on a page turned any
   way; no rotation arithmetic is added.

## Rejected alternatives

- **CSS on the drawn handles.** The handles are drawn by `SelectionLayer` as squares with no pointer events, because the
  press is the tool's, and the drawn handle is sized from the tool's own reach ([ADR-0133](0133-a-signatures-mark-is-drawn-once-for-both-writers.md) Decision 4); making them targets would add a second hit rule beside the tool's and let the two disagree
  about a slipped press.
- **Re-rendering on every pointer move to hold the pointer in state.** A move over a 200-page document is hundreds of events a
  second; an attribute write is the whole of what changes.
- **A list of cursors per tool in the registry.** A pointer that depends on a point cannot be a list of values; the tool must
  be asked.

## Consequences

- `ToolController.pointer` (required, defaulted in `pointerPath`), `ToolPointer`, `selectTool`'s `grabbedAt`, the overlay's move handler and four rules in
  the stylesheet. Cases: the hit test answers the same pointer for the same point a press would act on; the overlay writes and
  removes the attribute; a tool with no `pointer` keeps its cursor.
