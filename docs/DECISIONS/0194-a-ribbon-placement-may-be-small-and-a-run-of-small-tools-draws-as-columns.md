# ADR-0194 — A ribbon placement may be small, and a run of small tools draws as columns

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0098](0098-a-ribbon-placement-may-be-secondary-and-the-rail-has-a-foot.md) and
  [ADR-0101](0101-a-ribbon-placement-may-name-a-menu.md) — a ribbon placement had two optional properties, `prominence`
  and `menu`; it gains a third, `size`. Their rules (a secondary folds first; a menu is one button) stand.
- **Found by:** the owner's review, 2026-10-05 (Screenshot 2026-10-05 232806) and the checklist's *Compact ribbon* —
  *every ribbon group is one row of large buttons; Shapes as a small icon grid, Highlight / Underline / Strikethrough
  stacked with labels, Measure and Links as a small icon grid.*

## Context

Every ribbon button is the same size: a glyph over its caption, 52 × 64. The Comment section asks for 2642 px at its
natural width (§10.3's measurement in the comment on `ribbonTitle`), so at the owner's 1280 it folds into *More* what a
person uses most. The owner's reference draws the same tools in three sizes: a large button for the tool a group is
about, a small button with its label stacked three to a column, and a small glyph alone in a grid.

The registry already decides what a surface draws (§7), and the ribbon is a projection of it. The size of a tool in a
group is a fact about the command **in that group** — Highlight is large in Home › Quick tools and small in Comment ›
Markup at once, as *Highlight is primary in two groups* is the reason `prominence` is on the placement. So the size is
on the placement too, and the surface holds no list.

## Decisions

1. **`size?: 'large' | 'small' | 'icon'` on the ribbon placement.** Absent is `large`, so no placement written before
   today changes. `small` is a glyph beside its caption, in a row of a column; `icon` is the glyph alone, named by the
   caption (its `aria-label`) and described by the full title as a tooltip, since the label is not drawn.
2. **A run of consecutive entries of one small size in a group is gathered into columns of at most three,** by one
   function — `ribbonUnits`, which already defines what a button is for the fold and the drawing alike (B3a). The run's
   entries are distributed over `ceil(n / 3)` columns, remainder first, so seven icons are 3 + 2 + 2 and never 3 + 3 + 1.
   A column is **one unit**: the fold measures it as one width and folds it as one, from the end, and its members then
   appear in the group's *More* one command per line, as every folded unit's do. A column is measured by `data-stack`
   where a button is measured by `data-command`; nothing else about the measurement changes.
3. **A run does not cross a boundary the order already has:** it ends at a large tool, at a different small size and at
   a named menu, and the secondaries are gathered among themselves, after every primary. So the secondaries still fold
   first — a column of them at a time — and *More* still lists them last.
4. **The registry holds one more rule:** a command placed `icon` must have a `ribbonTitle` or a `title` (it always has
   one) and a glyph (it is refused without one already), so an icon-only control cannot be unnamed. There is no case to
   add that the type does not already close.
5. **No hand-made layout.** Which tools are small is each command's placement; the ribbon computes the columns. The
   *expand arrow* on a shapes gallery is not built here: a group's *More* is already what opens the rest, and a second
   control for the same job would be two (the owner decides, in the report, whether a gallery flyout is wanted).
6. **Tooltips and keys are unchanged.** A small button keeps the tooltip rule — present where the caption is an
   abbreviation — and an `icon` button always has one.

## Rejected alternatives

- **Sizes on the command, not the placement.** Highlight would then be the same size in every group it sits in, and the
  question the placement exists to answer (*in this group*) would be answered by the wrong object.
- **A group-level `layout` field with the rows in it.** A second place a group's contents are written; the placements
  already are the contents.
- **Letting CSS wrap a plain row into rows.** The fold measures units in widths; a row that wraps has no width the fold
  can charge, and what folds would be decided by the browser. A column is a unit with a width.
- **Columns of exactly three, filled in order.** Seven icons would end in a column of one, which reads as an accident.

## Consequences

- Comment, Organize and Tools carry `size` on their placements; the other sections do not change today.
- The ribbon's first measurement draws each column once before it is folded, as it does each button.
- The rendered baselines of every screen that shows these three sections change, and are regenerated on Windows.
