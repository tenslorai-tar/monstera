# ADR-0101 — A ribbon placement may name a menu

- **Status:** Accepted
- **Date:** 2026-09-24
- **Amends:** `docs/ARCHITECTURE.md` §7 — the ribbon placement gains `menu`.
- **Relates:** [ADR-0098](0098-a-ribbon-placement-may-be-secondary-and-the-rail-has-a-foot.md) (secondary
  placements and the group's *More*, which is the same mechanism without a name).
- **Context:** Stage 10, the owner's v5 design. v5-08 draws Forms › Data as two buttons, **Export** and
  **Import**, over six registered commands: form data to and from JSON, XFDF and FDF.

## The gap

Those six commands are deliberately six. `exportFormDataCommand`'s header rejects one command with a
format dialog: *"a dialog whose only control is a three-way choice spends a click on something the menu
can say."* The design agrees with that header. It draws one button per direction, and the format is what
the button offers. So what is wanted is a labelled button that opens its commands, the way a group's
*More* does, with its own caption and icon instead of *More*.

The ribbon placement cannot say that. Making the six secondary would leave Data with no primary, which
ADR-0098 refuses; making them primary draws six buttons where the design draws two; and a format dialog
is the click the header already rejected.

## Decision

```ts
{ surface: 'ribbon'; section; group; order; prominence?: 'secondary'; menu?: MessageKey }
```

- **Placements in one group naming the same `menu` are drawn as ONE button** captioned by that key, with
  the glyph of the first of them by `order`, opening a menu of their full titles in `order`. It sits
  where its first member's `order` puts it.
- **A menu is a primary unit of the row.** It counts as one button to the width fold, and a narrow
  window folds it into the group's *More* like any other button, as its commands listed individually.
- **`menu` and `prominence: 'secondary'` do not combine.** A secondary is already in a menu, the group's
  *More*. The type allows both fields, and the registry refuses the pair at construction, naming the
  command.

## Rejected alternatives

**One command per direction with a format dialog.** The click `exportFormDataCommand` already rejected,
for a choice the menu can state.

**Six primary buttons.** Correct and unlike the design, and a row of *Export JSON… · Export XFDF… · …*
buries the two things the group is for under a format list.

**`Export JSON…` as the primary, the others secondary.** It would draw *Export* over one format while
implying all three, which is a label that is not true of its control.

**A menu declared by the surface.** A list of which commands go under which button, in `Ribbon.tsx`, is
the second wiring place §7 forbids.

## Consequences

- The ribbon model keeps its flat list of entries, each carrying its `menu`. The fold and the ribbon work
  in **units**, where a unit is one entry or the run of entries sharing a menu. The unit is computed in one
  function, `ribbonUnits`, so the fold and the drawing cannot disagree about what a button is.
- Keyboard and screen reader: the menu button is a Base UI `Menu` trigger, as *More* is, named by its
  caption, and its items are named by their commands' full titles.
