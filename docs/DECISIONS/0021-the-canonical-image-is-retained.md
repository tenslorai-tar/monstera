# ADR-0021 — The canonical image is retained, one per open document, under a supplied ceiling

- **Status:** Accepted
- **Date:** 2026-08-21
- **Amends:** nothing. `docs/ARCHITECTURE.md` §2 and §3.2 already state that
  `DocumentService` owns the canonical bytes and the lazily-created engine
  handles. This records the **policy** those clauses do not fix: how many images
  are resident, and what happens at ADR-0007's ceiling.

## Context

§2 states as law that per document `DocumentService` owns "canonical bytes,
lazily-created engine handles (invalidated together on any mutation), the
command log and checkpoints, and the originating `FileHandle`". Four of the five
were implemented. The bytes were not.

That gap had a consequence §2 names in the next paragraph: the engine handle is
treated as a cache that can be thrown away and rebuilt, "safe because the truth
lives in main: canonical bytes plus the command log". With no bytes in main, the
truth lived only in the file, and killing an engine host — ADR-0007's *designed*
response to a memory breach — lost everything since the last save. The engine
seam **enabled** the guarantee (`open` takes bytes, `serialise` returns them) and
did not satisfy it.

`docs/security/engine-advisories.json` carried the trigger, and it fired the
moment `documentService.ts` named `Uint8Array`.

### One thing this ADR is not

**Checkpoint retention is a separate decision and is deliberately not taken
here.** `CommandLog` already retains a full byte image per terminal entry, with
no cap. ADR-0009's *Left open* defers that to the Stage 0 performance gate, and
§4's "every N commands" still has no N. Merging the two would either block the
canonical image on a gate it does not need, or settle checkpoint policy without
the gate that was meant to settle it. A `docs/FEATURES.md` row previously
described them as "one decision"; that row is corrected in the same commit.

## Decision

### 1. One canonical image per open document, held on the record

Read at `open`, released when the record is dropped. Its lifetime **is** the
record's, for the same reason the lane's and the log's are: a `delete` on a close
path is a thing someone forgets, and a field on a record that goes away cannot
be.

**Sized, not assumed.** `npm run perf:gate` measures per-process peak RSS above
that process's own baseline, on two content shapes:

| `main` holds | image-heavy, 199.4 MB | object-dense, 25.1 MB |
|---|---|---|
| one image | 1.00× — ok | 1.00× — ok |
| two images | **2.00× — FAIL** | **2.00× — FAIL** |

Against ADR-0007's `main = 1.5x`. So "exactly one" is a measured constraint and
not a preference: a second copy anywhere in main breaches the budget on both
shapes. The second row is also this instrument's resolution test — it separates
the two quantities that would change the decision, run before the decision was
taken rather than after.

**What was measured, stated precisely, because "sized by measurement" invites a
larger reading than the evidence supports.** The process measured is
`scripts/perf/roleMain.mjs`, which is a **model** of main: it reads the file,
hashes it, holds the buffer across a save-shaped operation, and reports. It does
not construct a `DocumentService` and does not call `open`. So the figures above
are arithmetic about **bytes**, and they are sound as that — they are not
evidence about this retention **implementation**.

The gap is not theoretical: a retention path that copied the buffer, held a
second live reference across a save, or stored a view of a larger allocation
would breach the budget and be invisible to a harness that never executes it.
That is the harness axis this project has already paid for once — *what does the
harness hand its child that the real caller does not* — and here the harness does
the retaining itself, so the real caller's version is exercised by nothing.

**Closed 2026-08-21 — the role exists.** `scripts/perf/roleMainService.mjs`
opens a document through the real `DocumentService`, with the production
`BytesReader` rather than an injected one, and `perf:gate` asserts it against
`main`'s budget beside the model:

| role | image-heavy, 199.4 MB | object-dense, 25.1 MB |
|---|---|---|
| `main` — the model | 1.00× | 1.00× |
| `main-service` — the implementation | 1.00× | 1.03× |

So the implementation matches the model, which is the answer the model could
only assume. Its fixed cost is about 7 MB higher — the kernel's own modules —
and well inside the declared 96 MB base.

**And the role's own resolution test is the argument for its existence.** With
one deliberately leaked second reference inside `DocumentService`,
`main-service` doubles and breaches on both shapes while `main` is unmoved and
passes. That is exactly the class this ADR could not previously see.

It was blocked until this range for a reason worth keeping: importing
`DocumentService` loaded the native MuPDF shim — 38.1 MB, through a type-only
import that survived compilation — so a role built on it would have measured
`main` with the parser in it, which is the one thing `main`'s budget exists to
detect. `proof:kernelload` holds that closed. (Finding JJ-1/LL-4.)

### 1a. The count is of every document-scaled byte, not only the image

*(Added 2026-08-21, finding JJ-2. The first version of this ADR shipped a count
that summed canonical images alone.)*

`Checkpoint` is `Brand<ByteImage, …>` — a whole byte image per terminal log
entry, uncapped. With a 1.00× image against a 1.5× budget, **the first
checkpoint written puts `main` over budget while `open` still reports
capacity**. A ceiling derived from §9.17's `main` budget that enforces one of the
two terms consuming it, and says so nowhere, is a guard that can be satisfied
while the thing it guards is breached.

So `residentDocumentBytes()` is the one place that answers *how much
document-scaled memory is main holding*, and it asks the log for the checkpoint
term rather than computing it — so the number moves on its own the day
checkpoint policy changes, instead of depending on someone remembering this
document. A comment naming the exclusion would have been the weaker form of the
same fix, with the failure mode that the note and the code drift.

**The log reports what it physically retains, not what `entries` shows.** Undo
moves a cursor and never pops, so a checkpoint in the redo tail is invisible to
the applied view and still in the process; summing what the log shows would
under-report by exactly the amount an undo just made invisible.

This is **accounting, not policy**. How many checkpoints may exist and what
spills when is still deferred, exactly as stated above.

### 2. The ceiling is supplied and has no default

`DocumentServiceOptions.documentBytesCeiling` is required. ADR-0007 states
`main`'s budget, §9.17 carries it as the one machine-read line, and
`scripts/lib/memoryBudgets.mjs` is its single reader. The kernel cannot reach
that module — it is plain Node under `scripts/` and the boundary is deliberate —
so **any number written into the kernel would be a second opinion about the
budget** (B3a): right on the day it was typed, silently stale after.

A run-time guard rejects a non-finite or negative value as well, because the
type stops every caller in this repository and stops neither a JavaScript caller
nor an `undefined` arriving from a config read — which is exactly how a bound
becomes unbounded with nobody deciding to remove it.

### 3. At the ceiling, `open` refuses. There is no eviction

A new `OpenOutcome` variant, `at-capacity`, carrying what the total would have
become and the ceiling it crossed. An **outcome, not a defect** — the same
category as `absent`, because opening one document too many is a thing a person
does and can be told about.

**Capacity is checked twice, and the first check is the one that matters.**
`identity.size` comes from the `stat` already performed, so a document larger
than the service may hold is refused *without being read*. Checking only after
the read would allocate the very image the refusal exists to prevent — a guard
causing the condition it guards against. The second check, against the bytes
actually read, is the correct one: `stat` and the read are two observations of a
file anything may write between, so the first is evidence and the second is
fact.

## Rejected alternatives

**Evict the least-recently-used image and re-read it on demand.** Attractive
because the bytes *are* re-readable: they are the file's bytes, and
`openedIdentity` can verify the file is still the one that was opened. Rejected
because it moves the failure to an arbitrary later moment. Re-reading is safe
only while the file is unchanged, which is precisely the condition that may have
changed, and the user would learn about it in the middle of an operation rather
than at the moment they asked for one more document. Refusing at `open` is
immediate, attributable, and comprehensible.

**Read the bytes lazily, on first engine use, rather than at `open`.** Defers
the allocation and defers the capacity decision with it, so the same
arbitrary-moment failure arrives by a different route — and a document that
opened successfully could then fail to do the first thing asked of it.

**Spill images to disk under pressure.** A cache of a file, on disk, beside the
file. It buys nothing the file does not already provide, and it adds a second
copy of document bytes to a filesystem the user did not choose to put them on.

**Give the kernel a default ceiling.** Covered above: a second opinion about
§9.17, and the specific kind of default nobody revisits.

**Fold checkpoint retention into this decision.** Covered above.

## Consequences

- `DocumentService` cannot be constructed without a ceiling. Every existing call
  site is a test; two files gained a named helper rather than 48 scattered
  literals.
- The advisory register's `kernel-holds-canonical-bytes` entry has served its
  purpose — it was "a prompt to decide" and the decision is here. It is retired
  in this commit rather than re-asserted, because its claim ("nothing in the
  kernel depends on `DocumentService` holding canonical bytes") is now
  deliberately false.
- **Still owed, and not by this ADR:** that a killed engine host actually
  recovers, asserted against a running process. That needs a host, which does
  not exist; invariant 25's `utilityProcess` trigger fires when one is written,
  and the assertion is a `docs/FEATURES.md` row. Retention is what makes the
  recovery *possible*; it is not evidence that it works.
