# ADR-0034 — The text substrate owns the engine's options, not a clusterer of its own

**Date:** 2026-09-02
**Status:** accepted. **Amends `BUILD-PROMPT.md` Part E2's mechanism**, which has
one module implement line clustering and tune it against a corpus score. The
architecture amendment is a separate commit (B4). Discharges the open half of
[ADR-0013](0013-pdfa-export-and-text-extraction-engines.md), which recorded that
*"whether that geometry is sufficient for columns and tables is unexecuted"* and
put the obligation on the feature that needs it. E2 is that feature.

---

## The problem, in one sentence

Two documents in the founding record disagree about who groups glyphs into lines
and blocks, and building either answer without measuring would have fixed a
design against a premise nobody had tested.

## The two readings, both from the founding record

`BUILD-PROMPT.md` Part E2:

> One shared text-structure module in the kernel — glyph runs → lines →
> blocks … Line clustering is implemented exactly **once** — the classic failure
> is the same clustering re-implemented per consumer with constants "required to
> mirror exactly" across copies. It is tuned against the fixture corpus with a
> measurable accuracy score.

`docs/ARCHITECTURE.md` §3's engine matrix, for *text extraction, plain and
layout-preserving*:

> **MuPDF** structured text … MuPDF exposes block, line and span geometry.
> Whether that geometry is *sufficient* for columns and tables is **unexecuted**.

Read alone, the first says we cluster and tune constants; the second says the
engine already does and nobody has checked how well. They are not reconcilable by
reading harder, which is why this ADR starts with a measurement.

## What was measured

`scripts/research/textStructure.mjs`, MuPDF **1.28.0**, page 1, 2026-09-02,
through the new `mz_stext_json` shim export — which emits
`fz_print_stext_page_as_json`, MuPDF's own serialisation, so nothing here forms a
second opinion about the format.

**The fixtures' ground truth is independent of any clusterer.** Every run is
placed by the generator at a coordinate the generator chose, so which runs share
a column and which share a baseline is a fact about the generator rather than an
opinion of the thing under test. Scoring a clusterer against labels produced by a
clusterer measures agreement, not correctness.

**The two columns share every baseline, deliberately.** A grouper keying on
baseline alone merges them into five wide lines and reads across the gutter,
which is the classic two-column extraction failure. Staggered baselines would be
handled correctly by the broken version and would separate nothing.

| fixture | default | `FZ_STEXT_SEGMENT` | `SEGMENT \| TABLE_HUNT` |
|---|---|---|---|
| two columns, 268pt gutter | 10 lines, 0 merged, **row-major** | 10 lines, 0 merged, **COLUMN-major** | 10 lines, **row-major** |
| two columns, 60pt gutter | 10 lines, 0 merged, **row-major** | 10 lines, 0 merged, **COLUMN-major** | 10 lines, **row-major** |
| single-column prose | 5 blocks, 5 lines | 5 blocks, 5 lines — **unchanged** | **11 blocks, 10 lines** |

Three readings, and each decides a different thing:

1. **MuPDF's line grouping never merged across the gutter, at either width.**
   The failure E2's prose is written against — a line that reads across a
   column boundary — is one the engine does not commit.
2. **`FZ_STEXT_SEGMENT` produces correct column-major reading order** at both
   gutters, and leaves single-column prose byte-for-byte as it was.
3. **`TABLE_HUNT` is harmful on prose**: it split
   `left0 and more words on the same measure` into two lines, inventing a table
   where there is none, and it undoes `SEGMENT`'s column ordering on both
   two-column fixtures.

## Decision

**The kernel's text substrate owns the engine's OPTIONS and the normalisation of
its output. It implements no clustering.**

- Exactly one module names the `fz_stext_options` flags. Every consumer —
  editing, Excel export, search, extraction — reaches text through it and cannot
  ask the engine a different question.
- `FZ_STEXT_SEGMENT` is **on**. It is the reading-order fix, and it costs nothing
  on pages that do not need it.
- `TABLE_HUNT` is **off**, on the evidence above rather than on taste. It becomes
  a per-consumer opt-in when a feature exists whose subject is a table — Excel
  export, D10, Stage 8 — and that feature owes its own reading before turning it
  on.
- The **accuracy score survives and changes its subject**: it scores the flag
  choice and the normalisation against ground-truth fixtures, not our constants.
  There are no constants of ours to tune.

**E2's stated purpose is met and its stated mechanism is not.** The purpose is
that clustering exists once and no consumer re-derives it with constants
"required to mirror exactly"; owning the options achieves exactly that, and
achieves it more strongly than owning an algorithm would, because there is no
algorithm for a second consumer to copy.

## Rejected alternatives

**Implement line clustering in the kernel, as Part E2's mechanism reads.**
Rejected on B3a: MuPDF already answers *which characters share a baseline*, it
answered correctly on the hard shape at two gutter widths, and a partial
reimplementation is the dangerous shape precisely because it agrees with the
authority most of the time. This project has paid for that three times in one
day before now.

**Implement block clustering and take MuPDF's lines.** The tempting middle, and
the measurement removes its premise: reading order is what block grouping is
*for*, and `FZ_STEXT_SEGMENT` already produces it. Writing a segmenter beside a
working one would be a second opinion with a corpus score attached.

**Turn `TABLE_HUNT` on globally**, since a text substrate serving Excel export
will eventually want tables. Rejected on the measurement: it damages ordinary
prose today, and a flag that is wrong for the common case cannot be the default
for a shared module. The consumer that needs it asks for it.

**Take MuPDF's output raw, with no module at all.** This is the null option and
it fails E2's purpose exactly: each consumer would choose its own flags, and the
flags demonstrably change the answer. The thing worth owning turns out to be the
options rather than the algorithm, which is a narrower module than E2 imagined
and the same guarantee.

**Defer until a real-document corpus exists.** Rejected because the decision
blocks the whole of Stage 1's opening and the synthetic fixtures answer it: the
question is whether the engine's grouping is *usable*, and three fixtures with
known ground truth settle that more sharply than found documents whose correct
answer nobody knows.

## Consequences

**`BUILD-PROMPT.md` Part E2's mechanism is superseded** and the founding record
is not edited. `docs/ARCHITECTURE.md` carries the amendment and the amendment log
names the clause.

**The corpus score keeps a real gate.** It fires when a MuPDF upgrade changes
segmentation — which is the regression this substrate is most exposed to now that
the grouping is the engine's, and which nothing else in the build would notice.

**One reading is not settled and is named rather than implied:** whether
`SEGMENT` holds on documents this build did not generate. The fixtures are
synthetic by design, so the score's corpus grows with the first real documents
extraction meets, and this ADR takes a dated correction if it does not hold.

**`TABLE_HUNT` acquires a trigger rather than a plan.** The first feature whose
subject is a table owes the reading this ADR did for prose, and the flag is a
per-call option so that reading changes one call site rather than a default.

---

## Addition, 2026-09-02 — what *"the deep tuning lands with Stage 5"* becomes

Part E2 carries one more obligation than the Decision above answers, and it was
inherited without being carried forward:

> It is tuned against the fixture corpus with a measurable accuracy score
> (constants change only with a corpus score in the commit message). … **The
> deep tuning lands with Stage 5**, but from day one there is exactly one
> implementation; a second extraction path anywhere is an immediate K.0
> regression.

Under the superseded mechanism *deep tuning* had an obvious meaning: change the
clustering constants, show a corpus score. **This ADR removed the constants, so
the sentence was left pointing at nothing** — and a deferred obligation whose
subject has dissolved is one that expires unnoticed, which is the shape this
repository keeps paying for. The three consequences above name a MuPDF upgrade,
real documents and `TABLE_HUNT`; none of them is Stage 5.

### What the obligation becomes

**Tuning is now a choice among the engine's options, scored the same way.**
`fz_parse_stext_options` exposes more than the two this ADR measured —
`dehyphenate`, `preserve-spans`, `paragraph-break`, `accurate-bboxes` and the
rest — and each is a decision with a corpus score attached, taken in
`STEXT_OPTIONS` and nowhere else. Part E2's *"constants change only with a corpus
score in the commit message"* survives verbatim with **options** as its subject.

### The question Stage 5 will actually ask, and the line it must not cross

Text editing will want structure MuPDF's answer does not give — a heading joined
across a wrap, a hyphen closed, a run merged. The tempting shape is a **post-pass
over the substrate's output**, and whether that is legitimate tuning or the
second extraction path K.0 bans is not obvious. It is decided here rather than in
the commit that wants it:

**A post-pass that reads GEOMETRY to decide grouping is a second extraction
path.** Deciding which lines belong together from `box` and `origin` is answering
the question MuPDF already answered, from the same inputs — two opinions about
what a line is, which is exactly the drift Part E2 describes and this ADR's whole
argument against a clusterer.

**A post-pass that transforms the text MuPDF already grouped is not.** Unicode
normalisation for comparison, case folding, joining a hyphen across a break the
engine's own `dehyphenate` does not close: these consume the grouping rather than
re-deriving it, and none of them can disagree with MuPDF about structure because
none of them looks at where anything is.

**So the test is one question — does it read a coordinate?** — and it is
checkable rather than a judgement, which is the property this ADR chose over an
algorithm in the first place. `TextLine.box` and `TextLine.origin` exist for
highlighting and hit-testing, both of which convert through `PageTransform`; a
module that reads either **to decide what belongs with what** is the violation.

### What to do when the engine's answer is genuinely wrong

In order, and the local re-derivation is last rather than first:

1. **An option**, scored against the corpus. This is the tuning Stage 5 inherits.
2. **A recorded engine gap** — the same route `docs/ARCHITECTURE.md` §3.2 already
   requires when MuPDF's API lacks a needed write: name what was checked and what
   is missing, in an ADR, so the matrix stays truthful.
3. **A re-derivation, behind one interface, with an ADR** — the shape §3.2
   reserves for a hand-rolled content-stream parser: *"permitted only after
   normalization provably fails a corpus case, and then quarantined behind one
   interface"*. The same bar applies here, and *provably* means a corpus case,
   not an example.

**This addition settles nothing about whether Stage 5 needs any of that.** It
settles what the answer would have to look like, so the question arrives with a
test attached rather than as an argument in the commit that wants the feature.

## Addition, 2026-09-02 — the measurements above were taken through a path the product does not use, and they reproduce

The readings in this document were taken through `mz_stext_json`, an export of
our C shim, over koffi. **The product does not use that path and never did**:
`pageText.ts` reaches the same MuPDF serialiser through the npm `mupdf`
package's `toStructuredText(options).asJSON()`. So the evidence for a decision
about what the product's text substrate does came from a neighbouring path —
which K.0's own logic condemns, since the two paths encoded the option set
differently (an `int` flag word against an option string) and nothing compared
them.

That second encoding is now deleted. `mz_stext_json` is gone from the shim,
`STEXT_FLAGS` is gone from `textStructure.ts`, and `STEXT_OPTIONS` holds MuPDF's
option **names** — so what this application asks for is one string composed from
one set, and adding `table-hunt` is a single edit (B5 rather than a paragraph
telling a reader to keep two literals in step).

**The spike was re-pointed at the product's path and every reading reproduced**,
run 2026-09-02, npm `mupdf` 1.28.0 against the shim's MuPDF 1.28.0 — the same
engine version, which is what made the move a re-measurement rather than a
different experiment:

| fixture | default | `segment` | `segment,table-hunt` |
|---|---|---|---|
| two columns, 268pt gutter | row-major, 5 blocks | **COLUMN-major**, 10 blocks | row-major, 11 blocks |
| two columns, 60pt gutter | row-major, 5 blocks | **COLUMN-major**, 10 blocks | row-major, 11 blocks |
| single-column prose | 5 blocks, 5 lines | unchanged | **11 blocks, 10 lines** |

The shipped parser's scores are unchanged too: `lines 1.00 / order 0.78` with no
options, `1.00 / 1.00` under `segment`.

**So the conclusion stands and its evidence is now about the right thing.** The
distinction is worth keeping even though the numbers agreed: they agreed because
both paths call `fz_print_stext_page_as_json` in the same engine build, and
nothing in the original reading established that — it was assumed. A version
skew between the shim and the package would have made the table describe a
structure the product never sees, silently, and no check in this repository
looks for that.
