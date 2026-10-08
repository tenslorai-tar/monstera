# ADR-0198 — Backups live in Monstera's own data folder, keyed by the file's canonical path, and nothing is written beside the person's file

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** `docs/ARCHITECTURE.md` §4, *Save is one pipeline*, where it says the save writes the `.bak` of the file it
  replaces **beside** it (`siblingNames`: `<target>.bak`, `.bak2`, …), and [ADR-0139](0139-a-removals-save-deletes-the-backups-monstera-made.md)
  and [ADR-0164](0164-a-removals-save-also-renews-the-hosts-copy-and-the-recent-picture.md) only in WHERE the copies they name
  are, not in what they decide. The temp file's name stays a sibling: an atomic rename needs the destination's volume.
- **Decided by:** the owner's order of 2026-10-08 (the overnight run, Step 4): *every save leaves report.pdf.bak beside the
  person's file, visible in their folder; handle backups the way other editors do — nothing written beside the person's file.*
- **Relates:** [ADR-0008](0008-save-mode-is-determined-by-purpose.md), [ADR-0139](0139-a-removals-save-deletes-the-backups-monstera-made.md)'s
  provenance ledger, and the `saving.backup-copies` setting, whose count this leaves as it was.

## Context

A save copies the file it is about to replace aside, replaces it, and rotates the copies: `report.pdf.bak`, `.bak2`, … up to
ten, in the person's own folder. They see them in the file manager, they sync them, they attach them by mistake, and a
folder of PDFs becomes twice as long. Other editors keep their recoverable versions in their own storage and offer them from
inside the application. The mechanism that places them is one function, `siblingNames(target, copies)`, which the save's
`SaveFileNames` dependency returns; everything downstream — the copy-aside, the rotation, a removal's deletion of what
Monstera made (ADR-0139), the ledger that proves it — works from the NAMES it is handed, never from a beside-the-file
assumption. So where the copies live is one decision, and the rest follows it.

## The question under the question

The order named the folders *"per-file folders keyed by the file's identity, not just its name"*. **A file's identity cannot be
the key** (measured by reading the save, 2026-10-08): the save writes a temp file and renames it over the target, so the
file at the path after a save is a NEW file with a new index, on every save. A key made of the identity changes each time the
person saves, which orphans every earlier backup at the moment it is made. What survives a save is the PATH, and what the
person means by *this file* is the path they open it by. So:

## Decisions

1. **The key is a hash of the file's canonical path** — resolved, normalised, and lower-cased on Windows, whose file system
   is case-insensitive — in a folder per file under `<userData>/backups/`. The name is a digest, never the path, so a folder
   listing says nothing about a person's documents. A small `source.json` in the folder carries the path and the file's
   identity (device and index, read after the save) **as a hint only**: a file moved or renamed outside Monstera has no folder
   at its new path, and the hint finds the one whose recorded identity is this file's. Nothing is ever keyed or decided by the
   hint alone, and a file the hint finds is offered, not assumed.
2. **The copy-aside lives in the same folder as the backups.** The save copies the file it replaces to `previous` and, once the
   save has landed, renames it into the newest backup name. A rename across volumes is a copy, so a copy-aside beside the file
   with the backups in the data folder would break the one ordering the atomic write exists for. Both in the data folder, the
   rotation is a rename within one volume, and a save that fails leaves the copy-aside there, not in the person's folder. The
   **temp** stays a sibling and is removed by the save however it ends.
3. **The count setting is unchanged** (`saving.backup-copies`, none to ten). A removal's save keeps no backup of the unredacted
   file, deletes what Monstera made of this file, and ADR-0139's ledger-provenance rule is unchanged: the names it deletes are
   the data-folder names, which it was always handed.
4. **The renderer never holds a path** (invariant 3). Two channels: `document.listBackups` answers each backup as an opaque
   `id`, its saved time and its size, and `document.restoreBackup` takes the `id`. Main picks the destination, writes a COPY of
   that backup's bytes there and opens it, `document.workOnCopy`'s route; the backup itself is never opened, so saving
   cannot overwrite it. File › *Restore a previous version…* lists them with their date and time.
5. **Existing `.bak` files beside a file are never deleted or moved unasked.** A file Monstera did not make is the person's
   (ADR-0139). Once per folder, when a document in it opens, main counts the `.bak` files there that the provenance ledger
   proves Monstera made; if any, the person is asked whether to move them into the new place. *Move* copies each into the file's
   folder and removes the original only after the copy reads back the same size; *Leave them* answers once and is remembered,
   per folder. A backup the ledger cannot prove is left where it is and the offer says how many.
6. **Clear and uninstall.** *Settings › Privacy › Clear backups* deletes the folder tree Monstera made. A packaged install keeps
   it under the package's own data, which uninstalling removes; nothing is left in a person's folders either way.

## Rejected alternatives

- **Key by file identity.** Changes at every save (above).
- **Key by file name.** Two `report.pdf` in two folders would share backups, and restoring one over the other is the failure
  a backup exists to prevent.
- **Keep the copy-aside beside the file and move only the backups.** Breaks the atomic ordering across volumes.
- **Delete the old `.bak` files on first launch.** Deletes files a person may have kept deliberately; ADR-0139's rule is that a
  file is Monstera's only where it can prove it, and even then the person is asked here.

## Proof

`backupFolder.test.ts` runs the real atomic write with these names: after a save the target's folder holds the file and
nothing else (no `.bak`, no copy-aside), the backup is in the data folder, and a restore reads back the OLDER bytes — with the
control that the same save under `siblingNames` leaves a `.bak` beside the file, so the case fails if the move is undone.
