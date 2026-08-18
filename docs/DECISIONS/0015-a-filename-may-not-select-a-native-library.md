# ADR-0015 — A filename may not select a native library

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amends:** `docs/ARCHITECTURE.md` §9, adding **invariant 23**. B4 amendment;
  the enforcing mechanism lands in a separate commit.
- **Supersedes:** nothing.

## Context

Auditing what the shim links found that `fz_new_document_writer` chooses its
writer from a **file extension**:

```c
if (is_extension(format, "ocr"))
    return fz_new_pdfocr_writer(ctx, path, options);
```

and when `explicit_format` is null it derives `format` from the path itself,
walking backwards through periods. So a path ending `.ocr` starts Tesseract, and
through Tesseract's `ocr_init` it arms Leptonica — with **no caller naming a
single OCR symbol**.

That dispatch is live in what we ship, not hypothetical: `FZ_ENABLE_OCR_OUTPUT`
defaults to 1 in `config.h`, and `libmupdf.vcxproj`'s `Release|x64` configuration
defines `HAVE_TESSERACT` and `HAVE_LEPTONICA`.

**Nothing reaches it today, and that was measured rather than assumed.** Walking
the call graph forward from all 24 exported shim functions reaches 5583
functions and none of the eleven OCR doors; `mz_save` routes through
`pdf_save_document`, never through the writer dispatch
(`scripts/security/shimReach.mjs`). Tesseract's two live advisories therefore
remain NOT REACHABLE.

## Decision

**The shim names the engine entry point it wants; it never hands a path to a
format dispatcher.** Wanting a PDF means calling the PDF constructor.

The banned set is **derived, not listed**: `is_extension` is `static` to
`source/fitz/writer.c`, so every filename-driven selection in the engine passes
through that one function, and the dispatchers are exactly the public functions
that can reach it. Today that is four —
`fz_new_document_writer`, `fz_new_document_writer_with_output`,
`fz_new_document_writer_with_buffer`, `fz_new_buffer_from_page_with_format`.

## Why an invariant rather than a recorded measurement

The measurement is a statement about this codebase at this moment. It has to be
re-established at every engine release, and re-checked by whoever next writes an
export, and it expires on somebody remembering to look. That is the shape of
safety this project keeps finding to be no safety at all: `pdf_subset_fonts` was
"not called today" and the note said so, which is why invariant expiry had to be
made a mechanism.

An invariant removes the class instead. No filename can select a native library,
a writer added upstream changes nothing here, and there is no per-release
recheck to forget. It also generalises a rule the renderer already lives under —
invariant 2, that a path never reaches a position where it can drive behaviour —
into the native boundary, which was the one place it had never been stated. That
it was unstated there is why this gap existed at all.

## Rejected alternatives

**Record the measurement and re-run it per release.** Rejected: it keeps a
security property dependent on a scheduled human action, and the scheduling is
the part that fails. It also leaves the property true by accident — nobody chose
`pdf_save_document` over `fz_new_document_writer` for this reason.

**Compile OCR out** (`OCR_DISABLED`, by undefining `HAVE_TESSERACT` and
`HAVE_LEPTONICA`). Rejected here, for the reasons in
[ADR-0014](0014-ocr-stays-inside-the-engine.md): it is a permanent divergence
from upstream's build configuration, re-paid at every bump, and Stage 6 needs
the integration. It is also **narrower than this invariant**, not wider — it
closes the `.ocr` extension and leaves every other format dispatch in place, so
a filename could still choose between PDF, SVG, PCL and the rest. That ADR keeps
it as the right answer under a different condition (Stage 6 slipping past
Stage 8); this decision is independent of it and holds either way.

**A runtime check that rejects paths with unexpected extensions.** Rejected for
the reason CLAUDE.md gives for preferring FileHandles over a path allowlist: it
fails open at every call site that forgets it. The dispatcher is never called, so
there is no site to forget.

**Ban only `fz_new_document_writer`.** Rejected: it is the instance, not the
class. Three sibling functions reach the same dispatcher today, and the set is
derived so upstream additions join it automatically.

## Consequences

- Export and convert features (Stage 8) must call the specific writer
  constructor for the format they mean, and must decide that format from
  something other than a filename — a command parameter, a format registry
  entry. That is more code than passing a path, and it is the point.
- A MuPDF release that renames or removes `is_extension` fails the derivation
  loudly rather than silently emptying the banned set, because an empty result
  here would read as "nothing dispatches on a filename".
- The invariant is enforceable only over source we can read. It says nothing
  about a future dependency that performs its own extension dispatch internally;
  such a dependency would need its own entry.
- This does **not** cover document *opening*. `fz_open_document` selects a
  handler for content the user has already chosen to open, and MuPDF sniffs
  magic bytes as well as extension. Opening is content-driven by design; the
  invariant is about the **output** side, where the application knows what it
  intends to produce and has no reason to ask a filename.
