# ADR-0016 — The document handler set is named, not inherited

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amends:** nothing in `docs/ARCHITECTURE.md`. Replaces an inherited default
  with a decision, and creates an obligation on every future format.
- **Related:** [ADR-0015](0015-a-filename-may-not-select-a-native-library.md)
  scoped invariant 23 to the output side and named this question without
  deciding it. This decides it.

## Context

`fz_register_document_handlers` registers **fourteen** parsers. Every
`FZ_ENABLE_*` gate in MuPDF's `config.h` defaults to 1, this build overrode
none, and `gz_document_handler` carries no gate at all. The set was inherited
from someone else's build defaults.

That was not theoretical. `fz_open_document` scores every registered handler
against the stream's **content** as well as against the filename and takes the
best, and `mz_open`'s `"not a PDF"` refusal comes from `pdf_specifics` **after**
`fz_open_document` returns:

```c
d->doc = fz_open_document(c->fz, path);
d->pdf = pdf_specifics(c->fz, d->doc);
...
if (d->pdf == NULL) { mz_fail(c, "not a PDF"); ... }
```

A file that content-scored as EPUB had already been opened and parsed by the
EPUB handler before it was refused. The rejection was post-hoc, and the caller
could not tell the difference: both paths return `MZ_ERR`.

CBZ, XPS, EPUB and Office are **zip containers**, so this also made "archive and
embedded-file extraction path traversal" — an item that read as future work —
live today.

## Decision

**Register only the handlers a feature requires.** Today that is `pdf`, because
every stage through SHIP 1.0 is PDF.

Three mechanisms, deliberately overlapping, declared in one place
(`scripts/lib/documentHandlers.mjs`):

1. **Build-time.** `-DFZ_ENABLE_<FORMAT>=0` for every format not permitted,
   passed through the `CL` environment variable because the definitions must
   reach a *vendored* project file. Preferred, for the reason below.
2. **Runtime.** The shim registers `pdf_document_handler` by name rather than
   calling `fz_register_document_handlers`. This is what covers
   `gz_document_handler`, which has no flag, and it is the half that stays
   correct when a future MuPDF adds a handler to the bulk function.
3. **Post-hoc.** `mz_open` still refuses whatever `pdf_specifics` does not
   recognise. It was never sufficient alone — that is the finding — but it costs
   nothing and still catches a PDF-shaped file the parser opens and cannot use.

## What the build-time half actually achieves — measured, not assumed

The flags gate **registration only**. Every `FZ_ENABLE_*` is referenced from
exactly two files, `document-all.c` and `config.h`; nothing inside `epub-doc.c`
or its siblings sits in an `#if`. So the flag by itself removes no code. What
removes code is the **linker discarding objects nothing references** — the same
mechanism that keeps every barcode symbol out of this DLL while `libzxing` sits
on the link line.

Whether that fired is a fact about a particular link, so it was measured
(`scripts/security/handlerFootprint.mjs`, searching for format-specific literals
each parser's own code carries, with PDF's markers as the positive control):

| Parser | Before | After |
|---|---|---|
| pdf | present | **present** (control) |
| epub | present | **absent** |
| xps | absent | absent |
| svg | present | **absent** |
| mobi | present | **absent** |
| fb2 | present | **absent** |
| html | present | **present** |
| office | present | **present** |

The DLL fell from **42,124,800 to 39,373,824 bytes**.

So the discard is **partial, and the honest statement is narrower than "the code
is gone"**. EPUB, SVG, MOBI and FB2 left the binary. HTML and Office markers did
not, most likely because MuPDF's HTML engine and story API are reachable
independently of the document handlers. For those two the verdict rests on
mechanism 2 — not registered, therefore not selectable — rather than on absence.

Stating that distinction is the point of measuring it. A claim of "the code is
not present" is worth more than "present but unregistered", and it is only true
for four of the six.

## Consequences

- **`DEBIAN-CVE-2025-55780` can be re-closed on a mechanism.** Its original
  premise — "no EPUB path is reachable" — described a guard that did not exist.
  The EPUB parser is now absent from the binary, so the advisory does not apply
  to what ships, rather than being argued about.
- **Adding a format is a deliberate act with an ADR.** Add it to
  `PERMITTED_HANDLERS`, and record which feature needs it and what its parser is
  now exposed to. D9 (import) and D10 (convert) at Stage 8 are the first that
  will ask.
- **`pdf_document_handler` is not public API.** MuPDF declares it `extern` in
  its own `document-all.c` and the shim does the same. An upstream rename breaks
  the **link**, which is loud, and is the acceptable failure mode here.
- Proven end to end: `proof:documenthandlers` opens generated `txt`, `html`,
  `svg` and `fb2` files through the real DLL and requires the refusal to be
  MuPDF's `cannot find document handler for file` rather than the shim's
  `not a PDF`. The message is the only observable difference between refusing
  before and after a foreign parser runs. A real PDF opening is the control.

## Rejected alternatives

**Leave it inherited and rely on the `pdf_specifics` check.** Rejected: that is
the state this ADR corrects. It permits a foreign parser to run on
attacker-supplied bytes and then discards the result, which is the parse, not
the outcome, that matters.

**Runtime non-registration only.** Rejected as the whole answer, kept as part of
it. It is sufficient for reachability and it leaves every parser in the binary,
so every advisory against them stays arguable rather than inapplicable. It is
also the only mechanism available for `gz`.

**Build-time gating only.** Rejected: it cannot cover `gz_document_handler`,
which has no flag, and a MuPDF release that adds a handler adds it to the bulk
registration function rather than to any list here.

**Patch `document-all.c` in the vendored tree.** Rejected: undone by the next
provisioning run, and it edits source we do not own to express a decision that
is ours.
