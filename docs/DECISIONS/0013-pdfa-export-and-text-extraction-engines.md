# ADR-0013 — PDF/A-2b export gets a matrix row and no binary; the Poppler conditional is dropped

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amends:** `docs/ARCHITECTURE.md` §3, adding two rows to the writer-of-record
  matrix. No existing row changes.
- **Context:** Two features in `BUILD-PROMPT.md` Part D name a capability whose
  engine appears in no matrix row. §3.1 exists to stop exactly that — a
  specified feature resting on an assumed engine — and it had two live
  instances.

## The two instances

**D10 specifies PDF/A-2b export**, with honest blocker reporting, and it carries
a row in `docs/FEATURES.md`. No engine is assigned to it anywhere. Meanwhile
Ghostscript sits in §8's provisioned-binaries list with no feature pointing at
it, which is the same gap seen from the other side: a component with no purpose
and a purpose with no component, and nothing connecting them.

**D10 also specifies text extraction as "layout-preserving when Poppler
available".** Poppler appears in no provisioning list, no matrix row and no
ADR. A conditional clause in a feature description is not an engine decision;
it is a decision deferred until the day someone implements the feature and
discovers there is nothing behind it.

## Decision

**PDF/A-2b export is Ghostscript's row. Ghostscript is not provisioned and does
not ship until Stage 8 builds the feature.**

Ghostscript is the realistic engine: MuPDF has no PDF/A output mode, veraPDF
validates conformance but does not convert, and hand-rolling font embedding,
output intents and the PDF/A XMP schema is precisely the bespoke-parsing work
this project's rules push back on.

The capability is real; the need for it now is not. PDF/A-2b is Stage 8 and 1.0
ships after Stage 4, so provisioning it today puts a binary in the first release
that nothing calls. That is the **wired-tools rule one layer down**: a component
that ships and does nothing is the same defect as a control that renders and
does nothing, and it is worse in one respect — a dead control is visible, a dead
binary is not.

**The Poppler conditional is dropped.** Text extraction gets a matrix row naming
MuPDF's structured-text API, which is what the kernel already reaches for.
Whether it preserves layout well enough — columns, tables, reading order — is
**not established**, and that question is recorded in `docs/ENGINE-SPIKE.md` as
an unexecuted hypothesis rather than settled here. What is settled is that a
feature description will not carry a conditional naming a component nobody has
decided to ship.

Both rows are marked **unexecuted** in the spike, alongside PDFium, `@signpdf`
and the PDF.js render path. Nobody has run a PDF/A conversion or a
layout-fidelity comparison in this project. The rows are the current best guess
and are labelled as guesses; §3.1's whole point is that a matrix row is evidence
or it is provisional, never quietly in between.

## Rejected alternatives

**Provision Ghostscript now.** It costs, starting immediately and lasting
through 1.0, for a feature that cannot be built until Stage 8:

- installer budget, in a Store package where size is a submission constraint;
- a **second AGPL component** in the source offer, with its own version, build
  configuration and corresponding-source obligation — the offer is a legal
  document and every component in it is a thing that must stay accurate;
- another sandboxed process, with its own argument construction, temp file
  handling and lifetime;
- an advisory surface with a **recurring sandbox-bypass class** — `-dSAFER`
  escapes are a repeating pattern in Ghostscript's history, not a one-off — which
  the engine advisory register would have to track from day one against a
  component no shipped code path calls.

Nothing architectural is foreclosed by waiting. Re-adding it is a provisioning
script plus a registration into the **external-converter seam that LibreOffice
already requires** for Office import. The seam exists because that import needs
it; Ghostscript joins it rather than motivating it.

**Leave Ghostscript in §8's binary list and say nothing.** This is the status quo
and it is how a binary ends up shipped because nobody could remember whether
something needed it. A component's presence must be traceable to a feature.

**Drop PDF/A-2b instead.** It is a specified feature with a real audience —
archival submission, legal and government filing — and no evidence has been
offered against it. Dropping a specified feature to avoid recording an engine
decision would be solving the wrong problem.

**Provision Poppler for layout-preserving extraction.** Same objection as
Ghostscript, without the same justification: MuPDF has a structured-text API
with block, line and span geometry, so the premise that a second engine is
needed has never been tested. Adding a binary to satisfy an untested premise is
how the founding matrix acquired two false justifications, which §3.1 was
written in response to.

## Consequences

**Two matrix rows now describe engines nobody has run.** They are marked as such
in `docs/ENGINE-SPIKE.md`, and `scripts/spike/engineSpike.mjs` does not gate
them, because there is nothing to regress against yet. The obligation lands with
the feature: Stage 8 executes the PDF/A row before building on it, exactly as
Stage 0 executed the MuPDF rows.

**`docs/FEATURES.md`'s Stage 8 rows point at this ADR and at the spike**, so the
provisioning work arrives attached to the feature that needs it rather than
living in a binary list nobody can trace to a purpose.

**If the layout-fidelity spike finds MuPDF insufficient**, Poppler returns
through the external-converter seam and this ADR gets a dated correction. That
is a cheaper outcome than shipping a binary for years against the possibility.
