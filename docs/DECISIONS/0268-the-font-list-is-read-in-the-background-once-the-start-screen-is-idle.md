# ADR-0268 — The font list is read in the background once the start screen is idle

- **Status:** Accepted
- **Date:** 2026-10-24
- **Amends:** [ADR-0237](0237-the-font-list-is-kept-on-disk-so-an-edit-starts-no-compose-host.md) Decision 3 (*asked,
  `main` reads the folders' fingerprint and the file*) as to WHEN it is asked, and how the fingerprint is read. Decisions
  1, 2 and 4 (one file under `userData`, the folders' listing as its fingerprint, the session hold) are unchanged.
- **Decided by:** the owner's item 6, 2026-10-24: *"Start building it in the background as soon as the app has started
  (after the window is shown and the start screen is interactive), so it is ready before anyone reaches Edit text. It
  must never slow the start or the interface: off the renderer's main thread and off main's event loop, at low
  priority … If someone does reach Edit text before it finishes, the editor opens at once and the font list shows a short
  'Loading fonts…' until it arrives."*

## Context

On a computer's first start the list is built by the compose host reading every installed font: 5.6 to 13 s measured
(ADR-0237's correction of 2026-10-23). It is asked for the first time when a person opens a block in Edit text, so the
first person to try Edit text meets the wait. On every later start the kept file is read (about 85 ms) — but behind a
fingerprint read SYNCHRONOUSLY in `main`: a `readdirSync` and a `statSync` per file of the fonts folder, measured
65 to 128 ms on this machine's 671 entries (2026-10-24, five runs, with a lint running beside them), every one of which
holds `main`'s event loop and so every reply the renderer is waiting for.

## Decisions

1. **The renderer asks for the list once the start screen is idle**: the first idle moment (`requestIdleCallback`) after
   the application's window has mounted, through the same `fontListOf`, which holds one request per window. So the
   picker's later request is the same promise, finished or in flight, and nothing is built twice.
2. **The fingerprint is read asynchronously** (`fs/promises` `readdir` and `stat`), so neither the first-start build nor
   a later start's check holds `main`'s event loop. The build itself runs in the compose host, a process of its own, as
   before.
3. **A stale list is refreshed the same way**: the fingerprint's change is found by the same background request at
   start, so a font installed or removed is read in before Edit text is reached.
4. **Nothing waits on it**: the editor opens at once, and the picker shows its reading state until the list arrives, as
   it already did while a first request was in flight, now in the owner's words, *Loading fonts…* (it read *Reading the
   fonts on this computer…*).

## Rejected

- **`main` asking at `ready-to-show`**: `main` cannot see when the start screen answers a person; the renderer can.
- **Building the list in `main`**: a font file is hostile input (ADR-0172); the compose host exists for that.
- **Lowering the compose host's priority by default**: it also serves imports a person is waiting for. Measured first;
  this ADR's correction records whether the build at start costs the interface anything.
