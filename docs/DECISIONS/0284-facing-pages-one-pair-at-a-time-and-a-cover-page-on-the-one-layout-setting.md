# ADR-0284 — Facing pages one pair at a time, and a cover page, on the one layout setting

- **Status:** Proposed 2026-11-02, built on this design in the same branch: it registers into existing seams (the
  settings registry, the command registry's checked commands, the page list's layout) and changes no architecture.
- **Date:** 2026-11-02
- **Requested by:** a user, relayed by the owner (item 57): *facing, continuous and continuous facing views.*
- **Relates:** FEATURES row 282 (`viewing.page-layout`, built 2026-09-28), row 56 (continuous scroll), row 65 (Split
  view); the help article *Show pages one at a time or side by side* (`help/en/page-layout.md`).

## What exists

`viewing.page-layout` holds `continuous`, `single` and `facing`. Its `facing` is a scrolling two-column grid that pairs
pages 1–2, 3–4: what the user called *continuous facing*. It is reachable only from Settings. There is no layout that
shows one pair at a time, and no cover page.

## Decisions

1. **Four layouts, named for what a person sees.** *Single page*, *Continuous*, *Facing* (one pair at a time) and
   *Continuous facing* (the scrolling pairs). The option titles in Settings say the same four names.

2. **A stored value keeps meaning what it meant.** The stored `facing` stays the scrolling two-column grid and is
   titled *Continuous facing*; a person who chose it gets exactly what they chose, and nobody's setting is rewritten.
   One-pair-at-a-time is a new stored value, `pair`. The schema gains a member and loses none, so every stored value
   still parses.

3. **The cover page is its own setting**, `viewing.cover-page`, a boolean, **off by default**, applying to both facing
   layouts and to nothing else. With it, page 1 stands alone on the right and pages 2 and 3 face each other, as in a
   printed book. Without it, pages pair 1–2, 3–4. An odd page count leaves the last page alone on the left without a
   cover page; with one, an even page count does.

4. **One rule says which pages pair**, `pageSpreads.ts` (B3a): the page list's layout, the wheel that turns a spread and
   the next and previous commands all take it, so no two of them can pair pages differently.

5. **Where it is reached: the command registry, never wired by hand.** Five commands, each writing the one setting and
   showing it checked: the four layouts and *Show cover page*. They sit in **Tools › Display**, where the rulers and the
   grid already sit, and in the menu bar's **View** menu. The ribbon has no View tab (its sections are Home, Organize,
   Edit, Comment, Forms, Protect, Review and Tools), and no ribbon control that holds a value exists; a set of checked
   commands is the registry's existing form of one value chosen among several, as the status bar's zoom buttons beside
   its slider are. A change made there and one made in Settings are the same stored value, read live. No key is bound:
   the free chords near the page keys are taken by navigation.

6. **The layout is one setting for the install**, as today: a way of reading, not a property of a document or a tab.
   **Split view keeps one page in each half**, as it does today: each half is a narrow pane, and a pair in each would
   be four pages too small to read. Compare keeps its own layout for the same reason.

7. **Mixed sizes and turned pages inside a pair:** each page keeps its own size and its own turn, as in the grid
   today; a pair's two pages are aligned at their tops, with the list's gap as the spine. **Fit width and Fit page fit
   the pair**: two pages' width and the gap, as today's grid already does for Fit width.

8. **Navigation in both facing layouts moves by pair.** Next and previous go to the first page of the next or previous
   pair; the page field and the status bar still name a page, the pair's first. A search hit, a link, a bookmark or a
   thumbnail on a right-hand page goes to that page, which in Facing shows the pair holding it. A wheel past the end of
   the pair on show turns to the next pair, as Single page turns to the next page.

9. **Selection, the text layer, annotations, forms and Edit text work on both pages of a pair exactly as on one.** Each
   page keeps its own slot, its own text layer and its own overlays; a pair is only where two slots stand.

10. **Right-to-left documents** (`/ViewerPreferences /Direction /R2L`) should put the first page of each pair on the
    right. **Today's facing does not honour it**: no module in the renderer or the shell reads `/Direction` (searched
    2026-11-02; only the accessibility check reads `/ViewerPreferences`). Honouring it needs a read of the document's
    viewer preferences that does not exist yet, so it is **not built here**, and the pairs read left to right for every
    document until it is.

## Rejected

- **Renaming the stored `facing` to mean one pair at a time.** A person who chose it would get something else at the next
  launch, silently.
- **A new ribbon tab or a new value control kind for one choice.** A new surface for four options the registry can
  already express as checked commands.
- **The cover page as a fifth and sixth layout.** It applies to two layouts and to nothing else, so it is a choice beside
  them, not a copy of each.
