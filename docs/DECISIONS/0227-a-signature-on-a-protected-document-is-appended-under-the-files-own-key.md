# ADR-0227 — A signature on a protected document is appended under the file's own key

- **Status:** Accepted
- **Date:** 2026-10-11
- **Amends:** [ADR-0220](0220-a-pdf-lib-command-on-a-protected-document-runs-on-its-readable-bytes-and-is-written-protected.md),
  its first Consequence (*signing's placeholder is refused on a protected document, by name*). The writers of record are
  unchanged: the placeholder is pdf-lib's (ADR-0054), the signature `@signpdf`'s over it (ADR-0148), and the protection
  MuPDF's (ADR-0220). What changes is that MuPDF may now write ONE revision incrementally, under the key the file already
  has, where ADR-0220 had it rewrite the whole file under the document's terms.
- **Decided by:** the owner's cloud bundle of 2026-10-11, Part 3 item 2: *signing a password-protected document must
  work; the document is encrypted, reopened with the held password, then signed as an incremental update, so the
  encryption dictionary and the earlier bytes stay untouched; check that the signature's `/Contents` is not encrypted and
  that the signature verifies with an outside validator; never write a readable copy to disk; cover Visible, Invisible
  and an already-signed protected document.*

## Context

ADR-0220 refused a signature on a protected document because both orders it tried failed: pdf-lib cannot encrypt a
revision with the file's own key, and a readable copy given its placeholder and then protected by MuPDF's whole rewrite
loses the placeholder. Its last sentence named what was missing: *MuPDF appending the signature revision itself, with the
file's key.*

Three things were measured on 2026-10-11 against MuPDF 1.28.0 (the shim this repository builds, run on Linux through
a scratch script that is not committed, on a 1-page AES-256 document with user password `open`):

| the question | what MuPDF did |
|---|---|
| does `saveToBuffer('incremental')` of a document opened with its password keep the earlier bytes? | yes: the output starts with the input, byte for byte, and appends one revision |
| are the new revision's strings encrypted with the file's key? | yes: a `/Reason` written as plain text came out as 32 bytes of ciphertext, and the trailer kept its `/Encrypt` |
| is a signature dictionary's `/Contents` left in clear, as ISO 32000-2 §7.6.2 requires? | yes: `pdf-crypt.c`'s `is_signature` skips `/Contents` of a dictionary with `/Type /Sig`, `/Contents`, `/ByteRange` and `/Filter`, and the 64 zero bytes came out as `<0000…>` |

And one about the token shape `@signpdf` requires (ADR-0054 Decision 3): MuPDF's default writer prints arrays tight,
`/ByteRange[0/**********/**********/**********]` and `/Contents<…>`, which `findByteRange` (it splits on spaces) and
`SignPdf.sign` (it searches for `/Contents ` with a space) both miss. Its `pretty` option prints
`/ByteRange [ 0 /********** /********** /********** ]` and `/Contents <…>`, which both find.

## Is this the right question

The question asked was *how does a placeholder get written after the protection?* Its premise is that a placeholder has
one writer and the protection another, and that is right: a second placeholder writer in MuPDF's object model would be a
second opinion about what a signature dictionary contains (B3), and a second encryptor in this repository is what
ADR-0220 already rejected (B3a). So the question is not *who writes the placeholder* but *who writes the revision that
carries it*, and that has an answer that keeps both writers.

## Decision

In the MuPDF host, for a session whose next save is protected:

1. **The protected image is the session's own serialise** (`mupdfWriter.serialise`, the one place a save's terms are
   decided). A signed protected document opened as it was serialises by appending, so its earlier signature keeps its
   bytes.
2. **The readable copy is ADR-0220's own, `unprotectedImage`**, made in memory from a second open of those bytes, and it
   keeps every object's number: its `garbage` is MuPDF's first level, which frees what nothing references and renumbers
   nothing (`pdf-write.c` renumbers from `garbage=compact` up). Measured 2026-10-11: with `garbage=compact` there, a
   signed protected file with a gap in its numbers and an already-signed one both lose their second signature's
   placement. The live session is never written with its protection off (ADR-0220 Decision 1's reason).
3. **pdf-lib places the signature on the readable copy, unchanged** (`withSignaturePlaceholder`'s own placement), and the
   objects its commit would write are read from pdf-lib's own rule for that, `context.snapshot.shouldSave`. Nothing in
   this repository decides which objects a revision holds.
4. **Those objects are copied into the protected document**, opened a third time with the password that opens it: an
   object pdf-lib changed keeps its number, and an object pdf-lib created is given a new number in the protected
   document, because a number free in the readable copy (its `/Encrypt` object, say) need not be free in the protected
   one. A stream is copied raw, with its filter.
5. **MuPDF writes that one revision with `incremental,pretty`**, under the file's key, and `@signpdf`'s range step and
   `main`'s fill then run exactly as they do for an unprotected document.

The password is the one the protected image opens with: the user password asked in this session where protection was set
here, and otherwise the one the document was opened with. **A document opened with its owner password where the user
password differs is signed too**, which ADR-0220's pdf-lib route has to refuse: an incremental save keeps the key, so it
needs no password it would have to reproduce.

Only protected bytes leave the process. The readable copy and the placed copy exist in this process's memory, for the
length of one prepare, as ADR-0220's do.

## Rejected alternatives

- **A MuPDF port of the placement.** It would make the signature dictionary's contents two opinions, in two libraries'
  object models, kept equal by hand (B3).
- **Transplanting by parsing the appended revision's cross-reference table.** A second reader of the format pdf-lib just
  wrote, when pdf-lib already says which objects it writes.
- **Reusing object numbers for new objects.** Reasoned, not met on a real file: the readable copy has no `/Encrypt`
  object, so where another program wrote `/Encrypt` as the highest-numbered object, pdf-lib's next free number is that
  object's, and an overwrite there loses the protection. The rule costs one map, and its case in `protectedSign.test.ts`
  goes red without it.
- **Keeping the refusal.** The owner's bundle says make it work.

## Consequences

- **The refusal is removed whole**, as the bundle asks where nothing else uses it: `SignatureProtectedDocumentError`, the
  host's `signature-document-protected` code, the sign outcome `document-protected` and its sentence. Nothing else threw
  any of them: the one other door to that code was `ProtectionNotReproducible` reached through `protectedWritingOf`, which
  this route does not call. The renderer and `main` ship together, so no build answers an outcome the other cannot read.
- A protected document's signature is an incremental update of the protected file; a later ordinary save appends (ADR-0008
  rule 2), so it survives Save.
- The proof reads the signed file with the WASM build of MuPDF, which did not write it, and verifies the signature with
  poppler's `pdfsig` where it is installed, which is the outside validator the bundle asks for.
