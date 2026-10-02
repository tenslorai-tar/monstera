# ADR-0132 — The title bar carries a light and dark switch, the bar's own control over two registered commands

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** `docs/ARCHITECTURE.md` §10.3's title-bar clause, which named three things: the document tabs, the Ctrl+K
  command search and the layout switcher.
- **Decided by:** the owner's list of 2 October, item 6A: *"a Light/Dark toggle in the title bar. Narrow the search
  field and add one icon button showing what a click switches to; from System it picks the opposite of what is
  showing. High contrast is unchanged; while Windows high contrast is on, the button is disabled with a tooltip."*
- **Relates:** [ADR-0095](0095-the-title-bar-projects-the-applications-own-commands.md) and
  [ADR-0113](0113-the-applications-own-commands-sit-at-the-centre-of-the-menu-row.md) (what the title bar projects),
  [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md) (a control that holds a value).

## Context

The owner's list asks for *"a command with a title-bar placement (ADR-0095)"*. That placement no longer exists:
ADR-0113 renamed it `menu-bar-commands` when Donate and Rate Us moved to the menu row, and left the title bar holding
the tabs, the search and the layout switcher, each a control that holds a value.

The switch is that kind of control. Its face is a value: it shows what a click switches to, so it reads the theme on
show, which is the setting or, under *System*, the operating system's scheme. A placement draws a command's own icon
and title, and a command has one of each; a placement drawing the face of a value would need a second icon and a
second title on the command, or on the placement, for one control.

## Decision 1 — the bar's own control, running registered commands

Two commands, `view.theme-light` and `view.theme-dark`, write `appearance.theme`. Each exists while it is the switch's
next step (`when`), so the palette offers the one a click would run. The title bar draws one icon button that runs
whichever applies, exactly as the layout switcher runs the three `view.layout-*` commands: the bar reads the value, the
commands alone write it (B3), and a bar over a registry without them draws no switch (the wired-tools rule).

**What a click does from *System***: the opposite of what is showing, written as an explicit choice. A person looking
at dark who presses it wants light, whatever the setting said about why it was dark.

**Its face** is the theme a click switches to: a sun while dark is showing, a moon while light is. Its accessible name
and tooltip are the command's title, *Switch to light theme* or *Switch to dark theme*.

## Decision 2 — high contrast is not a value of the switch

High contrast stays outside `appearance.theme` (its own trigger, `THEME_SETTING`'s comment). While Windows asks for it,
the switch is shown **disabled and still focusable**, with the tooltip *"Windows high contrast is on, so light and dark
follow it"*, and neither command exists. Hidden, it would be a capability a platform setting took away without saying
so (§10.3, *modes hide chrome, never capability*); natively disabled, it fires no hover and its tooltip could not show.

## Decision 3 — the search narrows to make room, and keeps its placeholder and chord

The command search gives up width for the switch; its placeholder and its `Ctrl+K` chord stay whole at 1280 × 800,
which a rendered case holds in light and dark.

## Rejected

- **Bring back the `title-bar` placement.** It draws a command's single face; this control's face is a value. Giving
  the placement or the command a second icon and title for one control is the layout table one field narrower,
  ADR-0095's own argument against deciding presentation from an id.
- **One command that toggles.** Its title could not say what a click does: *Toggle theme* names no outcome, and the
  palette would offer an action whose result depends on state the person cannot see from the list.
- **A three-way control (System, Light, Dark) in the bar.** That is the Settings row; the owner asked for one button.
- **Writing `appearance.theme` from the bar.** A second writer of the setting beside Settings (B3).

## Correction, 2026-10-02 — the two commands already existed, and they are not conditional

Decision 1 was written without reading `chromeCommands.ts`: `view.theme-light` and `view.theme-dark` already exist,
with `view.theme-system`, as the menu bar's *View › Theme* items (ADR-0107), each writing the setting the Settings
dialog writes. Two sentences above are therefore wrong, and are corrected here rather than edited:

- *"Each exists while it is the switch's next step (`when`)"* is withdrawn. A menu item whose `when` fails is drawn
  disabled, and *Light theme* must stay choosable from *View › Theme* whatever is showing. The commands are unchanged;
  **the switch chooses which of them to run** from the theme on show.
- *"the commands alone write it"* was false: Settings writes `appearance.theme` too. What holds is that **the bar writes
  nothing itself**; it runs a registered command, as the layout switcher does.

**The switch's name is its own**, *Switch to light theme* or *Switch to dark theme*, because it says what a click does;
the commands keep their titles, *Light theme* and *Dark theme*, which name a choice in a list.

**And a third sentence, found by the stage audit of `173cc5ae..0401c925`** (finding DDDDDDD-5): Decision 2's *"and
neither command exists"* under Windows high contrast is withdrawn with the first. The commands have no `when` at any
time; under high contrast it is the SWITCH that is disabled and says why, while *View › Theme* keeps both choosable,
since the choice is stored and takes effect once Windows stops asking for high contrast.
