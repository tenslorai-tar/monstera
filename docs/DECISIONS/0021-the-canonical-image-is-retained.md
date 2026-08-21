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

### 2. The ceiling is supplied and has no default

`DocumentServiceOptions.residentImageCeiling` is required. ADR-0007 states
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
