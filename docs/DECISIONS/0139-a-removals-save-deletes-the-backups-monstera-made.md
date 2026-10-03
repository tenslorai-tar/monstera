# ADR-0139 — A removal's save deletes the backups Monstera made, and the removal is the document's fact

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** `docs/ARCHITECTURE.md` §4, *Save is one pipeline*: which save writes no `.bak` is decided by the
  DOCUMENT, not by the engine session's mark, and the older copies a removal's save leaves are deleted by the save
  rather than named to the person and deleted on confirmation. Supersedes the confirmation step built on 2026-10-01
  (`5c19c062`, item 6 of the 29 September list): the `document.deleteStaleCopies` channel and the stale-copies dialog.
- **Decided by:** the owner's review of 0.1.9.0, item C.d: *"Redaction leaves a .bak beside the file. Reproduce it and
  say which mechanism happened. After saving a redaction, Sanitize or flatten, no Monstera-made backup holding removed
  content may remain: delete it permanently and say so in the confirmation. Never delete a file Monstera did not
  make."*
- **Relates:** [ADR-0008](0008-save-mode-is-determined-by-purpose.md) (the save's purpose chooses its mode),
  [ADR-0045](0045-a-removals-garbage-collection-belongs-to-the-command.md) (the session collects once a removal ran),
  [ADR-0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md) (a restore rebuilds the session),
  [ADR-0039](0039-a-byte-image-writer-round-trips-the-live-session.md) (a byte-image result is adopted by a rebuild).

## Context

Since 2026-10-01 a removal's save (a redaction, Sanitize, or flatten) writes no backup, and lists the older backups
beside the file and Monstera's undo copies for the person to delete. The owner still found a `.bak` beside a redacted
file in 0.1.9.0. Three routes produce one in that build, and the recording does not say which one ran:

1. **The save was not classified as a removal at all.** Main asks the MuPDF writer (`signaturesKeptBySave`), which
   answers from a mark on the session object (`removals`, a `WeakSet` keyed by the session). A checkpoint restore
   (undo of a later command), a byte-image or hosted command's `adopt`, and a host rebuild all build a new session
   from bytes, and the new session carries no mark. Measured 2026-10-02 for all three removal kinds
   (`removalCollects.test.ts`, with the native shim): the session rebuilt from the removal's own bytes holds none of
   the removed content and answers *ordinary*. So the next save backs up the file on disk, which still holds what was
   removed, and lists nothing.
2. **An earlier ordinary save left it, and nobody was asked.** Autosave is unattended, and the stale-copies dialog is
   "never asked of a timer". With autosave on, marking regions is an ordinary edit, so an autosave then writes the
   `.bak` of the original. After *Apply*, the next autosave is the removal's save, and it asks no one. A later Ctrl+S
   on a clean document writes nothing, so the question never comes.
3. **The person kept them.** The dialog's dismissal is *keep*, so Esc or × on it leaves every backup.

The first is a defect in where the fact lives. The second and third are what the owner's ruling removes: no question,
and no copy left.

## Decision

1. **The removal is the document's fact, held in main.** `DocumentContext` carries *a removal-purpose command was
   applied since the file was last written*. The command bus sets it when it applies a command declaring
   `purpose: 'removal'`, on execute and on redo. `markSaved` clears it. Undo does not clear it: an undone redaction
   still means the file on disk may hold what the person removed, and keeping no backup of that file is the safe
   direction. The save's `'keep' | 'none'` argument reads this fact. The engine's mark stays where ADR-0045 put it,
   for the one question that is the engine's (whether its serialise collects), and the writer stops answering the
   backup question (`NextSave` loses `removal`), so there is one authority for each question (B3a).
2. **A removal's save deletes, permanently, every older copy Monstera made of the file.** That means each backup
   beside the file that Monstera wrote, and every undo copy of the document with the history that needs them. It
   happens in the save's own lane entry, attended or not, with no question. Permanently means not the recycle bin,
   which would keep the content.
3. **"Monstera made it" is recorded when Monstera makes it.** Main keeps a ledger of the backups its saves wrote, by
   file identity: device, file index, size, and modification time in nanoseconds, read with `stat` after the copy.
   A backup is a fresh file made by `copy`, and the later rotations are renames, which keep all four. At deletion a
   file named like a backup is deleted only when its identity is in the ledger. A file with the same name that
   Monstera did not write, or that was changed since (another size or time), is kept. So is any file whose volume
   reports no file index. The ledger is bounded (oldest entries drop first), and a dropped entry can only cause a
   backup to be kept, never deleted.
4. **The confirmation says what went.** The save's answer carries what was deleted (backups and undo copies, by count)
   and the names of files that look like backups but were kept because Monstera did not make them. The Save toast
   says so in words, including those names, so the person can delete them.

## Rejected alternatives

- **Carry the session mark across every rebuild.** The supervisor would copy the mark onto each new session. Every
  rebuild path (restore, adopt, host restart, a fourth one tomorrow) would have to remember to, and the first one that
  forgets reproduces this defect silently. It also answers a document question from an engine object.
- **Keep the confirmation and fix only the classification.** This leaves routes 2 and 3, which the owner ruled out.
- **Treat any file with a backup's name as Monstera's.** A person, a sync client or another editor can make
  `report.pdf.bak`. The owner's rule is *never delete a file Monstera did not make*, and a name is not provenance.
- **Mark the backup itself** (an NTFS alternate data stream, or a sidecar file). A stream is Windows-only and cannot be
  tested on the CI's Linux leg. A sidecar is a second file beside the person's document that has to be kept in step
  with the first, which is the problem a ledger in main avoids.
- **Compare contents to decide provenance.** Nothing about a backup's bytes says who wrote it.

## Consequences

- After a removal's save, undo cannot reach back past that save. The undo copies held the removed content.
- Backups written by builds before this one are not in the ledger, so they are kept and named in the confirmation.
- Autosave saves quietly, so an autosaved removal deletes the copies without a toast. Whether autosave should wait for
  a person before a removal's save is the owner's question, carried in the report of this range.
- The stale-copies dialog, its strings and `document.deleteStaleCopies` are removed. No caller is left.

## Addition, 2026-10-03: a protection change is a removal

The code review of c89e7266 (CR-DOC-05) found that *Protect document* declared an ordinary purpose, so the save after
it backed the file up as it was: a copy without the password, beside the document just protected. The owner's
decision of 2026-10-03: protection changes take this ADR's removal save. The law already said so: invariant 19 and
§4's save-mode table both name an encryption change and a password removal as removals, so the declaration was a
regression against them rather than a new rule. What `setDocumentProtection` removes is the
**readable form**, and its case in `removalCollects.test.ts` reads exactly that, whether the bytes open with no
password. Its apply marks the session as every removal's does (ADR-0045), so the axis keeps one meaning; the
collection that brings costs nothing, since a change of encryption rewrites every object anyway.

The other 51 commands were read for the same question, *does the copy beside the file hold what the person asked
nobody may read*. None does: deleting pages, objects, annotations or fields is ordinary editing, where the backup is
the safety net this ADR keeps.
