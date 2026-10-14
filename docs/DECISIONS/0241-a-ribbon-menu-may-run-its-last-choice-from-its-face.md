# ADR-0241 — A ribbon menu may run its last choice from its face

- **Status:** Accepted
- **Date:** 2026-10-14
- **Amends:** [ADR-0101](0101-a-ribbon-placement-may-name-a-menu.md) (a ribbon placement may name a menu) and
  `docs/ARCHITECTURE.md` §7's ribbon placement, which gains `menuRuns`.
- **Decided by:** the owner's cloud run 4, Part 4 item E2: *"The Edit object button does nothing when clicked. Only
  choosing from its dropdown ('Edit all objects', 'Edit text objects', 'Edit images', 'Edit shapes') enters object mode.
  Clicking the button itself should enter 'Edit all objects', or the last choice."*

## The mechanism

ADR-0101 draws placements naming one `menu` as ONE button whose whole action is to open the menu. That is right for
Forms › Data's *Export* and *Import*, where no member is the obvious one and the format is the choice. Edit object is
the other shape: its four members are one mode with a filter, and a person who presses the mode's button means *turn
the mode on*. The face could not say so, because a menu's face runs nothing.

## Decision

1. **A menu may declare that its face runs a member.** `menuRuns: 'last'` on its placements draws the menu as two
   parts in one unit: the face, which runs the member chosen last from that menu in this window (its first member by
   `order` until one is chosen), and a chevron beside it that opens the menu as ADR-0101's button does. The face
   carries the member's own title as its accessible name and its tooltip, so a person and a screen reader are told what
   a press will do.
2. **Every placement naming the menu declares the same `menuRuns`**, or none does. The registry refuses a menu whose
   members disagree, naming the commands, as it refuses `menu` with `prominence: 'secondary'`.
3. **The last choice is the window's, not a setting.** It lives in the ribbon's own state and is gone on restart: it is
   a convenience of the current session, and a persisted value would be one more thing a person did not choose to save.
4. **The width fold is unchanged**: a menu is one unit whether or not its face runs a member, and a folded menu lists its
   members in the group's *More* individually, as before.

## Rejected

- **Making Edit object's face a separate primary command.** A fifth command, *Edit object*, beside four filters that
  already are the mode, would be a second way to enter it and a second place to keep in step.
- **Always the first member.** The owner's sentence allows it; the last choice is what a person who switched to *Edit
  images* expects on the next press, and costs one value in the ribbon's state.
- **Turning every named menu into a split button.** Forms › Data's faces would then run a format nobody chose.

## Consequences

- `ribbonUnits` carries the declaration with the unit, so the fold and the drawing read one answer.
- Forms › Data is unchanged; Edit object declares `menuRuns: 'last'`.
