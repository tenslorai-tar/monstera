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

## Correction, 2026-09-10 — the tables half is executed, and MuPDF is not found insufficient

This ADR left *"whether it preserves layout well enough — columns, tables,
reading order"* as an unexecuted hypothesis. The **columns** half was executed on
2026-09-02 ([ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)).
The **tables** half could not be, and the stated reason was that no fixture
contained a table — which is an absence, and an absence that had no expiry
anybody could see.

The supplied corpus grew from five documents to eleven on 2026-09-10 and now
carries table-bearing ones, so the reading was taken:
`npm run proof:lineagreement`, MuPDF's npm build, PDFium 155.0.8044.0, asked for
`segment,table-hunt` instead of `segment` and scored against the same
independent reading.

| | |
|---|---|
| documents carrying text | 6 of 11 |
| changed at all by the option | **2** |
| their change in line agreement | **−1.5 and −17.5 points** |
| improved by the option | **none** |
| control, a constructed 3×3 grid | the two readings **differ**, so a zero row is *no table found* rather than *the option never reached the engine* |

**`FZ_STEXT_TABLE_HUNT` stays off, and the reason is upgraded rather than
repeated.** It was *unexecuted*; it is now measured on real documents from four
producers.

**Two limits, because the figure is easy to over-read.** First, a fall in line
agreement is not on its own evidence of worse extraction: the option exists to
emit **cells**, and a cell is not a line, so some of that fall is the option
working. What decides it today is that no shipped consumer of the substrate
wants cells — the text layer, search, spell check and word count all read lines.
Second, this scores agreement with a second reader and not against ground truth,
so it says nothing about whether table **structure** is recovered correctly. A
feature whose subject is a table still owes that reading before turning the
option on, exactly as the per-consumer opt-in already says.

Poppler does not return: nothing here found MuPDF insufficient.

## Correction, 2026-09-14 — the layout half is measured, and MuPDF has no layout output

This ADR said that **if the layout-fidelity spike finds MuPDF insufficient**, Poppler returns
through the external-converter seam. The spike's layout part is now executed
(`docs/ENGINE-SPIKE.md` H7, addition of this date). It found MuPDF insufficient in one specific
sense, and not in the sense that sentence expected.

- **MuPDF's text is right.** Its lines were intact on every fixture, including a `/Rotate 90`
  page.
- **MuPDF has no layout output.** `asText()` gives one line per text line under every option
  the engine names. A two-column page came back as twelve one-line rows against six two-cell
  rows of truth.
- **A layout mode would therefore be built, not called.** A row grid over MuPDF's lines matched
  the generator's truth on two columns, a table and a rotated run. It failed a rotated page when
  laid out in display space. And a grid is the clustering
  [ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md) keeps
  out of the kernel.

**So the fallback this ADR named is one of three answers, not the automatic one.** The choice
is between a grid amending ADR-0034, Poppler (or Xpdf) through the external-converter seam
(a new provisioned binary, licence and advisories included), and plain text only. It is left
to the owner.

**The plain half is built on MuPDF** (D10, 2026-09-14): one extraction path through the text
substrate, streamed a page at a time under ADR-0035. The matrix row stands.

## Correction, 2026-09-16 — the owner chose Poppler for the layout half

The owner took the choice left above: Poppler, through the external-converter seam. That does not
revive the conditional this ADR dropped. *"When Poppler available"* was a feature that depended on
whether a binary happened to be present; the decision is a **pinned** `pdftotext` from conda-forge,
provisioned, licence-checked and run in a contained process, recorded in
[ADR-0071](0071-layout-preserving-text-is-popplers-pdftotext-in-a-contained-process.md). Plain text
stays MuPDF's, and ADR-0034 is not amended.

## Correction, 2026-09-17 — the tables reading asked without `vectors`

The 2026-09-10 correction above measured `segment,table-hunt`. MuPDF's own CSV writer,
`output-csv.c`, asks for `vectors` and `accurate-bboxes` as well, and `stext-table.c` proposes a
table for every raft of vectors, so without `vectors` a ruling line proposes nothing. Measured on
MuPDF 1.28.0: `segment,table-hunt` returned every one of six generated grids two columns wide, and
the CSV writer's set returned all four ruled grids exactly. The −1.5 and −17.5 figures stand as a
reading of the option string that was asked; they are not a reading of the engine's table finding,
and its *"none improves"* says nothing about tables. Text extraction's choice is unchanged, because
it wants lines. Finding a table is now its own §3 row and read,
[ADR-0073](0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md).
