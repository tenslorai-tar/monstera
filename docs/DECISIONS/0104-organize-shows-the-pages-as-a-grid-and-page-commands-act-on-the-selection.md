# ADR-0104 — Organize shows the pages as a grid, and page commands act on the pages selected there

- **Status:** Accepted
- **Date:** 2026-09-25
- **Amends:** `docs/ARCHITECTURE.md` §10.3 (the canvas), and the command context §7 hands every command.
- **Relates:** [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md) (a surface's own
  value controls), [ADR-0102](0102-a-selection-survives-a-command-that-keeps-the-walk.md) (the annotation
  selection, which this is not).
- **Context:** the owner's design, v5-09 (*Organize*): with the Organize section chosen, the canvas is not
  the reading view but every page as a card in a grid — a header *"24 pages · 2 selected · Drag to reorder ·
  Ctrl+click to multi-select · Delete removes"*, a Medium / Large size control, the selected cards ticked —
  while the rail, the ribbon's Organize tools, the document panel and the status bar are as on every other
  screen. §10.3 says the canvas is *"the star"* and names one thing in it; nothing in the law lets a section
  change what the canvas shows, and nothing gives a command more than one page to act on.

## Decision 1 — the canvas shows the grid while Organize is the active section

The canvas takes its view from the rail's active section: **Organize shows the page grid, every other section
the reading view.** One rule, read from the one value §10.3 already persists, so the grid has no switch of its
own to disagree with the rail. It holds in every layout mode, because *"modes hide chrome, never capability"*
and the active section persists through Studio and Focus alike. Leaving Organize returns to the reading view at
the page the reader was on. **Opening a page from the grid** — a double-click, or Enter on a focused card — goes
to it in the reading view, which means choosing Home: the section is the one value, so going to read a page is
choosing a section that reads.

## Decision 2 — the grid is the thumbnail strip laid out as a grid, not a second one

The strip already draws pages lazily, reorders them by drag and by keyboard through `movePage`, and has a
size setting. A grid written beside it would be a second reorder, a second lazy draw and a second keyboard
model for the same pages (B3a). So the grid is `Thumbnails` with a grid layout and its own size (v5-09's
Medium and Large), and whatever the grid adds — the selection — is a prop the strip does not pass.

## Decision 3 — a page selection, per document, and one reading of which pages a command means

Selecting pages is new state, and it is the document's (§6: state is per document): `selectedPages` in the
document's store, cleared by any command that moves the version, since a page number means nothing across a
reorder or a delete. **Click** selects one page, **Ctrl+click** toggles one, **Shift+click** extends from the
last clicked. In the side strip Shift+click keeps its meaning — swap with the page being read — because the
strip passes no selection; the two gestures live on two surfaces and never on one.

The command context gains `selectedPages: readonly number[]`, zero-based and sorted, empty with none. **Which
pages a page command acts on is one function**, `targetPages(context)` — the selection when there is one, else
the page on show — and page commands call it rather than reading `page`. A command that read `page` while a
person had four pages ticked would rotate the one they were not looking at, and nothing on screen would say so.

## Decision 4 — Delete removes the selected pages, and is undone like any command

*"Delete removes"*: the Delete key in the grid dispatches `deletePages` with the selection — no dialog, because
the operation is in the undo log like every other, and a confirmation in front of an undoable action is the
dialog people learn to dismiss. The Delete key belongs to the grid only while it has focus; everywhere else it
keeps its present meaning.

## Rejected

- **A dialog for organizing.** A second surface for the pages already on screen, with its own reorder.
- **The grid as a document panel.** The panel is 224 px by default; v5-09's grid is the canvas's width.
- **A grid toggle of its own** (a status-bar button, a view setting). A second value for *what the canvas
  shows* beside the active section, which the two would then disagree about.
- **Commands reading `page` and a separate selection-aware set.** Two readings of *which pages*, which is the
  second-opinion shape B3a names.

## Consequences

- `CommandContext` gains a field every command receives; commands that act on pages move to `targetPages`.
- The document store gains `selectedPages` and clears it on a version move.
- §10.3's canvas bullet names the grid.
