# ADR-0171 — The password is held in main while the document is open, so every copy stays protected

- **Status:** Accepted, with two questions put to the owner (Decisions 7 and 8)
- **Date:** 2026-10-05
- **Supersedes:** [ADR-0055](0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md) Decision 3's *"It does
  not survive the call. Main does not keep it"*, its rejected alternative *"Caching the password to make `recycle`
  work"*, and `docs/ARCHITECTURE.md` §3.2's *"What the password must never do is persist: main does not keep it ...
  and `recycle` therefore refuses"*. ADR-0055's other decisions stand: unlocking is an open, `needsPassword` is
  barred, the password crosses into the engine host, and the renderer is told a document is locked and nothing else.
- **Found by:** CR-DOC-11 (a protected document's working copies on disk) and P0's *password documents reach PDFium*.

## Context

The owner's answer of 2026-10-05, to the question CR-DOC-11 left open: *"keep the password in memory while the
document is open, so every copy stays protected. Never write it to disk, a log, the undo log or any file. Wipe it on
close. It must never cross to the renderer. This supersedes ADR-0055's refusal, so write the new ADR first."*

What was measured before this was written, each on a generated AES-256 document (user and owner passwords), never a
person's file:

| reading | engine, date | result |
|---|---|---|
| a document opened with either password, then `serialise` (`garbage`) | MuPDF 1.28 native, 2026-10-05 | reopens only with a password, before an edit and after one |
| the same session saved `garbage,encrypt=none` | same | reopens without a password |
| a session that has once been saved decrypting, then `serialise` | same | **reopens without a password**: a decrypting save changes the live session's own encryption, so every later save is plaintext |
| PDFium with no password, then with either | PDFium 155.0.8044.0 Linux, 2026-10-05 | `FPDF_GetLastError` 4 with none; either opens |
| PDFium `FPDF_SaveAsCopy` flags 0, then `FPDF_REMOVE_SECURITY` | same | stays encrypted; plaintext |
| the renderer, after unlocking, then one command that moves the version | Chromium 151, the shim serving the encrypted bytes at every version | **the password dialog is shown again** |

And what the code holds today, read 2026-10-05 (the 16-place map of CR-DOC-11):

- **A document opened with a password** (here *opened locked*). Every copy main writes is the document's own
  encrypted form: the snapshot is the raw file, the canonical image is the raw file or a MuPDF serialise, a checkpoint
  is a serialise. But PDFium opens with no password (`pdfiumFfi.ts`, `loadDocument(bytes, length, null)`), so **every
  PDFium edit of a document with a user password fails**; `recycle` refuses; a removal's save renewal answers *locked*
  and keeps the old session. The renderer is asked for the password again at every version, because each version's
  bytes are encrypted and PDF.js needs it to draw them, and nothing in main holds it to spare the person that.
- **A document protected in this session** (here *protected here*). The snapshot, a large document's `image-0.pdf`
  and the protect's own undo checkpoint are the document without its password until close; the Recent picture was
  closed by 9b210b06.
- **The protect command's passwords are in the undo log.** `setDocumentProtection` declares `replay:
  'reapply-intent'` and is terminal, and a terminal entry keeps its command whole (`commandBus.ts`), so both passwords
  live as long as the entry. ADR-0162 closed this for signing and nothing else.

## Decision 1 — one holder of a document's password, in main, for the life of the open document

`DocumentPasswords` (`apps/desktop/`) holds, per `DocId`, **the password that opens the document as it stands**: the
one `document.unlock` accepted, or the user password a protect set; a protect that removes protection clears it. It
is set inside the document's lane after the engine accepted it, and nowhere else (B3). The engine hosts are handed it
when they open a session (Decision 4); nothing else reads it.

## Decision 2 — it cannot be written, by shape

The value is a `HeldPassword`: a class whose only state is a `Uint8Array` behind a private field, with no enumerable
property; `toJSON`, `toString` and Node's inspection answer a fixed redaction, so a log line, a diagnostic, an
incident, `JSON.stringify` or a structured clone of anything holding it writes no character of it. The text is read
by one method, at the one call that hands it to a host's pipe (Decision 4).

**Wiped on close:** the document's close fills the bytes with zeros and drops the entry; a protect that replaces it
wipes the old one. **The limit, stated:** a JavaScript string cannot be overwritten. The value arrives from the
renderer as a string in an IPC message and leaves as one in a host frame, and those strings are collected, not wiped.
The holder makes no copy of its own beyond the bytes it wipes.

## Decision 3 — the undo log keeps no password

`setDocumentProtection`'s log entry keeps its command **with no password in it**: the bus records the command its
spec's `recordable` answers, and for this command that is the command without `userPassword` and `ownerPassword`. A
side table in the bus, keyed by the entry object (`WeakMap`), keeps the passwords while that entry lives, in memory
only, for redo, which re-runs the intent. An entry trimmed from the log, a redo tail discarded and a closed document
take their passwords with them, by the table's key. Rejected: ADR-0162's `stored-result`, since redo would then
install an image encrypted under a password nothing holds; refusing the redo, which ADR-0162 rejected for signing.

## Decision 4 — it crosses to the engine hosts, and only there

- **MuPDF**, on every open of a session: the first, and now `recycle`, a removal's save renewal and a host rebuild,
  which ADR-0055 refused and which now open with the held password.
- **PDFium**, with every image it opens: the byte-image host opens a document per call (ADR-0047), so the open
  carries the held password and `loadDocument` takes it. Its default save keeps the security handler (measured), so
  its output is the document's own encrypted form.
- **Never to the renderer from main.** No channel's answer has a field that could carry it, which a contract case
  checks by walking every renderer-facing answer schema for a string field named as a password (Decision 9).

## Decision 5 — no code saves a live session decrypted

Measured above: a decrypting save changes the session it ran on, and every save after it is plaintext. So
`encrypt=none` and `FPDF_REMOVE_SECURITY` appear only where a person removes protection, a command whose removal's
save writes the user's file. No lint rule enforces it yet; until one does, the call sites are the ones in
`documentProtection.ts`, and a new one is a review finding.

## Decision 6 — every working copy of a document opened locked is its own encrypted form

For an *opened locked* document this is already true of what main writes (the table above), and this ADR makes it a
proven property rather than a reading: a test opens such a document, edits it through both engines, takes and
restores checkpoints, and requires every PDF under the session's directories to refuse to open without the password;
and after close, that the password's UTF-8 and UTF-16LE bytes are in no file under main's data, session or
temporary directories.

## Decision 7 — the renderer and the owner's *never cross to the renderer* (PUT TO THE OWNER)

**The question first, since its premise does not hold as written.** The password is typed in the renderer, in the
unlock dialog and in Protect, so it is there before main ever sees it. And PDF.js draws from the bytes main serves;
for a document opened locked those are encrypted, so PDF.js cannot draw them without the password. So the choices are:

- **(a) The renderer keeps what the person typed, for its PDF.js view of that document only, in memory, until the
  document closes.** Main still never sends it. This also ends the re-prompt at every version measured above.
  *Recommended*: it adds no new holder of the secret, since the renderer has it at the moment it is typed.
- **(b) The renderer is served a decrypted image.** `main` parses no document (threat model §2), so a host would decrypt and
  the plaintext would cross host to main to renderer. Every cross-process transfer of a document here is a file in a
  granted directory, so the plaintext would land on disk, which is what this ADR exists to stop, unless it crosses in
  memory frames, which a document past main's memory ceiling cannot.

Until the owner answers, the renderer is unchanged: it hands PDF.js the password it was given and asks again at a
new version.

## Decision 8 — a document protected here, and its history (PUT TO THE OWNER)

Making every copy of a *protected here* document encrypted means the canonical image becomes the encrypted file after
the protect, which needs Decision 7's answer for the window to draw it. And it leaves the copies of the document as it
was **before** it was protected: the protect's own undo checkpoint, and every earlier checkpoint in the log.

- **Recommended:** the protect becomes invertible. Its prior is the protection the document had (none, or a scheme,
  its permissions and the password from Decision 3's table), so undo applies that prior and **no checkpoint is taken**,
  which removes the plaintext checkpoint this command writes today. Earlier checkpoints are re-written encrypted under
  the new password, and undo past the protect restores them and removes the encryption in memory; the alternative,
  deleting them, loses the person's undo history (the owner's *preserve, never drop*).
- Until answered, *protected here* keeps today's behaviour, stated in the FEATURES row.

## Decision 9 — proofs

- `HeldPassword` serialised every way the code serialises anything (JSON, a structured clone, `util.inspect`, string
  coercion) contains no character of the password; a control holding the same text in a plain string does.
- The undo log after a protect: no entry, serialised, contains either password; redo still applies the protect, which
  is what the side table is for. Control: the same flow with the passwords recorded fails the first half.
- PDFium edits a document opened with its user password, through the real library; control: the same edit with no
  password held is refused at `open` with PDFium's 4.
- `recycle` of a document opened locked reopens it; control: with the holder emptied it refuses as ADR-0055 did.
- Decision 6's two scans, each with a positive control: a plaintext PDF planted in the scanned directories is reported,
  and the password planted in a file there is found.
- Close wipes: the holder's bytes read as zeros after close; control: before close they do not.
- No renderer-facing answer schema has a field that could carry it (Decision 4); control: a schema given such a
  field is reported.

## Rejected

- **A password per version, or per checkpoint, in a list.** It is the undo log in another place, and the owner named
  the undo log.
- **Main re-deriving the encryption itself** to avoid holding the password: main parses no document (threat model §2)
  and runs no native engine code (invariant 20).
- **Holding it in the engine host across sessions.** A host is recycled and rebuilt by design (invariant 22), and a
  secret kept in a process this application treats as hostile is kept in the wrong place.

## Addendum, 2026-10-05 — how a PDFium call is handed the password (Decision 4's mechanism)

Decision 4 says the password crosses *with every image* PDFium opens and does not say how main attaches it. It is a
change to the bus's seam, so it is recorded here before it is built (B4).

**The problem.** One `CommandBus` serves every document, and what it hands a byte-image writer is the document's
bytes and nothing else (§3; ADR-0039 removed identity from that slot). So the PDFium adapter in main, which writes the
frame, cannot know which document an image belongs to, and so which password opens it.

**Decision.** In main, a byte-image writer's execution session is the bytes **and the key that opens them**:
`ImageSession { bytes, opensWith }`, where `opensWith` is the document's `HeldPassword` or `undefined`. The bus builds
it in `#sessionFor` from `ByteImageAccess`, which gains `opensWith` beside `current`; the per-document inputs answer it
from the one holder. It still carries no identity: it says how to open the bytes, not whose they are.

- `HeldPassword` moves to `packages/kernel`, since a kernel type now carries it; the holder stays in `apps/desktop`.
  Its text is revealed only where a frame is written.
- **On the wire**, `byteImageWire.read` gains an optional `password`, so `apply`, `capture` and `invert` carry it, and
  PDFium's own reads (`text-runs`, `page-objects`, `render-page`) take `byteImageWire.read` instead of spelling `from`
  each: one statement of what a byte-image read carries (B3a). The compose host's `keep-inline-images`, which opens
  the same image before a regenerating command (ADR-0126), takes it too, since MuPDF without it reads the pages
  undecrypted.
- **In the host**, PDFium's `open` passes it to `FPDF_LoadMemDocument64`, and the read-back (ADR-0169) reopens the
  saved bytes with it, because the default save keeps the security handler (measured, the table above).
- The reads main asks with a document in hand (`text-runs`, `page-objects`, `render-page`) pass the held password by
  that document.

**Rejected.**

- **Matching an image to its document by object identity** (a `WeakMap` marked where `current` mints the bytes). It is
  a second channel beside the session, it fails whenever the bytes are copied, and it is the cross-parser identity
  join B3 names.
- **Handing the writer the document's id.** ADR-0039 removed it from that slot, and §3's account of why a byte-image
  host holds no per-document table rests on its absence.
- **A decrypted image for PDFium.** It is a plaintext copy in a granted directory, the thing this ADR exists to stop.
