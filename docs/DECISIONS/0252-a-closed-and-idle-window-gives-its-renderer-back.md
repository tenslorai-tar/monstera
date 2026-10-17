# ADR-0252 — A closed and idle window gives its renderer back

- **Status:** Accepted
- **Date:** 2026-10-17
- **Amends:** `docs/ARCHITECTURE.md` §6 (what the renderer holds once every document is closed) and §5 (a new channel,
  `app.releaseMemory`).
- **Decided by:** the owner's addendum 2 of 2026-10-17, item 3: when the last document closes, send Chromium the
  memory-pressure signal; then reload the renderer, so memory returns to about the start figure, only when no document
  is open, no dialog or Settings is open, and there has been no input for a while (about 60 s, measured); the reload
  restores the start screen exactly as it was and never happens during work; proved by the memory walk, within about
  10% of the start, and §9.17's *closed* budget set from that reading.

## What was measured

`scripts/research/idleMemoryProbe.mjs`, this laptop, 2026-10-17, private memory of every process by role:

| moment | total | main | renderer | GPU |
|---|---|---|---|---|
| the start screen at rest | 357 MB | 150 | 105 | 73 |
| seven documents open and scrolled | 742 MB | 162 | 321 | 112 |
| every document closed, 30 s later | 518 MB | 143 | 233 | 117 |
| then Chromium's memory-pressure signal, 30 s later | 489 MB | 143 | 233 | 88 |
| then the renderer reloaded, 30 s later | **362 MB** | 134 | 113 | 89 |

So the pressure signal gives back what the GPU process held (29 MB) and nothing of the renderer's, and the reload takes
the renderer back to within 8 MB of where it started: the whole application to within 1.4% of the start screen.

## Decision

1. **The last close sends the signal.** When the last open document closes, `main` sends the window's renderer
   Chromium's memory-pressure notification at the critical level, through the DevTools protocol's
   `Memory.simulatePressureNotification` on `webContents.debugger`: Electron offers no other way to say memory is short.
   The debugger is attached for that one command and detached. Where it cannot attach — DevTools already open on the
   window — the shell log says so and nothing else changes.
2. **The renderer asks, and only when nothing is happening.** `app.releaseMemory` is asked by the renderer when every one
   of these has held for `IDLE_RELEASE_MS` (60 s): no document is open; no dialog is open, Settings included; no write or
   piece of main's work is in flight; and there has been no pointer, wheel or key input. Any of them breaking starts the
   minute again. The renderer is where all of these are known; a person typing in the start screen's search, a dialog on
   screen, or a recent file being opened is never interrupted.
3. **`main` decides, by what it holds.** It reloads the window only if no document is open in `main` — the writer of
   record for that fact — and a document has been opened since the window last loaded. So a window that has just been
   reloaded, or never held a document, answers `nothing-to-release` and the renderer does not ask again until a document
   has been opened and closed. There is no loop.
4. **The start screen comes back as it was.** What it holds that `main` does not — the start area's scroll offset — is
   kept in the window's `sessionStorage` across the reload and put back when the start screen is next drawn. The recent
   list, the crash report offer and the AI offer are `main`'s or settings', and come back from there.

**60 s** is the owner's starting figure. A shorter wait would reload while someone is reading the start screen; a
longer one leaves the memory held longer for nothing, since the reload costs nothing the person can see once they have
stopped using the window. It is checked against the memory walk, which must read the closed figure within 10% of the
start after the minute.

## Rejected

- **Reload at the last close.** That is during work: a person closing tabs is often about to open the next file.
- **Leave it to the pressure signal.** Measured above, it gives back 29 MB of 161.
- **A new window instead of a reload.** It would recreate the window's frame and position for the same memory, and show
  the person a window being replaced.
- **Leave it to Windows.** Measured above, 161 MB above the start stays held for as long as the window is open.

## Proofs

- `idleRelease.test.ts`: the rule — asks after the minute only with every condition holding; CONTROLS: one millisecond
  short, a document open, a dialog open, work in flight, and input inside the minute each stop it.
- `releaseMemory` in main: reloads with no document open and one opened since the last load; CONTROLS: answers
  `nothing-to-release` with a document open (and does not reload), and right after a reload.
- `memoryWalk.mjs` M5: every document closed, then idle past the minute: the total within 10% of M1's.

## Consequences

- A person who leaves Monstera on its start screen for a minute after closing their documents gets the start-up memory
  back without doing anything; the window reloads once, out of sight of anyone using it.
- `main` holds one more fact about the window: whether a document has been opened since it last loaded.
