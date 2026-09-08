# ADR-0010 — Native MuPDF through an FFI shim; WASM withdrawn

> ## Correction — 2026-08-17
>
> **The conclusions stand. Two of the instruments that produced them did not,
> and one number was already stale when written.**
>
> An audit found that two of the three instruments this ADR relied on could not
> measure what they reported. Both are rebuilt, validated against MuPDF's own
> figures, and the measurements re-run. What follows is what changed and what
> did not.
>
> **Re-confirmed, with the prediction stated before the numbers.** The old cache
> reader searched `fz_debug_store`'s output for `size=` from the start of the
> buffer, so it bound to the first *cached item* line and reached the summary
> only when there were no items at all. It could therefore return zero only when
> the store was genuinely empty. This ADR recorded zero at every checkpoint —
> so the store really was empty, and "not the resource store" should be
> confirmed by deduction rather than merely probable. Predicted before running:
> the corrected instrument must also report ~0 there. It does — 0 bytes after
> open and 0 after a full page walk. **No third defect.**
>
> **The leak claim is now answerable, and holds.** "0 live blocks and 0 live
> bytes after the context is dropped" was produced by counters that `mz_init`
> reset on the next call, so it measured a reset rather than a release — and
> per-context accounting structurally cannot answer it, because the accounting
> is freed with the context. Process-wide monotonic totals now outlive every
> context: 155,548,924 bytes allocated against 155,548,924 freed, 1,547 blocks
> against 1,547, imbalance 0.
>
> **`mz_store_size` is withdrawn entirely**, not repaired. With 32 items cached
> it reported 100,368 bytes where the store held 25,472,232. Its replacement,
> `mz_store_footprint`, measures the delta across `fz_empty_store` — validated
> against MuPDF's own summary to within 1,984 bytes, 0.008%. It is destructive
> and reports whether the measurement was taken at a quiescent point, because
> refcounted items still in use are not evicted and the figure is otherwise a
> floor rather than a total.
>
> **The exported symbol count below is wrong.** It reads 14; the shim exports 25.
> That number was accurate when measured and the source landed in a later commit
> (`d075cbe`), so it is corrected here rather than edited in place — what was
> believed at the time is part of the record.
>
> Also since: the seam is rebuildable from a clean checkout by one command
> (`npm run provision:mupdf`) and runs in CI, which is the actual repair for the
> underlying problem — this ADR's evidence lived in a scratch directory and was
> deleted, which is why any of it needed re-measuring.

- **Status:** Accepted; instruments corrected 2026-08-17
- **Date:** 2026-08-17
- **Amends:** `docs/ARCHITECTURE.md` §2 (process topology), §3 (writer-of-record
  matrix), §8 (cross-cutting services — how native code arrives), §9 (invariants
  17 and 18).

  > §8 was added to this list on 2026-08-17, after an audit found it still
  > listing `mutool` among binaries "provisioned by a pinned, SHA-256-verified
  > script" — a script this ADR withdrew. It was absent from the amendment-log
  > row too, so the section had never been **scoped**, not merely missed. The
  > lesson is the one ADR-0001's correction also carries: withdrawing a component
  > means finding every place its mechanism was described, and the `Amends` field
  > is where that search is recorded.
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
  *(Corrected 2026-08-18 — see below. It needs no ABI prebuild; the real
  obligation is narrower and different.)*
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

## Correction — 2026-08-18: koffi needs no Electron ABI prebuild

The consequence above says koffi "needs Electron ABI prebuilds". That was
written from the general fact that native addons are ABI-bound, and it is not
true of this one. Measured against the installed koffi 3.1.5:

- It declares a **Node-API** floor of 8 and refuses to load on a runtime
  reporting less, checking `process.versions.napi` at load. Node-API is
  ABI-stable across runtimes by construction — that is what it is for — so
  there is no V8 ABI to rebuild against.
- Its prebuilt binaries are published per **platform and architecture**
  (`@koromix/koffi-win32-x64`), with no runtime or ABI in the name. Fifteen are
  declared as optional dependencies and the lockfile pins all of them.
- Its loader probes **`process.resourcesPath`** for the binary — an
  Electron-only global. Electron is a case it was written for, not one it needs
  rebuilding for.
- Electron 43.4.0, current stable on this date, bundles Node 24.18.1, which is
  Node-API 10. The floor is 8.

**The real obligation is narrower and was not what the ADR named.** The platform
binary is an *optional* dependency, so an install that omits optional packages —
`npm ci --omit=optional`, a sandbox that blocks the extra download, a
cross-platform build host — leaves koffi resolving nothing and failing at the
first FFI call, at runtime, inside a shipped application. And because a `.node`
is a native library, it cannot be loaded from inside an asar archive: the
packaging config must unpack it, which is the same requirement the shim and
`pdfium.dll` already have.

`npm run proof:nativeaddon` holds all of it, including a real FFI call whose
return value is compared against a process id known independently — a loaded
file is not a working binding.

What remains genuinely owed is the packaging half, and it needs Electron to
exist before it can be asserted: that the unpacked binary is found via
`resourcesPath` from a built application. That is the packaging test, and it is
recorded as such rather than as an ABI problem to solve.

---

## Correction, 2026-09-08 — this decision is unbuilt for the document pipeline

**The decision above is not withdrawn. What is corrected is the belief that it
had been implemented**, which three documents stated in the present tense.

Measured on 2026-09-08. Every MuPDF consumer in `packages/kernel` imports the
bare specifier `mupdf`, which Node resolves to the npm package's
`dist/mupdf-wasm.wasm` — **nineteen non-test modules do so**, and a search for
`monstera_mupdf` across `packages/` and `apps/` returns **zero**. The shim is
built, is 39.4 MB, is scanned by four security proofs, and is loaded by nothing
the shipped application runs. The engine the product actually reaches is the
WASM build this ADR withdrew.

So the two options this ADR weighed are both still live, and the one it rejected
is the one running.

**What that does and does not touch.** The measurements above stand — they were
taken against the native library and nothing here re-opens them. `mutool.exe` is
still not shipped. The held document handle is still real: the npm package's
`PDFDocument` object persists across mutations, so the property this ADR was
protecting is obtained by a different mechanism than the one it named. What is
untrue is the *reach*, and with it the parts of the reasoning that depend on
native memory behaviour — the 2 GB cap and the whole-file copy this ADR removed
are removed only for a route the product does not take.

**Why it survived.** `docs/ARCHITECTURE.md` §3 stated it as a compound claim —
*reached natively … running in the contained host … never as WASM, and never by
spawning `mutool`* — of which two clauses were true throughout. The live half
vouches for the dead half, and the part a reader checks is the part still true.
`docs/JOURNAL.md`'s finding AAAAAA-1 had already recorded that the product
reaches structured text through the npm package, and read that as a fact about
one uncalled shim **export** rather than about this decision.

**What is owed: a decision, and it is the owner's.** Either the kernel's
adapters move onto the shim — a large change touching every MuPDF consumer, the
host, the memory budgets and the security proofs — or this ADR is amended to the
reach the product has, with the 2 GB cap and the copy re-entered as live
constraints. **Nothing may be built on either reading until it is taken**, and
in particular a second engine host's process topology depends on which it is: a
process containing a WASM sandbox and a process containing a native parser are
not the same containment problem.

**One consequence is already closed**, because it was a mechanism rather than a
decision. Invariant 24's proof, `proof:activecontent`, scanned only
`monstera_mupdf.dll` — a binary the shipped pipeline never opens. It now also
scans the engine the application's own import **resolves to**, with the target
derived from that resolution rather than written down, and with both controls.
No JavaScript interpreter is linked into either. **That the answer did not change
is why this is recorded rather than quietly fixed:** the mechanism would have
read exactly as it did if the answer had been the opposite, which makes its
previous green a check that verified nothing.

---

## Correction, 2026-09-08 (later the same day) — the open question is answered: NATIVE, both engines, koffi

**The correction above ends with *"nothing may be built on either reading until
it is taken"*. It has been taken.** The owner ruled on 2026-09-08: MuPDF and
PDFium are both reached **natively**, through koffi, and the kernel's adapters
move onto `mupdfRaw.ts`. That sentence is now satisfied rather than outstanding,
and this note is what a later reader needs in order not to re-open it.

Appended and not folded in. What was believed on the morning of 2026-09-08 — a
decision recorded, unbuilt, and owed to the owner — is the record, and editing
the paragraph above would destroy the evidence that it was ever in doubt.

### Which option was taken, and which was rejected

Two were weighed and both were live:

- **the kernel's adapters move onto the shim** — the option taken;
- **this ADR is amended to the WASM reach the product has**, with the 2 GB cap
  and the whole-file copy re-entered as live constraints — **rejected**.

### The ruling was taken against the documentation, not by preference

The founding record never re-opened this, and that is the reason given rather
than a taste for native code:

- `BUILD-PROMPT.md`:115-117 names `mupdfRaw.ts` **and** `pdfiumFfi.ts` as the
  two native-boundary adapter modules that alone may carry a file-level lint
  disable — a rule that presumes two native boundaries exist;
- :203 draws `pdfiumHost` as *"PDFium via koffi FFI"* in the architecture
  diagram;
- :399 provisions `pdfium.dll` among the native binaries;
- :257 assigns in-place text editing, styled runs and HD render to **PDFium** in
  both columns.

**And the reason the owner decides in is a measurement this ADR already
carries**: a 464 MB, 2M-object file opens in **144 MB** and saves incrementally
in **4.5 s** natively. The WASM route's own figure for the same document is
[ADR-0007](0007-memory-budgets-and-the-document-size-ceiling.md)'s **withdrawn**
ceiling — withdrawn precisely because it was a WASM ceiling read as a property
of documents — so the comparison here is the native reading against the *shape*
of the other: WASM eagerly materialises objects because it cannot page from
disk, and the same file costs 45 bytes per object natively. Stage 5's editing
rows are where a document of that shape is met.

### What this settles, and what it deliberately does not

**Settled: the topology question.** The correction above said a second engine
host's process topology depends on which reading is taken, *"a process
containing a WASM sandbox and a process containing a native parser are not the
same containment problem"*. With native taken it is **one** containment problem
and not two: both hosts contain a native parser reached the same way, so the
second host is a generalisation of the first rather than a new kind of thing.
That is what makes it a B4 amendment to an existing seam rather than a new ADR.

**Not settled here: how much moves and in what order.** Nineteen non-test kernel
modules import the bare specifier `mupdf`. The change reaches the memory budgets
in `docs/ARCHITECTURE.md` §9.17 — whose figures were read against the WASM route
— and the four security proofs that scan `monstera_mupdf.dll`, which is the
binary this correction's parent recorded as one the shipped pipeline never
opens. Those are part of the change and not follow-up work.

**`proof:activecontent` keeps the property it gained.** It derives its subject
from the application's own module resolution rather than from a written-down
path. When the resolution moves to the shim, the scan follows it with no edit —
which is the whole reason it was built that way, and a path constant added
during the migration would undo it.

---

## Correction, 2026-09-09 — how much moves, measured: 117 members, not 19 imports

The section immediately above closes by saying what it does not settle: *"how
much moves and in what order. Nineteen non-test kernel modules import the bare
specifier `mupdf`."* That sentence has since been read as the size of the work,
here and elsewhere, and it is not one. **Nineteen is a count of import
statements, and an import statement is not a unit of work.** The number nobody
held is the part of MuPDF's JavaScript API those modules **call**, because that
is what an adapter over `monstera_mupdf.dll` has to expose.

Read 2026-09-09 from `npm run proof:enginesurface`
(`scripts/research/engineSurface.mjs`), against `node_modules/mupdf`'s shipped
declarations and the kernel's own sources:

| | |
|---|---|
| kernel modules importing `mupdf` (non-test) | **19** |
| — of which load an engine at runtime (a value import) | **4** |
| — of which import types only, and are erased by the compiler | **15** |
| distinct MuPDF members those modules call | **117** |
| C functions `monstera_mupdf.dll` exports today | **24** |

And the shape matters more than the total. Grouped by the class declaring them,
the four largest are **`PDFAnnotation` 41**, **`PDFDocument` 20**, **`PDFObject`
20** and **`PDFWidget` 15** — an object model. The shim hands back an **opaque
handle** and represents none of those classes by design (`native/mupdf-shim/README.md`:
*"the caller never sees a `fitz` struct, so the ABI does not change when MuPDF's
internals do"*), so for the great majority of the 117 there is no counterpart to
move onto. They are not ported; they are **written**, in C, behind a flat ABI
that has to be designed first.

**Why the import count reads low, which is the transferable part.** Fifteen of
the nineteen spell `import type`. A type-only import is erased and loads
nothing — those modules receive a `PDFDocument` or a `PDFObject` that one of the
other four opened, and operate on it. So the reading that looks like *nineteen
places to change one line* is really *four modules that load an engine, and
fifteen written against the object model it hands back*. Changing the engine
changes the object model, so all nineteen **bodies** move and none of them moves
by editing its first line. A count of import statements measured the thing that
does not have to change.

**This corrects a size, not the decision.** The reach ruling of 2026-09-08 —
native, both engines, koffi — stands exactly as written, and every clause of the
founding record it was taken against is unaffected. What is withdrawn is the
implication carried by *"nineteen non-test kernel modules import the bare
specifier"* that the MuPDF half is a commit. It is a body of work whose first
deliverable is an ABI design, and it is the owner's to schedule.

**What it does NOT block, stated because the opposite was assumed.** The Stage 5
editing rows — in-place text editing, object-level edit, replace-all, the
replace half of find-and-replace, HD render — are **PDFium's** by
`BUILD-PROMPT.md`:257, in both columns. PDFium needs no shim: its API is already
flat C, which is why `:203` draws it as *"PDFium via koffi FFI"* directly.
`pdfium.dll` is provisioned (`scripts/provision/pdfium.mjs`), its export table
is parsed rather than searched (`scripts/lib/peExports.mjs`), and koffi already
binds and drives it in `scripts/research/pdfiumTextEdit.mjs`. So those rows sit
behind `pdfiumFfi.ts` and a second engine host — the B4 amendment for which
landed on 2026-09-08 — and not behind this migration. Sequencing them after it
would have parked five rows behind an unrelated body of work.
