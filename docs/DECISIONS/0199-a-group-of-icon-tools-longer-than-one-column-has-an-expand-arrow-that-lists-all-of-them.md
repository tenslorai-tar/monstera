# ADR-0199 — A group of icon tools longer than one column has an expand arrow that lists all of them

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0194](0194-a-ribbon-placement-may-be-small-and-a-run-of-small-tools-draws-as-columns.md), Decision 5 —
  *the expand arrow on a shapes gallery is not built here; the owner decides.* The owner has decided (the overnight order
  of 2026-10-08, item 5.3: *the expand arrow that opens the full shape list*).
- **Found by:** the owner's reference ribbon, where a shapes gallery ends in an arrow that opens every shape.

## Context

ADR-0194 draws a run of `icon` tools as columns of three. The Comment ribbon's Shapes group is twelve tools, so four
columns, and at the owner's 1280 the width folds the last of them into the group's *More*. A person who wants a shape
that is not in the first columns opens *More*, which is a list of the folded tools in the order they fold — correct, and
not what the reference shows: an arrow at the end of the gallery that opens **all** of it, the drawn ones included, with
names.

ADR-0194 held back because the arrow and *More* look like two controls for one job. They are not the same job. *More* is
what the width hid, so what it holds depends on the window; the arrow is the whole group, the same list at every width,
which is what a person looking for a shape by name wants.

## Decisions

1. **A group whose run of `icon` tools is longer than one column (more than three) draws an expand arrow after its
   buttons.** One function decides it from the group's units, `ribbonUnits` — the function that already defines a button,
   a column and a menu for the fold and the drawing alike (B3a) — so the arrow is a fact about the registered placements
   and the surface keeps no list of which groups have one. Today that is Comment › Shapes; Measure and Links are one
   column each and have none.
2. **The arrow opens a menu of EVERY entry of the group,** in the group's own order, each with its glyph and its title,
   through the component that draws *More* (`RibbonMore`) — one menu component, so the two cannot differ in how they
   open, how a keyboard reaches them or how a tool is named. It is a view of the same projection: the entries are
   the group's own array, and a command cannot be in the menu without being in the group.
3. **The arrow is a small icon button, not a captioned one,** named for a screen reader *All {group}* and described by
   the same words as a tooltip, so an icon-only control is never unnamed (ADR-0194 Decision 4).
4. **The fold charges for it.** It sits inside the group's buttons row, after every unit, and its width and the gap
   before it are added to the group's `chrome` — the cost of the group besides its buttons — so a group with an arrow is
   measured as wide as it draws. A fold that did not know the arrow was there would let the row run past its room by the
   arrow's width, which the first measurement of the row would then show as a sideways scroll.
5. **It does not replace *More*.** When the width folds tools, the group still draws its *More* for them, and the arrow
   still lists all of the group. Two controls, two answers: *what did not fit* and *everything in this group*.

## Rejected alternatives

- **A per-group flag on the placement or the section (`gallery: true`).** A second place a group's contents are decided;
  the placements already say which tools are icons, and the arrow follows from them.
- **Making *More* list everything when its group has an arrow.** *More* is measured and shown by the fold as the tools
  the width hid; changing what it holds by group would make its meaning depend on a property nobody can see.
- **A grid flyout of glyphs without names.** The reference draws one, and an icon-only menu cannot be searched by name
  or read by a screen reader as a list; the glyph and the title are one row.

## Consequences

- The rendered baselines of the Comment screens change (an arrow after the Shapes columns) and are regenerated on Windows.
- `ribbonFolding` is unchanged (it takes widths); the measurement in `useRibbonFold` reads one more box.

## Correction, 2026-10-09

The owner overruled the arrow on seeing it in 0.1.12.0: the Shapes group's arrow listed the same seven shapes that were already
drawn beside it, so it added a control and no tool. It was there because the decision above gave every group whose icons ran
past one column an arrow that lists the group whole, drawn tools included, so that an icon could be found by its name; in the
one group that had it, the tooltips already name each icon and nothing in the list was missing from the row. The arrow, its
component branch, its width in the fold's measure and its message are removed. A shape the width folds away is still in the
group's own *More*, which is the list of what is not shown. The statements above are kept as written; this is the record that
they no longer hold.
