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

### Addition, 2026-08-27 — both offsets are explained, and the corrected ratio contradicts §9.17's own argument for the host term (finding PPPP-1)

**Axis 1, the quantity.** `hostFixedCost.mjs` read `WorkingSet64` — the *current*
set — while §9.17 is enforced against the peak, through `peakRss.mjs`'s
`process.resourceUsage().maxRSS` (`PeakWorkingSetSize` on Windows). Reading from
the parent is right and unchanged, for `hostContainment.mjs` step 3's reason; the
**quantity** was a second opinion about a question `peakRss.mjs` owns (B3a).
Fixed by adding `peakWorkingSetOf(pid)` there — `Get-Process … PeakWorkingSet64`,
the same kernel counter reached the other way. Every probe run now prints a
cross-check: parent **40.5 MB** against the child's own `maxRSS` **40.4 MB**,
agreeing to **0.2 MB**, and the run refuses to report if they diverge past 2 MB.

**Axis 2, the runtime, which the quantity fix did not touch.** The fix moved the
host **69.9 → 89.5 MB** and the control **43.6 → 43.7 MB**. A control that does
not move under a current→peak correction is one whose current set was already at
its peak, which an idle process's is; a host that moves 20 MB is one Windows had
been trimming. The remaining 9 MB therefore sat in the control alone, and
`--runtime` was added to make that reproducible. Measured, 4 runs against
`C:/Program Files/nodejs/node.exe`: control **54.0–54.3 MB**, host
**102.3–102.6 MB**.

**The note above was system Node, read as a current set.** 52.7 MB is within
1.3 MB of system Node's 54.0 MB peak, and 93.6 ≤ 102.3, with the host trimmed
8.7 MB against the idle control's 1.3 — the trimming mechanism, in the direction
it predicts. It is **inconsistent** with the pinned binary for the host: a current
reading cannot exceed the peak, and 93.6 MB exceeds every Electron-as-Node host
peak observed (max **92.2 MB** over 15 runs). The older figures are rescued
rather than discarded, and the **0.78×** they yielded was a subtraction across
two different runtimes.

**Withdrawn from the addition above:** *"both cells moved together"*. They did
not — 20 MB and 0.1 MB — and that asymmetry is what located axis 2.

**The corrected figures**, 15 paired readings against the pinned binary, which is
what ADR-0022 makes the host:

| | median | spread |
|---|---|---|
| control (bare runtime) | 43.7 MB | 5.9 MB |
| **host, connected, no document** | **89.5 MB** | **2.9 MB** |
| the engine's share | 45.8 MB | 6.1 MB |
| **ratio** | **1.05×** | 0.28× |

**§9.17 argues for the host term as *"a fraction of the runtime's, not a multiple
of it"*. At 1.05× it is not a fraction** — the engine's share is slightly larger
than the runtime it sits on. That clause is the stated basis for the term's
shape, and it is contradicted by the first matched-runtime measurement of it.
Reported, not acted on: §9.17's writer of record is `docs/ARCHITECTURE.md` and
moving it is a B4.

### The derivation for `mupdf-host`, run for the first time — and it does not yield one number

This ADR's rule is *floor above the largest honest measurement, ceiling below
floor + the smallest regression that must be caught*. Applied to the corrected
figures, with the two candidate regressions this document already carries at
lines 246–247:

| | floor | ceiling | window |
|---|---|---|---|
| against the kernel barrel, **9.6 MB** | > 92.2 MB | < 99.1 MB | **6.9 MB** |
| against `koffi`, **2.9 MB** | > 92.2 MB | < 92.4 MB | **0.2 MB** |

Floor is the largest observed host peak, 92.2 MB over 15 runs; ceiling is the
median 89.5 MB plus the regression.

**So the emptiness question has a per-class answer rather than one answer.** The
barrel-sized window is real but thin: 6.9 MB against a machine-to-machine swing
this project has measured at **more than 4 MB**, and the runner's own host
baseline has never been read — the same gap `main`'s derivation names above,
arriving one role down. The koffi-sized window is **empty**, and no choice of
number opens it, because 2.9 MB is below the run-to-run spread of the thing being
bounded.

**Proposed, for the owner: `base 98 MB`, scoped in §9.17 to the barrel-sized
class, with `koffi` moved to reachability.** 98 sits 5.8 MB above the largest
honest measurement, which covers the >4 MB swing, and 1.1 MB below the smallest
barrel-class regression that must fail. `proof:kernelload` already answers the
koffi question exactly and without variance — it is a reachability walk, and *is
this binding reachable* has no spread at all.

**The residual, stated rather than left implied:** 1.1 MB of ceiling margin is
thin, and on a machine whose host floor is more than 1.1 MB above this one the
budget stops catching the barrel class while still passing. That is the same
shape as `main`'s unread runner baseline and it closes the same way — by reading
the host's floor on the runner. **`base 128 MB` is wrong either way**: against
89.5 MB it leaves 38.5 MB of slack, four times the largest candidate it exists to
catch.

Moving §9.17 is a B4. Nothing here changes it.

### Correction, 2026-08-27 — the ceiling above mixes two statistics, and neither is the right one (finding RRRR-2)

**The internal contradiction first.** The paragraph above states the rule as
*floor + the smallest regression* and then computes the ceiling from the
**median**, saying so outright: *"ceiling is the median 89.5 MB plus the
regression."* Applied literally the rule gives 92.2 + 9.6 = **101.8**; the table
gives 89.5 + 9.6 = **99.1**. Both numbers are in one paragraph and neither
reconciles the other. `main`'s derivation at lines 147–149 has no such gap — it
uses 63.5 for the floor and 63.5 + 39.2 for the ceiling, the same figure twice.

**Neither statistic is right, and that is the substantive half.** The gate reads
**one peak per run** and compares it to the budget. A regression of `R` shifts
the whole distribution, so afterwards the readings run from `min + R` to
`max + R`. What each candidate ceiling buys:

| ceiling | value | catches the barrel class |
|---|---|---|
| the rule as stated, `max + R` | 101.8 MB | at the worst reading only |
| the table as computed, `median + R` | 99.1 MB | about half the time |
| **reliable, `min + R`** | **98.9 MB** | **every run** |

A check that reddens intermittently is a check people switch off, which is this
ADR's own stated reason for not lowering `main`'s number. So the reliable ceiling
is the only one worth having, and **the rule is corrected to `min + R`.**

**The floor is unaffected** and stays *above the largest honest measurement* —
92.2 MB — because a budget below it fails on correct code. The window for the
barrel class is therefore **(92.2, 98.9)**, 6.7 MB wide rather than the 6.9 above.

**`base 98 MB` survives all three ceilings, and its margin is smaller than
stated.** Against the reliable ceiling it is **0.9 MB**, not the 1.1 the section
above claims — and against a machine-to-machine swing this project has measured
above 4 MB, 0.9 MB is not a margin. The proposal stands as a proposal and the
number is not defended here.

**Where `min` comes from:** 15 paired readings, host peaks 89.3–92.2, median
89.5. `min` is a measured extreme of a small sample and is itself an estimate;
more readings can only lower it, which moves the ceiling down and the margin
toward zero.

### Correction, 2026-08-27 — `main`'s own baseline was derived with no spread measured (finding RRRR-3)

Line 48 records `main-service` clean at **63.4 MB / 63.5 MB**. Two readings are
not a spread estimate, and the corrected rule above needs a **minimum**. The host
now has fifteen readings; `main` has two.

**This is not a claim that `base 80 MB` is wrong.** Its headroom above 63.5 MB is
16.5 MB, wide enough that a minimum a little below 63.4 changes nothing about it.
The finding is that the gap found one role down exists one role up and was
unrecorded — and that the correction above raises a question about `main` that
its own derivation cannot answer from what is written.

**Cheap to close now that the probe exists.** Fifteen paired readings of
`main-service` through `hostFixedCost.mjs`, which already takes a bare-runtime
control in the same run. Owed, not done.

### Addition, 2026-08-27 — the runner's host floor is measured, and `base 98 MB` does not survive it

The binding half of `mupdf-host`'s derivation was unread, which is the mistake
this ADR records one role up: *a budget at or above the runner's number "cannot
catch this on the runner, which is exactly what happened."* It is read now.

**Fifteen paired readings on `windows-latest`**, from the same tracked probe, in
`ci.yml`'s `shim` job at `d91efa2`, emitted as a public `::notice` because
Actions serves logs only to the owner and a measurement's value is what it prints
on a **green** run:

| | this machine | `windows-latest` |
|---|---|---|
| host, median | 89.5 MB | **88.9 MB** |
| host, min | 89.3 MB | **88.6 MB** |
| host, max | 92.2 MB | **91.5 MB** |
| host, spread | 2.9 MB | **2.9 MB** |
| ratio, median | 1.05× | **1.06×** |

**The two machines agree far more closely than `main`'s did** — 0.6 MB between
the medians and the same 2.9 MB spread, against the >4 MB swing measured for
`main`. That is a fact about this role rather than a general one, and it is what
makes a derivation possible at all.

**The derivation, with both inputs and the corrected `min + R` rule:**

- **Floor** — above the largest honest measurement on either machine: **92.2 MB**.
- **Ceiling** — below the smallest minimum plus the barrel regression:
  88.6 + 9.6 = **98.2 MB**.
- **Window: (92.2, 98.2)**, 6.0 MB.

**`base 98 MB` is withdrawn.** It sits inside the window by **0.2 MB**, and a
ceiling margin of 0.2 MB is not a margin: one reading slightly lower on any
machine moves the ceiling below it, and `min` is a measured extreme of thirty
readings that more sampling can only lower.

**Proposed instead: `base 96 MB`** — 3.8 MB above the largest honest measurement
and 2.2 MB below the reliable ceiling. The margins are deliberately unequal and
this ADR's own rule decides which way: *a baseline that reddens on ordinary
variance is a check people switch off, which is a worse outcome than one that
misses a small regression.* So the floor side gets the larger share.

**The residual, stated rather than implied.** 2.2 MB of ceiling margin rests on
`R = 9.6 MB` for the barrel, measured once. If that regression class is ever
smaller than measured, the ceiling falls toward the floor and the window closes —
and the koffi-sized class at 2.9 MB has no window at all, which is why
`proof:kernelload`'s reachability answers that one and no baseline can.

**And the runner confirms §9.17's falsified clause on a second machine.** The
engine's share is **1.06×** the runtime there against 1.05× here. *"A fraction of
the runtime's, not a multiple of it"* is contradicted by both. The B4 that moves
this number carries that clause with it — one amendment, because they are the
same sentence and the same measurement.

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
