# ADR-0129 — An open document's view lives until it closes; a background tab is kept, hidden

- **Status:** Accepted
- **Date:** 2026-10-01
- **Amends:** `docs/ARCHITECTURE.md` §6, the paragraph *"State is per document"*: it now says what a background
  tab holds, not only that its store survives.
- **Reverses:** the implementation decision recorded in `App.tsx`'s `activate` comment, *"Only the active view is
  mounted, and that is a BUDGET decision"*. It was never in the law; it is recorded here because it was a
  deliberate choice with a stated reason, and reversing it silently would leave that reason unanswered.
- **Relates:** §9.17 (the renderer budget, still `provisional`), [ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)
  (one parser per version, ranges refused for any other).
- **Context:** the owner's review of the installed 0.1.6.0 (2026-10-01, `tabswitch_grid.png`). One tab switch
  showed three stages: slots at their minimum size with blank thumbnails and the zoom readout still on the other
  tab's figure, then a blank page at 100%, then the page at its fit. Row 303 says tab switching is instant.

## What was wrong

§6 already says *"Tab switching changes which store the UI reads — nothing is snapshotted, restored, or
re-parsed."* The store half was true. The view half was not: `App` mounted the page area for the active document
only, keyed by its id, so every switch unmounted one document's page area and mounted the other's from nothing —
a new PDF.js parser over a new range transport, a scroller at minimum slot sizes, thumbnails undrawn, the zoom
resolved after the first measurement. That is a re-parse on every switch, and the three stages are its phases.

The comment that held the decision gave a real reason: one set of page bitmaps per open document is the first
thing in this build that looks like the cache §9.17's renderer budget is about.

## Decision

1. **Every open document has a layer, mounted from open to close.** The layer on show is in flow; a background
   layer lies over the same box under `visibility: hidden`, with `inert` and `aria-hidden`. Not `display: none`,
   which would drop its layout box, its scroll offset, and every intersection, and so unmount the canvases this
   exists to keep.
2. **The same component instance whether on show or behind.** A background layer renders the same `PageCanvas`
   at the same position with props of its own, so a switch changes props and React keeps the parser, the drawn
   pages and thumbnails, and the scroll offset. Anything that wraps a slot must be the same component on both
   sides (`pageMenu` is one callback for that reason); a different wrapper at that position remounts every slot.
3. **Behind, a layer shares the LAYOUT and nothing else.** Rulers, the split, the page layout and both side
   panels' widths come from the same settings, so its fit resolves to what it will be on show and nothing re-fits
   on activation. It gets no tool, no search, no compare and no reporting into `App`'s state, which belongs to
   the document on show; its page and zoom are its own store's (§6). Its document panels mount nothing, so
   nothing behind the reader asks main for outlines or lists.
4. **A version moving under a background layer is recorded without activating it.** The active layer is told
   through `opened`, which brings a document forward; a background layer is told through a mover that only
   updates its tab and store.

## Cost, and what is not known

**Not measured here; the local agent measures memory on the installed build.** The estimate, per background tab,
is its PDF.js worker and parsed document plus the bitmaps of the pages in its margin and its visible thumbnails.
Computed, not measured: a Letter page at 1.5 device pixels and 100% is 918 × 1188 × 4 bytes, about 4.4 MB, so a
margin of three or four pages is roughly 13–18 MB of bitmaps; the worker and parse are not estimated here
because nothing in this repository has measured a PDF.js worker's resident size. Ten tabs is ten of those.

§9.17's renderer budget is `provisional`, so no stated number is breached by this; equally, nothing checks it.
**Trigger:** if the local agent's measurement shows the renderer past what §9.17 is later set to, the follow-up
is a cap on kept layers — least recently shown released to the old behaviour — not a return to one layer, which
would bring back the re-parse §6 forbids.

## Rejected alternatives

- **Keep only the last frame** (a bitmap of each tab's page area shown until the remounted view has drawn). It
  hides the stages and still re-parses on every switch, which §6 forbids, and the renderer cannot capture its own
  page area as an image without a new channel to `main`; a composite of the canvases would miss every DOM layer
  over them.
- **Cache the parser per document and remount the page area.** Removes the parse and keeps every other stage: the
  minimum slots, the undrawn thumbnails, the fit resolved after the first measurement.
- **A cap on kept layers now.** A number with nothing measured behind it; it is the stated follow-up instead.
- **Keep the scroller but drop its canvases while hidden.** The bitmaps are most of what a switch would otherwise
  redraw, so this keeps the cost of the decision and not its point.

## Correction, 2026-10-02 — the page menu is not shared behind

Decision 2's *`pageMenu` is one callback for that reason* held the rule and cost every switch. The callback wrapped
each slot in a menu built from the focused document's context, so a layer behind took a prop that changed with
every switch, and with it the element on show as `children`: every render of `App` rendered every kept layer's
every slot and rebuilt every slot's menu, 1.5–2.2 s of work after each switch on the installed 0.1.8.0. The rule
stands — the wrapper is the same component on both sides — and now it is one `MenuArea` per list, which asks for
the right-clicked page when the right-click happens; a layer behind takes `NO_MENU`, which is Decision 3's *the
layout and nothing else*. `DocumentLayer` is memoised and takes the element on show only when it is the layer on
show, so a switch renders the two layers it moves. Proof: `tabSwitchRenders.pw.ts`.
