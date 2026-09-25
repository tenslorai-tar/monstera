# ADR-0095 — The title bar projects the application's own commands

- **Status:** Accepted
- **Date:** 2026-09-23
- **Amends:** `docs/ARCHITECTURE.md` §7 — `Placement` gains a sixth surface, `title-bar`, and the list of
  surfaces derived from placements names it; §10.3's title-bar clause, which named three things and now
  names four.
- **Relates:** [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md) (the status bar
  is a projection around two value controls) — this is the same move at the other end of the window, and its
  reasoning about value controls is taken rather than restated.
  [ADR-0068](0068-the-start-screen-projects-into-three-slots.md) (a placement names a slot).
- **Context:** Stage 10, the owner's design (`assets/Monstera PDF Editor UI Design/exports/`, 2026-09-22).

## The gap

The owner's document exports put two controls in the title bar between the document tabs and the command
search: **Donate**, a filled accent button with a heart, and **Rate Us**, an outlined button with a star.
Both are ordinary application commands — each opens a dialog — and §7's `Placement` had five surfaces
(ribbon, quick toolbar, context menu, start screen, status bar) and no title bar.

So the only way to draw them was to write them into `TitleBar.tsx`: a hand-maintained list of commands
inside a surface, which §7 names *"the second wiring place this registry exists to forbid"* and
`check:secondwiring` scans that directory for. The feature cannot be built by registering into the seam as
it stands, so this is a B4 and the amendment goes first.

§10.3's title-bar clause is the other half: it names *"integrated document tabs (Window Controls Overlay),
the Ctrl+K command search, and the layout switcher"* — three things, and the design has four kinds of thing
in that row. A surface added to §7 while §10.3 still describes a three-part bar would leave the law
contradicting itself in the way item 7 of the audit exists to catch.

## Decision

A sixth surface:

```ts
{ surface: 'title-bar'; emphasis: 'primary' | 'normal'; order: number }
```

- **The bar's own controls stay its own, and they are the ones that take a value.** ADR-0067's rule, applied
  here without change: the layout switcher holds the current mode, the document tabs hold the open set and
  the active one, and the command search is a field-shaped opener for `view.command-palette`. A command's
  `run` takes no argument, so none of the three can be a command, and each keeps one writer.
- **Everything else in that row is a projection.** A command placed on the title bar renders as a labelled
  button — icon and words, as the design draws them — in `order`, between the tabs and the search.
- **`emphasis` is on the placement, because the surface must not know which command is which.** The design
  gives Donate the filled accent treatment and Rate Us the outline, and a bar that decided that by reading a
  command's id is the layout table this ADR exists to forbid, one field narrower. It is the same argument
  ADR-0067 makes for `cluster` and the 2026-09-08 row makes for a ribbon group being a `MessageKey`.

## Rejected alternatives

**Write the two buttons into `TitleBar.tsx`.** The cheapest edit and exactly the defect §7 forbids. It is
also the one that looks most harmless here, because there are only two of them and they are unlikely to
move — which is what every second wiring place looks like on the day it is written.

**Put them on the ribbon instead and leave the bar alone.** This deviates from a design the owner fixed, and
it deviates in the direction that costs the most: Donate and Rate Us are the two controls in the whole
window that are about the application rather than the document, and the ribbon is sectioned by what you do
to a document. They would land in Tools › Application beside About, where nobody looking to support the
project would find them.

**Reuse `start-screen`'s `slot`.** A `slot` names a place on a screen that is not drawn when a document is
open; the title bar is drawn in every layout mode including Focus. One placement feeding both surfaces would
put Donate in the start screen's footer as a side effect of putting it in the bar.

**No `emphasis`, with `order: 1` meaning primary.** A convention in a number that no type states and no
single placement shows — §7's own argument against fixed indices, and it breaks the first time a third
command is ordered before Donate.

**A `variant` on the command itself rather than on the placement.** Highlight lives in three surfaces at
once; a command carrying one presentation would be asserting it looks the same in all of them, which is the
claim the ribbon, the pill and the context menu each already contradict.

## Consequences

- The title-bar projection is a pure function of the registry, testable like the others, and
  `check:secondwiring` already scans `packages/ui/src/surfaces`, where `TitleBar.tsx` lives — so this
  surface is covered from the day it projects, which the status bar's was not.
- **`emphasis` is a closed union of two, and a third value is a design change.** It is not a styling hook:
  adding `danger` or `quiet` to it would make the placement a stylesheet.
- The bar now has a variable-width region between the tabs and the search. The tabs already shrink; what a
  narrow window does with this row is the design's own question and is answered in the feature commit, not
  here.
- Nothing about the Window Controls Overlay changes. The projected buttons sit inside the draggable region's
  cut-out like the search and the switcher do, so they are not under the window's own controls.

## Correction, 2026-09-25

*"Both are ordinary application commands — each opens a dialog"* is true of Donate and was never built true of
Rate Us. When Rate Us landed (the E3 rating prompt, same day as this correction) it opens the Store's review
page directly through `app.review`, the prompt's own channel, so that a rating given from the title bar and
one given from the prompt are one fact in main's record. A dialog in front of it would have been a
confirmation of a press that already says what it does. The decision above is unaffected: both are still
ordinary commands projected by placement, and nothing about the surface depended on what `run` does.
