# ADR-0146 — A narrow window keeps the page, and folds the chrome around it

- **Status:** Accepted
- **Date:** 2026-10-03
- **Amends:** `docs/ARCHITECTURE.md` §10.3's side-panel clause (*"a chevron in the panel header collapses it; a slim
  edge handle on the canvas reopens it"*) and its menu-bar clause, and
  [ADR-0113](0113-the-applications-own-commands-sit-at-the-centre-of-the-menu-row.md) Decision 3, which has two states
  where a narrow row needs three.
- **Decided by:** the owner's CLOUD-4 list, item 1f: *"at 760 wide, the tool strip and Properties panel cover the page
  and the menu row runs off at Rate Us."*
- **Relates:** [ADR-0107](0107-the-menu-bar-is-a-projection.md) (the menu bar is a projection), §10.3's *"Modes hide
  chrome, never capability"*.

## The problem, in one sentence

Every part of the document row and the menu row keeps its own minimum and nothing keeps the page's, so a narrow window
gives the page whatever is left. Measured 2026-10-03 at 760 × 560 on the pinned Chromium, that was 174 px between two
panels at their minimums, with the floating tool strip over a quarter of it. In the same run the menu row needed 834
px of 760.

## Context

The window's floor is `MINIMUM_WINDOW`, 1024 × 720, and never more than the display's work area (`minimumWindowFor`).
A 1080p display at 200% gives about 960 × 516, so a window narrower than 1024 is a real setup, not a test size. Read in
the same run, without the window controls a browser does not draw:

| width | page area | menu row |
|---|---|---|
| 1024 | 318 px, both panels open | fits, labelled |
| 960 | 254 px | fits only because *Rate Us* wrapped onto a second line |
| 760 | 174 px | 834 px wanted, *Rate Us* cut off |

In the application the row's end also holds the system's window controls: three caption buttons, which Windows draws
46 px wide each at 100%. That is Windows' own size and was not measured here. On that figure, at 960 even the icon
form of ADR-0113 does not fit after the eleven menus. The row has 940 px inside its padding; less 16 of gaps, 186 of
reserve and 696 of menus, that leaves 42 px for 64 px of icons.

At 960 the wrapped *Rate Us* is a measuring defect inside ADR-0113's own mechanism, not a missing state. The commands'
grid track is `auto`, so it shrinks to fit and the button's words wrap. The row then measures the squeezed width as
*"the commands as drawn"*, and the slack it computes is never negative.

## Decision 1 — the page area has a floor, and the panels narrow before it does

`PAGE_AREA_MIN_WIDTH` is **440 CSS px**. That is a US Letter page at 50%, 408 px, plus the 32 px gutter that `zoom.ts`
keeps around a fit. A narrower page area shows a page smaller than half size, or half a page. The splitter gives its
flexible pane that minimum, so when a window narrows or a person drags a handle, the side panels go towards their own
minimums before the page goes below its floor. A panel's stored width is not written when that happens; it is drawn
again when there is room.

The floating tool strip is unchanged: §10.3 makes it a pill over the canvas edge, repositionable and hideable. With the
floor it lies over a page's margin, as it does at 1280, rather than over a quarter of what the page area can show.

## Decision 2 — when the row cannot hold the floor, a side gives way and its setting is not written

When the row cannot hold the floor plus each open side at its minimum, a side **gives way**: the right panel first,
then the left. A side that gives way draws as its reopen handle, as a shut side does. **Its open setting is not
written**, so the person's choice is still what it was, and a window made wide again draws the panel again by
construction. This is Focus's rule (*"Focus supersedes per-panel collapse state"*) applied to width. The decision is
a pure function of the row's measured width and the constants, so drawing a handle cannot change it and nothing
flickers at the boundary.

## Decision 3 — a side that has given way, asked for, opens as a sheet over the page's edge

The person asks for a side by its handle, by *Window › Document panel* or *Properties panel*, or by a command that
shows the panel, such as *Properties* on a mark. When that side has given way, it opens as a **sheet** over that edge of
the page area, at its minimum width, with a shadow. Escape, the panel's own chevron, or asking again closes the sheet.
The sheet is presentation, kept nowhere, as Studio's ribbon overlay is. A second sheet replaces the first. The sheet
covers the page, but only when a person asks and only until they close it; that is the trade a narrow window has to
make somewhere, and here the person makes it.

## Decision 4 — one module writes the panels' open settings

`panelPresence.ts` is the one writer of `appearance.document-panel-open` and `appearance.context-panel-open`. It has
three verbs: `shown(side)`, `show(side)` and `hide(side)`. `show` opens the setting and, when that side has given
way, its sheet. `hide` closes the sheet when one is open and otherwise shuts the setting. Every control that opened or
shut a panel by writing a setting now calls these: the panels' chevrons and handles, the two *Window* toggles, *Window
› Properties panel*, and *Properties* on a mark.

The toggles' ticks read `shown`, so a menu never ticks a panel that is not on screen. Without this, each of those
controls would be dead in a narrow window, since setting a value that is already true changes nothing: a control that
renders but does nothing is the wired-tools rule's defect.

## Decision 5 — the menu row's words stay on one line, and its menus fold from the end

A menu-row button's label is one line. So the commands group's drawn width is its natural width, and ADR-0113's slack
is a real reading. **The row's states, in order:** labelled; then icons alone (ADR-0113); then **the last menus fold**
into a final *More* menu, one at a time from *Help* backwards. Each folded menu is a submenu there, drawn from the same
model. Whether a menu fits is decided from a **ruler**: a hidden copy of the menus' names, set in the triggers' own
class, so the measurement does not depend on what is folded and changes with the language. It is never a breakpoint,
for ADR-0113's reason.

Folding keeps every command reachable in one more step. The row keeps one line, so the system's window controls keep
the height the overlay reports.

## Rejected

- **Let a panel go below its minimum.** Each minimum is derived from what the panel holds, and the rendered cases
  assert it. Below it, the panel's tab strip or chevron is clipped, which is a broken screen rather than a narrow one.
- **Scroll the row sideways.** A document row that scrolls past its window is a page nobody can find the edge of.
- **Draw an open panel over the page whenever the row is narrow.** That is the owner's finding as it was observed.
- **Write the open setting off when the window narrows.** That makes the window a second writer of the person's choice
  (B3), and widening it again would not bring the panel back.
- **The side last asked for wins its place in the row.** At 760 even one panel and the floor do not fit (about 672 px
  of document row, 256 + 440 wanted), so the rule would have to break its own floor whenever it is used.
- **Menus wrap onto a second line**, Win32's own behaviour. A second row moves the height the Window Controls Overlay
  is told, and gives up a row of the page for chrome.
- **A breakpoint in CSS.** The widths that decide are the menus' and the panels', which a language and the person's
  stored widths change. A number chosen in English at default widths is wrong somewhere by construction.

## Correction, 2026-10-03 — the ruler's names have a class of their own

Decision 5 said the ruler's names are *"set in the triggers' own class"*. Built that way, every selector for a trigger
also matched the ruler: ADR-0113's rendered case took `.m-menu-bar__trigger` last as the last menu, read the ruler's
*More* at the row's start instead, and failed. The menu bar's own F10 lookup takes the first match, which was still
right only because the ruler comes later in the document. The names now carry `m-menu-bar__name`, and the triggers'
one rule lists both classes. So the box the room is read from is still a trigger's box exactly, and a trigger's
selector matches only triggers.

## Correction, 2026-10-03 — the floor is 416, anchored to the minimum window, and the right panel's minimum is 264

**Decision 1's 440 was chosen on the page's merit and against nothing else, and building the sheet showed that the
right panel's minimum was wrong.** The sheet opened at `CONTEXT_PANEL_MIN_WIDTH`, 216, and its header was scrolled
42 px sideways. Measured in Chromium 151 at 1024 × 720, the header's content is 256 px. The panel at 216 gives it 214,
and the panel the row drew at 1024 gave it 238, so the collapse chevron was clipped at the application's own minimum
window. That defect predates this ADR. 216 was derived from the Properties controls before v5 gave the tabs a glyph,
and no case looked at the header. The minimum is now 264, read from the header (`layout.ts` carries the arithmetic).
The header's own rule holds a longer language: the chevron never shrinks, and a tab's label gives way first. A width
stored under the old floor reads as 264 rather than as the fallback.

With 264, the floor of 440 would make the right panel give way at 1024 × 720. That window is `MINIMUM_WINDOW`, *"the
floor the chrome fits in"*, so its whole chrome must draw there. **So the floor is derived from that window instead.**
Its document row is 936 px, measured at 1024 × 720; less 256 and 264, that leaves 416, a Letter page at about 47%. Only
a window smaller than the minimum, on a display whose work area is under 1024 wide, makes a side give way. The floor
and the handle's width moved to `@monstera/shared` beside `MINIMUM_WINDOW`, because the rendered case reads them. That
case asserts that nothing gives way at 1024 × 720, that the right side gives way at 960 and both at 760, that each
handle is the width the rule counts, and that neither open setting is written.

The rejected alternative *"the side last asked for wins"* is unaffected. At 760 the row is about 672 px, and one side
in it needs 697: 256 for the side, 416 for the floor, and 25 for the other side's handle.
