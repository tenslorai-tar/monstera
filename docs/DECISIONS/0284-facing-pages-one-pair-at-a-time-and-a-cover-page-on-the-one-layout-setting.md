# ADR-0284 — Facing pages one pair at a time, and a cover page, on the one layout setting

- **Status:** Accepted 2026-11-02 by the owner (below). Proposed 2026-11-02, built on this design in the same branch: it
  registers into existing seams (the settings registry, the command registry's checked commands, the page list's
  layout) and changes no architecture.
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

## Accepted by the owner, 2026-11-02

The owner accepted this design as built at `73c3d91b` (work/cloud-43-page-layouts), with its placement: the choices in
Tools › Display and the View menu were right, since the ribbon has no View tab. Decision 10's right-to-left pairing is
the next item, built on its own (work/cloud-45-rtl-pairs), and nothing above changes until it lands.

## Correction, 2026-11-02 — Decision 10 is built

A right-to-left document now pairs right to left. Decision 10's *not built here* is superseded:

- **The kernel reads it, once per view-model answer.** `readPageGeometry` reads the catalog's `/ViewerPreferences
  /Direction` in the pass that reads the page count, and answers `R2L` for the name `R2L` and `L2R` for anything else,
  missing, malformed or unknown: ISO 32000's default for the key, and the reading every document had before. It
  crosses the engine host's `engine/page-geometry` and `document.viewModel` as one scalar beside `pageCount`. The
  renderer never reads it from the bytes.
- **`pageSpreads.ts` decides the sides**, in `spreadPlace`: the earlier page of a pair stands where reading starts, the
  left for `L2R` and the right for `R2L`; a cover page stands alone where the later page of a pair would, the right for
  `L2R` and the left for `R2L`. The pairs themselves, and so next, previous, the wheel and a request for a page, do not
  read the direction: reading order is page order in both.
- **Each slot names its grid cell** from `spreadPlace` (row and column), and the stylesheet's cover rule that put page 1
  in the second column is gone. It was a second statement of the pairing beside `pageSpreads.ts`, and the grid's flow
  places items left to right, so a right-to-left pair needs its cells named either way. Not `direction: rtl` on the
  grid, which would also turn the scroller's horizontal origin and every page's own text direction.
- Measured on Linux, Chromium 151: opening the six-page fixture in Continuous facing took a median of 499.8 ms against
  501.5 ms before, 16 rounds each in turn; the timer separates a 100 ms hold. The catalog lookup itself is 0.02 to
  0.03 ms an answer.

## Correction, 2026-11-05 — the five commands moved to Home › Display

The owner moved them on 2026-11-05, so the Tools section has fewer items. Decision 5's *They sit in Tools › Display*
and the acceptance's *the choices in Tools › Display … were right* are superseded: the four layouts and *Show cover
page* sit in **Home › Display**, after Compare, as small tools drawn in two columns (three and two, ADR-0194). The View
menu's entries stay. Because a section's menu in the menu bar is its ribbon section (ADR-0107), they also leave the
menu bar's Tools menu; Home has no menu there, so the View menu is where the menu bar reaches them.
`pageLayoutCommands.test.ts` holds the placement.
