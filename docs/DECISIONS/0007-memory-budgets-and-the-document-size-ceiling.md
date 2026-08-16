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

### The hard ceiling

The WASM binary declares its own limit. Read directly from the memory section
of `mupdf-wasm.wasm`: `flags=1, initial=22MB, maximum=2048MB`. Linear memory
cannot grow past **2 GB**, so a document large enough that its resident copies
do not fit does not degrade — it fails.

Measured by escalating document size, each trial in a fresh process:

| File | open | walk all pages | save |
|---|---|---|---|
| 200 MB | 636 MB | 462 MB | 739 MB |
| 400 MB | 1211 MB | 1000 MB | 1722 MB |
| 613 MB | 1805 MB | 1336 MB | 2062 MB |
| **657 MB** | 1948 MB | 1459 MB | **2106 MB — last success** |
| **679 MB** | 2021 MB | 1409 MB | **FAIL: `realloc (551620174 bytes) failed`** |
| 700 MB | 2094 MB | 1702 MB | FAIL, same |

**The largest document that opens, edits and saves is ~657 MB.** Failure
arrives at ~679 MB, and it arrives at **save**, not at open — opening alone
still succeeded at 700 MB. That asymmetry matters for the user-facing story: a
document can open, display and be read long after it has become too large to
write back.

## Decision

### 1. The budget is per process, and each number is reasoned

A single whole-application number stopped constraining anything once the
measurement showed the dominant term is inherent to an engine that runs in its
own process. Three processes hold document-scaled memory, and each gets a
budget derived from **what that process is for**, not from what it currently
measures.

| Process | Budget | Why this number |
|---|---|---|
| **Main** | **≤ 1.5× file size** | A design constraint, not an observation. Main holds the canonical bytes and never parses. Anything above 1.5× means parsing or copying has crept back into main, which is precisely the regression the kernel/Electron boundary exists to prevent. |
| **MuPDF host** | **≤ 6× file size** | A **containment limit**, not a performance target. Normal operation measures 3.2–4.6×; a breach means a leak rather than work, and the response is to kill and restart the host, not to raise the number. |
| **Renderer** | **≤ 2.5× file size** | Holds one byte snapshot per `DocVersion` (~1×) plus PDF.js's parsed structures. It is the process most likely to regress, because it is the one where a retained proxy or an uncollected snapshot is easiest to introduce. |

**A budget derived only from the measurement it is supposed to constrain can
never fail.** That is why main's number is argued from its job and the host's
is set above the measurement as a containment limit — a gate that merely
records today's number is the green check that verifies nothing.

### 2. The maximum supported document size is a stated fact

**~650 MB**, and it is measured, not chosen. Above it MuPDF cannot save. This
is a property of the WASM build's 2 GB memory cap, so it is honest to state to
users rather than a policy to negotiate:

- The save path must detect the condition and fail with an actionable message,
  never with a bare `realloc failed`.
- Because open succeeds well past the point where save fails, a document above
  the ceiling must be opened **read-only with the limitation stated up front**,
  not opened normally and then refused at the moment the user tries to save
  work they have already done.

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

## Reproducing

The probes are deliberately **not** committed: they generate multi-hundred-MB
fixtures, and invariant 15 keeps generated artefacts of that size out of a
public repository. The Stage 0 performance gate — which *is* committed, and
runs in CI — generates its fixture deterministically at test time per Part I's
fixture size rule, and asserts the three budgets above.

The measurements here were taken with `mupdf@1.28.0` on Windows 11, Node
v24.12.0. The WASM memory maximum is read straight from the binary's memory
section and is a property of the shipped artefact, not of the host.
