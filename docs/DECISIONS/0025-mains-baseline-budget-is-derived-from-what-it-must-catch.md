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

---

## Note, 2026-08-27 — `mupdf-host`'s cost is now MEASURED, and `base 128 MB` fails this ADR's own rule

This ADR left `mupdf-host` alone because *"nobody has named"* the smallest thing
its baseline must catch. Half of what was missing is now measured, and it settles
more than expected: **the number is not merely underived, it is too generous by
this ADR's own arithmetic.**

**The honest fixed cost**, read 2026-08-27 from **outside** the process — the
parent reading `WorkingSet64` of the child, because a host reporting on itself is
the shape `hostContainment.mjs` records as unsafe for exactly this subject:

| cell | reading |
|---|---|
| bare Node, same binary, doing nothing (control) | **52.7 MB** |
| `hostEntry.js`, connected, before any document | **93.6 MB** |
| the engine's share | **40.9 MB** |

The engine's share is **0.78× the runtime**, which is what §9.17 asks for — *"a
fraction of the runtime's, not a multiple of it"*. That half of the argument
holds and is now evidence rather than assertion.

**The window does not.** `base 128 MB` leaves **34.4 MB** of slack above the
honest cost, so it can only detect a regression of at least that size. The
concrete candidates are all far smaller:

| a thing the host has no business loading | measured |
|---|---|
| `koffi`, an FFI the host does not currently use — its transport is plain Node | **2.9 MB** |
| the kernel barrel, after ADR-0026 | **9.6 MB** |
| a second binding of the engine itself | ~41 MB |

Only the last is caught. **That is `main`'s `96 MB` defect again** — a baseline
wide enough to hide the thing it was written for, reading as a working limit —
and it is the failure mode this ADR exists to correct.

**What is NOT concluded, because the next step is a decision rather than a
measurement.** Applying the rule literally gives a window of roughly
(93.6, 96.5) MB against the smallest candidate, which is **tighter than the
variance this project has already measured on one machine** — `main` saw a >4 MB
inter-run swing, and ADR-0025 deliberately left slack to absorb it, on the
grounds that *a baseline that reddens on ordinary variance is a check people
switch off*. So the window may be **empty**: no single number can both survive
variance and catch a 2.9 MB regression.

If that is so, the honest conclusion is not a smaller number — it is that **a
baseline is the wrong detector for this class in this role**, and what catches
`koffi` arriving in the host is a reachability check like `proof:kernelload`,
which is exact and variance-free. That is a decision for the owner and is named
here rather than taken.

**Two limits on the reading itself.** It is one machine and one run. And it is a
**current** working set where the budget is enforced against a **peak** — peak is
never lower, so the true honest cost is ≥ 93.6 MB and the real slack is ≤ 34.4 MB.
Both errors run in the direction that makes the finding stronger, which is why it
is recorded now rather than held for a better instrument.

### Addition, 2026-08-27 — the window is NOT empty, and the ratio is the noisier statistic rather than the safer one

The note above named its own missing half — *one machine and one run* — and made
the emptiness question turn on a variance figure measured on **`main`**, a
different process running a different workload. That was item 5's asserted
column. It is measured now, on the host itself.

**The probe is tracked this time, and that is the first finding.**
`scripts/research/hostFixedCost.mjs` and its child. The instrument that produced
the table above was a scratchpad throwaway and no longer exists, so its two
numbers could not be re-derived by anyone — including their author, one day
later, which is how the replacement came to be written. **A measurement that
decides something is an instrument, and an untracked instrument has an expiry of
one session.** The new one takes its control in the same run, and refuses to
report at all unless it first recovers a known 8 MB difference between two
control cells — because *the readings agree* is this instrument's reassuring
answer, and a spread of zero is what an instrument that cannot see also reports.

**Two runs of fifteen paired readings, 2026-08-27, resolution test passing in
both (7.9 MB and 10.7 MB recovered of 8 MB):**

| statistic | run A | run B |
|---|---|---|
| host, median | 69.9 MB | 70.1 MB |
| **host, spread** | **3.1 MB** | **2.9 MB** |
| control, median | 43.6 MB | 43.6 MB |
| control, spread | 8.6 MB | 8.7 MB |
| engine's share, spread | 8.7 MB | 11.5 MB |
| ratio, median | 0.60× | 0.60× |
| **ratio, spread** | **0.35×** | **0.42×** |

**The host's own variance is ~3 MB, so by the criterion set for it the window is
not empty and this is a number problem rather than a shape problem.**

**And the proposed remedy runs the wrong way.** The reasoning for preferring a
ratio was that *"an absolute must absorb machine and run variance; a ratio
measured against a bare-node control taken in the same run cancels most of it"*.
Measured, the ratio is roughly **three times noisier** than the absolute. The
mechanism is that cancellation needs **common-mode** noise: the host cell and the
control cell are different programs whose fluctuations are not correlated, so
subtracting one from the other **adds** variance rather than removing it. A
control cancels a machine's contribution only where both readings share it.

**What else is different about the odd point** (AAAA-8's tell, asked before
concluding): the control's 8.6 MB spread is not spread at all — it is one cold
reading. The **first** paired control is 37.6, 37.7 and 37.7 MB across three
separate sessions of the probe, and every later one sits at 43.5–46.4. Excluding
the first reading the control's range is ~2.9 MB, the same order as the host's.
So the honest statement is that both cells are stable once warm, and the ratio's
extra noise is real but concentrated at the start of a run. **Dropping a first
reading is a decision, not a measurement**, so both figures are given above and
neither is presented alone.

**One thing is NOT reconciled and is not glossed.** The absolute figures here —
host ~70 MB, control ~43.6 MB — sit about 20 MB below the 93.6 MB and 52.7 MB in
the table above, and both cells moved together. Two probes, two readings, and no
explanation established; the difference is methodological rather than noise,
since the spread within either instrument is a few MB. **The spread is the
quantity this addition claims, and it is a within-instrument figure that survives
whatever systematic offset separates the two.** The absolutes above are left
standing rather than replaced, because an ADR is a record; the way to settle
which is right is to run the tracked probe, which is now possible.

---

## Note, 2026-08-27 — the runner's clean baseline is waiting on an event that SUCCESS PREVENTS

This ADR says *"what would close it is the runner's clean baseline being printed
by some run"*, and the section above says why the figure is unreadable: job logs
answer 403 without owner authentication, and annotations carry a step's output
only when it fails.

Both halves are still true, and read together they say something the sentence
does not: **no passing run will ever print it.** Confirmed from
`scripts/ci/annotate.mjs` rather than from the prose — it emits `::error` on a
non-zero exit and on a spawn that failed, and **nothing at all on success** —
while its own header records that annotations *are* public at
`/repos/{owner}/{repo}/check-runs/{id}/annotations`.

So the closing condition can be met by exactly one thing today: `perf:gate`
**failing** on the runner, which would carry its tail — including the baseline —
into a public annotation. The condition is waiting on the outcome nobody wants,
and *"take it the first time a run makes the figure available"* is therefore not
a strategy that terminates.

**This is the reassuring answer wearing yet another costume.** A green board is
what withholds the measurement; the state everyone is working toward is the state
in which the number stays unreadable.

**The fix is small and is not taken here**, because it changes what CI emits and
that is the owner's: have the gate emit its figures as a `::notice` on success as
well, or write them to a public artefact. A blanket success-notice in
`annotate.mjs` is the wrong shape — every annotated step would emit one, and
GitHub caps annotations per run, so real error annotations would be crowded out
by routine ones. Narrow it to the gate that owns the figure.
