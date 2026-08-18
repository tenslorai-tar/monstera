# ADR-0012 — The memory budgets are machine-read from invariant §9.17

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amends:** `docs/ARCHITECTURE.md` §9.17. The invariant's substance is
  unchanged — the same three budgets, the same arguments, the same withdrawals.
  What changes is where the numbers live and who may state them.
- **Context:** The Stage 0 performance budget assertion is about to be written.
  It needs limits. The question this ADR settles is where it gets them from.

## Decision

**§9.17 carries one machine-read line, and it is the only place in that section
the budget values appear.** The prose names each budget and argues it from what
its process is for; it does not repeat a value. The performance assertion parses
that line rather than defining constants.

```
> **Memory budgets:** `main = 1.5x, 1.5 GB, base 96 MB` ·
> `mupdf-host = 6x, 3 GB, base 128 MB` · `renderer = provisional`
```

> **Addition — 2026-08-18: the third term.** The entry grammar gained a
> `base <n> MB|GB` term after the gate was built. It is not a fourth kind of
> thing; it is a budget on the same process, and it exists because the first two
> terms cannot see a regression in it.
>
> The multiple is taken *above* the measured baseline, which is correct — a
> fixed cost in the numerator makes the ratio a function of document size rather
> than of behaviour. But it also means an inflated baseline raises the numerator
> and the subtrahend together: an engine that starts preloading fonts, or a cache
> warmed at startup, moves both and the ratio does not budge, while the process
> grows by hundreds of megabytes and the absolute cap says nothing until it is
> gigabytes late.
>
> For one commit the baseline was measured, subtracted, printed, and part of no
> verdict — which is the same defect as the H2 spike case that computed
> `acroFormGone` into a detail string and left it out of the pass expression.
> Bounding it costs one term per role on a line that already had the shape.

The shape is deliberately the one ADR-0007 already uses for its withdrawn
phrases: a blockquote, a bolded label, backticked entries separated by `·`. A
second notation for the same idea would be a second thing to learn.

**The parse fails loudly and has no default.** A missing line, an unknown budget
name, a malformed entry, a duplicate entry — each throws. Nothing in that path
yields a value. `renderer = provisional` parses successfully to *"declared, and
deliberately not assertable"*, which is different from absent and must not be
confused with it: a consumer asking for the renderer's limit gets a refusal
naming this ADR, not a number and not a silent skip.

**Scope: budgets only.** One line, one consumer, one section. This is not a
general mechanism for executable documents, and it should not grow into one —
the value here comes from the fact that a reader of §9.17 sees exactly what the
code enforces, and that property does not survive being generalised into a
format with options.

## Why the numbers cannot stay in prose

Because the check that protects prose does not reach code, and code is where a
withdrawn number does real damage.

The withdrawn-phrase mechanism built for finding 28 reads every tracked `.md`
file and fails the build when one states a phrase an ADR retracted. It is why
`~650 MB` cannot quietly reappear in a document. It scans documents only, so a
constant enforcing a retracted budget is invisible to it — and a constant is
worse than prose repeating one, because prose is read by a human who might
recognise it while a constant is obeyed by a machine that cannot.

Deriving removes the second statement rather than checking for it. The same
argument settled the ESLint ignore list the day before this ADR: a divergence
check keeps both lists and can only report the drift it was always going to
have.

## Rejected alternatives

**Extend the withdrawn-phrase scan to `.ts` and `.mjs`.** This was the obvious
move and it does almost nothing. The declared phrases are prose — `~650 MB`,
`admission gate`, `stream bytes × 3.7`, `machine-RAM table`, `renderer ≤ 2.5×` —
and matching is normalised-substring. Code does not look like that. A budget
constant reads `650 * 1024 * 1024`; an identifier reads `admissionGate`; a
multiplier reads `2.5`. None of them match.

The result would be a check whose file list says it covers code, which passes
because it finds nothing, and which is believed because it is green. Batch 6
closed four separate instances of exactly that shape — a stale `dist` resolution
excluded from *collection* and not from *resolution*, an entropy test asserting
uniqueness, a spike case grepping method names, an ignore list covering five of
sixteen paths — and this would have been the fifth, added on the same day, by
the person who had just closed the other four.

**Keep the numbers in prose and have the assertion cite §9.17 in a comment.**
The comment is not machine-read, so it is a promise rather than a mechanism. It
also leaves two statements of each number in the tree, and the entire point of
the invariant is that the budget is argued rather than fitted — which nobody can
check if the argued number and the enforced number are different strings.

**Put the budgets in a config file — JSON or TypeScript — and have §9.17 point
at it.** This inverts the authority. The invariant is the law; a config file
that the law defers to is a law that can be amended without a B4 amendment,
which is the exact control this repository exists to keep.

## Consequences

**§9.17 is now partly a machine format.** A careless edit to the declared line
breaks the build. That is intended, and it is also a real cost: the section can
no longer be reflowed or reworded freely, and anyone rewriting it must keep the
line's grammar. The blockquote and the note inside it exist to make that visible
to whoever is editing.

**A reader of the prose gets no numbers.** They must read four lines further to
the declared line. This is a genuine loss of local readability, accepted because
the alternative is two numbers that can disagree, and the disagreement is
silent.

**One more consumer of `docs/` at build time.** `scripts/lib/memoryBudgets.mjs`
joins `documentConsistency.mjs` and `withdrawnPhrases.mjs` in parsing tracked
documents. That is now three, which is the point at which this project has
previously said a class earns a mechanism — noted here so that if a fourth
appears, the answer is a shared document-parsing seam rather than a fourth
bespoke parser.

**The renderer budget stays unassertable, loudly.** `provisional` parses, and
asking for its limit throws. The failure mode this avoids is an assertion that
quietly skips the renderer and reports success for two processes out of three.
