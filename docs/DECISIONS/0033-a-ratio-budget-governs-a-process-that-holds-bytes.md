# ADR-0033 — A ratio budget governs a process that holds bytes, not one that parses them

**Date:** 2026-09-01
**Status:** accepted 2026-09-01. **Restates `mupdf-host`'s budget in
`docs/ARCHITECTURE.md` §9.17**, keeping the absolute and the baseline and
withdrawing the multiple.
**Answers the gate that failed**, per `BUILD-PROMPT.md:680-682`: *"A failed gate
blocks Stage 1. The response is an ADR that either amends the architecture or
restates the budget with reasons — never 'note it and proceed.' A gate whose
failure path is unstated degrades into exactly that."*
**Evidence:** the readings in
[ADR-0025](0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md)'s
note of 2026-08-31, reproduced below.

---

## The problem, in one sentence

`mupdf-host`'s `6x` is exceeded by the real host on both content shapes it was
measured against, and no larger number is available, because §9.17 already
forbids one.

## What was measured

| shape | model asserted by `perf:gate` | the real host | absolute |
|---|---|---|---|
| image-heavy | 1.30x | **6.26x** | 1.34 GB |
| object-dense | 3.73x | **7.83x** | 284 MB |
| baseline, no document | — | — | 87.7 MB |

Two of those three terms **hold comfortably**. The absolutes are 1.34 GB and
284 MB against a 3 GB ceiling. The baseline is 87.7 MB against a 128 MB floor,
and it reproduces: `roleMupdfHost` read 91,496,448 bytes — 87.3 MB — for
connect-and-close with no document on a CI runner, against 87.7 MB here.

Only the **multiple** is breached, and it is breached on both shapes at once.

## The finding: a ratio is a statement about a process that HOLDS bytes

§9.17 argues `main`'s budget from *"main holds canonical bytes and never
parses"*, and that sentence is doing more work than it appears to. A ratio
against file size is meaningful precisely when the process's cost is a
**function of the file's size** — which is what holding a copy of it is. Main's
1.5x says *one copy, plus overhead*, and a breach of it is evidence of a
**second copy**. That is a specific, findable defect, and it is why the number
is enforceable.

The engine host does not hold the document. It **parses** it, and a parser's
cost is a function of the document's **content shape**, not its length. The two
readings above are the demonstration: the same ceiling produced 6.26x and 7.83x
on two documents, and the absolute costs behind those two ratios differ by a
factor of **4.7** in the opposite direction — the 6.26x document cost 1.34 GB
and the 7.83x document cost 284 MB. A budget whose two breaches disagree about
which document is expensive is not measuring the thing it is named for.

So `6x` was never a derivable number. §9.17 already says so — *"`mupdf-host`'s
ceiling is not yet derived, because the thing it must catch has not been
named"* — and this ADR's contribution is to say **why it cannot be derived in
that form**, rather than leaving it as a derivation nobody has got round to.

## What a breach is evidence of, which is the question ADR-0007 left open

ADR-0007 records that *"the founding record never says which process the budget
governs. That omission turns out to matter more than the number."* Carried
forward, the answer is per process and it is not the same answer twice:

| process | term | a breach is evidence of |
|---|---|---|
| `main` | 1.5x of file size | a **second copy** of the document in the process that must hold exactly one |
| `mupdf-host` | 3 GB absolute | a document whose parse **does not fit**, which is kill-and-restart (§9.17) |
| `mupdf-host` | 128 MB baseline | a **fixed cost** that grew — a library loaded, a cache warmed, a font set preloaded |

The middle row is the containment limit, and §9.17 already states its response:
*"a breach means kill-and-restart, never a raised number."* Nothing in that
sentence needs a ratio.

## The mechanism that already enforces it, and the one that never did

The absolute is not a number this repository asks a process to respect. It is
**set on the job object** — `JOB_LIMIT_PROCESS_MEMORY` with
`ProcessMemoryLimit`, applied at `createContainedHost` and, as of 2026-09-01,
**read back off the job** and refused if it did not take. Invariant 25(b) is
what makes the ceiling real: the kernel enforces it whether or not anything in
this repository is watching.

The multiple has no such mechanism and could not have one. A job object bounds
bytes; it has never heard of the file the document came from.

That asymmetry is the practical argument. One term is enforced by Windows and
observed by a proof; the other is asserted by a perf harness against a **model**
of the host rather than the host itself, which is how it came to read 1.30x
where the host reads 6.26x.

## Decision

**Restate the budget, with reasons.** `mupdf-host = 3 GB, base 128 MB`.

1. **The multiple is withdrawn** for `mupdf-host`, on the grounds above: it is
   not derivable in that form, it is not enforceable by the mechanism that
   contains the process, and its two breaches disagree about which document is
   expensive.
2. **The absolute and the baseline stand**, both measured, both holding, and the
   absolute enforced by the job object rather than by assertion.
3. **`main` is untouched.** Its ratio is meaningful for the reason the host's is
   not, and this ADR is the sentence that distinguishes them.
4. **`perf:gate` is not pointed at the real host by this ADR.** It asserts a
   model today; pointing it at the host is a separate change that must not be
   made while the term it would assert is the withdrawn one.

## The alternative, and why it is not taken

**Amend the architecture** — raise `6x` to something the readings clear — is the
other permitted outcome and it is refused twice over. §9.17 forbids it in terms:
*"a breach means kill-and-restart, never a raised number."* And it would fail on
its own merits, because 7.83x is not a ceiling either: it is the largest of two
documents, and the next document has never been measured. Fitting a bound to the
sample is how a placeholder acquires a second decimal place and no more meaning.

## What this does not settle, and what it gives up

**What is given up: amplification detection.** The multiple was the only term
keyed to **input size**, and therefore the only one that could catch a small
hostile document producing a large parse. After this restatement a **1 MB file
that parses to 2.9 GB clears every term** — under the absolute, and its baseline
untouched.

That is consistent with §9.17 calling this *"a containment limit"* rather than a
detector, and the 3 GB ceiling still protects the machine: the job object kills
the process at it either way. But it is stated here rather than left to be
discovered, because invariant 25's premise is that this host is **hostile
territory**, and a term that used to bound the ratio of output to attacker-chosen
input is exactly the kind of thing whose removal should be a decision rather
than an omission.

Whether the host needs a *different* second term — one keyed on something a
parser's cost actually tracks, object count perhaps — is open and is not
proposed here. Naming a term nobody has measured would repeat the mistake this
ADR exists to correct.

**Those two paragraphs are one gap seen twice.** A term keyed on object count is
the candidate that would restore amplification detection, because object count
is attacker-chosen in the way file size is and, unlike file size, is something a
parser's cost plausibly tracks. Neither is proposed until measured.

The **renderer** stays `provisional`, unchanged and out of scope.

## Reproducing

`npm run perf:gate` asserts the model. The real-host readings come from
`scripts/perf/roleMupdfHost.mjs`; the baseline figure above is that script's
`--no-document` run, whose CI reading is quoted in the table.
