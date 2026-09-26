# ADR-0105 — The section rail's order is the owner's v5 order

- **Status:** Accepted
- **Date:** 2026-09-26
- **Amends:** `docs/ARCHITECTURE.md` §10.3 (the left section rail).
- **Supersedes:** `BUILD-PROMPT.md` M3 (:1054-1055), *"the eight feature sections — Home, Comment, Edit, Organize,
  Forms, Review, Protect, Tools"*.
- **Decided by:** the project owner, 2026-09-26, through the reviewing seat's work list (item 2d).
- **Context:** the owner's v5 design lists the sections in a different order on every screen that draws the rail
  and in its prototype's section table: **Home, Organize, Edit, Comment, Forms, Protect, Review, Tools.** The
  founding record's order was user-approved and binding (M3), so the design cannot simply be followed in the code:
  the order is law, and law changes by amendment.

## Decision

The rail lists the sections in the owner's v5 order: Home, Organize, Edit, Comment, Forms, Protect, Review, Tools.
The same order is the one every projection of the sections takes — the rail, the Studio overlay's section list,
the setting that remembers the active section, and the menu bar's section menus (v5-14), which the prototype
draws in its own sequence of File · Edit · View · Organize · Comment · Forms · Review · Protect · Tools and is a
menu order, not the rail's.

**The order lives in one place.** `SECTION_IDS` in `registries/placement.ts` is the list the rail and the ribbon
iterate, and the setting that remembers the active section takes its values from that list rather than spelling a
second one. A case pins the sequence against this ADR's list, so a reordering by accident is a red test rather
than a quiet change to a binding clause.

## What it gives up

Nothing functional: no section gains or loses a command, and every shortcut that selects a section is unchanged.
A person used to a build with the old order finds Organize second rather than fourth, which is the design's intent
— page work is the second thing most people do with a PDF after reading it.

## Rejected

- **Keeping M3's order and drawing the design's elsewhere.** Two orders for one list is the second-opinion shape
  B3a forbids, and the rail is the thing the owner's screens draw.
