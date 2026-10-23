# ADR-0265 — Accessibility is a panel of the left strip, with its own tab

- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** [ADR-0189](0189-the-accessibility-tools-open-in-the-document-panel-while-in-use-not-as-a-fourth-tab.md)
  Decision 2 (the tools take over the panel's body while in use, with no tab and no setting) and its rejected
  alternative *"A seventh permanent tab in the left strip"*. Its Decisions 1, 3 and 4 stand, Decision 3 restated below.
- **Amends:** `docs/ARCHITECTURE.md` §10.3's document panel: *"Pages, Bookmarks, Comments, Forms, Layers, Search …
  six icon tabs"* becomes seven, Accessibility last.
- **Decided by:** the owner's T3, 2026-10-23: *"Accessibility gets its OWN tab in the left pane … no other tab is ever
  displaced"*.

## Context

ADR-0189 put *Accessibility check* and *Reading order* in the left document panel by taking over its body: the tab on
show (often Pages, the thumbnails) was replaced by the tool until the tool was closed. To the owner that reads as the
thumbnails being taken away, and the way back is a close button nobody looks for.

ADR-0189 rejected a seventh tab for two reasons. **The strip is six by §10.3**: that is a rule this ADR amends, not a
measurement — the strip is icons, and the narrowest panel still holds seven (the case below). **A remembered tab with
nothing to show at launch is an unfinished screen**: the Check view with nothing read is not empty — it explains the check
and offers *Run the check* (`AccessibilityPanel`'s start), and Reading order reads the page on show as soon as it is
chosen. So both reasons are answered rather than overruled.

## Decisions

1. **`accessibility` is the seventh member of the panel roster** (`PANEL_IDS`, `PANELS`), last, with the Accessibility
   check command's own glyph (`ShieldCheck`), and of the panel setting's schema. Its body is the Accessibility panel as it
   is — the two views, Check and Reading order, unchanged.
2. **The ribbon's *Accessibility check* and *Reading order* choose that tab**, at their view, through the panel setting —
   the one writer of which panel shows (§10.3) — and show the panel. No other tab is displaced: choosing any tab shows
   that tab's panel as it was, and the Accessibility tab stays in the strip.
3. **ADR-0189 Decision 3 restated for a tab**: the place a view marked is drawn on the page only while the Accessibility
   tab is the panel on show — the rule *"the page carries no mark for a surface nobody can see"*, now decided by the
   panel setting rather than by a tool's open flag.
4. **The take-over goes**: `DocumentPanel` has no tool body. It had no other user.

## Rejected

- **Keeping the take-over and adding a tab beside it.** Two ways to show one panel, and the take-over is what displaced
  the thumbnails.
- **A tab only while a check has run.** A strip whose members come and go moves every tab after it under the pointer.

## Proof

A rendered case per command: the Accessibility tab chosen, at the command's view, and the tab chosen before it intact
and selectable as it was. CONTROL: on the take-over build no tab is chosen for the tool. `panelOverflow.pw.ts`: the
strip's seven tabs fit at the panel's narrowest width.
