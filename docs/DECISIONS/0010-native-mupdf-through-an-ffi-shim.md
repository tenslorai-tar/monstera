# ADR-0010 — Native MuPDF through an FFI shim; WASM withdrawn

- **Status:** Accepted
- **Date:** 2026-08-17
- **Amends:** `docs/ARCHITECTURE.md` §2 (process topology), §3 (writer-of-record
  matrix), §9 (invariants 17 and 18).
- **Supersedes:** `BUILD-PROMPT.md` Part C3's assumption that MuPDF is reached
  through its WASM build, and Part J's listing of `mutool.exe` as a bundled
  native binary.
- **Corrects:** [ADR-0007](0007-memory-budgets-and-the-document-size-ceiling.md)
  — its two-term memory model and the admission gate built on it are withdrawn.
  [ADR-0001](0001-agpl-on-the-microsoft-store.md) — its stated AGPL mechanism is
  now false while its conclusion stands.
- **Evidence:** measurements below, reproducible from the probes described at the
  end.

## Context

The WASM build of MuPDF declares `maximum=2048MB` in its own binary's memory
section and cannot read from disk: `openDocument` reads the whole file and
copies it into linear memory. Measured, that made a 405 MB document cost
1293 MB before any work, and made a 464 MB document fail outright with
`realloc (551620174 bytes) failed`.

ADR-0007 responded by writing a memory policy around that limit. **That was the
wrong response.** It treated an engine choice as a constraint of the world, and
built an admission gate, a two-term cost model and a set of size bands on top of
it. The correct first question — whether the limit had to exist at all — was not
asked. This ADR asks it.

## What was measured

Same MuPDF version (1.28.0) throughout, so the comparison is the binding, not
the library.

### Operation-matched, three engines

**image-heavy — 405 MB, 53 objects, 17 pages**

| operation | WASM | native CLI | **native FFI** |
|---|---|---|---|
| open | 1293 MB | 6 MB | **1 MB live** |
| walk every page | 1293 MB | 6 MB | **1 MB live** |
| full save | 1505 MB | 31 MB | 58 MB peak |

**object-dense — 28 MB, 127,184 objects, 141 pages**

| operation | WASM | native CLI | **native FFI** |
|---|---|---|---|
| open | 167 MB | 12 MB | **6 MB live** |
| walk every page | 468 MB | 487 MB | **370 MB live** |
| geometry only | — | — | **10 MB live** |
| full save | 289 MB | 126 MB | 177 MB peak |

**object-dense — 464 MB, 2,038,522 objects, 2260 pages**

| operation | WASM | **native FFI** |
|---|---|---|
| open | — | **144 MB** |
| geometry only | — | **152 MB** |
| walk every page | **FAILED** | 4.07 GB, completes |
| full save | **FAILED** | 1907 MB, 79 s |
| incremental save | **FAILED** | **304 MB, 4.5 s**, 7,313 bytes |

**The file WASM could not process at all, native saves in 4.5 seconds.**

### Save mode

| fixture | full rewrite | incremental |
|---|---|---|
| 28 MB dense | 3793 ms, 177 MB | **234 ms, 74 MB** |
| 405 MB image | 7574 ms, 58 MB | 3381 ms, 58 MB |
| 464 MB dense | 79,235 ms, 1907 MB | **4484 ms, 304 MB** |

### The held handle

| approach | cost per mutation |
|---|---|
| FFI, held handle | **0.0037 – 0.024 ms** |
| spawn `mutool` per operation | 443 – 3745 ms |

Five orders of magnitude. A held handle is what makes an interactive editor
possible, and only in-process FFI provides one — a resident CLI process is not
an option, because `mutool`'s stdout is block-buffered over a pipe and MuJS
exposes no flush, so a request/response protocol deadlocks. That was executed,
not assumed.

## Decision

### 1. MuPDF is reached through a native shared library, bound with koffi

Artifex's prebuilt Windows archive ships three statically linked executables and
no DLL, no headers and no import library, so the library is **built from
source**: MuPDF's own MSVC solution produces the static libs, and a thin C shim
links them and exports a flat C ABI. 40.1 MB, 14 exported symbols.

**The shim is not optional glue.** MuPDF's error handling is `fz_try`/`fz_catch`,
which is `setjmp`/`longjmp`, and a `longjmp` that unwinds through frames koffi
created is undefined behaviour. Every `fz_try`/`fz_catch` pair therefore lives
entirely inside one exported function, and what crosses the ABI is an `int` and
a message. This is the same property that makes PDFium's flat API bind cleanly
today.

Containment is verified rather than assumed: a forced failure returns code 1
with `cannot open ...: No such file or directory`, and the process continues.

### 2. WASM is withdrawn, and so is spawn-per-operation

WASM's 2 GB cap and whole-file copy are removed, not managed. Spawn-per-operation
is rejected on its own timings above.

### 3. One held handle per open document, in a utility process

A native fault is uncatchable, which is exactly the reasoning behind invariant 8
for PDFium. The shim therefore runs in a utility process, never in main, and
`DocumentService` holds one document handle per `DocId` for the document's
lifetime.

### 4. Save mode follows [ADR-0008](0008-save-mode-is-determined-by-purpose.md),
with incremental as the routine path

The purpose-based rule is unchanged. What the measurements add is that a full
rewrite of a large document is 79 seconds and 1.9 GB, so it cannot be what
happens on every save. Routine saves are incremental; a full rewrite is an
explicit act, and remains mandatory wherever the purpose is removal
(invariant 19).

### 5. `mutool.exe` is not shipped

No feature in the founding record requires it. Every mention is the licence
rationale, the general native-binary policy, a packaging test asserting it
spawns, or installer arithmetic — and no `mutool <subcommand>` appears anywhere
in the repository. Every concern the C3 matrix assigns to MuPDF is an API
concern, and the shim exposes the same API the CLI wraps.

Installer arithmetic improves: the plan was WASM 9.9 MB + `mutool.exe` 44.3 MB =
54.2 MB; it is now the shim alone at 40.1 MB.

## The memory finding, settled

This is recorded as a **closed question**, not an open risk.

Loading a page materialises its object graph and MuPDF holds it for the
document's lifetime: 370 MB across 7.1 million small allocations for 141 pages
carrying 127,000 annotations — roughly 2.9 KB and 56 allocations per annotation.
Measured with an allocator hook installed through `fz_new_context`, counting live
bytes inside MuPDF independently of the operating system.

What it is **not**, each ruled out by measurement rather than argument:

- **Not the resource store.** 0 bytes at every checkpoint, read from
  `fz_debug_store`.
- **Not the glyph cache or store items.** Calling the full documented purge
  surface — `pdf_clear_xref`, `fz_purge_glyph_cache`, `pdf_purge_locals_from_store`,
  `pdf_empty_store`, `fz_empty_store` — three times in succession freed 48 MB on
  the first pass and **nothing** on the second or third.
- **Not the open-page list.** `fz_document.open` behaves exactly as designed:
  holding 141 pages grows it to 141 live, releasing them empties it, and a
  subsequent load reaps the dead entries. Live bytes fall only 378 → 370 MB.
  Releasing pages as they scroll out of view reclaims ~2%, and in release mode
  the list never grows at all while memory still reaches the identical 370 MB.
- **Not a leak of ours.** 0 live blocks and 0 live bytes after the context is
  dropped.
- **Not Windows withholding freed memory.** Working set returns to baseline on
  close, and working set tracked private commit within 5% at every checkpoint on
  every fixture — so the earlier tables were measuring real private memory.

What follows, and why it does not constrain the design:

- **It is a cache, not a leak.** A second pass over the same pages allocates
  nothing at all — byte-identical and block-identical.
- **Purging is counterproductive.** Purge then re-walk ends at 396 MB against
  370 MB for never purging.
- **No engine change helps.** The cost is materialising an object graph; every
  PDF engine pays it. It is not a reason to reconsider MuPDF.
- **The only lever is close and reopen**, which the per-`DocId` lifecycle already
  provides.
- **The viewer never pays it.** The full walk is not a workload this application
  runs. Scroll layout needs size and rotation, which are dictionary reads:
  **10 MB against 370 MB** on the dense fixture, **152 MB against 4.07 GB** on
  the 2,260-page one. Ten rendered pages measured 62 MB. The real viewing cost
  is geometry plus visible pages.

### What ADR-0007 got wrong

Its two-term model `(stream bytes × 3.7) + (object count × 4 KB)` and the
admission gate built on it are **withdrawn**. The 4 KB figure was WASM eagerly
materialising objects because it cannot page from disk; the same document opens
natively at 45 bytes per object because opening materialises nothing. A model
fitted to four points, three of them from a single engine, was never a model.

The per-process budgets stand as *design constraints* — main holds canonical
bytes and never parses — but no number in this project should be derived from a
measurement it is meant to constrain.

## Rejected alternatives

**Keep WASM for editing, native for large documents.** Two backends for one
writer of record, with a size-based switch between them. Rejected: the held
handle is the whole basis of the editing loop, and it is exactly what WASM
cannot provide at scale.

**Bind `fz_*` directly with koffi.** Rejected on the `longjmp` grounds above.

**Ship Artifex's prebuilt `mutool.exe` and drive it.** Rejected: no held handle,
and the stdout buffering makes a resident protocol impossible.

**`pdf_drop_resource_tables` as a purge lever.** Not called: it appears only in
document teardown, so using it mid-life is unproven.

## Consequences

- A **build pipeline** is now required: MuPDF source (69 MB, hash-verified), MSVC
  build, shim compile and link. Roughly ten minutes. This must run in CI and
  produce a release artefact; `scripts/provision/mutool.mjs` is withdrawn
  because it provisions the wrong thing.
- **koffi is a native module** and needs Electron ABI prebuilds.
- The **AGPL position is unchanged** — MuPDF forced it before and forces it now —
  but the *mechanism* changed from WASM linkage plus a bundled upstream binary
  to static linkage into a library we build. The source offer must cover the
  MuPDF version, our build configuration and the shim source. ADR-0001 carries a
  dated correction.
- The packaging test that proved `mutool.exe` spawns becomes a test that the
  shim loads from `app.asar.unpacked`, alongside the same check for
  `pdfium.dll`.
- **Ghostscript** is listed as a provisioned native binary with no feature
  assigned to it anywhere in Part D. Unrelated to this decision, but it sits in
  the same installer budget and should be resolved or dropped.

## Reproducing

The probes are not committed: they generate multi-hundred-megabyte fixtures and
build a 40 MB library, and invariant 15 keeps artefacts of that size out of a
public repository. Measurements were taken on Windows 11, Node v24.12.0,
`mupdf@1.28.0`, MSVC v143, koffi 3.1.5.

Two instrument bugs were found and fixed during this work, both of which had
produced confidently wrong numbers: a `setInterval` peak sampler that never
fires because an FFI loop blocks the event loop, and a spike case whose verdict
was a literal `false` and so could never go red. Any future memory measurement
here marks its peak explicitly inside the loop, and reports live bytes from the
allocator hook rather than RSS.
