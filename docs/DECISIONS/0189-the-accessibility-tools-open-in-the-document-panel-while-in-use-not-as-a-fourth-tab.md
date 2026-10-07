# ADR-0189 — The accessibility tools open in the document panel while they are in use, not as a fourth tab

- **Status:** Accepted
- **Date:** 2026-10-07
- **Supersedes:** [ADR-0183](0183-accessibility-results-live-in-a-panel-so-they-can-be-shown-on-the-page.md) Decision 2
  only — *where* the two tools are shown. Its other four decisions (plain names, the highlight on the page, a sentence per
  check, the help articles) stand.
- **Found by:** the owner's review of 0.1.12.0, 2026-10-07 — *Accessibility is rarely used, and with four tabs the
  Assistant, the panel's main tool, shrinks to an icon.*

## Context

ADR-0183 made *Accessibility check* and *Reading order* a fourth tab of the right panel so the page stayed in view and a
result could be marked on it. That worked, and it cost the panel's width: four tabs do not fit at the default width, so
the strip had to drop to icons for every tab but the chosen one, and the Assistant — the tool the panel is for — became
an icon on a page where it had been a word. A permanent tab is the wrong price for a tool a person opens once per file.

What the tab bought was real and is kept: the tool does not cover the page, so a click on a result can mark it there.

## Decisions

1. **The right panel is Properties, Assistant and Spelling again.** The `accessibility` member leaves
   `layout.context-panel-tab`; a stored value of it is refused by the setting's schema and the setting falls back, as for
   any value the registry no longer has.
2. **The tools open in the LEFT document panel, for as long as they are in use.** *Accessibility check* and *Reading
   order* (Review, unchanged) open the same panel the ADR-0183 tab held, in the place the Pages, Bookmarks and Search
   panels are. It is not a seventh tab: it has no setting and no tab of its own, so it is never there when nobody opened
   it and is not remembered across launches. While it is open it takes the panel's body, under a header naming it with a
   close button; choosing any of the panel's own tabs, or the close button, closes it and the panel is as it was.
3. **Closing the tool takes its mark off the page.** The mark is drawn only while the tool is open, which is the rule the
   tab had (*the page carries no mark for a surface nobody can see*), now stated on the one flag that decides it. What the
   tool read is kept for the document, so opening it again shows it.
4. **State is unchanged in shape:** per document, in the store, with `accessibility/run.ts` the one writer; the view gains
   `open`. The panel component is the same one, so the click-to-highlight, the sentences and the plain names are not
   touched.

## Rejected alternatives

- **A modal or a dialog.** It covers the page, which is the thing the highlight needs.
- **A floating, movable panel over the page.** It covers a part of the page the reader may be marking, and a floating
  surface is a second place that decides what is on screen.
- **A seventh permanent tab in the left strip.** The strip is six icons by §10.3; a seventh for a rarely used tool is the
  same cost moved one panel over.
- **Putting the tool's choice in a setting.** A setting persists, and a tool that reopens at launch with nothing to show
  is an unfinished screen.

## Consequences

- `ContextPanel` loses a prop and a tab; `DocumentPanel` gains one optional body, with its header, and closes it when a
  tab is chosen. The right panel's tab-strip container queries return to what three tabs need.
- The screens that change: the right panel's tab strip in every section (three tabs), and the Review tools' screen (the
  left panel shows the tool).
- ADR-0183 is corrected by appending, and its index row says so.
