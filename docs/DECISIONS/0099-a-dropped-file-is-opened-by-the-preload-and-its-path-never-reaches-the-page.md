# ADR-0099 — A dropped file is opened by the preload, and its path never reaches the page

- **Status:** Accepted
- **Date:** 2026-09-24
- **Amends:** `docs/ARCHITECTURE.md` §10.3's start-screen clause (*"Drag-drop a PDF anywhere to open"*),
  which states the behaviour and had no mechanism; §5's bridge, which gains a second function.
- **Relates:** invariant 1 (*"preload uses only `contextBridge`, `ipcRenderer` and `webUtils`"*),
  invariant 2 and L2 (the renderer holds a `FileHandle`, never a path),
  [ADR-0020](0020-the-preload-is-bundled.md) (the preload is bundled).
- **Context:** Stage 10, the owner's design. v5-01 and v5-13 say *"or drop a PDF anywhere in this
  window"* under Open PDF, and the owner's order makes it a condition: *"drag-and-drop open is built
  (B4 first: the renderer may not hold a path)."*

## The gap

A drop is an event the PAGE receives. Its `DataTransfer` carries `File` objects, and a `File` in a
sandboxed, context-isolated renderer has no path, by Chromium's own design. Main receives no drop event
at all. So a drop can reach main only through the renderer, and §5 gives the renderer exactly one way
to ask main for anything: the bridge's `invoke`, whose every channel is a contract entry the page can
name. A contract channel taking a path is a path in a renderer-facing type, which L2 makes a compile
error, and rightly so: the page could then ask main to open any path it could spell.

## Decision

**The bridge gains `openDropped(file: File)`, and the path lives only inside the preload.**

- The page passes the `File` from the drop. `contextBridge` carries a `File` across the isolated-world
  boundary as the same object.
- The preload resolves it with `webUtils.getPathForFile` — the third of invariant 1's three names, which
  the founding record listed for exactly this — and sends the path to main on
  **`document.openDropped`**.
- **The path never returns to the page.** The page receives what `document.open` answers: a `DocId`, a
  version, a name and a byte length, or a refusal.
- **`document.openDropped` is a preload channel, not a renderer one.** It is declared in the contract and
  validated by `wrapHandler` like every channel, but the page's `ContractClient` is typed over renderer
  channels only, so page code cannot name it. The preload's own surface proof counts `openDropped` as the
  bridge's one new function.
- **A page cannot forge a dropped path.** `getPathForFile` answers an empty string for a `File` built in
  script (`new File([…], 'x.pdf')`), and main refuses an empty or relative path by name. A path therefore
  exists only for a file that came from the operating system: a drop, or a file input a person chose
  from. Both are a person's choice of that file, the same authority the picker's answer carries.
- **Main opens it as it opens a picked file**, through the one open path, with the same refusals: missing,
  not a PDF, too large, unreadable.
- **Several files dropped at once** open as several tabs, in the order the `DataTransfer` lists them.
- **A dropped non-PDF** is refused with the same sentence a picked one gets, and nothing else happens.

## Rejected alternatives

**Hand the page the path and let it call `document.open` with it.** L2's violation exactly, and the one
the owner named.

**Intercept the navigation Chromium performs when a file is dropped on a page that does not handle
drops** (`will-navigate` to a `file:` URL). It keeps the path in main, but it is a side effect of NOT
handling the drop, so the page could not show the drop target the design draws. It also depends on
Chromium's navigation-on-drop behaviour, which Electron's security guidance recommends refusing, and the
navigation guard (§9) already refuses every navigation off the document.

**A per-drop token that main issues and the preload redeems.** Main cannot observe the drop, so it would
have nothing to issue a token against. The token would prove only that the preload asked, which the
channel already proves.

**`webUtils.getPathForFile` exposed to the page as a bridge function.** The page would then hold a path,
which is the whole thing this ADR keeps out.

## Consequences

- `scripts/security/preloadSurface.mjs` derives the preload's surface from its syntax. Its expected set
  gains `webUtils` and one bridge member, and that change is the visible trace of this decision.
- `proof:rendererpolicy` reads back from the running renderer that `openDropped` exists and that
  `getPathForFile` does not.
- The page's drop target is a presentation concern: a dashed frame on the start screen and a window-wide
  overlay while a drag is over it. It is drawn from tokens, and cancelled by Escape or by leaving the
  window.
