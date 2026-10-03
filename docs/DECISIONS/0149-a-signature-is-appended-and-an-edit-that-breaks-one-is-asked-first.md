# ADR-0149 — A signature is appended, and an edit that would break one is asked before it is made

- **Status:** Accepted
- **Date:** 2026-10-03
- **Decided by:** the owner, 2026-10-03, on the code review of c89e7266 (CR-DOC-07 and CR-NAT-11): *"a second signature
  is always appended incrementally. Any edit that would break an existing signature warns BEFORE the edit is made, and
  offers to work on a copy. ARCHITECTURE §4 is amended (ADR first) to say what PDFium's saves really do."*
- **Amends:** `docs/ARCHITECTURE.md` §4's save invariant *"Text edits save incrementally. A full PDFium rewrite corrupts
  non-embedded font references"*, both clauses of which the repository already contradicts;
  [ADR-0054](0054-the-signing-core-ships-and-the-placeholder-is-ours.md) Decision 3's whole save for the placeholder
  (its `useObjectStreams: false` constraint is kept); and
  [ADR-0127](0127-a-pdf-lib-command-appends-its-revision.md)'s correction that the signer keeps its route.
- **Rests on:** [ADR-0008](0008-save-mode-is-determined-by-purpose.md)'s rows (a removal saves whole; a signature must
  survive by an incremental save) and [ADR-0148](0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md)
  (the placeholder is written in the MuPDF host).

## The problem, in one sentence

The only question about breaking a signature is asked at save, by asking MuPDF whether its next save keeps the
signatures, and two kinds of edit have already rewritten the document whole by then — so MuPDF reopens a file whose
signatures no longer verify, finds their dictionaries, will append, and answers *kept*.

## What was measured, 2026-10-03

- **A second signature rewrote the file.** Signed once, 18,360 bytes; signed again, 35,324 bytes, and the first
  18,360 were not a prefix of the result. Read back by MuPDF: the first signature `coversDocument: false`, the second
  `true`. The cause is the placeholder's whole save (`openWhole`, then `save()`).
- **Appending keeps both.** The placeholder written by pdf-lib's `commit()` on a document loaded for an incremental
  update, objects uncompressed: the first signature's file is a prefix of the result byte for byte, both signatures
  `coversDocument: true`, the first `coversWholeFile: false` (it covers the file as it was) and the second `true`. Every
  existing signing case passes on that route (90, timestamps and certification included).
- **What PDFium's saves really do**, read from `pdfiumFfi.ts`: `FPDF_SaveAsCopy` with flags `0`, a full rewrite, and
  its comment records a measurement of 2026-09-09 — an unedited save changes no rendered pixel on the corpus. So §4's
  *"text edits save incrementally"* is false, and *"a full PDFium rewrite corrupts non-embedded font references"* is
  what that measurement looked for and did not find. The seven PDFium commands each answer a whole rewrite.

## Decision

1. **A signature is added as an incremental update.** The placeholder is written by `commit()` on a document loaded
   for one, with `useObjectStreams: false` so `@signpdf` can still find the hole in the raw bytes. A signature after
   the first therefore covers the file with the earlier ones untouched inside it.
2. **Which commands break a signature is derived in one place**, from what already decides it: a command whose writer
   of record is **PDFium**, because its result is a whole rewrite, and a command whose purpose is **removal**, because
   ADR-0008's first row saves it whole with no prior revisions. Every other command keeps a signature: MuPDF's save of a
   signed document appends (ADR-0008's second row), pdf-lib's commands append (ADR-0127), and a signature appends
   (Decision 1). A command added tomorrow is classified by its writer and its purpose, which it must declare anyway.
3. **It is asked before the edit is made.** Inside the document's lane, before the bus runs, `main` asks the
   document's own session how many signatures it carries. With one or more, and the person not having agreed, the
   command answers `breaks-signatures` and nothing changes — no byte of the image, no session, no history.
4. **The renderer's one dispatcher asks the person**, in one dialog: *Work on a copy*, *Edit this document*, or
   *Cancel*. *Edit this document* sends the same command again, agreed. A person is never refused because of their
   document.
5. **Work on a copy** is a copy written where the person chooses — *Save a copy*'s picker and write — opened as a
   tab, with the same edit applied there. A command that names the version it was composed against (ADR-0041) has that
   version re-bound to the copy's, and only when the original has not moved since; otherwise it is stale, as it would
   be on the original. The original is untouched and its signatures still verify.
6. **Agreed once per open document.** After *Edit this document*, the save does not ask the same question again about
   that document — a removal's save would otherwise ask twice — and the agreement ends when the document closes. The
   save's own question stays for every other path.

## Rejected

- **PDFium saving incrementally** (`FPDF_INCREMENTAL`). It would keep a signature through a text edit, and nothing
  here has measured it: the text-edit path was measured against a full rewrite, and an incremental PDFium save is a
  different output whose reading by the other engines is unknown. The owner's decision is the warning.
- **Asking at save, as today.** It asks after the image is rewritten, and answers *kept* for signatures that are
  already broken.
- **A field on each command saying whether it breaks a signature.** The fact is its writer's and its purpose's, and a
  third declaration could disagree with both.
- **Refusing a breaking edit on a signed document.** A person is never refused because of their document.
- **Working on a copy by hand.** Opening a copy and asking the person to make the edit again drops what they typed;
  the edit they asked for is the one applied.

## Amendment only

Nothing is built on this in the commit that records it.
