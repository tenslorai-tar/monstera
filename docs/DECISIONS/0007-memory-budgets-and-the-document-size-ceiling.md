# ADR-0007 — Per-process memory budgets, and the measured document-size ceiling

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** `docs/ARCHITECTURE.md` §9 (invariants) and the Stage 0 exit gate
  recorded in `docs/FEATURES.md`.
- **Supersedes:** `BUILD-PROMPT.md` Part G's Stage 0 performance assertion,
  "assert peak RSS < 1.5× file size", as a single whole-application number.
- **Evidence:** measurements below, reproducible from `.probe/memoryProbe.mjs`
  and `.probe/ceilingProbe.mjs` (both gitignored — see *Reproducing* at the end).

## Context

Part G sets the Stage 0 performance gate at **peak RSS < 1.5× file size** on a
200 MB fixture, and states that a failed gate blocks Stage 1, to be answered by
an ADR that either amends the architecture or restates the budget — never by
noting it and proceeding.

The gate was measured before `DocumentService` was built rather than after,
because it constrains the shape of the engine seam. Building the kernel first
and discovering the memory model afterwards is the failure this project exists
to prevent.

The founding record never says **which process** the budget governs. That
omission turns out to matter more than the number.

## What was measured

Against `mupdf@1.28.0` (WASM), on hand-written fixtures with uncompressed
content streams so file size is a term the probe sets rather than one a
compressor decides. Peak RSS is sampled on a 1 ms timer, because the
allocations happen inside synchronous WASM calls that never yield to the event
loop — a before/after reading around `saveToBuffer` misses the peak entirely.

**160 MB document, one page rotated, full save:**

| Moment | RSS | × file |
|---|---|---|
| Runtime baseline — Node + MuPDF WASM, no document | 75 MB | — |
| After `openDocument(path)` | 478 MB | **2.99×** |
| Settled, all 320 pages touched | 279 MB | 1.74× |
| After `saveToBuffer` | 658 MB | **4.11×** |
| After copying the bytes out of the heap (K.1 requires this) | 818 MB | **5.11×** |

Of the 818 MB peak, 75 MB is fixed runtime and **743 MB (4.64×) scales with the
document**.

**Why**, read out of `node_modules/mupdf/dist/mupdf.js` and confirmed by the
numbers above:

1. `openDocument(path)` calls `node_fs.readFileSync` (lines 599, 651, 732,
   1461) and then copies the result into the WASM heap — two full copies of the
   file exist at once, which is the 2.99× spike.
2. The heap keeps its copy resident for the document's lifetime, because object
   loading is lazy and reads from it — that is the 1.74× floor.
3. Any save builds a **complete second image** of the document in the heap
   before returning.
4. `asUint8Array()` returns `HEAPU8.subarray(...)` — a *view*, not a copy — so
   the copy K.1 requires ("MuPDF WASM buffers are views into the whole heap —
   copy exact-size out") adds another 1×.

**Incremental save does not avoid it.** `canBeSavedIncrementally()` is `true`,
and an incremental save of one rotation appended exactly **201 bytes** to the
file and reopened correctly with `countVersions()` 1 → 2. But RSS still rose
444 MB during the call: the on-disk delta is small, and the in-memory
materialisation is not. Incremental save is worth having for reasons in
[ADR-0008](0008-save-mode-is-determined-by-purpose.md); it is not a memory
remedy.

**None of this is reachable from the main process.** It is MuPDF's cost,
wherever MuPDF runs.

### Content drives heap use, not file size

The ratio measured above is not monotonic — 3.70× at 200 MB, 4.31× at 400 MB,
3.21× at 657 MB — so before setting any budget as a multiple of file size, two
fixtures of the **same size and opposite content profile** were measured.

| Fixture | Size | Objects | Peak (production) | × file |
|---|---|---|---|---|
| Image-heavy — 17 pages, huge image XObjects | 405 MB | **53** | 1504 MB | **3.71×** |
| Object-dense — 141 pages, heavy annotation | 28 MB | **127,185** | 586 MB | **20.9×** |
| Object-dense — 2260 pages, heavy annotation | 464 MB | **2,038,522** | — | **FAILED** |

**The 464 MB object-dense document failed** — `realloc (80217856 bytes) failed`
inside `loadPage`, during the page *walk*. It never reached the save. A 657 MB
stream-heavy document succeeds where a 464 MB object-dense one dies, which is
the opposite of what a file-size budget predicts.

So the answer to "is content the driver" is **yes, decisively**, and the ratio
varies by roughly 6× across profiles. The working model:

    peak ≈ (stream bytes × ~3.7)  +  (object count × ~4 KB)

Both terms check out against every fixture measured: the image-heavy document
has 53 objects, so its second term vanishes and it lands at 3.7×; the 28 MB
dense document is almost entirely second term. At 2.04M objects the second term
alone predicts ~8 GB, which is why it died against a 2 GB cap.

**The non-monotonicity has a separate cause**, and it is allocator behaviour
rather than anything about documents: RSS is the allocator's high-water mark,
not live bytes. Once the heap grows to absorb the open spike, a later save
reuses that freed space without growing RSS further. In the image-heavy run,
RSS *after* the save (1099 MB) sits **below** RSS after the open (1202 MB) —
visible proof of reuse.

**`countObjects()` is free.** Measured immediately after open and before any
page load, RSS was identical either side of the call (173.7 MB both). It reads
from the already-parsed xref, so an admission decision can use it.

### The hard ceiling — and it is profile-specific

The WASM binary declares its own limit. Read directly from the memory section
of `mupdf-wasm.wasm`: `flags=1, initial=22MB, maximum=2048MB`. Linear memory
cannot grow past **2 GB**, so a document large enough that its resident copies
do not fit does not degrade — it fails.

Measured by escalating document size, each trial in a fresh process. **The RSS
column below stops at `saveToBuffer` and does not include the copy-out K.1
mandates**, so it understates the production path by roughly one further copy
of the file — the 160 MB run above measures that step at exactly +1.00×
(4.11× → 5.11×). The production column applies that.

| File | open | walk all pages | save (no copy-out) | production ≈ save + 1× |
|---|---|---|---|---|
| 200 MB | 636 MB | 462 MB | 739 MB (3.70×) | ~939 MB (4.70×) |
| 400 MB | 1211 MB | 1000 MB | 1722 MB (4.31×) | ~2122 MB (5.31×) |
| 613 MB | 1805 MB | 1336 MB | 2062 MB (3.36×) | ~2675 MB (4.36×) |
| **657 MB** | 1948 MB | 1459 MB | **2106 MB (3.21×) — last success** | **~2763 MB (4.21×)** |
| **679 MB** | 2021 MB | 1409 MB | **FAIL: `realloc (551620174 bytes) failed`** | — |
| 700 MB | 2094 MB | 1702 MB | FAIL, same | — |

The **failure point is unaffected** by the copy-out: the failure is a WASM
`realloc` against the 2 GB linear-memory cap, and the copy-out lands in the
Node heap, outside it.

**The largest document that opens, edits and saves is ~657 MB.** Failure
arrives at ~679 MB, and it arrives at **save**, not at open — opening alone
still succeeded at 700 MB. That asymmetry matters for the user-facing story: a
document can open, display and be read long after it has become too large to
write back.

### The practical limit is lower than the technical one

2048 MB of WASM is what MuPDF runs out of. It is **not** what users run out of.

At the 657 MB ceiling the production peak is **~2.7 GB of resident memory in
the MuPDF host alone**, before the main process, the renderer, Electron's own
overhead, or anything else the user has open. On an 8 GB machine with a browser
running, that means paging or an OS kill well before MuPDF ever reaches its
linear-memory cap.

So the user-facing limit carries a **stated machine-RAM assumption**, and the
number users actually hit is this one rather than 2048 MB:

| Installed RAM | Practical working limit, **stream-heavy documents only** |
|---|---|
| 8 GB | ~250 MB |
| 16 GB | ~600 MB |
| 32 GB and above | the ~657 MB engine ceiling governs |

These follow from the ~4.2× production peak against a working assumption of
roughly a third of installed RAM being available to one application. They are
derived, not measured, and are flagged as such — the measured quantity is the
4.2×; the division of a user's machine is an assumption. **They apply only to
the stream-heavy profile**; an object-dense document reaches the same memory at
a fraction of the file size, which is why admission uses the two-term estimate
rather than these rows. The Stage 0 gate asserts the per-process budgets, not
this table.

## Decision

### 1. The budget is per process, and each number is reasoned

A single whole-application number stopped constraining anything once the
measurement showed the dominant term is inherent to an engine that runs in its
own process. Three processes hold document-scaled memory, and each gets a
budget derived from **what that process is for**, not from what it currently
measures.

| Process | Budget | Why this number |
|---|---|---|
| **Main** | **≤ 1.5× file size, and ≤ 1.5 GB absolute** | A design constraint, not an observation. Main holds the canonical bytes and never parses. Anything above 1.5× means parsing or copying has crept back into main, which is precisely the regression the kernel/Electron boundary exists to prevent. |
| **MuPDF host** | **≤ 6× file size, and ≤ 3 GB absolute** | A **containment limit**, not a performance target. Normal operation measures 3.2–5.3× on the production path; a breach means a leak rather than work, and the response is to kill and restart the host, not to raise the number. The absolute term is what actually bites: 6× of a small document is meaningless, and 3 GB is where an 8–16 GB machine starts paging. |
| **Renderer** | **PROVISIONAL — see below** | Not yet derived from anything. Marked so it is not read as evidence. |

**Every ratio budget carries an absolute ceiling.** The measured ratio is not
monotonic in file size (3.70× at 200 MB, 4.31× at 400 MB, 3.21× at 657 MB), so
a pure multiple is wrong at both ends — too loose on small documents, too tight
or too generous on large ones depending where on the curve they land. The pair
is what constrains.

**A budget derived only from the measurement it is supposed to constrain can
never fail.** That is why main's number is argued from its job and the host's
is set above the measurement as a containment limit — a gate that merely
records today's number is the green check that verifies nothing.

### The renderer budget is provisional, and its unit is wrong

An earlier draft of this ADR set the renderer at ≤ 2.5× file size. **That
number had no derivation** — PDF.js overhead has never been measured here — and
it was written into a decision whose whole point is that budgets must be
reasoned. It is recorded here as the mistake it was: the reasoning was applied
to the two budgets that prompted it and missed the third.

The unit is also wrong. The renderer holds three things and only two of them
scale with file size:

| What | Scales with |
|---|---|
| The byte snapshot for PDF.js | ~1× file size |
| PDF.js parsed structures | proportional-ish to file size, **unmeasured** |
| Rendered page bitmaps | **zoom and display, not file size** |

A single page canvas at 400% zoom on a 4K display can be hundreds of MB
regardless of whether the document is 2 MB or 200 MB, so a budget expressed
purely as a multiple of file size cannot constrain the term most likely to blow
it. The renderer budget therefore has **two terms**:

    renderer ≤ (K × file size)  +  (absolute cap on the bitmap cache)

Both constants are **to be measured when the renderer exists**: load the byte
snapshot through the testing shim, `getDocument`, render a realistic page
window at several zoom levels, record peak. Until then the renderer has no
number, and Stage 0 exit cannot be claimed on it.

### 2. A failed save is recoverable, never destructive

This is the requirement that actually protects users, and it matters more than
the size limit — because **the dangerous case is the one no size gate can
predict.** A 450 MB object-dense document passes any threshold set from these
measurements, the user works on it for an hour, and then the save fails with
`realloc`. No cutoff catches that. The recovery path has to.

Architecturally the path already exists, and this ADR pins it as a requirement:

- **The command log lives in main and is untouched by a host crash.** That is
  what makes recovery possible at all, and it is a reason the log must not be
  delegated to the engine.
- On a save failure the response is: kill the MuPDF host, restart it, reopen
  from the last-saved bytes, **replay the log**, and tell the user the save
  failed and why — in those words, not as a generic error.
- Offer the routes that can still succeed: Save As to a different path, or
  export a smaller subset. Never leave the user with a dialog whose only option
  loses the work.
- **The original file is never destroyed by a failed save.** The atomic write
  (temp → fsync → rename) already gives this, and a save that fails before the
  rename must leave the original intact — which is a property to prove, not to
  assume.

**Proof with a control case** (invariant 13): force a save failure — an
oversized fixture, or an injected failure in the host — and assert that the
command log is intact and the document state is fully recoverable. The control
must run the same scenario **without** the guard and show the work being lost;
otherwise the proof does not distinguish a working recovery path from a save
that happened to succeed.

### 3. Admission is estimated from both terms, and is a warning band

**There is no single supported document size.** ~657 MB is the stream-heavy
ceiling; an object-dense document failed at 464 MB, and the 28 MB dense fixture
already consumed 586 MB. Any policy keyed on file size alone would open that
464 MB document "normally" and let it die an hour into the user's work.

Admission therefore reads **both terms**, using the estimate above, after the
xref is parsed and before any page is loaded — `countObjects()` is free, so this
costs nothing:

    estimate = (file bytes × 3.7) + (countObjects() × 4 KB)

| Estimate against the host budget | Behaviour |
|---|---|
| Comfortably under | Open normally. |
| Approaching the limit | Open normally, **warn up front** that saving may fail, and why. |
| Over | Open **read-only**, limitation stated before the user does any work — never sprung at the moment they save. |

The thresholds are deliberately expressed against the *estimate*, not against
megabytes, because megabytes were the wrong unit. The constants 3.7 and 4 KB
are first approximations from four fixtures; they are refined when the Stage 0
gate runs across a wider corpus, and the ADR is corrected then rather than
quietly retuned.

**A warning plus a safe failure is more honest than a cutoff that is wrong at
both edges** — and because no estimate is exact, decision 2's recovery path is
the real protection, not this table.

### 3. Stage 0 exit is gated on the three per-process budgets

Replacing the single whole-application number. The gate remains a real gate:
the assertion runs on every push, per Part G.

## Rejected alternatives

**Raise the single whole-app number to ~5×.** Simplest to state and to assert,
and it fails the reasoned-budget test: it would stop constraining main
entirely, so a regression that put document bytes back into the main process
would sail through a green gate.

**Cap the supported document size at something small and keep 1.5×.** The
measurement says the real ceiling is ~650 MB; declaring a much lower one to
protect a number would be choosing a policy where a fact was available.

**Replace WASM with a native MuPDF binding** that can memory-map instead of
copying. This is the only option that attacks the root cause, and it stays on
the table — but it is a large architectural change with its own AGPL packaging
consequences, and nothing measured here says the app cannot ship without it.
Revisit if the ceiling or the host budget becomes a real user constraint;
record as its own ADR if taken.

**Write our own incremental writer** to avoid full materialisation. This would
make the kernel a second writer of record for document bytes — a B3 violation
at the root, and the exact pathology the writer-of-record matrix exists to
forbid.

## Consequences

- `docs/ARCHITECTURE.md` §9 gains invariant 17 (per-process memory budgets).
- The Stage 0 gate row in `docs/FEATURES.md` is restated.
- The engine seam must not add a further full copy of its own. Any design that
  materialises the document once more than MuPDF already does spends a budget
  that has ~1.4× of headroom at 200 MB, not 4×.
- Checkpoint retention (`ARCHITECTURE` §4) must be settled against these
  numbers. At 200 MB, two resident byte checkpoints alone exceed the main
  budget, which is why checkpoints cannot live on the main heap.

## Not measured, and stated as such

- **The exact failure threshold for the object-dense profile.** Known: 464 MB
  with 2.04M objects fails during the page walk; 28 MB with 127K objects
  succeeds at 586 MB peak. The sweep between them was abandoned because walking
  600K+ objects takes minutes per trial. The two-term estimate covers the gap
  well enough to gate admission; the precise threshold is not needed and is not
  claimed.
- **A performance dimension the gate does not cover at all.** The dense fixtures
  were not merely memory-hungry, they were *slow* — a 138 MB document with 611K
  objects took minutes simply to walk its pages. The Stage 0 gate asserts memory
  and IPC bytes and says nothing about time. That is a real gap, and it is
  recorded rather than closed here because closing it means choosing a latency
  budget, which is its own decision.
- **The constants 3.7 and 4 KB** come from four fixtures on one machine. They
  are first approximations, adequate for admission, not a characterisation.

## Reproducing

The probes are deliberately **not** committed: they generate multi-hundred-MB
fixtures, and invariant 15 keeps generated artefacts of that size out of a
public repository. The Stage 0 performance gate — which *is* committed, and
runs in CI — generates its fixture deterministically at test time per Part I's
fixture size rule, and asserts the three budgets above.

The measurements here were taken with `mupdf@1.28.0` on Windows 11, Node
v24.12.0. The WASM memory maximum is read straight from the binary's memory
section and is a property of the shipped artefact, not of the host.
