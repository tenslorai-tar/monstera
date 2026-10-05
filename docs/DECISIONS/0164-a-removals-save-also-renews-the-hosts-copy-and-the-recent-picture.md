# ADR-0164 — A removal's save also renews the host's copy and the Recent picture, and a copy written meanwhile keeps no backup

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** `docs/ARCHITECTURE.md` §4, *Save is one pipeline*, as [ADR-0139](0139-a-removals-save-deletes-the-backups-monstera-made.md)
  left it: which copies a removal's save leaves no older version of, and which write keeps no backup.
- **Found by:** CR-DOC-11 (copies of removed content ADR-0139 does not reach: the host snapshot, the Recent preview,
  the temp file, the Save-a-copy `.bak`).

## Context

ADR-0139's deliverable is the owner's sentence: *after saving a redaction, Sanitize or flatten, no Monstera-made backup
holding removed content may remain.* It reached the backups beside the file and the undo copies. Read on 2026-10-04,
three other copies Monstera makes still hold what was removed after that save:

1. **The engine host's snapshot.** A session is opened from the canonical image written into a granted directory
   (ADR-0023 Decision 7), and that file is the document as it was opened. Commands change the session, never the
   file, so after a redaction's save the snapshot still holds the unredacted document until the document closes.
2. **The Recent picture.** `RecentPictures.capture` keeps a picture of page 1 when a document opens (ADR-0100), and
   nothing takes it again. After a redaction of page 1 the start screen shows the redacted content, as a picture, on
   every launch.
3. **A copy's backup.** *Save a copy* over an existing file writes the `.bak` a save would leave, by design
   (`writeDocumentCopy`'s comment). Written while a removal is pending, which is the usual way a redacted copy is
   made, it keeps whatever that file held, and an earlier attempt at the same copy is the likely thing it held.

The fourth the finding names is not one: a temp file a crash left beside the document is the name the next save
writes its own temp to, so a removal's save replaces it and renames it into the file. Read in `atomicWrite`, whose
temp is `names.temp` of the target on every path; the leftover can only outlive the next save of the same file by
that save failing before its temp write, which removes the temp too.

## Decision

1. **A removal's save rebuilds the document's engine sessions from the file it just wrote**, through the restore a
   checkpoint uses (`recycle`, which releases the old granted pair and opens a new one). The old snapshot goes with
   its directory. Inside the save's own lane entry, so no command lands between the write and the rebuild.
2. **A document opened with a password keeps its session**, because the rebuild would need the password this build
   does not keep (ADR-0055). Its snapshot is the encrypted file as it was opened, readable only with that password,
   and it goes when the document closes. The refusal is a named error, and only that error is passed over.
3. **A removal's save retakes the Recent picture**: the kept picture is deleted first and a new one made from the
   saved document, so a picture that cannot be made leaves the placeholder, never the old one.
4. **A copy written while the document carries a removal keeps no backup of the file it replaces.** The same
   document fact ADR-0139 Decision 1 reads, and the same `'keep' | 'none'` argument, now required by
   `writeDocumentCopy` too.

## What this costs, said plainly

A removal's save opens the document again in the engine host: one more parse of the saved file, on the save of a
redaction, a Sanitize or a flatten, and nowhere else. A copy over an existing file, made before the removal is saved,
no longer leaves a `.bak` of that file; the person chose to replace it, and the picker asked.

## Rejected

- **Deleting the snapshot and keeping the session.** The engine may read the file it was opened from, so the session
  would be left on a file that is gone.
- **Writing the redacted bytes into the old snapshot.** The host is granted read on that directory and nothing more,
  by design; main writing a different document under a session opened from the first is the staleness ADR-0047
  keeps unaskable.
- **Retaking the picture without deleting first.** A capture that fails, or a Privacy setting turned off meanwhile,
  would leave the old picture.
- **A second fact for copies, "a removal ran since the document opened".** It would drop the backup of every copy made
  after a removal was saved, to cover a destination this build cannot know holds an earlier version of the same
  document. That case stays as it is, and is said here so it is not read as covered: a copy made after the
  redaction is saved still leaves a `.bak` of the file it replaces.

## Correction, 2026-10-04 — the rebuild opens before it releases, and a protected document keeps its snapshot

Decisions 1 and 2 as first written were wrong, and the build found it before anything shipped. **Protecting a
document is a removal** (ADR-0139), so its save is one of these, and the file it writes is encrypted. Decision 1's
route, the checkpoint restore, is `recycle`, which releases the old session BEFORE it opens the new one: the open
then failed for want of the password, the document was left with no session, and the save threw past a file it had
written. `documentCommands.test.ts`' protection case went red on exactly that.

So the rebuild is `EngineSessions.renew`, the same open with the order reversed: the new sessions are opened first,
and the old pair is released by the new open's own registration, so an open that fails leaves the document as it
was. Decision 2 is replaced: **a saved file that opens only with a password keeps the old session**, the renewal
answering `locked` (`EngineDocumentLocked`, classified at the composition root, the one refusal it expects). That
covers a document a password opened, which is saved encrypted, without a second rule beside it.

**What it leaves, said plainly:** for a document the save PROTECTED, the snapshot the session was opened from is the
document without its password, the very thing the person asked nobody may read, and it stays until the document
closes. It sits in the host's granted directory, deleted at close and swept at the next start. Reaching it needs the
session rebuilt from the encrypted file with the password, which this build does not keep (ADR-0055), or from bytes
the person has not saved; both are the owner's to weigh, and the report puts it to them.

## Correction, 2026-10-05: a file that opens only with a password keeps no Recent picture

The owner ruled on CR-DOC-11 the same day: a protected document leaves no unprotected copy on disk, even until close.
The Recent picture is one, and it outlives the close: a JPEG of page 1, kept beside the list until the entry leaves it.
Decision 3 retook it after every removal's save, so a save that protected the document drew the page it had just
protected, from the session still holding it, and an open of a file protected since its picture was taken left that
picture in place, since a capture that cannot draw keeps the one it had.

So **a file that opens only with a password keeps no picture.** `EngineSessions.opensOnlyWithPassword` is the one
answer: locked now, unlocked by a password, or the file the last removal's save wrote opens only with one. `renew`
answers `locked` and records it in the same step, so the save and the later question cannot disagree; removing a
password makes it false again. `firstPagePicture` answers `none` for such a document before it asks for a session, and
the picture store deletes the kept picture on `none`, where a picture that failed to draw is still left as it was.

**What this does not reach, and is the owner's, is the rest of CR-DOC-11** (measured and mapped 2026-10-05): the host's
snapshot above; for a document over main's memory ceiling, the canonical image file `image-0.pdf`; and the protect
command's own undo checkpoint, which a removal's save does not delete, because the protection draws nothing, so the
canonical image never includes it and the log never sheds an entry past the image's base (ADR-0115). Each is the
document without its password until close, and each is closed only by the canonical image and the sessions becoming
the encrypted file, which every reader of it, the renderer included, would then need the password for.
