# ADR-0067 — The status bar is a projection around two value controls

- **Status:** Accepted
- **Date:** 2026-09-14
- **Amends:** `docs/ARCHITECTURE.md` §7 — `Placement` gains a fifth surface, `status-bar`, and the list of
  surfaces derived from placements names it.
- **Relates:** [ADR-0029](0029-how-the-registries-are-built.md) (how the registries are built).
- **Context:** Stage 8's design pass, commit E — §10.3's status bar.

## The gap

§10.3: *"The status bar always carries page navigation: first / previous / an editable "page ⁄ total" field (type a
number, Enter jumps) / next / last … The zoom cluster is zoom-out button · slider · zoom-in button · current
percentage · fit mode, all real controls."*

The commands exist — `view.page-first`, `view.page-previous`, `view.page-next`, `view.page-last`, `view.zoom-in`,
`view.zoom-out`, `view.fit-width`, `view.fit-page` — and `StatusBar.tsx` renders none of them. §7's `Placement` had four
surfaces (ribbon, quick toolbar, context menu, start screen) and no status bar, so the only way to put those buttons in
the bar was to write them into it: a hand-maintained list of commands in a surface, which §7 names *"the second wiring
place this registry exists to forbid"* and `check:secondwiring` exists to find. The feature cannot be built by
registering into the seam as it stands, so this is a B4.

## Decision

A fifth surface:

```ts
{ surface: 'status-bar'; cluster: 'navigation' | 'zoom'; side: 'before' | 'after'; order: number }
```

- **Buttons are commands, and are projected.** A command placed on the status bar says which cluster it belongs to and
  which side of that cluster's value control it sits on; `order` orders it within that side.
- **The two value controls are the bar's own.** The page field and the zoom slider each take a value, and a command's
  `run` takes none (the reason `view.go-to` sends the caret to a field rather than opening a prompt). They write the
  state the commands change — the page through `jumpTo`, the zoom through the zoom state — so each still has one owner.
- **The percentage is a readout**, which the bar already renders.

## Rejected alternatives

**Write the buttons into `StatusBar.tsx`.** The cheapest edit and exactly the defect §7 forbids: a surface holding its
own list of commands, invisible to the registry, the palette's view of where a command lives, and every projection test.

**Place them on the quick toolbar and render that projection in the bar too.** The quick toolbar is a surface with its
own list, hideable by its own command; one placement feeding two surfaces would make hiding one hide the other, and
it would put the navigation buttons on the floating pill as well.

**Make the page field and the slider commands.** A command runs with no argument. A command per page, or a command that
reads a value from the DOM, is a second channel for the value and a run that cannot be tested without the surface.

**A single ordered list with the value controls at fixed indices.** An index is a position two features that never see
each other's code cannot agree on — §7's own argument for `order` being a number — and it breaks the day one command
is added before the field.

## Consequences

- The status-bar projection is a pure function of the registry, testable like the others.
- **`check:secondwiring` does not see the status bar where it is.** `scripts/lib/secondWiringPlace.mjs` scans
  `SURFACES_DIR = 'packages/ui/src/surfaces'`, and `StatusBar.tsx` is at `packages/ui/src/`. Read before this ADR was
  committed, and it corrects the draft, which said the scan would find a hand-written list there. The feature commit
  moves the bar into the surfaces directory, so the scan covers it from the day it projects.
- **§10.3's status-bar toggle for the quick toolbar is not built by this amendment or its feature commit.**
  `view.toggle-quick-toolbar` does not exist as a product command — §7 names it, and it appears only in two test
  fixtures — and a button bound to a command that does not exist renders and does nothing. It lands with the quick
  toolbar's own pass, as a command placed on this surface.
