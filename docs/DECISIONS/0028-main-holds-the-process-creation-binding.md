# ADR-0028 — `main` holds the process-creation binding, and §9.17's `main` clause is amended to say so

**Date:** 2026-08-28
**Status:** accepted. Per B4 the amendment to `docs/ARCHITECTURE.md` is the next
commit and the wiring the one after it, so the law states the superseded clause
for exactly one commit. That is the ordering working, not a gap.
**Amends:** `docs/ARCHITECTURE.md` §9.17 — the baseline **argument** for `main`.
No budget number changes and the machine-read line is untouched.
**Supersedes nothing.**
[ADR-0022](0022-the-engine-host-is-a-process-we-create.md) requires what this
permits. [ADR-0025](0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md)
established that a baseline carries a derivation; this adds a term to `main`'s.
**Corrects** [ADR-0023](0023-how-the-contained-engine-host-is-built.md)'s note of
2026-08-27, which decided this question as a note rather than as a B4.

---

## The decision

**`main` legitimately holds the binding it needs to create a contained engine
host, and §9.17's argument for `main`'s baseline is amended to say so rather
than being worked around.**

The clause today reads:

> `main` runs the language runtime and nothing else, so its fixed cost should be
> within a small factor of a bare interpreter, and anything more means it is
> loading something it has no business loading. `mupdf-host` also carries the
> FFI binding and the statically linked engine…

It becomes, in the amendment commit:

> `main` runs the language runtime and the foreign-function binding it needs to
> create a contained engine host — `kernel32.dll` and `advapi32.dll`, and
> nothing else. Its fixed cost should be within a small factor of a bare
> interpreter plus that binding, and anything more means it is loading something
> it has no business loading. `mupdf-host` carries the same binding **and** the
> statically linked engine…

Three properties of that wording are deliberate:

- **The permission is bounded by the libraries it names, not by intent.** *"The
  binding it needs"* alone is a hole the next reader widens by arguing about
  need. Two library names are a set somebody can be wrong about in public.
- **`mupdf-host`'s clause stops being exclusive and stays true.** It said the
  host *"also"* carries the FFI binding, where *also* meant *in addition to the
  runtime*; read against `main`'s clause it acquired a second meaning — *and
  `main` does not* — which is the half of a compound claim that goes stale
  without looking wrong.
- **Invariant 20 is untouched and this ADR must not be read as loosening it.**
  What `main` may load is the operating system's own libraries through an FFI
  loader. MuPDF in `main` remains forbidden by name, and
  [ADR-0026](0026-a-declaration-is-not-an-implementation.md)'s subpath rule is
  what keeps the kernel's public surface from dragging it there.

The surface is imported **statically**. The deferral this replaces is priced
below.

---

## Why this is a B4 and not a spelling choice

Two things the law already says cannot both hold once the composition root
builds a host.

**§9.17 assigns the FFI binding to `mupdf-host` by name**, and does it inside
the sentence that is the stated argument for `main`'s number. The budget is not
an arbitrary limit with a rationale attached; the rationale is what derives it
([ADR-0025](0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md)),
so weakening the argument silently is weakening the budget silently.

**ADR-0022 makes `main` the process that creates a contained host.**
`utilityProcess.fork` cannot produce an AppContainer, so the host is a process
we create with `CreateProcessW`. Creating it requires Win32, and Win32 here
requires `koffi` at module scope in all three adapter modules —
`apps/desktop/src/win32HostSurface.ts`, `win32PipeSurface.ts` and
`win32DirectorySurface.ts`.

Neither statement is wrong. They were written eleven days apart about different
subjects and they have never met, because **nothing in `main`'s startup graph
imports any of the three surfaces yet**. The wiring is what introduces the
first meeting, which is precisely B4's trigger: a feature that cannot be built
by registering into an existing seam.

---

## What is in `main`'s graph today, read rather than assumed

| module | what it reaches | how established |
|---|---|---|
| `apps/desktop/src/entry.ts` | `composition.js`, `main.js`, `electron` | its three import statements |
| `apps/desktop/src/composition.ts` | `@monstera/kernel`, `@monstera/contract`, six local modules | its import block; no `win32*Surface` among them |
| `apps/desktop/src/main.ts` | `electron` and three local modules | same |
| `apps/desktop/src/readerHostSurface.ts` | `win32PipeSurface.js` **as a value** | the only value importer of any surface, and nothing in the startup graph imports it |
| `apps/desktop/src/engineReaderChannel.ts` | `win32PipeSurface.js` **as a type only** | see below |

That last row is the one worth reading from the emitted file rather than from
the source, and it was. `engineReaderChannel.ts:6` spells
`import type { StopEvent }`, and line 1 of `apps/desktop/dist/engineReaderChannel.js`
is `import { err, ok } from '@monstera/shared';` — the specifier is gone.

The near-identical `import { type X } from …` is **not** elided under
`verbatimModuleSyntax`: it emits `import {}`, keeps the side effect, and is how
38.1 MB of MuPDF got inside `main`'s measured baseline
([ADR-0025](0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md)).
The two spellings differ by one word and the difference is invisible in a diff,
so the claim is made from the build output.

---

## The measurements

### 1. What the surface would cost `main`

From [ADR-0023](0023-how-the-contained-engine-host-is-built.md)'s note of
2026-08-27, peak RSS over a bare process, one spawn per cell:

| cell | over bare | marginal over `composition.js` |
|---|---|---|
| `koffi` alone | +2.4 MB | — |
| `win32HostSurface.js` | +2.7 MB | +1.0 MB |
| `engineHostConnection.js` | +10.1 MB | below resolution |
| `composition.js` | +10.5 MB | — |

**Provenance, stated because it is a weakness rather than a footnote: those four
cells came from a scratchpad probe that was not tracked and no longer exists.**
The figures cannot be re-derived by anyone, including their author. That is
verbatim the failure `scripts/research/hostFixedCost.mjs` was written to stop
recurring — *a measurement that decides something is an instrument, and an
instrument that is not tracked has an expiry of one session* — and it recurred
one day later.

**So this decision is deliberately built not to turn on that number.** Every
comparison below uses the surface's **absolute** cost over bare, 2.7 MB, as the
price of putting it in `main`. That is an upper bound on the marginal by
inspection — a module added to a larger graph can share more of what it pulls,
not less — and the conclusions hold at 2.7 as they do at 1.0. What is owed is a
tracked cell, in the wiring commit; what is not owed is a decision waiting on
it.

### 2. What an extra process costs, if creation moves out of `main`

Measured 2026-08-28 on this machine, `node scripts/research/hostFixedCost.mjs --runs 3`,
peak working set read from the parent:

```
run   control      host      engine's share    ratio
  1     37.8 MB    89.3 MB     51.5 MB     1.36x
  2     43.7 MB    89.5 MB     45.8 MB     1.05x
  3     43.7 MB    89.3 MB     45.7 MB     1.05x
control  median 43.7 MB  spread 5.9 MB
```

The `control` cell is the price of the helper: the pinned binary in Node mode,
doing nothing. **43.7 MB.** The instrument passed its own resolution test in
the same run — bare 37.8 MB against a deliberately +8 MB cell at 45.9 MB,
recovered 8.1 MB — so it is reporting a difference it has just been shown able
to see.

### 3. What the budget can resolve

The between-invocation drift of these baselines is **4.8–5.8 MB across hours**
against 0.2–0.3 MB within one invocation, measured by
`scripts/research/baselineSpread.mjs` and recorded in ADR-0025's WWWW-1
correction.

So a 2.7 MB term sits **below the noise the budget already absorbs**. The
consequence cuts both ways and both halves matter: the budget cannot object to
holding the binding in `main`, and it cannot reward deferring it either. The
term is not the mechanism here, and saying so is the point — a number that
cannot resolve a question must not be cited as though it had.

---

## The three options, priced

### 1. `main` holds the binding, imported statically — **chosen**

Costs `main` at most 2.7 MB of fixed footprint, permanently. Keeps the creation
path synchronous and single-process, which is what ADR-0023 Decision 8's
ordering was specified and unit-tested against.

The objection, stated rather than answered: this is a real relaxation of an
argument, and the fact that it is 2.7 MB inside a 5.8 MB drift band does not
make it *free* — it makes it **undetectable**, which is a different and worse
property. The bounded library list is what stands in for the detector until one
exists.

### 2. Bind lazily, at first host creation — **rejected, and the honest reason is that nothing can hold it**

The deferral is real: `main` would pay nothing until the first document opens.
It does not survive the measurement, for three reasons found by reading the
instruments rather than by preferring an answer.

- **It defers past startup, not past the first open.** ADR-0023's correction of
  2026-08-27 established that a session is created at **open**, and under
  Decision 9c's one-host-per-engine shape the shared host is built the first
  time a session needs one. So the deferred cost lands at the first document.
- **Every role the budget gate measures runs against a document.**
  `baselineFor` in `scripts/perf/budgetGate.mjs` measures a role by running it
  against a trivially small document, so a baseline is by construction taken in
  the state where the deferral has already ended.
- **And today no role measures the composed `main` at all.**
  `scripts/perf/roleMain.mjs` is a model that imports no application module, and
  `scripts/perf/roleMainService.mjs` constructs `DocumentService` directly and
  never imports `composition.js`. Neither the static import nor the deferral is
  visible to `perf:gate` as it stands.

What the deferral buys is the state where the application is running and no
document has been opened. That is a real state and no instrument observes it.
An unenforceable benefit bought with an asynchronous seam in the creation path
is complexity with a rationale attached, and this project's standing test —
*could this compensation have been printed before you made your change?* — is
failed by any argument for it.

### 3. Process creation moves to a Node-mode helper, per ADR-0024 — **rejected on price and on where it leaves the binding**

[ADR-0024](0024-execution-mode-is-a-placement-axis.md)'s placement axis is
genuinely satisfied by this: a helper that only creates processes runs in Node
mode, lives outside `apps/desktop/`, and leaves `main` literally as §9.17
describes it. It is the option that requires no amendment at all, which is why
it is priced rather than dismissed.

It costs **43.7 MB of resident memory to avoid at most 2.7 MB** — measured
above, in the same run, on the same machine. Roughly sixteen times the cost of
the thing it removes, before counting the hop, the second process to supervise,
and a third trust boundary in a design that already has two.

**And it does not remove the binding from the system.** The helper needs
`koffi` exactly as `main` would; the FFI moves into a process §9.17 does not
name, so it stops being budgeted rather than becoming correctly placed. Trading
a term the law can be amended to state for a term no document mentions is worse
by this project's own standard, and the 43.7 MB is what one would pay for it.

---

## Consequences, including the unpleasant ones

- **`docs/ARCHITECTURE.md` states the superseded clause for one commit.** That
  is B4's ordering and it is deliberate. The amendment commit is next and
  carries the amendment-log row.
- **A second amendment to the same paragraph is already owed** — the
  *"a fraction of the runtime's"* clause and `base 96`'s outcome, carried since
  ADR-0025's WWWW-2 consequence. Two amendments in flight against one paragraph
  is how a clause gets restated twice in different words; **whichever lands
  second reads the other first**, and if they land together the commit says so.
- **The relaxation is invisible to `perf:gate`.** No role measures the composed
  `main`, so this amendment loosens an argument that no instrument was
  enforcing. That is not an excuse for the relaxation — it is the reason the
  bounded library list is part of the decision rather than a nicety.
- **The bounded list has no check yet.** Until one exists — a scan for what
  `main`'s module graph binds, against the two names — the clause is held by
  review, and review is what this project keeps proving does not hold a rule.
  Owed alongside the wiring.
- **The marginal figure is not re-derivable.** A tracked cell is owed in the
  wiring commit, for the reason `hostFixedCost.mjs` exists.
- **`main`'s baseline will move when the wiring lands**, by at most 2.7 MB and
  by an amount the drift band cannot separate from noise. A baseline reading
  taken across that commit measures two things, and the third reading with no
  event in it is what settles the size — the WWWW-1 lesson, applied in advance
  rather than after.

---

## Rejected alternatives

**Amend nothing and let the wiring introduce the import quietly.** This is the
option that requires no ADR and it is the one B4 exists to forbid: the clause
would go on being cited as the derivation of `main`'s budget while being false
about what `main` loads. A budget whose stated argument is wrong is worse than
one with no argument, because the wrong argument is what the next reader uses
to decide whether a regression is real.

**Reword §9.17 to drop the FFI from `mupdf-host`'s clause instead.** Rejected:
the host does carry it, and the sentence would become false in the other
direction. The defect was never that the clause named the host; it was that
naming one process read as excluding the other.

**Keep the argument and exempt the surface as "not really loading anything".**
Rejected on the measurement: `import koffi from 'koffi'` is at module scope and
the module's own header — *"nothing is bound at import time"* — is true of
`koffi.load('kernel32.dll')` and not of the import above it. An exemption
argued from that sentence would be an exemption argued from a comment whose
scope is narrower than it reads.

**Weaken the clause to a general permission — "and whatever bindings it needs".**
Rejected for the reason the bounded list exists: a permission stated as need is
settled by whoever is arguing, and the next binding arrives with a need.
