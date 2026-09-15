# ADR-0068 — The start screen projects into three slots

- **Status:** Accepted
- **Date:** 2026-09-15
- **Amends:** `docs/ARCHITECTURE.md` §7 — `Placement`'s `start-screen` member gains a `slot`.
- **Relates:** [ADR-0029](0029-how-the-registries-are-built.md) (how the registries are built),
  [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md) (the same shape, one surface along),
  [ADR-0002](0002-brand-mark-treatment.md) (the hero's artwork).
- **Context:** Stage 8's design pass, commit H — §10.3's start screen.

## The gap

§10.3: *"Start screen (never a conventional two-column launcher): centered hero — the app logo, "PDF EDITOR"
letterspaced beneath, tagline "Built For The Way You Work" — then one primary green **Open PDF… (Ctrl+O)** button, then a
grid of six feature shortcuts (…), **each a real entry point**. Recent files appear below the grid when they exist.
Footer: "Press F1 for keyboard shortcuts" and version + © Tenslor Inc."*

§7's placement for this surface is `{ surface: 'start-screen'; order: number }` — one ordered list. Four commands project
into it today: `document.open` (order 0), `app.about` (1), `log.reveal` (2) and `app.settings` (3), and
`StartScreen.tsx` draws all four alike, as primary buttons in one row.

The design has **three places with different presentations**: one primary button under the hero, a grid of feature
shortcuts, and a footer. An `order` alone cannot say which of them a command belongs in, so the screen can either draw
every command alike — which is not the approved design — or name `document.open` in `StartScreen.tsx` to draw it
differently, which is a surface holding its own knowledge of commands: *"the second wiring place this registry exists to
forbid"*, and what `check:secondwiring` scans `packages/ui/src/surfaces` for. The feature cannot be built by registering
into the seam as it stands, so this is a B4.

## Decision

```ts
{ surface: 'start-screen'; slot: 'primary' | 'shortcut' | 'footer'; order: number }
```

- **`primary`** — the button under the hero. §10.3 names one; the projection does not refuse a second, for the reason
  `startScreenModel` already gives about the grid's six: a projection that capped a slot would be the layout deciding
  what the registry may contain.
- **`shortcut`** — the grid of feature shortcuts. Each is a real command: it opens a document and then takes the reader
  to its feature, so no tile is a control with nothing behind it.
- **`footer`** — the application's own commands a person needs before any document is open: About, Settings, and the
  diagnostics log. With no document the ribbon is not drawn, so without this slot those would be reachable from the
  palette alone; §10.3's *"Modes hide chrome, never capability"* is the same argument one screen along.
- **Not commands, and not placed:** the hero (the logo, "PDF EDITOR", the tagline), the recent list (`RecentFiles.tsx`'
  own argument — data with a control, not a registered command), and the footer's text — the F1 hint, the version and
  the copyright. They are the screen's own content, as the status bar's page field is the bar's own control.

## Rejected alternatives

**Name `document.open` in `StartScreen.tsx`.** The cheapest edit and the defect §7 forbids; `check:secondwiring` would
report it, rightly.

**Order ranges** — 0–9 primary, 10–99 grid, 100 and up footer. A slot written as a convention in numbers is invisible to
the type and to every reader of one placement, which is QQQ-3's shape: the wrong choice costs nothing to write. ADR-0067
refused fixed indices for the same reason.

**A surface per slot** (`start-primary`, `start-shortcut`, `start-footer`). Three surfaces for one screen, each joining
every exhaustive switch over `surface` and `DRAWS_A_GLYPH`, while availability, ordering and glyph rules are identical
across them. A discriminant inside one surface is the status bar's `cluster`, and it is the smaller change.

**Take About, Settings and the log off the start screen.** §10.3 does not list them, and it does not list them as
removed either. Removing them would leave a reader with no document one route to Settings — the palette — which is the
capability a mode must never hide.

## Consequences

- Every existing `start-screen` placement names a slot in the feature commit: `document.open` → `primary`; `app.about`,
  `log.reveal` and `app.settings` → `footer`.
- `startScreenModel` answers per slot, and stays a pure function of the registry.
- The grid is empty until its commands exist (commit H2). An empty slot draws nothing, as an empty ribbon section does
  not draw its caption.
- **The footer's F1 hint needs a command bound to F1.** A line telling a reader to press a key that does nothing is the
  wired-tools defect in a sentence, so the hint lands with that command, not before it.
