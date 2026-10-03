# ADR-0143 — File › Recent is the menu row's own value control; main keeps ten and says which are there

- **Status:** Accepted
- **Date:** 2026-10-03
- **Amends:** `docs/ARCHITECTURE.md` §7 — the `menu-bar` placement gains `submenu`; §10.3's menu-bar and start-screen
  clauses, which gain File › Recent and the start screen's four.
- **Supersedes:** the owner's cap of 2026-10-01 as `MAX_RECENT_ENTRIES` states it (*"Keep only the latest 4"*), and
  the recent list's rule of 2026-09-03 that an entry whose file has gone is **forgotten** (`docs/FEATURES.md`'s recent
  files row, `openRecentHandler`).
- **Relates:** [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md) (a surface's own value
  control), [ADR-0068](0068-the-start-screen-projects-into-three-slots.md) (the recent list is the start screen's own
  content), [ADR-0100](0100-a-recent-file-shows-where-it-is-and-a-preview-both-from-main.md) (what an entry carries),
  [ADR-0101](0101-a-ribbon-placement-may-name-a-menu.md) (a menu sits where its first member falls),
  [ADR-0107](0107-the-menu-bar-is-a-projection.md) (the menu bar).
- **Decided by:** the owner's list of 2026-10-02, item N3: *"File › Recent submenu. Main keeps up to 10 recent files;
  the start screen still shows 4; the submenu has "Clear list" and shows missing files as unavailable (never
  hidden)."*

## The gap

Every item the menu row draws is a `UiCommand` placed by a `menu-bar` placement (ADR-0107), and that placement has a
menu, a group, an order and a caption — nothing that says *this sits inside a submenu*. A recent file is not a command:
§7 names the recent list as the start screen's own content, and a command per file would rebuild the registry every
time the list changed. Drawing a Recent submenu by hand in `MenuBar.tsx` would put a *Clear list* item in the menu that
no placement names, which is the menu file ADR-0107 rejected, one item wide.

Two facts the item needs are not in the contract either. `document.recent` says nothing about whether an entry's file
is there, and only main can tell: the renderer holds no path (L2). And main keeps four, because on 2026-10-01 a
remembered file no surface showed was the display-only defect.

## Decision 1 — main keeps ten; the start screen shows the first four

`MAX_RECENT_ENTRIES` is **10**. The 2026-10-01 four was the right number for its reason: the start screen was the only
surface that showed the list, and a remembered file nothing shows is a control that does nothing. File › Recent shows
every entry main keeps, so the reason no longer bounds the list at four, and the owner's new number replaces it. A
stored list longer than ten is still cut as the store opens, and the cut entries' pictures leave with them.

The start screen shows **the first four of the same answer** — one list, two views. Four is the start screen's own
number, named once beside the cards (`START_SCREEN_RECENT`), because it is a fact about that view and not about what
main keeps.

## Decision 2 — each entry says whether its file is there, and main answers it by the open's own rule

`document.recent`'s entries gain **`available: boolean`**, computed in main each time the list is asked for, by
`readFileIdentity` — the kernel's rule `DocumentService.open` answers `absent` by. So the list and the open cannot
disagree about *absent* (B3a): an entry is available exactly when an open would find a file. A read that throws rather
than answering (a refused permission, a device error) is **unavailable** too, since an open would fail on it as well.
The entries are checked in parallel, off main's event loop. Availability is never stored: it is a fact about now.

## Decision 3 — never hidden: a file that has gone is no longer forgotten

`document.openRecent` forgot an entry whose open answered `absent`, so the same dead row was not offered on every
launch. It is withdrawn, with the store's `forget`, which nothing else called. A file on a drive that is not connected,
or a share that is down, is back when the drive is — forgetting it lost a file the person still has. An entry now
leaves the list only by *Clear list*, or by being pushed past ten. Both views draw an unavailable entry **disabled,
with its state in words**: it is listed, it says why it cannot be opened, and nothing about it is removed.

## Decision 4 — File › Recent is the menu row's own value control

As the status bar's page field is the bar's own (ADR-0067): its entries are data from main, drawn by the menu row. The
row asks main for the list when the File menu opens, so the submenu shows the list as it is at that moment, with each
entry's availability. An entry opens through **`openRecentDocument`**, the renderer's one route over
`document.openRecent` — the start screen's cards and the crash offer's restore take it too, so all three settle an open
the same way (a document already open is brought forward, a full shell says so).

## Decision 5 — a `menu-bar` placement may name a submenu

```ts
{ surface: 'menu-bar'; menu; group; order; caption?; submenu?: 'recent' }
```

- **Placements naming a submenu are drawn inside it**, after its values and a separator. The submenu sits in its
  members' menu and group, **where its first member's `order` falls** — ADR-0101's rule for a ribbon menu.
- **One place per submenu.** Every placement naming a submenu names the same menu and group; the registry refuses one
  that does not, naming both commands, since a submenu drawn in two places is two lists of one thing.
- **A closed union, not a `MessageKey`.** The menu row draws each submenu's values, so a submenu it cannot draw is a
  compile error in the row rather than an empty submenu.
- **A submenu's commands act on its values**, so the row draws them disabled while it holds none.

## Decision 6 — *Clear list* is a registered command

`document.clear-recent`, titled with the owner's words, placed in the Recent submenu. It asks main to empty the list
and, once main has, both views read it again. The start screen's *Clear list* button runs the same command's `run` —
one implementation with two triggers, as the tab strip's *+* runs `document.open`. *Settings › Privacy › Clear recent
files* keeps its own action over the same channel.

## Rejected alternatives

**A command per recent file.** The registry would be rebuilt whenever the list changed, and a command is not data:
`RecentFiles.tsx` already calls this *the second wiring place wearing the first one's clothes*.

**The submenu drawn by hand in `MenuBar.tsx`, *Clear list* its own button.** A menu item outside the registry: not in
the palette, not rebindable, invisible to every projection test — the menu file ADR-0107 rejected.

**A command kind carrying entries.** `UiCommand` would change for one caller, and a `run` that takes an entry is the
argument ADR-0067 refused a command for the page field.

**One copy of the list in the renderer, shared by both views.** A second holder of main's list that has to be kept
fresh by every route that changes it. Each view asks main when it shows, and main holds the one list.

**Keep forgetting an absent file.** The item says never hidden, and a file on a disconnected drive is not gone.

**`existsSync` in the handler.** It blocks main's event loop on a slow drive, and it is a second opinion about
*absent* beside the one the open uses.

## Consequences

- `document.recent`'s answer waits for the slowest check. A path on a network share that does not answer delays the
  list until Windows gives up on it. Not bounded here; carried to the owner as a question.
- Up to ten pictures are kept, a few tens of KB each (ADR-0100), and *Clear list* still deletes them all.
- `document.clearRecent`'s answer is bounded by the same ten.
- The Help article *Reopen a recent file* and the recent files row in `docs/FEATURES.md` say ten, four, File › Recent
  and unavailable.
