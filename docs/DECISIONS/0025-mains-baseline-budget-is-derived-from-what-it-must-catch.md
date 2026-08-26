# ADR-0025 — `main`'s baseline budget is derived from what it must catch, and 96 MB was not

**Date:** 2026-08-26
**Status:** accepted
**Amends:** `docs/ARCHITECTURE.md` §9.17 — the machine-read budget line's `base`
term for `main`.
**Supersedes nothing.**
[ADR-0007](0007-memory-budgets-and-the-document-size-ceiling.md) established the
per-process budgets and
[ADR-0012](0012-memory-budgets-are-machine-read-from-the-invariant.md) made them
machine-read; both stay correct. This changes one number and gives every baseline
a derivation.

---

## The decision

**`main`'s baseline budget becomes `base 80 MB`, and the rule that produced it is
written down:**

> A baseline budget sits **above** the honest measured fixed cost of every role
> it governs, and **below** that cost plus the smallest thing the term exists to
> catch. A budget outside that window is not a loose limit — it is a limit that
> cannot fail for the reason it was written.

§9.17 already argues the first half. The second half is new, and it is the half
that was missing when a native library got inside `main`'s fixed cost and the
budget passed.

---

## Why now: an invariant-20 exposure passed the budget on one machine

`engineSessions.ts` was written `import { type X } from './documentCommands.js'`,
which under `verbatimModuleSyntax` keeps the statement and emits
`import {} from './documentCommands.js'`. That module imports `declaredSpecs` as
a value, so the kernel barrel — and with it `mupdfWriter` and the statically
linked MuPDF library — loaded in every process that loaded the supervisor,
including `perf:gate`'s `main-service` role, whose whole job is measuring `main`'s
fixed cost.

**Measured, both directions, both machines available.** `perf:gate`'s reported
`main-service` baseline:

| | with the barrel loaded | clean |
|---|---|---|
| `windows-latest` runner, CI run at `9c7f078` | **92.0 MB** — passed `base 96 MB` | not read |
| this machine, 2026-08-26 | **98.1 MB / 98.6 MB** — `OVER`, gate FAILS | **63.4 MB / 63.5 MB** |

So the same defect **breaches the budget here by ~2 MB and passes on the runner
by ~4 MB**. That is this repository's build-dependent shape again, and it makes
the requirement stronger rather than weaker: a limit that catches a regression on
some machines and not others is one no reader can rely on, and — unlike a limit
that always fails — it cannot be dismissed by testing a single machine.

What went red on the runner was not the budget. It was
`proof:perfbudget`'s H2 control, which re-measures with the declared baseline
tightened by 4 MB and requires the gate to refuse; with the library loaded, two
measurements of the same role differed by more than that. **An invariant-20
exposure was caught because a control is variance-sensitive.** That is luck, and
luck is not a term in a budget.

---

## Why 96 was the wrong number, and it is not the reason either of us guessed

Two possibilities were on the table: that 96 was measured against a clean `main`
and is simply generous, or that it was measured against a `main` that already
loaded the barrel — the second being a budget fitted to the defect, the shape
[ADR-0010](0010-native-mupdf-through-an-ffi-shim.md) was corrected for.

**Neither. It was argued, and never measured at all.** The commit that introduced
the term, `752679e` (2026-08-18), says so in its own message:

> The budgets are argued rather than fitted, as the invariant requires: main runs
> the language runtime and nothing else, so its fixed cost should be within a
> small factor of a bare interpreter and more means it is loading something it
> has no business loading

That argument is right and it has no number in it. *A small factor of a bare
interpreter* is a criterion, not a measurement, and nothing recorded what a bare
interpreter cost on the day it was written — so nothing downstream could tell
`96` from any other number satisfying the same sentence. **B6 unmet, in the
section whose own two paragraphs above the line say a baseline is *measured,
never assumed*.**

The measurements that were missing, taken 2026-08-26 on this machine by
`scripts/research/barrelCost.mjs` (peak RSS of a bare Node process, then the same
process importing one built module):

| | |
|---|---|
| bare Node | **55.0 MB** |
| `+ capabilityRegistry.js` | 56.8 MB (+1.8) |
| `+ documentService.js` | 63.3 MB (+8.3) |
| `+ mupdfWriter.js` — the anchor, it binds the library at module scope | 94.2 MB (**+39.2**) |
| `+ commandBus.js` | 95.6 MB (+40.6) |
| `+` the kernel barrel | 103.8 MB (+48.8) |

Against those, `96` is bare-plus-41 — which is, to within a megabyte, **bare plus
the barrel**. That coincidence is why the fitted-to-the-defect reading was worth
testing rather than dismissed, and the commit message is what refutes it. It is
also why the number is dangerous: whatever produced it, it landed exactly where a
`main` that had loaded the engine would sit.

---

## The derivation, stated so the next value is not argued from scratch

Roles governed by the `main` budget, clean, measured on this machine:

| role | baseline | what it is |
|---|---|---|
| `main` | 56.0 MB | a model of main — reads, hashes, holds; constructs no service |
| `main-service` | 63.5 MB | the real `DocumentService` through the production reader |

The smallest thing the term must catch is the native binding: **+39.2 MB**.

> **NOTE, 2026-08-26 — that sentence names one of THREE classes and calls it the
> smallest, and only one of the three has a measured size** (finding FFFF-3,
> raised in review of this ADR). §9.17 names what the baseline term exists to
> catch: *"an engine that begins preloading fonts, a cache warmed at startup"* —
> and the native binding. **The binding is the only one anybody has measured.**
> Nothing makes a warmed cache or a font preload ≥ 39.2 MB, so the derivation
> above is sound for the class it used and does not establish the general
> property this ADR's title claims.
>
> **What `base 80 MB` therefore does and does not catch**, stated as a limit
> rather than left implied: against this machine's honest floor of 63.5 MB it
> leaves roughly **16.5 MB of slack**, so a fixed-cost regression smaller than
> that passes here. On the runner the slack is larger and **unknown** — its clean
> baseline is bounded at ≤ 80 MB by a passing gate and has never been read — so
> the figure there cannot be stated at all.
>
> **The number is not lowered, and the reason is a rule of its own.** The slack
> also absorbs a machine-to-machine swing measured at more than 4 MB and whatever
> legitimate growth `main` is entitled to; a baseline that reddens on ordinary
> variance is a check people switch off, which is a worse outcome than one that
> misses a small regression. So this is the same move made for `mupdf-host`'s
> ceiling in the section below — an unfinished derivation named as unfinished
> rather than a criterion quietly widened to fit what was done.
>
> **What would close it** is the runner's clean baseline being printed by some
> run, at which point the slack is known on both builds instead of one — the same
> gap this amendment closed one level up, arriving one level down.

- **Floor**: above 63.5 MB, the largest honest measurement, or the gate fails on
  correct code.
- **Ceiling**: below 63.5 + 39.2 = **102.7 MB** here, and below the runner's
  equivalent. The runner's clean figure is not read, but its with-barrel figure
  is 92.0 MB, so its ceiling is **at most 92.0** — a budget at or above that
  cannot catch this on the runner, which is exactly what happened.

**80 MB** sits inside both: 16.5 MB of headroom above the largest honest
measurement, and 12 MB below the smallest measurement that must fail. Against
§9.17's own criterion it is 1.45× a bare interpreter, which is a small factor.

**The ceiling is the half that was missing, and it is the half that binds.** A
baseline budget has an upper bound as well as a lower one, and the upper bound is
a property of the regression it exists to detect — not of how much slack feels
comfortable.

---

## What this does NOT claim

- **It is not a measurement of the runner's clean baseline.** That figure is not
  readable from the building seat: job logs answer 403 without owner
  authentication, and annotations carry a step's output only when it fails. The
  runner ceiling above is derived from its *with-barrel* figure, which is a real
  reading, and is therefore an upper bound rather than the number itself.

  > **NOTE, 2026-08-26 — the amendment's own CI run bounds it, and that is a
  > reading rather than an inference.** `perf:gate` passes when
  > `baselineBytes <= budget.baselineBytes`, so `e94e6c5` going green on
  > `windows-latest` says the runner's clean `main-service` baseline is **at most
  > 80 MB**. Still not the figure — a pass is a bound, and this one is the
  > declared value by construction — but it closes the direction that mattered:
  > the floor chosen from this machine's 63.5 MB does not fail on the runner.
  > Recorded because the sentence above says the figure is unreadable, and a
  > reader would otherwise not notice that the green board answers half of it.
- **It does not explain the >4 MB swing** between two measurements of the same
  role on the runner. Loading a statically linked engine is a plausible source
  and it was not isolated. The amendment does not depend on it: with the budget
  inside the window, the budget refuses the regression and no control has to be
  variance-sensitive for the defect to be seen.
- **It does not change `mupdf-host`'s `base 128 MB`.** That role's honest cost
  legitimately includes the engine, so the rule above needs a different "smallest
  thing it must catch" for it, and nobody has named one. Left as it is, and named
  here as unfinished rather than silently blessed.

---

## Rejected alternatives

| alternative | why not |
|---|---|
| **Leave 96 and rely on `proof:perfbudget`'s H2 control** | It caught this by being variance-sensitive, on one machine, in one direction. A detector whose sensitivity is noise is one that stops detecting the day the noise falls — and it reports as a *proof* failure, not as a budget breach, so the reader is pointed at the instrument rather than at the regression. |
| **Set the budget to the measured value plus a small epsilon** (say 66 MB) | Fitting the limit to today's measurement. Every legitimate addition to main then reddens the board, and the pressure is to raise the number by whatever the addition cost — which is how a budget becomes a record of what happened rather than a limit on it. |
| **Make the budget a multiple of a bare-interpreter measurement taken at run time** | Attractive, and it removes the constant. Rejected because it makes the limit depend on a second measurement taken in the same disturbed environment — the two would move together, which is the *exact* blindness §9.17 gives the baseline term to avoid in the ratio. A budget must be a number decided when nothing is under measurement. |
| **Add a separate check that main loads no native binding** | This is the right thing and it is not an alternative to this one. It is [`proof:kernelload`](../../scripts/proofs/kernelLoad.proof.mjs)'s neighbourhood, its subject is `documentService.js`, and widening it is ordinary work. The budget still has to be a limit that can fail; a second detector does not repair a first one that cannot. |
| **Record the derivation and leave the number** | Half the finding. B6 is unmet either way, but the number would still be outside the window on the runner, so the section would document a limit it also shows cannot work. |

---

## Consequences

- `MAIN_DOCUMENT_BYTES_CEILING` is main's absolute cap **minus** its declared
  baseline, so it grows by 16 MB. `proof:composition` recomputes it from the
  invariant and needs no edit; the number it asserts moves with the line, which
  is that proof's whole design.
- `perf:gate` and `proof:perfbudget` read the line and need no edit.
- The prose-restatement rule in `check:docs` still applies: §9.17 states the
  value once, in the machine-read line, and the paragraphs above argue it without
  repeating it.
