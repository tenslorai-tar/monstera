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

## Correction, 2026-09-15 — the zoom cluster had a third position, and the toggle had no cluster

**The decision above could not express the approved zoom order, and the feature commit built a different one.**
§10.3 (`docs/ARCHITECTURE.md`:2302-2304) and `BUILD-PROMPT.md`:1075-1077 give the order as *"zoom-out button · slider ·
zoom-in button · current percentage · fit mode"*. That has **two** things of the bar's own in it — the slider and the
percentage readout — with a command between them. `side: 'before' | 'after'` names one gap on each side of one control,
so zoom-in and fit mode could only both be *after the slider*, and `3f6c67b` rendered zoom-out · slider · percentage ·
zoom-in · fit and stated the deviation in a comment. The owner's ruling of 2026-09-15: follow the approved design, do not
edit §10.3 to match the build; if this ADR cannot express it, the placement type changes.

The mistake in the decision was the sentence *"The percentage is a readout, which the bar already renders"*: true, and it
treated a readout as having no position. Anything the bar renders between two projected commands is a position a
command has to be able to name.

**And the quick-toolbar toggle had nowhere to go.** The consequence above says it lands *"as a command placed on this
surface"*; §10.3 asks for it *"as a status-bar toggle"*. Neither `navigation` nor `zoom` is what it is, and putting it in
either would give a screen reader a group named *Zoom* holding a control that shows a toolbar.

### Corrected decision

The `status-bar` placement is discriminated by cluster, so each cluster's positions are exactly its own gaps:

```ts
  | { surface: 'status-bar'; cluster: 'navigation'; side: 'before' | 'after'; order: number }
  | { surface: 'status-bar'; cluster: 'zoom'; side: 'before' | 'between' | 'after'; order: number }
  | { surface: 'status-bar'; cluster: 'chrome'; order: number }
```

- **`navigation`** is unchanged: before or after the page field (with its *⁄ total*).
- **`zoom`**: `before` the slider, `between` the slider and the percentage, `after` the percentage. §10.3's order is then
  zoom-out `before`, zoom-in `between`, fit width and fit page `after`.
- **`chrome`** holds the bar's commands about the chrome itself — the quick-toolbar toggle first. It has no value
  control, so it has no `side`, and a `side` written on it is a compile error rather than a value nothing reads.

A `between` on `navigation` is unrepresentable too: the page field is one control, and a gap that does not exist should
not be spellable (B5).

### Rejected

- **Edit §10.3 to the built order.** The owner's ruling; and §10.3 is the approved design, not a description of a build.
- **Make the percentage a command.** It takes no action; a command that does nothing when run is the wired-tools defect.
- **One `position` index across the whole bar.** The fixed-index alternative this ADR already rejected, for its reason.
- **Keep `side` two-valued and move the percentage after fit.** A second deviation from the same sentence.
