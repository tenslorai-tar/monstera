# ADR-0098 — A ribbon placement may be secondary, and the rail has a foot

- **Status:** Accepted
- **Date:** 2026-09-24
- **Amends:** `docs/ARCHITECTURE.md` §7 — the ribbon placement gains `prominence`, and `Placement` gains a
  seventh surface, `rail`; §10.3's rail clause, which names the eight sections and now names what sits
  beneath them.
- **Relates:** [ADR-0095](0095-the-title-bar-projects-the-applications-own-commands.md) (a presentation
  property belongs on the placement, never on the command or the surface), the per-group fold of
  2026-09-23 (`ribbonFolding.ts`).
- **Context:** Stage 10, the owner's design, which is the target as it is:
  `assets/Monstera PDF Editor UI Design/exports/v5-*.png` (twelve files, 2026-09-24; gitignored).

## The gap

**The design draws fewer ribbon buttons than the registry places.** v5-02's Home shows four groups and
nineteen buttons at 1920 px: *File* (Open, Save, Print, Undo, Redo), *Quick tools*, *Display*, *Export*.
The running ribbon's Home, read off the renderer on 2026-09-24 by `ribbonInventory.capture.ts`, carries
fourteen buttons in *File* alone. None of those may disappear, since a command placed nowhere is reachable
only from the palette, and the owner's order says: *"each ribbon group folds its less-used tools into More."*

**Today's fold cannot say *less-used*.** `ribbonFolding.ts` folds by WIDTH: a group keeps what fits and
carries the rest. At 1920 px there is room, so every Home button would be drawn and the design's four
groups would never appear. Which tools are the less-used ones is a fact about the command in that group,
and the ribbon placement has no field for it.

**The rail has nowhere below its sections.** Every v5 export draws a Settings gear at the foot of the
left rail, apart from the eight sections. §10.3's rail clause names the eight sections and nothing else,
and §7's `Placement` has no surface there. Drawing it means writing a command into the rail by hand, which
is the second wiring place §7 forbids.

## Decision

**1 — A ribbon placement may be secondary.**

```ts
{ surface: 'ribbon'; section: SectionId; group: MessageKey; order: number; prominence?: 'secondary' }
```

- **Absent means primary**, so the hundred and more existing placements keep their meaning without an
  edit.
- **A secondary placement is drawn in its group's *More* at every width**, in `order` among the other
  secondaries. The width fold then works on the primaries alone, as today: a narrow window moves primaries
  into the same *More*, after the secondaries.
- **A group must hold at least one primary.** A group of secondaries only would be a caption over a lone
  *More*, which the fold already refuses to produce. The ribbon model refuses it when built, and a case
  asserts the refusal.

**2 — The rail has a foot, and it is a projection.**

```ts
{ surface: 'rail'; order: number }
```

A command placed on the `rail` is drawn as an icon button at the rail's foot, below the eight sections, in
`order`: labelled in Ribbon mode as the sections are, and icon-only in Studio with its title as the tooltip
and accessible name. It is not drawn in Focus, which draws no rail. **The rail's sections remain the
ribbon's sections**, and nothing here changes how a section is chosen.

## Rejected alternatives

**List the design's buttons per section in a layout file.** It would match the exports exactly on the day
it was written, and it is the second wiring place §7 forbids — the one that silently drops the next
command added to Home.

**Remove the commands the design does not draw.** They would become palette-only, which deletes the ribbon
path to Save copy, Cloud storage, PDF/A and the rest without a decision about any of them. The owner said
*fold*, not *remove*.

**An `order` threshold meaning secondary** (say, 100 and above). A convention in a number that no type
states, the same argument ADR-0095 makes against `order: 1` meaning primary.

**`prominence` on the command.** Highlight is primary in Home › Quick tools and in Comment › Markup; a
command-level flag would assert the same prominence in every group.

**One section-wide *More* for the less-used tools.** It would take the tools out of the groups the owner's
captions name, so *Export text* would no longer sit under *Export*.

**Settings in the title bar or on the start screen only.** The title bar is the row for the application's
own commands, and adding Settings there is a design change the owner has not drawn. The start screen is
not drawn while a document is open, and the exports put the gear on the document screens.

## Consequences

- `ribbonModel` returns each group's primaries and secondaries separately, and `ribbonFolding` takes the
  secondaries as already folded. Its width arithmetic is unchanged: a group whose secondaries are
  non-empty always carries a *More*, and its width counts one.
- Keyboard and screen reader: a secondary tool is reached exactly as a width-folded one is, through its
  group's *More*, which is already a menu with its own keyboard path.
- The rail projection is a pure function of the registry like the others, and `check:secondwiring`
  already scans `packages/ui/src/surfaces`, where the rail lives.
- Which commands are secondary in which group is **the feature commit's** decision, taken from the
  exports, and each one is visible in the placement that declares it.
