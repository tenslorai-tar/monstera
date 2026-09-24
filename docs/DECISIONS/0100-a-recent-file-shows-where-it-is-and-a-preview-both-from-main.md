# ADR-0100 — A recent file shows where it is and a preview, both made in main; the wordmark is Marcellus

- **Status:** Accepted
- **Date:** 2026-09-24
- **Amends:** `docs/ARCHITECTURE.md` §10.3's start-screen clause (*"Recent files appear below the grid
  when they exist"*), which gains what each entry shows; §10.4's *"No webfonts for UI chrome"*, which
  gains the one typeface that is not chrome.
- **Relates:** L2 (the renderer holds no path), invariant 24 (opening a document runs none of its
  content), [ADR-0068](0068-the-start-screen-projects-into-three-slots.md) (the start screen's slots).
- **Context:** Stage 10, the owner's design. v5-01 and v5-13 draw each recent file as a card: a picture of
  its first page, its name, and a line such as *"Today · Documents › Leases"* or *"Sep 18 · OneDrive ›
  Legal"*. The order says: *"recent-file locations come from main as display-only text."*

## The gap

`document.recent` answers a `FileHandle` and a name per entry. A location is part of a path, and the
renderer may not hold a path. A picture of the first page means reading the file, and the start screen is
drawn before any document is open, so there is nothing parsed to draw from. Neither can be registered into
an existing seam: the first changes what a renderer-facing type may carry, and the second adds a new
kind of stored data about a person's files.

## Decision

**1 — A location is DISPLAY TEXT made in main, and it is branded so it cannot be anything else.**

- Main derives it from the path it already holds, at most two folders: the known folder the file is under,
  if any (*Documents*, *Downloads*, *Desktop*, *OneDrive*, the cloud working copy's provider), then the
  folder the file is in, joined by *"›"*. It is never a drive letter or a full path. A file directly in
  a known folder shows that folder alone.
- The contract types it `DisplayLocation`, a branded string that **no channel accepts as a parameter**.
  The renderer can show it and cannot send it anywhere, so it cannot be used as a path even when it happens
  to read like one.
- **The date beside it is when the file was last opened here**, which main records already, shown as
  *Today*, *Yesterday* or a short date. It is not the file's modification time.

**2 — A preview is a small picture main keeps from when the document was open, not a fresh read.**

- When a document is opened, main asks the engine host that already holds it for a picture of page 1
  through the render channel it already has, at card size (a bounded raster, a few tens of KB). Main
  stores it beside the recent list under the application's data folder, keyed by the recent entry.
- The start screen asks for it by the entry's handle on **`document.recentPreview`**, and gets bytes or
  *none*. It never causes a file to be parsed. A file that was never open in this build, or whose preview
  failed, shows a page-shaped placeholder with its type.
- **A preview is dropped with its entry.** Removing a file from the list, *Clear list*, and the list's own
  cap each delete the picture in the same step. A preview never outlives its entry.
- **It is a Privacy setting, on by default**: *Show previews of recent files*. Off, no preview is made and
  the existing ones are deleted. It is a picture of a person's document kept on disk, and the switch is
  where a person looks for that.

**3 — The wordmark is set in Marcellus, and that is not UI chrome.**

The start screen's *"Monstera"* is the product's name set as artwork, like the logo above it: it is drawn
once, at display size, and never carries interface text. It uses **Marcellus** by Astigmatic, the free SIL
Open Font License 1.1 release (Google Fonts), **bundled** in the renderer's assets because §9.27's policy
allows no remote font. Its licence text goes in `NOTICE`. **Never *Marcellus Pro***, which is a commercial
family with a different licence. Every other piece of text keeps §10.4's system stack.

## Rejected alternatives

**Send the full path and trust the start screen to show only its tail.** A path in a renderer-facing type,
which L2 makes a compile error; the owner's own wording rules it out.

**Render the preview when the start screen asks.** It would parse a person's files just to draw a menu, at
every launch, including files that have since been changed, moved or replaced by something hostile.
Invariant 24's spirit is that opening Monstera does nothing to a document the person did not ask for.

**Use the operating system's thumbnail cache.** Windows' shell thumbnails come from whatever PDF preview
handler is installed, which is another product's parser running on the file. It would also make the card
depend on software Monstera does not ship.

**No preview, only an icon.** It departs from the owner's design, and there is no reason of the law's to
set against the design: the preview is made from bytes Monstera had already parsed on the person's request.

**A webfont loaded from Google Fonts at runtime.** §9.27's CSP allows no remote font, and loading one would
tell a third party every time Monstera starts.

## Consequences

- The recent list's store gains the preview files, and its tests gain the rule that every path that
  removes an entry also removes its picture. A case lists a removal path and asserts the picture is gone.
- `DisplayLocation` joins the branded types. A case asserts no channel's parameter schema accepts it.
- `NOTICE` gains Marcellus's OFL text, and `proof:licences` sees a new bundled asset.
