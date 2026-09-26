# ADR-0107 — The menu bar is a projection: section menus from the ribbon, the rest from a menu-bar placement

- **Status:** Accepted
- **Date:** 2026-09-26
- **Amends:** `docs/ARCHITECTURE.md` §7 (`Placement`) and §10.3 (the title bar becomes two rows).
- **Decided by:** the project owner's v5-14 and the prototype `v5-09-menu-bar.html` (work list 2026-09-26, item 3, a
  new D12 row), and the owner's answers of the same day (build every item with no command except *New window*).
- **Relates:** [ADR-0095](0095-the-title-bar-projects-the-applications-own-commands.md),
  [ADR-0098](0098-a-ribbon-placement-may-be-secondary-and-the-rail-has-a-foot.md),
  [ADR-0101](0101-a-ribbon-placement-may-name-a-menu.md), [ADR-0105](0105-the-section-rails-order-is-the-owners-v5-order.md).

## Context

v5-14 draws a menu bar as the window's top row, 32 px: the application icon, then *File · Edit · View · Organize ·
Comment · Forms · Review · Protect · Tools · Window · Help*, with the three window controls at its right end (46 × 32,
the Windows standard). The row with the tabs, Donate, Rate Us, the command search and the layout switcher moves below
it. The prototype's menus hold two kinds of content:

- **section menus** — Organize, Comment, Forms, Review, Protect and Tools list their ribbon section's groups and tools
  under the groups' captions; Edit lists Undo, Redo, Cut, Copy, Paste and Select all, then the Edit section's groups;
- **application menus** — File, View, Window and Help, whose items are not a ribbon section.

§7 names *menus* among the registry's projections, and no placement kind can say "this command is in the File menu".
A hand-kept menu file is the second wiring place §10.3 forbids. Electron's application menu is refused too: its default
carries accelerators the registry does not (Ctrl+W closed the window without asking, Ctrl+R reloaded, DevTools), and a
native menu drawn from the registry would be a second renderer of the projection, in `main`, outside the renderer's
theme and i18n.

## Decision 1 — a section menu IS its ribbon section

A section menu is `ribbonModel` for that section drawn as a menu: each captioned group a menu group under its caption,
every tool an item — primary, secondary and a named menu's members alike. No placement is added, so a tool registered
into a ribbon group is in the matching menu by construction.

## Decision 2 — a `menu-bar` placement for the application menus

```ts
| { readonly surface: 'menu-bar'; readonly menu: MenuBarMenu; readonly group: number; readonly order: number;
    readonly caption?: MessageKey }
type MenuBarMenu = 'file' | 'edit' | 'view' | 'window' | 'help';
```

A group is a number, because most of the prototype's application groups are unnamed separators; a group that has a
caption (View's *Layout · Theme · Zoom*, File's *Export*) takes it from its placements, and two placements in one
group naming different captions are refused at registration. Edit's application groups come first and the Edit
section's after, as the prototype draws it. Home is not a menu: its tools are placed on application menus.

## Decision 3 — every command the ribbon reaches is in some menu, and a case says so

The owner's rule. Sections other than Home are covered by Decision 1; Home's tools carry `menu-bar` placements or sit
in another section's group. A case asserts it as SET EQUALITY over the registry: every command with a ribbon placement
is reachable through the menu-bar projection.

## Decision 4 — the menu bar is the renderer's; the window controls stay the system's

The native caption stays gone (Window Controls Overlay). The overlay is reported at the MENU BAR's height, so Windows
draws its own three controls in that row, 46 wide — snap layouts, hover and accessibility come with them. The title bar
below no longer reserves room for them. The application menu stays `null`, so none of Electron's accelerators exist.

Shortcuts shown are the registry's (`shortcutMapOf`). Alt and F10 move focus into the bar; the menus follow the WAI-ARIA
menubar pattern (arrow keys, Enter, Escape). An item whose `when` is false in the current context is DISABLED rather
than hidden — the ribbon hides what cannot apply; a menu lists what exists and says what cannot run now.

## Rejected

- **`Menu.setApplicationMenu` built from the registry**: the registry lives in the renderer; the menu would draw in the
  platform's theme and could not show section captions.
- **A menu file listing command ids**: the second wiring place.
- **A section menu from its own placements**: every ribbon tool would need a second placement to appear there, which is
  the duplication Decision 1 makes unnecessary and the omission Decision 3 exists to catch.

## Correction, 2026-09-26 — a command may say it is ON, and Decision 3 is a registration rule

**A command may carry `checked(context)`**, pure and synchronous like `when`, answering whether the state it sets is
the current one. The menu bar draws a checked command as a checkable item with its mark — View's *Light*, *Dark* and
*Match the system* and its three layouts are one choice among several, and rulers, grid and the panels are on or off.
A menu that could not show which theme is current would be a list of verbs over a state it hides, which is what the
prototype's menu does not do. Absent means the command sets no state a menu shows. **Rejected:** a menu-bar
placement field (`checked` is a fact about the command in every surface, and a ribbon toggle will want it next); the
menu reading the setting itself (the menu would then know which command writes which setting — the layout table
one field narrower).

**Decision 3 is enforced at REGISTRATION, not by a case.** "Every command with a ribbon placement is reachable
through the menu bar" reduces to one fact, because every section but Home is a menu by Decision 1: a command whose
only ribbon placements are in Home must carry a `menu-bar` placement. `CommandRegistry` refuses one that does not, so
the application's own registry is checked every time it is built, including by every test that renders the shell,
where a set-equality case would have checked a fixture.
