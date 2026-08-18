# ADR-0014 — OCR stays inside the engine: Tesseract and Leptonica are kept

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amends:** nothing. Records a decision that would otherwise be a default.
- **Context:** [ADR-0013](0013-pdfa-export-and-text-extraction-engines.md)
  removed Ghostscript, which had been carried as an assumed dependency for PDF/A
  export. Auditing what the shim actually links then found two more third-party
  engines nobody had decided to ship: **Tesseract 5.5.2** and **Leptonica
  1.87.0**, statically linked into the shipped DLL through MuPDF's own project
  graph.

## Decision

**Keep both, and keep them where they are** — inside MuPDF, on the shim's link
line, reached only through MuPDF's own OCR API.

This is recorded rather than left as a default because the surrounding evidence
argues the other way at first glance, and the next person to find two unused
OCR engines in the binary will reach for the same removal that was right for
Ghostscript.

## Why this is not the Ghostscript case

Ghostscript was a **dependency we had assumed**: written into a feature row, not
provisioned, not linked, not shipped. Removing it removed nothing, because
nothing was there. The cost of the decision was zero and the cost of leaving it
was a scheduled surprise.

Tesseract and Leptonica are the opposite on all three counts.

- **They are already integrated, by the engine, not by us.** MuPDF's build
  defines `HAVE_TESSERACT` and `HAVE_LEPTONICA` in its Release configuration and
  compiles `tessocr.cpp`, `ocr-device.c`, `output-pdfocr.c` and
  `leptonica-wrap.c` accordingly. Removing them means diverging from upstream's
  own build configuration and maintaining that divergence across every engine
  bump, which ADR-0011 schedules at each stage boundary.
- **Stage 6 needs them.** OCR is a specified feature, not a speculative one, and
  the integration it needs is exactly the one already present. Removing now means
  re-adding later, and re-adding means re-deriving the build configuration that
  currently arrives working.
- **The removal buys less than it appears to.** The exposure that matters is
  reachability, and reachability is already zero and already checked: no shipped
  code references any of the eleven public functions with a call path into
  `ocr_init` (`docs/security/engine-advisories.json`, `reachability.ocr`). What
  removal would buy is the deletion of unreachable code from the binary — real
  but small, and paid for continuously.

## What is accepted along with them

Both engines carry live advisories, and keeping them means keeping these facts
visible rather than absorbing them.

- **Tesseract 5.5.2 ships two heap memory-safety defects**, CVE-2026-73066 (an
  out-of-bounds **write**) and CVE-2026-73067 (an out-of-bounds read). Both were
  verified present in the vendored source rather than inferred from the
  advisories' version strings, per ADR-0011. Both are fixed in 5.5.3, which MuPDF
  1.28.0 does not vendor.
- **Their attacker input is the model, not the document.** Both are reached
  through a crafted `.traineddata` file. That is a different trust boundary from
  the one this application is built around, and it is the reason these two do not
  become live the moment OCR ships.
- **Leptonica is the one whose exposure changes with Stage 6.** It parses image
  formats, so when OCR becomes reachable it processes attacker-controlled bytes
  taken from the document itself. Its thirteen advisories are all four or more
  years older than the vendored 1.87.0, so the register carries them as a class
  verdict — but the *shape* of its exposure, not its current advisory list, is
  what puts it on the untrusted-document path.

## Constraints this decision creates

These are the terms on which "keep" was chosen. They are not advice.

1. **`.traineddata` is ours.** The language and datadir reaching `ocr_init` must
   not be influenced by a document, and must not be user-supplied without a new
   decision. Both Tesseract advisories stay unreachable only while that holds.
2. **Leptonica is named in the threat model as the image-format parser on the
   untrusted-document path**, not as a footnote to Tesseract. This is enforced:
   `check:docs` fails if a threat model exists and does not say so.
3. **The door set is derived, never hand-maintained.**
   `scripts/security/ocrDoors.mjs` computes it from the compiled source on every
   run, and the register is compared against it.
4. **An engine bump re-triages both.** Their versions are recorded in
   `scripts/release/nativeComponents.json` with the file each was read from, and
   the advisory register fails if a vendored version moves under a verdict.

## Rejected alternatives

**Remove them from the link line, as with Ghostscript.** Rejected: unlike
Ghostscript they are present, working and integrated by upstream, and Stage 6
needs the integration. The saving is unreachable code in the binary; the cost is
a permanent divergence from MuPDF's build configuration, re-paid at every bump.

**Keep them but disable OCR at compile time** (`OCR_DISABLED`, by undefining
`HAVE_TESSERACT`/`HAVE_LEPTONICA`). Rejected for now, and it is the strongest of
the alternatives — it would close the `.ocr` filename dispatch in
`fz_new_document_writer` outright. It is rejected because it is the same
divergence-and-re-add cost as removal, on a shorter timer, and because the
reachability check already gives the property with none of the cost. **It becomes
the right answer if Stage 6 slips past Stage 8**, when import/export work makes
`fz_new_document_writer` a plausible call for reasons unrelated to OCR.

**Take MuPDF 1.28.2 or newer to get Tesseract 5.5.3.** Rejected as a *reason to
move now*: ADR-0011 permits a mid-stage upgrade only when an advisory is shown to
affect the pinned version **and** to be reachable. These are affected and not
reachable. The bump is scheduled at the next stage boundary regardless, and this
is a thing to check when it happens rather than a thing to do today.

**Leave it undecided.** Rejected: that is what produced the Ghostscript
situation. An engine nobody decided to ship is one nobody re-examines, and the
two live advisories here would have sat in a binary with no record that anyone
had looked.

## Consequences

- The shipped DLL contains an OCR engine with two known heap defects, and this
  document is the record that it was a decision.
- Stage 6 inherits a working integration and a written list of what must stay
  true — constraint 1 in particular is a design constraint on the OCR settings
  surface, not a note.
- The binary is larger than it needs to be until Stage 6. Measured, not
  estimated: this is not a claim that the cost is zero, only that it is smaller
  than a maintained divergence from upstream's build.
- If Stage 6 is cut from the product, this ADR is superseded rather than quietly
  ignored, and the compile-time disable above is the decision to take.
