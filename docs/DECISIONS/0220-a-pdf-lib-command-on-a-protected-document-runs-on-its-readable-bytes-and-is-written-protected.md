# ADR-0220 — A pdf-lib command on a protected document runs on its readable bytes and is written protected

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0121](0121-main-never-holds-two-images.md) Decision 3 (a pdf-lib command runs in the MuPDF host on the
  session's own serialise) for a session whose bytes are protected.
- **Found by:** the owner's list of 2026-10-08, from the code review of 2026-10-03: *the commands that write through
  `@cantoo/pdf-lib` fail or misbehave on an encrypted file; make each work: decrypt in memory, apply, re-encrypt with the
  same password and permissions before anything reaches disk; never write a plaintext copy.*

## Context

Eight commands are routed to pdf-lib: Watermark, Headers and footers, Bates numbering, Page background, Insert image, a
drawn form field, a table of contents, and a recognised page's text. Each runs in the MuPDF host: the host serialises the
session, `@cantoo/pdf-lib` loads that image, appends one revision, and the result is written to a file main adopts.

A document that opens only with a password, or has an owner password, serialises protected (MuPDF keeps its keys when it
saves; measured 2026-09-12). What pdf-lib then does was measured on 2026-10-08, against pdf-lib `@cantoo/pdf-lib` 2.9.1:

| the load | what happened |
|---|---|
| the way every command opens a document | refused: *Input document to `PDFDocument.load` is encrypted*. Every one of the eight commands failed on a protected document, as an internal failure the person is told nothing about. |
| with `{ password }` | it decrypts in memory, and the revision it appends has **no `/Encrypt`** and plain streams, appended to a file whose other objects are encrypted. The result opened with no password and its streams inflated to nothing (*zlib error: incorrect header check*). |
| `encrypt()` on the loaded document | writes **streams only**; a string (a form field's name, a contents entry's title) is left readable, which a conforming reader decrypts to garbage. A revision cannot be encrypted with a file's own key through this library. |

So pdf-lib can be made to work on a protected document by one route only: give it the readable bytes, and protect what it
wrote with MuPDF, which writes every object and string correctly.

## Decision

In the host, for a session whose bytes are protected:

1. **The readable image is made in memory, from a copy.** The session is serialised as it is (protected, as every
   serialise of it is), that copy is opened with the password that opens it and written with `encrypt=none`, and the copy is
   destroyed. **The live session is never written with its protection off**: measured 2026-10-08, MuPDF writing a document
   with its encryption off replaces the key of the document it wrote, and the session's `/Encrypt` was gone from its
   trailer afterwards, so every later save of it would have been unprotected.
2. **pdf-lib runs on that image**, unchanged: the commands are not told the document was protected.
3. **The result is written protected again before it leaves the process**: opened as a new MuPDF session, given the
   document's own protection, serialised. Only protected bytes are written to the output directory. There is no plaintext
   file, and the readable image exists only in this process's memory.

**What "the document's own protection" is** (`documentProtection.ts`, `protectedWritingOf`, the one place):

- *Protected in this session* (`setDocumentProtection`): the terms it was asked for, every credential known. Both
  passwords and the permissions are kept exactly.
- *Opened from a protected file*: the scheme and `/P` read from its `/Encrypt` dictionary (`hasPermission` is not asked: it
  answers `true` for every right on a document opened with its owner password), the password it was opened with as the user
  password (none where it opened with none), and as the owner password too where it is the one password for both.
- *Opened with the user password, owner password unknown* (a file stores each password only as a hash, and a document that
  opens for everybody with an owner password set is this case): **the owner password is made up and kept nowhere.** The
  rights the file grants a reader are unchanged and the file opens as it did; what is lost is a password this person never
  had. **The owner decided on 2026-10-08 to keep this**, on one condition: **the person is told, once per document, in
  plain words** (Decision 4).
- *Opened with the owner password where the user password differs*: the password people open the file with is unknown and
  cannot be made up. **Refused by name** (`ProtectionNotReproducible`), before any work, with nothing written. It crosses
  the pipe under its own code and reaches the person as the contract failure `protection-not-reproducible` with its own
  sentence, which says what happened and what to do (close it, open it again with the password readers use). The owner
  decided on 2026-10-08 that this is not the generic failure.

4. **The replaced owner password is told once.** The host's answer carries `permissionPasswordReplaced` only when the
   owner password was made up, `main` turns it into one `document.notice` event per document (by `DocId`, so a document
   closed and opened again is told again, being a new file), and the renderer opens a dialog whose first sentence says the
   change was made. The dialog is not a toast, `dialog.history-trimmed`'s reason: it is a fact about the person's own file
   that they cannot see anywhere else.

The host takes this through one optional part, `protectedWriting` on its handlers' parts. Absent, every session is
unprotected, which is every handler test; the production entry supplies it, loaded with the first pdf-lib command.

## Rejected alternatives

- **Teaching pdf-lib to encrypt a revision with the file's own key.** Its writer encrypts streams and not strings, so the
  result would be a file other readers misread; the fix would be a second implementation of PDF encryption inside this
  repository, beside the one MuPDF has and is written against (B3a).
- **Writing the session with its protection off to get the readable bytes.** Destroys the session's key (above).
- **Refusing every pdf-lib command on a protected document.** The owner's list says make each work, and a document the
  person opened with their password is theirs to edit.
- **Keeping the owner password by recomputing it.** Not possible: the file stores a hash of it.

## Consequences

- **Signing's placeholder (`engine/prepareSignature`) is REFUSED on a protected document, by name, and cannot be covered the
  same way with the libraries this build has.** It meets the same wall (pdf-lib on the protected serialise), and the order a
  signature needs, encrypt and then place the signature with nothing written after, is the one that cannot be written:
  pdf-lib cannot encrypt a revision with the file's own key (the table above), and the other order, a readable copy given
  its placeholder and then protected by MuPDF's whole rewrite, loses the placeholder. **Measured 2026-10-08**: the
  rewritten file carried `/Encrypt` and no `/ByteRange` placeholder `@signpdf` could find, so the range step has nothing to
  fill. Placing a signature in a protected document needs MuPDF to append the signature revision itself, with the file's
  key, which is a larger decision than this one and is listed for the owner. Until then the host refuses before any work
  (`signature-document-protected`), `main` answers the sign outcome `document-protected`, and the sentence says what to do
  (save a copy without the password, sign the copy). It does not touch the save pipeline.
- The two copies of the document in memory during a command (the protected serialise and the readable copy) are transient and
  bounded by the document, as the serialise already was.
- `proof:pdflibprotected` (17 cases, with controls) reads each result with the WASM build of MuPDF, which did not write it.

## Correction, 2026-10-10 — protection undo retains the opening key

[ADR-0224](0224-protection-undo-restores-the-whole-protection-record.md) makes
the prior retain both parts of the structured protection record. The inverse
formerly restored only its writer options and discarded a known opening key,
so this decision's readable-copy step failed after a direct kernel undo.
The saved-file password remained intact in the native app checks.
