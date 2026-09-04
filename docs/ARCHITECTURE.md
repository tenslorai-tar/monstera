# Monstera — Architecture (living law)

**Status:** in force. **Derived from:** `BUILD-PROMPT.md` Parts C, L and M.

This document is the **living law** of the project. `BUILD-PROMPT.md` is the
immutable founding record and is never edited; where this document and the
founding record diverge, **this document wins**, and the amendment that created
the divergence names the founding clause it supersedes. `CLAUDE.md` is the
derived operational digest and is updated in the same commit as any amendment
that affects it.

## How this document changes (rule B4)

If a feature cannot be built by registering into one of the seams in §7 —
**stop**. Do not bend the seam in place.

1. Write an ADR in `docs/DECISIONS/` stating the gap, the options considered,
   the **rejected alternatives and why**, and the consequences.
2. Amend this document **in its own commit**, referencing the ADR.
3. Build the feature in a **separate** commit.

This ordering is the whole point: it keeps the architecture ahead of the
features instead of retrofitted underneath them. Architecture retrofitted under
features is the failure mode this project exists to avoid, and it never
announces itself — it arrives as one reasonable-looking exception.

---

## 1. Repository topology

An npm workspaces monorepo. The boundary rules below are enforced by ESLint
import restrictions and per-package `tsconfig.json` references, so a violation
is a **red build, not a review comment**.

```
monstera/
├── packages/
│   ├── shared/      branded types, geometry, Result type, pure utils
│   │                imports: nothing internal. Runs anywhere.
│   ├── contract/    THE IPC contract: every channel, command, query and event
│   │                defined once with zod schemas. Imports: shared only.
│   ├── kernel/      the headless document engine: DocumentService, CommandBus,
│   │                engine adapters (MuPDF, PDFium, @cantoo/pdf-lib), undo log, save
│   │                pipeline, OCR, export, text-edit. Node-only.
│   │                Imports: shared, contract. NEVER Electron, NEVER React.
│   ├── ui/          the React app: components, per-document stores, registries,
│   │                PDF.js presentation. Browser-only.
│   │                Imports: shared, contract. NEVER kernel, NEVER Node.
│   ├── nodemode/    code that runs in NODE MODE and is not the document engine:
│                    the engine host's reader thread and what it needs. The
│                    Electron binary may be the runtime; Electron's APIs are not
│                    there. Imports: shared, contract. NEVER Electron.
│   └── testing/     fixture corpus, proof harness, esbuild bundling helpers,
│                    browser shim.
├── apps/
│   └── desktop/     Electron shell: main entry, preload, window/menu, utility
│                    process hosts, generated IPC registration, packaging.
│                    The ONLY package that imports Electron.
├── scripts/         provisioning (binary downloads, fixtures), git hooks,
│                    release tooling. Plain .mjs — see §1.1.
├── native/          C SOURCE we compile ourselves. `mupdf-shim/` is the flat C
│                    ABI over MuPDF (ADR-0010); `cff-poc/` is a security
│                    reproduction harness. No TypeScript and no npm package, so
│                    it sits outside every tsconfig and every ESLint boundary
│                    rule — the compiler is the only thing checking it, which is
│                    why the fz_var rule is written into the file header rather
│                    than left to a linter that does not run here. Build output
│                    goes to `native/*/out/` and is gitignored. Only the kernel,
│                    through its one typed adapter module, may load what this
│                    produces.
├── assets/          brand source artwork. `assets/brand/` holds the master the
│                    icons are generated from; `npm run brand:check` fails if
│                    the generated set has drifted from it.
└── docs/            ARCHITECTURE.md (this file), FEATURES.md, UI-GUIDE.md,
                     JOURNAL.md, DECISIONS/
```

**Why the kernel may not import Electron.** It is not aesthetic. It means the
entire document pipeline is unit-testable in milliseconds in CI, reusable for a
future CLI, and legible to reviewers as a library. A test that must fake
`DOMMatrix` or a window bridge just to exercise a save is evidence the boundary
is wrong — fix the boundary, not the test.

**And that sentence is why `packages/nodemode` exists rather than one more file
in the kernel** ([ADR-0024](DECISIONS/0024-execution-mode-is-a-placement-axis.md)).

**Placement has TWO axes, and this map states both.** The tree above classifies
by what a package is **about**. The second axis is which runtime mode a module
executes in, and it is not derivable from the first:

| the module runs | it lives |
|---|---|
| inside Electron, with Electron's APIs available | `apps/desktop/` |
| in **Node mode** — the Electron binary may be the runtime, but Electron's APIs are absent | outside `apps/desktop/`; in `packages/nodemode` where its subject is not the document engine |
| under `node` directly, as tooling | `scripts/` |

Harness and probe files are in scope by the same test — which mode they run in,
not that they are harnesses.

The axis is stated because this is the point where the two answers can disagree:
the engine host's reader is Win32 pipe plumbing **for the shell** that executes
**where the shell's API surface does not exist**. Invariant 26 records four
failures of `apps/desktop/src/` as a proxy for *runs inside Electron*, and a
module whose subject and mode disagree is the case a one-axis map cannot place.
Putting a Windows-only reader in `packages/kernel` would satisfy the mode and
break the paragraph above — a package that cannot be exercised without a
platform, which is the boundary decaying by one reasonable-looking exception.

**A package's public surface exports no value whose module graph binds a native
library** ([ADR-0026](DECISIONS/0026-a-declaration-is-not-an-implementation.md)).
Importing `@monstera/kernel` cannot load native code. The engine adapters are
reached through an explicit subpath — `@monstera/kernel/engine` — and only from
the process that runs them.

This is what makes invariant 20 a property of the module graph rather than a
rule about where people put `import` statements. Measured 2026-08-27: loading
the kernel's barrel in a bare Node process cost **+41.7 MB** over bare, against
`+46.0 MB` for the adapter itself — so the barrel was loading it, and `main`
paid that at startup while §9.17 argues `main`'s budget from *"main holds
canonical bytes and never parses"*.

**A subpath rather than a rule, because the rule was already there and had
failed.** The same exposure reached `main`'s measured baseline through
`import { type X } from './documentCommands.js'`, whose emitted form is
`import {}` — in a file whose own header documents that exact trap, one commit
after it was written. A barrel with nothing native behind it has no accidental
route left; an import that must name `/engine` is a cost somebody chose.

The corollary is §3's: a **declaration** of what a command is must not drag in
the **implementation** that performs it, or every consumer that wanted routing
gets an engine.

### 1.1 The bootstrap layer is plain JavaScript, deliberately

`scripts/` is written as `.mjs` with `// @ts-check` and JSDoc types, not as
TypeScript, while everything in `packages/` and `apps/` is TypeScript under
B7's strict settings.

The boundary is principled rather than convenient: `scripts/` contains the code
that runs **before dependencies exist** — the git hooks that gate the very first
commit, and the provisioning that installs the toolchain. Code responsible for
installing a toolchain cannot depend on that toolchain being installed. It is
still type-checked in CI via `checkJs`, so it is not an escape from B7's
substance, only from its build step.

---

## 2. Process topology and document ownership

```
┌─ main (apps/desktop + kernel) ─────────────────────────────┐
│  DocumentService   ← owns every open document              │
│  CommandBus        ← the only mutation entry point         │
│  CapabilityRegistry← mints FileHandles; renderer never     │
│                      sees a filesystem path                │
│  Services: Update, Engagement, Ai, Ocr, Export, Print,     │
│            NativeBins, Settings(main-side), Logs           │
└────────────────────────────────────────────────────────────┘
     │ generated typed IPC            │ typed host contract, over a
     │                                │ DACL'd named pipe
     ▼                                ▼
┌─ renderer (sandboxed) ──────┐  ┌─ contained: mupdfHost ───┐
│  React, per-doc view state  │  │  MuPDF native, via koffi │
│  PDF.js — presentation ONLY │  │  behind a flat-C shim.   │
│  No Node, no fs, no paths   │  │  NO in-main fallback —   │
└─────────────────────────────┘  │  native faults are       │
                                 │  uncatchable (L20)       │
                                 └──────────────────────────┘
                                 ┌─ contained: pdfiumHost ──┐
                                 │  PDFium via koffi FFI    │
                                 │  NO in-main fallback —   │
                                 │  native faults are       │
                                 │  uncatchable             │
                                 └──────────────────────────┘
```

**The engine hosts are processes this application creates, not Electron utility
processes** ([ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md)).
`CreateProcessW` with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` and an
AppContainer SID, running `process.execPath` under `ELECTRON_RUN_AS_NODE=1` — the
same runtime, so nothing new ships.

The reason is invariant 25 and not preference: **a LowBox process cannot be
created by `utilityProcess.fork`**, so the creation route is where two of the
four containment properties live. Measured — a contained host is refused a file
it was not handed through `CreateFileW` itself (`ERROR_ACCESS_DENIED`, the call
Node's permission model cannot reach) and refused a **loopback** connection,
while koffi, the shim and a document it *was* handed all still work.

What this gives up is plumbing and is enumerated in the ADR: a `MessagePort`
becomes a named pipe carrying the host contract — which had to be DACL'd for the
container either way — while the job object is one main already assigns against
the child's pid, and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` outlives main dying
badly rather than only main exiting cleanly. **The host body lives in
`packages/kernel`**, where naming Electron is already a red build, for the reason
in §9.26.

**Renderer hardening (non-negotiable).** `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, CSP set — **the exact
directive list is invariant 27**, not a note — deny-all permissions except
media, navigation locked, popups denied.

**Main owns the document.** The renderer holds an opaque branded `DocId` and a
monotonic `DocVersion`. Per document, `DocumentService` owns: canonical bytes,
the command log and checkpoints, and the originating `FileHandle`. **The engine
session is owned by the engine session supervisor**, whose per-document entry
has the same lifetime as the record — `DocumentService` is the only component
that knows a record ended, and it hands the supervisor that fact through
`DocumentTeardown` rather than the supervisor watching for it.

> **AMENDED 2026-08-28, and the amendment is LATE.** This sentence read
> *"canonical bytes, **lazily-created engine handles** (invalidated together on
> any mutation), the command log and checkpoints, and the originating
> `FileHandle`"*, and the handles clause became false when
> [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md)
> Decision 9 put the sessions on the supervisor — *"the supervisor holds a
> single per-document entry … precisely so the count and the sessions cannot
> acquire separate owners"*.
>
> **The move was forced and correct.** `DocumentService` is in `packages/kernel`
> and cannot create a remote session: that needs Win32 and a pipe, which the
> kernel may not name. What was missed is that Decision 9 **amended nothing**.
> Its opening paragraph quotes this sentence and checks it — deliberately and
> explicitly — for the **lifetime** clause only, concludes *"session lifetime
> needs no amendment"*, and is right about lifetime. Ownership travelled with
> the sessions and no document said so.
>
> Recorded as finding KKKK-5. The general shape is worth more than the instance:
> **a four-clause sentence checked for one clause is three unchecked claims**,
> and the check that was run is what makes the other three feel examined. Nothing
> could have caught it — no range ever changed both this sentence and the code
> that refuted it, so no range-scoped sweep could reach it, and the citation
> pointed at a document that says the opposite, which resolves and therefore
> passes every link check (UU-1).

**Engine handles are disposable, and their lifetime is not the document's.**
MuPDF reclaims a page's object graph only when the document is closed, and
releasing pages as they scroll out of view does not help — measured, a session
that visits pages grows **linearly** and never falls. So the handle is treated as
a **cache that can be thrown away and rebuilt**, not as the document.

Rebuilding costs a close plus an open plus re-reading whatever the user is
looking at, and it returns memory to the open-cost floor. It is safe because the
truth lives in main: canonical bytes plus the command log — **and a rebuild is
only safe once reopening replays that log, which it does not yet do.**

**Corrected 2026-09-01.** This paragraph ended *"Reopening replays the log"*, in
the present tense, and nothing does. `openEngineSession` writes the canonical
image and opens a session on it; there is no replay anywhere in the repository,
and `document.viewModel` reads page geometry from the **session**. So a rebuilt
session is the document as of its last save, while the log says otherwise — the
two disagree, visibly, about a rotation the user can see.

The sentence was a statement of design read as a statement of fact, and it made
the conditional above look discharged. It is not: invariant 22's condition is
that no mutation exists **only** on the handle, which the log satisfies, and the
*recovery* that makes the condition useful is the replay. Both halves are needed
and only one is built.

**What binds until replay lands.** `DocumentService.recycle` — invariant 22's
capability — **refuses** a document whose log holds entries and names this gap in
the refusal, so the unsafe rebuild is unreachable rather than merely undocumented.
The host-death path in
[ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9c
has no such refusal available to it: a dead host must be rebuilt for, and that
path therefore loses unsaved commands from the session today. **Recorded here
rather than fixed here**, because building replay is a decision about how each
command's `replay` mode is re-applied (§4 declares `reapply-intent` and
`stored-effect` and only the first exists), and that is an ADR rather than a line.

That safety is conditional, and the condition is a requirement on every command
(invariant 22): **no mutation may exist only on the handle.** Measured directly —
an unsaved rotation is gone after close and reopen, and comes back only by
replaying the command. A command that cannot be replayed cannot be issued.

This is the same mechanism as the kill-and-restart response to a host memory
breach (§9.17) and as the failed-save recovery path (§9.18); one recovery route,
reached three ways. **No memory limit or recycling schedule is stated here** —
the containment budget already decides when, and a second number would be a
second policy for one concern.

But `DocumentService` must be able to recycle a handle at a **deliberately
chosen moment**, not only under memory pressure. Memory pressure arrives when
the user is scrolling, and rebuilding costs re-reading the current page —
measured at 1.65 s on a two-million-object document, which is precisely the
freeze recycling exists to avoid. So recycling is an operation the service
offers, callable when nothing is waiting on it. **Which moments those are is
left open**, to be chosen against real usage rather than guessed now; the
requirement is only that the capability exists and is not wired solely to a
pressure trigger.

**What crosses, and how often.** The renderer receives a **view model** (page
count, page sizes and transforms, annotations, form fields, outline — structured
data, bounded size) and **no document bytes at all until it asks for them**. It
holds the document's byte **length** and reads ranges: PDF.js is driven through a
`PDFDataRangeTransport` whose `requestDataRange(begin, end)` is a query, answered
by main out of the canonical image it already holds
([ADR-0031](DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)).
**Any design where payload size scales with document size per operation is
wrong** (invariant L11), and this satisfies L11 more strongly than a snapshot
did: payload scales with what is actually **read**, not with the document and not
with the version. Measured 2026-08-29 on `perf-image-200mb.pdf` — 7,779,129 bytes
of 209,105,721 cross to open the document and produce page 1, **3.72%**.

**A transport is bound to one `DocVersion` and main refuses a range for any
other.** Byte offsets mean nothing outside the version that produced them, so
answering a stale offset out of new bytes would assemble a document from two
versions — a corruption with no symptom where it happens. The renderer rebuilds
the transport on a bump; the old "bytes cross once per version" cadence survives
as an **invalidation** rather than as a transfer.

**Mutations are commands.** `doc.command` with `{docId, command}`, handled in
main, validated at the boundary, routed to the writer of record, bumping
`DocVersion` and answering with the **version and the byte length** that describe
the document it left behind. `deletePages([3,5])` is bytes of intent regardless
of file size.

**The view model is a QUERY, scoped to the pages the renderer draws**
([ADR-0032](DECISIONS/0032-the-view-model-is-a-scoped-query.md)). A command's
answer says the renderer's view is stale; `document.viewModel({docId, pages})`
is how it stops being stale, answering `{version, pageCount, rotations}` for the
pages it named. One rotation per page scales with the document, so an unscoped
read is correct once — at open — and becomes L11's defect the moment anything
re-reads it, which a renderer must do after every command.

**A LIVE-SESSION mutation reaches the screen through the view model, not through
the bytes**, and that is a property of this design rather than an accident of
it. A `DocumentRecord`'s bytes are replaced by no command MuPDF or PDFium
writes: the mutation lands in the engine session, so `document.readRange` serves
the pre-command document (measured 2026-08-30). §3.2's *"PDF.js is never a
source of truth. It renders"* is what makes that correct — the parser is handed
the kernel's rotation and overruled on the one value stale bytes cannot carry.

**A BYTE-IMAGE mutation reaches it through the bytes, and must**
([ADR-0039](DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
Drawn content — a watermark, a header, a Bates number — is not a page transform
and there is no honest way to put it in a view model carrying rotations. A
byte-image writer's `apply` **returns** the new image, so it is already in main
when the decision is made, and the record's image is replaced with it. The
serialise that produces its *input* is the one `CommandBus.execute` already
performs for every entry recorded as `terminal`, which every content command is.
The refresh ADR-0032 rejected was one per command, on a path that performed
none; this is none per command, on a path that already performed one.

**Reads are queries.** `getPageText`, `findText`, `getStyledRuns` and friends
are served from cached engine handles. The renderer never ships a whole document
to ask a question about it.

**FileHandles.** `CapabilityRegistry` mints an unguessable handle wherever the
*user* or the *app* produces a path — dialogs, drag-drop, argv, file
association, app-created temp files. Every path-consuming operation takes a
handle; **a string path in a renderer-facing type is a compile error.** The
rejected alternative, a runtime path-allowlist check, fails open at every
handler that forgets to call it; a handle design makes that omission
unrepresentable (B5). A persistence layer re-mints handles for Recent Files.

---

## 3. Engines and the writer-of-record matrix

Four engines, each covering a gap the others cannot. **The law is who *writes*.**
MuPDF is the structural writer of record. Nothing is ever written by one engine
and re-read for truth by another.

**MuPDF is reached natively**, as a shared library built from source and bound
with koffi behind a thin flat-C shim, running in the contained `mupdfHost`
process this application creates (§2,
[ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md)) — never as
WASM, and never by spawning `mutool`. That is what gives
`DocumentService` a **held document handle**, which is the difference between a
mutation costing 0.004 ms and costing seconds
([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md)).

Violating that breeds two specific pathologies, both banned at the root here:
**sidecar hacks** (data smuggled through unrelated PDF fields so the writer's
model survives a round trip through a reader that cannot express it) and
**fragile identity joins** between two parsers' object numbering.

| Concern | Writer of record | Reader for view model |
|---|---|---|
| Rendering, text layer, text selection, search display | — (presentation) | **PDF.js** |
| Page tree ops: delete/insert/extract/merge/split/crop/resize | **MuPDF** | MuPDF |
| Page reorder | **MuPDF** — inheritable attributes pushed down, then the root `/Kids` rebuilt in place, per invariant L6. **`rearrangePages` is banned** (it orphans `/AcroForm` even for an identity permutation), and so is permuting `/Kids` directly (on a nested tree that permutes subtrees and drops inherited `/Rotate`). See [ADR-0006](DECISIONS/0006-engine-capability-spike-results.md) | MuPDF |
| Annotations (all types), appearance streams | **MuPDF** | MuPDF |
| Form fields: fill | **MuPDF** | MuPDF |
| Form fields: flatten | **MuPDF** — `bake(false, true)` | MuPDF |
| Form fields: create | **@cantoo/pdf-lib** — the one concern MuPDF has no API for | MuPDF |
| Metadata, outline/bookmarks, encryption, permissions, redaction, optimize | **MuPDF** | MuPDF |
| Print & export rasterisation | **MuPDF** | — |
| In-place text editing (line/run rewriting), styled runs, HD render | **PDFium** | PDFium |
| Content composition: new document generation (markdown/CSV/TOC/image-to-PDF), drawing onto pages (watermark, headers/footers, Bates, OCR text layer) | **@cantoo/pdf-lib** — pdf-lib itself is unmaintained since 2021-11-06 | — |
| Digital signatures (PKCS#7) | **@signpdf** | node-forge (verify) |
| Text extraction, plain and layout-preserving | — (read-only) | **MuPDF** structured text. The founding record's "layout-preserving when Poppler available" is withdrawn: Poppler was named in no matrix row and no provisioning list, and MuPDF exposes block, line and span geometry. **The COLUMNS half is now executed** (2026-09-02, MuPDF 1.28.0): lines never merge across a gutter at 268pt or 60pt, and `FZ_STEXT_SEGMENT` yields column-major reading order — so no second engine and no clusterer of ours ([ADR-0034](DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)). **TABLES stay unexecuted**: `FZ_STEXT_TABLE_HUNT` was measured only against prose, which it damages, and no fixture here contains a table ([ADR-0013](DECISIONS/0013-pdfa-export-and-text-extraction-engines.md)) |
| PDF/A-2b export (Stage 8) | **Ghostscript** — MuPDF has no PDF/A output mode and veraPDF validates without converting. **Not provisioned and not shipped until Stage 8 builds the feature**: a binary in the 1.0 installer that nothing calls is the wired-tools rule one layer down. Row **unexecuted** ([ADR-0013](DECISIONS/0013-pdfa-export-and-text-extraction-engines.md)) | — |

### 3.1 The matrix is evidence, and stays that way

**This table was provisional and is no longer.** Every row above was executed
against a real document before the kernel was built on it, and the results are
in [ADR-0006](DECISIONS/0006-engine-capability-spike-results.md) and
`docs/ENGINE-SPIKE.md`.

That mattered: **two of the founding matrix's three stated justifications were
false**, and the most consequential finding was one no type declaration could
have revealed — MuPDF's `rearrangePages` reorders pages correctly while
silently dropping `/AcroForm`, even when passed the identity permutation.
Reading the API surface would have produced confidently wrong architecture.

`scripts/spike/engineSpike.mjs` is kept and runs in CI as a **regression gate**.
Each case records the verdict this table depends on, and the script fails when
reality differs — so an engine upgrade that changes any of these behaviours
turns the build red rather than quietly invalidating the matrix underneath it.

Adding a row still means executing it first.

### 3.2 Standing rules

- **PDF.js is never a source of truth.** It renders. The renderer's annotation
  and form models come from the kernel via the view model.
- Engine handles are cached in `DocumentService`, created lazily, and **all
  invalidated together** on any mutation. One parse per engine per version,
  maximum.
- If MuPDF's JS API genuinely lacks a needed write, document the gap — which API
  was checked, what is missing — and pdf-lib may take that concern, recorded as
  an ADR so the matrix stays truthful. **The matrix is law; silent second
  writers are defects.**
- Adding an engine requires an ADR: the gap, the engines checked, the licence
  and its AGPL interaction, the process it runs in. A fifth engine is not
  forbidden; an undeclared one is.
- **A declaration is not an implementation, and they are separate modules**
  ([ADR-0026](DECISIONS/0026-a-declaration-is-not-an-implementation.md)). What a
  command *is* — its writer of record, its invertibility, its undo strategy, its
  reproducibility, its replay strategy — is declared in a module that imports no
  implementation and therefore reaches no engine. The functions are composed
  onto that declaration in a second layer, imported only by the executor that
  runs them.

  **One declaration in two layers, never two tables.** A command is declared in
  exactly one place, and a kind declared without an implementation does not
  compile — the same rule that already forbids a second spec table, applied to
  the split rather than violated by it.

  The reason is measured rather than aesthetic: every routing consumer reads
  `spec.writer` and nothing else, and `apply`/`capture`/`invert` have gone
  through the registered writer since [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md)
  Decision 10. So a value import of the spec table bought routing and paid for
  a 46 MB native binding, and had done since the day Decision 10 landed. **An
  edge can outlive the reason for it, and nothing about the code looks wrong
  afterwards** — which is why this is stated here rather than left as a
  refactor somebody may undo.
- **Text inside Form XObjects** (how Office and InDesign emit text): implement
  **normalize-then-edit** — on first edit of such a page, promote the XObject
  content into the page content stream with its matrix composed in, then edit in
  flat space. A hand-rolled content-stream parser is the **last** resort,
  permitted only after normalization provably fails a corpus case, and then
  quarantined behind one interface with an ADR.
- **The text substrate owns the engine's OPTIONS and implements no clustering**
  ([ADR-0034](DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)).
  Glyphs into lines and lines into reading order is MuPDF's structured text, and
  exactly one kernel module names the `fz_stext_options` flags — so editing,
  Excel export, search and extraction cannot ask the engine different questions.
  `FZ_STEXT_SEGMENT` is **on**; `FZ_STEXT_TABLE_HUNT` is **off** and is a
  per-consumer opt-in that owes its own reading.

  Measured 2026-09-02 on MuPDF 1.28.0, against fixtures whose correct grouping is
  a fact about the generator rather than an opinion of the thing under test: the
  engine's lines never merged across a gutter at 268pt **or** 60pt; `SEGMENT`
  turned row-major reading order into column-major at both widths and left
  single-column prose unchanged; `TABLE_HUNT` split one prose line into two,
  inventing a table, and undid `SEGMENT`'s ordering.

  **This supersedes `BUILD-PROMPT.md` Part E2's mechanism and keeps its
  purpose.** E2 asks that clustering exist once so no consumer re-derives it with
  constants *"required to mirror exactly"*; owning the options achieves that more
  strongly than owning an algorithm, because there is no algorithm for a second
  consumer to copy. **A second set of stext options anywhere is the K.0
  regression E2 names**, in the place the mechanism actually lives.

---

## 4. Undo, save, and versions

**The command log is the undo stack.** Each command records its inverse or is
marked non-invertible. Non-invertible commands (redaction, flatten, encryption,
OCR embedding) force a **checkpoint** — a byte snapshot taken before execution.
Checkpoints also occur every N commands to bound replay depth. Undo restores the
nearest checkpoint and replays forward minus the undone command.

Memory is "one document plus a few checkpoints". The rejected alternative —
full-byte snapshots rationed by a memory budget — has a worst case of several
resident copies of a large file.

**Every command declares two independent things, and conflating them is a
defect.** Invertibility answers *can this be undone*; reproducibility answers
*does repeating it produce the same result*. They are orthogonal, and a command
may be either, both or neither.

| | reproducible | **not** reproducible |
|---|---|---|
| **invertible** | records **intent** — replayed by re-execution | records **effect** — replayed by re-applying stored bytes |
| **not invertible** | records intent, plus a pre-execution checkpoint | records effect, plus a pre-execution checkpoint |

A command is **not reproducible** whenever re-executing it would produce
different bytes: digital signing stamps a timestamp and signs over an exact byte
range, OCR output changes with the engine version, AI operations are
nondeterministic by design, and PDF object identifiers are frequently random.
Such a command **records its effect rather than its intent**, and replay
re-applies that stored effect verbatim instead of re-running the operation.

This is stated before the first command exists because Stage 6 OCR and Stage 7
signatures both depend on it, and a log that assumed re-execution would have to
be rewritten rather than extended. Invariant 22's "no mutation may exist only on
the handle" is satisfied either way — by intent that can be re-run, or by an
effect that can be re-applied.

**Save is one pipeline:** flush each writer of record once → atomic write (temp,
fsync, rename, `.bak`, Windows `EPERM`/`EBUSY` retry ladder) → stamp saved
version.

**The pipeline has one mode, and the purpose of the save chooses it** — never a
default, never a setting ([ADR-0008](DECISIONS/0008-save-mode-is-determined-by-purpose.md)):

| Purpose | Mode | Why the format forces it |
|---|---|---|
| Removal — redaction, sanitize, flatten, encryption change, metadata scrub, password removal | **Full rewrite with object GC, zero prior revisions** | An incremental save appends; earlier revisions stay readable by walking the xref chain, so the un-redacted content is recoverable (invariant 19) |
| A digital signature must survive | **Incremental** | A full rewrite changes the byte ranges the PKCS#7 signature covers, invalidating it |
| Everything else | **Full rewrite, for now** | Conservative default; whether incremental should take over is an open question with a stated list of what must be executed to close it (ADR-0008) |

Every command that reaches the save pipeline declares which row it falls under.
A command whose purpose is removal cannot be added without classifying it.

Save invariants (hard-won; each has a mechanism):

- **A save never rewrites annotations it did not author.** `srcRef` marking;
  foreign subtypes and form Widgets pass through byte-identical.
  **Byte-identity is currently assumed, not measured.** The spike proves a
  foreign annotation *survives* a full save, which is a strictly weaker claim
  than that its bytes are unchanged — a full rewrite re-serialises every object,
  so if MuPDF normalises string encoding, filter choice or compression on round
  trip, this invariant is already violated. Executing that check is item 4 of
  [ADR-0008](DECISIONS/0008-save-mode-is-determined-by-purpose.md) and it can
  invert the save-mode default, so it is the first of that list to run.
- **Page reordering rewrites the page tree in place.** Rebuilding into a new
  document drops `/AcroForm`, `/Outlines`, `/Names` and `/OCProperties`.
- **Text edits save incrementally.** A full PDFium rewrite corrupts
  non-embedded font references.

---

## 5. The IPC contract — one definition, four generated surfaces

`packages/contract` defines every **renderer-facing** channel exactly once, with
a zod schema per params and result. Generated or type-derived from it:

1. the `ipcMain` registration — **exhaustive; an unhandled contract entry is a
   compile error**,
2. the preload bridge,
3. renderer types,
4. the browser-shim stubs, which must implement the full contract or fail to
   compile.

**All validation happens once, in the generated boundary wrapper.**
Hand-writing the same channel in several places drifts silently and surfaces at
runtime.

The worker protocol takes the same shape, and the **intended** vehicle is one
`defineWorkerContract` helper shared by both hosts. *That helper does not exist
yet* (finding XX-1, 2026-08-22). This paragraph asserted it in the present tense
from the founding record onwards, and two ADRs then reasoned from it as though it
were built. What carries the discipline today is `channel()` plus
`wrapHandler`/`wrapHandlers`/`createClient` in `packages/contract`, with
`frame.ts` beneath them for the byte-stream transport the engine host needs.
Whoever writes the worker protocol either extends those or builds the named
helper on top of them; what is settled either way is that there is **one**
validated-boundary discipline and not a second (B3a).

**A channel's DEFINITION lives where its schemas may live; the discipline is
what is shared** ([ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md)
Decision 11, 2026-08-26). The word *renderer-facing* above is doing work: the
engine host's channels are declared in `packages/kernel`, not here, and the
reason is a rule this document's own contract package already states.
`commands.ts` says inverses *"stay kernel-only: they carry structural prior state
the renderer must not see"* — and the host's `capture` channel answers with
exactly that prior state, so its result schema cannot be declared in the package
the renderer imports. Kernel is where both halves of the engine host run, so the
declaration is still exactly once and still through `channel()`, `wrapHandler`
and `frame.ts`. What would be a second discipline is a hand-validated boundary,
not a channel map in the package whose types it carries.

Errors cross every boundary **structurally**
(`{name, message, stack, cause}`), never as a bare string. Silent `catch {}` is
banned except with a comment stating what is swallowed and why that is safe.

**The engine host's pipe is a trust boundary, and it registers into this
discipline rather than beside it**
([ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md)).
Invariant 25's stated threat is code execution *inside* the host, so everything
arriving over that pipe is attacker-controlled and the parser is ours. That
obligation was identical with a `MessagePort`; what is new is the **wire
format** — a byte stream needs framing, and framing is where a hostile peer gets
its first move, before any schema is consulted. A framing layer beneath the
contract is a transport. **A second validation discipline beside the contract is
the defect** (B3a), and no host protocol may introduce one.

---

## 6. Renderer architecture

**State is per document.** A store instance per `DocId`, created on open,
dropped on close. Tab switching changes which store the UI reads — nothing is
snapshotted, restored, or re-parsed.

This makes an entire race class unrepresentable *by shape*: an async result
landing in the wrong document's state, and the next save writing one document's
content into another's file. There are no generation tokens to remember. Retain
a document-still-open check only where an async result can outlive its
document's close (invariant L10).

App-shell state (theme, active tab, panels, settings cache) is a separate small
store. **Never let a singleton store accumulate document state.**

**Registries drive the UI** (§7). `App.tsx` composes surfaces; it holds no
feature wiring, no dialog flags, and no large switch statements.

**Annotations use one geometry vocabulary.** Every annotation type registers a
geometry adapter (`bounds`, `transform`, `hitTest`) and a renderer; every tool
registers a controller (`begin`, `update`, `commit → Command`, `cancel`). The
overlay is a dispatcher, never a monolithic switch stack. Adding a type touches
one adapter and one renderer.

**Coordinates.** Five spaces exist — `PdfPoint` (y-up), `FitzPoint` (y-down),
`ViewportPoint` (CSS px), `XObjectPoint`, `RasterPoint`. They are **branded
types**; passing one where another is expected is a compile error. One
`PageTransform`, derived from the viewport transform and correct under `/Rotate`
and a non-zero CropBox origin, is the only converter; there is one affine
implementation in the codebase. **A lint rule bans bare y-flips** — an inline
flip silently assumes rotation 0 and a zero CropBox origin, the most expensive
recurring bug class in PDF UI code.

**CSS.** Design tokens in one global file; light/dark/high-contrast as token
remaps under `data-*` attributes; component styles in CSS modules; inline
`style={{}}` only for genuinely dynamic values.

### 6.1 Render quality — who draws the page, and why it stays sharp

**PDF.js draws every page the user sees.** It is presentation only and never a
source of truth (§3). **PDFium** is an optional higher-fidelity rasteriser
behind a setting, and **MuPDF** rasterises for print and image export, where
output goes to a file or a printer rather than to the screen.

Blurry text in a PDF viewer has one dominant cause, and it is not the engine:
**a canvas rendered at CSS pixels and then scaled up by the display.** On a 2×
display, a page laid out at 800 CSS px whose canvas backing store is also 800 px
is stretched to 1600 device pixels by the compositor, and every glyph edge is
resampled. It looks acceptable at 100% and progressively worse as the user zooms.

The rules that prevent it, all binding:

- **Render at exactly `devicePixelRatio × zoom`.** The canvas backing store is
  sized in device pixels and the CSS size in layout pixels; PDF.js is handed a
  viewport at that same scale. 1:1 device pixels, always.
- **Never supersample and CSS-downscale as a default.** Rendering at 2× and
  letting CSS shrink it *blurs* text rather than sharpening it — the resample is
  a low-pass filter. The `renderQuality` multiplier stays an explicit user
  setting, never an implicit workaround.
- **A CSS-stretched stale bitmap is permitted only transiently**, during a zoom
  gesture, and is always replaced by a true re-render (the two-tier zoom: instant
  stretch, then a debounced real render).
- **Above a zoom threshold, render tiles rather than whole pages**, so memory
  stays bounded at 400%+ instead of forcing a lower render scale.
- **Re-render on `devicePixelRatio` change** — dragging a window between a
  laptop screen and an external monitor changes it, and a canvas rendered for the
  old ratio is exactly the blurry case.

This is verified rather than asserted: the acceptance proof is a **perceptual
diff with a stated tolerance** at 100% and 200%, on 1× and 2× DPR, against
reference renders. Never an exact hash — a Chromium, font or driver update would
turn that red, and a flaky gate gets ignored, which is worse than no gate.

---

## 7. The registries — how every feature lands

A feature is finished when it is **registered**, not when it is wired.

| Registry | Entry | Derives |
|---|---|---|
| **Commands** (`UiCommand`) | id, title (i18n key), icon, shortcut, `when(ctx)`, `run(ctx)`, **`placements[]`** | ribbon, floating toolbar, menus, command palette, shortcut map, context menus, start-screen shortcuts |
| **Dialogs** | id, lazy component, props schema, **result schema** | one mount point, one focus trap, one Escape/backdrop handler, and the promise an opener awaits |
| **Settings** | id, type, default, category, i18n key, `secret?`, migration | the entire Settings dialog, persistence, export (secrets excluded) |
| **Annotation types** | geometry adapter, renderer, kernel writer mapping | overlay, panel, persistence |
| **Tools** | controller (begin/update/commit/cancel) | toolbar, overlay dispatch |
| **AI providers** | id, models, validateKey, chat, vision? | onboarding, settings, assistant |
| **Update providers** | detect, check, apply/redirect | About panel, update flow |
| **Import/Export formats** | id, extensions, direction, handler command | dialogs, file associations |
| **Cloud providers** | id, auth, list, fetch | cloud storage panel |

**A dialog that collects arguments ANSWERS the command that opened it**
([ADR-0038](DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)).
Opening one is a question: the host hands the body a `resolve` callback, and the
opener awaits a promise that settles with the parsed result or with `undefined`
when the dialog was dismissed. The command is what dispatches, so the table's
first row stays the only place a mutation is wired — and the gate is structural
rather than a rule, because a dismissal produces no value to apply.

`resolve` is **not** in the props schema. Props keep meaning *the data this
dialog was opened with*, and a function never has to be described by a
validator — which is the hole a callback-in-props would open in the one surface
that has no other error path.

**Placements are part of the command, not of the surface.** A projection needs
data to project from, so every command declares where it appears:

```ts
type Placement =
  | { surface: 'ribbon';        section: SectionId; group: string; order: number }
  | { surface: 'quick-toolbar'; order: number }
  | { surface: 'context-menu';  context: 'page' | 'annotation' | 'selection' | 'tab'; order: number }
  | { surface: 'start-screen';  order: number }
```

A command may carry several placements — Highlight legitimately lives in
Home › Quick tools, Comment › Markup, and the annotation context menu.

`SectionId` is exactly the eight sections of §10.3. The ribbon, floating
toolbar, context menus and start-screen shortcuts are all **derived** from
placements. **A hand-maintained layout file for any of them is the second wiring
place this registry exists to forbid.**

Chrome visibility is itself commanded: `view.toggle-quick-toolbar`,
`view.toggle-panel` and the layout-mode switch are registry commands, which is
what guarantees a hidden surface can always be restored from the palette or a
shortcut.

**Those two ids were written `view.toggleQuickToolbar` and `view.togglePanel`
until 2026-08-30, and the spelling is not cosmetic.** A command id is
`<domain>.<name>` — the same grammar as a `MessageKey`, lower-case and
dot-separated, hyphens inside a name — which is what every shipped id uses and
what `check:secondwiring` matches on to find a surface holding its own list of
commands. A camelCase id is invisible to that scan, so the law's own examples
described a shape the second-wiring check cannot see. Corrected in the body
rather than noted below it, because a reader copies an example.

`BUILD-PROMPT.md` Part C7 and M8 still spell them the old way and are not
edited — the founding record never is. **No amendment-log row is opened**,
because no decision changed: the grammar has been
[ADR-0029](DECISIONS/0029-how-the-registries-are-built.md)'s since the registry
was designed, and these were two examples written before it that nothing had
reconciled.

---

## 8. Cross-cutting services

- **Observability.** A rotating local log (`userData/logs`, capped, with a
  "Reveal log" menu item) is always on. Electron `crashReporter` is **opt-in,
  off by default**, with a consent prompt on first run. **No telemetry.** This
  is a privacy-respecting open-source app and its audience will read the network
  tab.
- **Recovery.** Crash-recovery sidecars for dirty documents, change-detected
  rather than timer-spammed, offered on next launch.
- **Native code arrives two ways, and they have different rules.**

  **Built from source by us.** MuPDF is fetched as source against a pinned
  SHA-256, compiled, and statically linked into `monstera_mupdf.dll` — a library
  this project produces. `mutool.exe` is **not** provisioned and **not** shipped;
  ADR-0010 withdrew it. The build records what it was built from and every
  script that loads the library refuses a stale one
  (`scripts/lib/shimBinary.mjs`). Because the linkage is static rather than a
  bundled upstream binary, the AGPL source offer covers the MuPDF version, our
  build configuration and the shim source — see ADR-0001's correction.

  **Downloaded as prebuilt binaries** (LibreOffice, `pdfium.dll`, and
  **Ghostscript from Stage 8 only** — it is not provisioned before the PDF/A-2b
  export that needs it, per [ADR-0013](DECISIONS/0013-pdfa-export-and-text-extraction-engines.md);
  a binary shipped for years before anything calls it is the wired-tools rule
  applied to components)
  are provisioned by a pinned, SHA-256-verified script: pinned version,
  host-locked download, size bounded independently of `Content-Length`, hash
  verified **before** any parser or unzipper touches the bytes. Spawned without
  a shell; `-dSAFER` for Ghostscript; isolated LibreOffice profile;
  kill-all-children on quit; resolved from `app.asar.unpacked` when packaged.
  The single implementation is `scripts/lib/fetchVerified.mjs`.
- **Network.** HTTPS only, host-locked per purpose, with an SSRF guard carrying
  a private-range blocklist and a DNS-rebinding pin — re-validated on **every**
  resolution, not just the first — for user-supplied URLs.

- **Distribution is the Microsoft Store, and only the Store.** The website
  carries information and its download button links to the Store listing. **No
  direct download exists**, so no installer flavour, no signing certificate in
  use, and no self-update path.

  The two-flavour design is **kept as a seam and not deleted**. The flavour
  switch stays, `WebUpdateProvider` stays **registered with no implementation
  behind it**, and the signing certificate stays as an **empty build config
  value**. A signed direct download may be added later, and when it is it must
  be a configuration change rather than an architecture change. That is the
  reason the seam exists — it is not dead code, and removing it converts a
  future config change back into an amendment.

- **Updates come from Windows, not from us.** The Store updates its apps in the
  background by default, staging the package and applying it on close. **The
  application must never attempt to install its own package, and must never
  override a user who has disabled automatic updates.**

  `StoreUpdateProvider` adds only what the Store does not:

  1. **A version check against a static JSON manifest we host** — current
     version, minimum supported version, and a `security` boolean. A plain
     HTTPS GET of a static file that **sends nothing**: no machine identifier,
     no install ID, no usage data, no query parameters. This is the
     application's only call to our own server, and its audience will read the
     network tab.
  2. **An in-app indicator** when a newer version exists, with a button opening
     the Store listing through the Store protocol link. A `security` release
     shows a notice requiring acknowledgement.
  3. **A settings entry to disable the check**, describing exactly what it sends
     and what it fetches. Default on.

  The `security` flag is the join between the advisory tracker and the user: the
  tracker decides how fast a fix can ship, this decides how fast it arrives.
  ([ADR-0018](DECISIONS/0018-distribution-is-the-microsoft-store.md))

---

## 9. Invariants

A regression against any of these is a defect **regardless of what the tests
say**.

1. Renderer sandbox on; preload uses only `contextBridge`, `ipcRenderer` and `webUtils`.
2. The renderer never holds a filesystem path or document bytes it can mutate.
3. All coordinate conversion goes through `PageTransform`; a bare y-flip is banned.
4. One writer per concern (§3); PDF.js is never a source of truth.
5. A save never rewrites annotations the app did not author.
6. Page reordering rewrites the page tree in place.
7. Every replaced PDF.js proxy is destroyed.
8. PDFium never runs in the main process.
9. Downloaded executables are hash-verified before any parser touches them.
10. Async results check their document is still open before committing.
11. Cross-process payload size never scales with document size per operation.
12. Secrets: OS keychain or refused; never plaintext, never exported, never logged.
13. Every fix ships a proof with a control case, and CI runs all proofs.
14. Main's history is append-only: no force-push, no rewriting published commits.
15. No secrets, no binaries and no real-world personal-data fixtures ever enter
    the repository. The pre-commit hook and CI secret scan enforce this; their
    absence is itself a defect.
16. No raw colors or magic pixel values in components — design tokens only. No
    emoji as UI icons, anywhere.
17. Memory is budgeted **per process**, each budget argued from what that
    process is for — never from the measurement it is meant to constrain. A
    budget set only from the measurement it constrains can never fail. The
    two-term cost model and the admission gate an earlier revision of this
    invariant carried are **withdrawn**: they were fitted to WASM, which
    materialises objects eagerly because it cannot page from disk, and MuPDF is
    no longer reached that way
    ([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md)).

    Three budgets, by name and by argument. **`main`** holds canonical bytes and
    never parses, so exceeding its budget means parsing crept back in — **and it
    never holds a document's extracted text either, transiently or otherwise**
    ([ADR-0035](DECISIONS/0035-extracted-text-is-never-resident-in-main.md)).
    That text is a third thing, neither canonical bytes nor a parse `main`
    performs, so this sentence did not reach it: measured 2026-09-02, a
    text-heavy document's extracted text is **3.59× the file size**, which is
    more than twice `main`'s whole declared multiple on the text alone, before
    the canonical bytes it already holds. Text is read a page at a time,
    searched and dropped, so what is resident is bounded by the largest page. The
    **`mupdf-host`** budget is a *containment* limit: a breach means
    kill-and-restart, never a raised number. The **`renderer`** budget is
    **provisional and two-term** — a file-size-proportional term plus an
    absolute bitmap-cache cap — and a number invented for either now would be
    the mistake ADR-0007 records.

    **The two terms' preconditions are no longer the same, read 2026-09-03.**
    This clause said neither was assertable *"until a renderer exists to
    measure"*, and one now does: it opens documents, draws pages and holds two
    parsers when a reader compares. So the **proportional** term's stated
    blocker has expired, and what it now waits on is an instrument —
    `perf:gate` measures roles by spawning them, and no role composes a
    renderer. The **cap** term's blocker has not expired and is a different
    thing: there is no bitmap cache to cap. A page slot drops its canvas when
    it leaves the scroller's margin, and only the ACTIVE document's view is
    mounted, so nothing retains a bitmap for a page or a document that is not on
    screen. Compare holds two live views and both are being looked at, which is
    two documents' worth of draw rather than a cache.

    Stated here rather than left as one sentence covering both, because a
    precondition that has expired for half a claim is how a claim goes on
    reading as blocked.

    **The multiple is of the document's cost, not of the process's footprint.**
    It is measured as peak RSS *above that process's own fixed baseline* — the
    runtime, the loaded engine, the process itself — because those do not scale
    with the document and the ratio exists to detect what does. Including a fixed
    cost makes the multiple a function of document size rather than of behaviour:
    a small document reports a large multiple however correctly the process is
    behaving, and a large one hides a regression inside the rounding. Measured,
    `main` holding exactly one copy of a 25 MB document breaches its budget on
    the runtime's own footprint alone. Each role's baseline is measured, never
    assumed, by running that same role against a trivially small document.

    **The absolute cap is not baseline-adjusted.** It bounds the whole process,
    because the machine pays for the baseline too, and containment is about what
    the machine has to survive.

    **The baseline is itself budgeted**, and that third term is not bookkeeping:
    without it a baseline regression is invisible to the other two. Because the
    multiple is taken *above* the baseline, anything that inflates the fixed cost
    inflates the subtrahend as well — an engine that begins preloading fonts, a
    cache warmed at startup — so the ratio holds steady while the process grows
    by hundreds of megabytes, and the absolute cap does not object until it is
    gigabytes late. Each baseline is argued the same way as the budgets it sits
    beside: `main` runs the language runtime and the foreign-function binding it
    needs to create a contained engine host — `kernel32.dll` and `advapi32.dll`,
    and nothing else. Its fixed cost should be within a small factor of a bare
    interpreter plus that binding, and anything more means it is loading
    something it has no business loading. `mupdf-host` carries the same binding
    **and** the statically linked engine, so its fixed cost is larger by the
    engine's own footprint — but the engine's fixed cost is meant to be a
    fraction of the runtime's, not a multiple of it.

    > **A SECOND AMENDMENT IS OWED TO THIS SAME CLAUSE AND HAS NOT LANDED.**
    > [ADR-0025](DECISIONS/0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md)
    > owes `mupdf-host` a derived baseline, and it is blocked on two things its
    > own closing section names: host readings across days under the pinned
    > runtime, and those readings taken through the real host rather than
    > `hostFixedCost.mjs`. Recorded here, in the sentence both amendments touch,
    > because two independent edits to one clause is how a document acquires a
    > contradiction — and the last sentence above is the one ADR-0025 will
    > rewrite: the ratio it asserts is **already falsified on two machines**,
    > measured at 1.06× on the runner and 1.05× here.

    **A baseline budget has an UPPER bound as well as a lower one, and the upper
    bound is what makes it a detector** ([ADR-0025](DECISIONS/0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md),
    2026-08-26). It must sit above the honest measured fixed cost of every role
    it governs — or it fails on correct code — and **below that cost plus the
    smallest thing it exists to catch**, or it cannot fail for the reason it was
    written. `main`'s previous value satisfied the argument above and not the
    ceiling: it was set by that argument alone, with no measurement recorded, and
    landed within a megabyte of a bare interpreter *plus the whole kernel barrel*
    — so a native library inside `main`'s fixed cost passed the budget on the CI
    runner and was found only because a control is variance-sensitive. Each
    baseline therefore carries its derivation — what was run, when, and what it
    read — in the ADR rather than in an argument alone. `mupdf-host` **no longer carries a
    multiple at all**, and that is a decision rather than an omission
    ([ADR-0033](DECISIONS/0033-a-ratio-budget-governs-a-process-that-holds-bytes.md),
    2026-09-01). Its `6x` was exceeded by the real host on both content shapes
    where the model `perf:gate` asserts against cleared them, and the two
    breaches **disagreed about which document was expensive**: 6.26x cost
    1.34 GB and 7.83x cost 284 MB. A ratio against file size states something
    about a process that HOLDS bytes — which is why `main`'s stands and is
    argued from *"main holds canonical bytes and never parses"* — and the host
    parses, where cost tracks content shape. The absolute is enforced by the job
    object and read back off it (invariant 25(b)); the multiple had no mechanism
    and could not have one, since a job object has never heard of the file the
    document came from.

    **What that gives up is stated in the ADR rather than left to be
    discovered:** the multiple was the only term keyed to input size, so a small
    hostile document producing a large parse now clears every term. That is
    consistent with this budget being a containment limit rather than a
    detector, and it is why a term keyed on something a parser's cost actually
    tracks is recorded there as open.

    > **Memory budgets:** `main = 1.5x, 1.5 GB, base 80 MB` ·
    > `mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`
    >
    > That line is machine-read, and it is the **only** place this section
    > states these numbers — the prose above names each budget and argues it,
    > and deliberately does not repeat a value.
    > `scripts/lib/memoryBudgets.mjs` parses it, and the performance assertion
    > takes its limits from there rather than from a constant. A constant is how
    > a withdrawn number returns: prose repeating one is caught by the
    > withdrawn-phrase check, and code enforcing one is not, because a constant
    > reads `650 * 1024 * 1024` rather than `~650 MB`.
    >
    > The parse has no default and no fallback. A missing or malformed line
    > fails the build; it never yields a value, because a fallback limit is
    > indistinguishable from a measured one at the moment it matters.
    ([ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md),
    [ADR-0012](DECISIONS/0012-memory-budgets-are-machine-read-from-the-invariant.md))
18. **A failed save never loses work.** The command log lives in main and
    survives a host crash, so a save failure is answered by killing the host,
    restarting, reopening from the last-saved bytes, replaying the log, and
    telling the user what failed — never by a dialog whose only option discards
    their edits. The original file is intact until the atomic rename. Proven
    with a control case that shows the same scenario losing work without the
    guard.

    **(i) Where the engine is permanently refused, that sequence is unavailable
    and this invariant still binds.** [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md)
    Decision 9a poisons a document at two consecutive engine failures and gives
    it **no reopen**, so *restart and reopen* has no attempt left to make. What
    the invariant requires of a poisoned document is a **property**, not that
    sequence: its command log is retained, the last-saved bytes on disk are
    untouched, it is refused engine work rather than closed under the user, and
    the user is told which document and why. Close-and-reopen is the route back
    and it is the **user's** to take — an application that took it for them
    would be choosing which of two documents' edits to keep.

    **(ii) The mechanism is FORWARD REPLAY BY RE-APPLIED INTENT, chosen
    2026-09-04 once both of this clause's triggers had fired**
    ([ADR-0037](DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)).
    A document whose engine session is gone — a dead host, or a poisoned
    document the user reopens — is brought back by opening a session on the
    canonical image and re-applying each applied log entry's command, in order.
    Every command declared today is `replay: 'reapply-intent'`, and
    `CommandBus.redo` makes a spec declaring otherwise a **compile** error
    rather than a silent wrong branch, so the mode this rests on cannot widen
    unnoticed. Where the applied prefix contains a terminal entry, its
    checkpoint is a **starting point that shortens the replay** and is never
    required for correctness: *terminal* means prior state could not be
    recorded, not that the command is irreproducible.

    **The triggers were `CheckpointRestoreNotBuiltError` being deleted and
    `document.close` being declared, and both have fired.** The first is
    ADR-0037's own feature commit. The second fired on **2026-09-03**, one
    commit earlier, and nobody noticed — `packages/contract/src/channels.ts`
    declares `document.close` at `:545`, while this clause went on saying the
    table held ten channels and no close. A trigger whose only mechanism is a
    sentence in a document fires into that document; the reader it was waiting
    for was the author editing the channel table, and an event-keyed claim
    belongs on a `docs/FEATURES.md` row where something reads it.

    **What is chosen here is the mechanism, not the schedule.** When replay runs
    is the supervisor's question — `onEngineHostEnded` rebuilds inside each
    document's lane today and hands back a session at the last-saved state — and
    it is owed a `docs/FEATURES.md` row rather than a paragraph here. Until that
    row lands the exposure below is live, and stating it is what keeps it from
    reading as closed.

    **The exposure that remains.** A host death loses every command since the
    last save, bounded to that event, with **no refusal available to it**:
    `recycle` may refuse a document whose log holds entries because recycling is
    optional, and a dead host must be rebuilt for. `onEngineHostEnded` rebuilds
    a dead host's sessions in each surviving document's lane
    ([ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md)
    Decision 9c) and nothing replays the log onto them (§2, corrected
    2026-09-01). Clause (i) is unaffected — it is a property of a *poisoned*
    document and binds whatever the route.

    One candidate is already excluded rather than merely unchosen: resurrecting
    the poisoned session is not available, because
    [ADR-0009](DECISIONS/0009-document-identity-and-the-command-log.md) §7
    removed resurrection **by construction** and not by rule.
    ([ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md),
    [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9a)
19. A save whose purpose is **removal** — redaction, sanitize, flatten,
    encryption change, metadata scrub, password removal — is never incremental,
    and its output carries zero prior revisions. An incremental save appends and
    leaves earlier revisions readable by walking the xref chain backwards, so a
    redaction saved incrementally is recoverable. This is a property of the file
    format, not of any engine.
    ([ADR-0008](DECISIONS/0008-save-mode-is-determined-by-purpose.md))
20. **No native engine code runs in the main process** — generalising invariant
    8 from PDFium to MuPDF, which is now reached through a native shared library
    rather than WASM. A native fault is uncatchable wherever it happens, so both
    engines live in **engine hosts** — processes this application creates, not
    Electron utility processes (§2,
    [ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md)).
    Every `fz_try`/`fz_catch` pair stays
    inside one exported shim function and what crosses the ABI is an error code,
    because a `longjmp` unwinding through koffi's frames is undefined behaviour.
    ([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md))
21. **MuPDF caches a page's object graph for the document's lifetime.** This is
    settled and closed: a cache, not a leak — a second pass allocates nothing,
    purging is counterproductive, every byte returns on close, and no engine
    change avoids it. The viewer never pays it, because scroll layout reads page
    geometry from the dictionary (10 MB where a full page walk costs 370 MB) and
    only visible pages are loaded. Whole-document walks are explicit operations,
    not a viewing path.
    ([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md))
22. **An engine handle is a cache, never the truth.** Everything on it derives
    from canonical bytes plus the command log, so it may be dropped and rebuilt
    at any point *between* commands, and rebuilding returns memory to the
    open-cost floor. The condition this places on every command: **no mutation
    may exist only on the handle** — either as intent that can be re-executed or,
    where re-execution would produce different bytes, as a recorded effect that
    can be re-applied (§4). Handle lifetime is therefore not document lifetime.
    §2 states no recycling schedule, because the host containment budget already
    decides when under pressure; it does require that recycling be callable at a
    deliberately chosen moment too, since pressure arrives mid-scroll and the
    rebuild costs re-reading the current page.
23. **The shim names the engine entry point it wants; it never hands a path to a
    format dispatcher.** Wanting a PDF means calling the PDF constructor. It
    never means passing a filename to a chooser and letting the extension decide
    which code runs. This extends invariant 2 — a path never reaches a position
    where it can drive behaviour — across the native boundary, the one place it
    had not been stated.

    The mechanism it closes is real and live in the shipped binary:
    `fz_new_document_writer` selects a writer from a **file extension**, so a
    path ending `.ocr` starts Tesseract, and through it Leptonica, with no caller
    naming a single OCR symbol. `FZ_ENABLE_OCR_OUTPUT` defaults to 1 and the
    `Release|x64` configuration defines `HAVE_TESSERACT` and `HAVE_LEPTONICA`, so
    the dispatch is compiled in, not hypothetical.

    Nothing reaches it today — measured forward from all 24 exports, not
    inferred. That is precisely the reason for an invariant rather than a note: a
    fact that is *currently* true has to be re-established at every engine
    release, by whoever next writes an export, and it expires on someone
    remembering. The banned set is derived from MuPDF's own `is_extension`, so a
    writer added upstream joins it with no list to edit.
    ([ADR-0015](DECISIONS/0015-a-filename-may-not-select-a-native-library.md))
24. **Opening a document runs none of its content.** No embedded JavaScript
    executes, no automatic action runs, no external reference is fetched, and no
    embedded file reaches disk — until the user asks for it, explicitly, for that
    item.

    A PDF is a program as well as a page, and the process that parses it is
    parsing the single most attacker-controlled thing this application touches.

    **Measured 2026-08-31: no JavaScript interpreter is linked into the shipped
    shim.** This paragraph previously stated the opposite — that MuJS is linked
    and present in the process — and that was the invariant's stated rationale.
    MuJS's own registration strings (`Array.prototype.forEach` and its siblings,
    which exist in `thirdparty/mujs/jsarray.c` and cannot come from MuPDF's C)
    are absent from `monstera_mupdf.dll`, while MuPDF library strings are
    present; the same scan finds all three in a harness that calls
    `pdf_enable_js`. The mechanism is ordinary static linking: `pdf_enable_js`
    is referenced by exactly one file in all of MuPDF, `source/tools/murun.c`,
    and the shim references nothing in `pdf-js.c`, so the linker never pulls
    that object — or MuJS behind it — out of `libmupdf.lib`.

    **That is a property of the call graph, not of the build, and the
    distinction is the whole of what is owed here.** One call to
    `pdf_enable_js` anywhere in the shim brings the interpreter back, in a
    commit whose diff is one line. `FZ_ENABLE_JS=0` would make its absence
    structural; it is deliberately not set, because stages 3 and 4 anticipate
    JavaScript-bearing widgets and compiling the interpreter out forecloses
    that. So the containment rests on nothing calling it — which is the shape of
    claim this project has twice found resting on a guard that did not exist,
    once for `pdf_subset_fonts` and once for the EPUB handler the `"not a PDF"`
    check was refusing only *after* it had parsed the file. `proof:activecontent`
    is what turns it from a claim into a measurement, and it fails the day the
    interpreter arrives.

    `/OpenAction` is contained by a different fact, and a stronger one: MuPDF
    1.28.0 does not implement it. The key appears nowhere in `source/`, and its
    name table carries `AA` but not `OpenAction`, so there is no dispatch to
    contain. That is pinned by the same proof, because a version bump can change
    it.

    Pinned now because the open path is small now. Stages 3 and 4 add
    annotations, form actions and JavaScript-bearing widgets, and each arrives
    with a plausible reason to run something on open.
    ([Threat model §4.2](security/THREAT-MODEL.md))
25. **An engine host contains a compromise, not only a crash.** Every process
    that parses a document runs at the lowest workable integrity level, under a
    job object bounding memory and process creation, **with no network access**,
    and reaches no filesystem path it was not handed.

    Invariant 20 put native engine code **out of main** so a native fault
    could not take the application down. That contains a *crash*. A
    memory-safety bug that reaches code execution currently inherits everything
    the process has, and MuPDF's advisory history is memory-safety bugs.

    This was written as policy before mechanism — deliberately, because it is a
    property of processes that did not exist, and fitting it underneath them
    afterwards is the retrofit this project exists to avoid. The trigger was
    declared in `docs/security/engine-advisories.json`: the day shipped code
    referenced `utilityProcess`, the verdict expired and named this invariant.
    **That trigger catches "a host was written"; it cannot check "and it was
    contained"** — the runtime assertion that does is a scheduled row in
    `docs/FEATURES.md`, not an intention.

    **Corrected 2026-08-30 — the hosts exist, and the trigger this paragraph
    names can never fire.** `composition.ts` creates one and takes §5's verdict
    before binding a writer. And ADR-0022 chose `CreateProcessW` *because*
    `utilityProcess.fork` cannot create an AppContainer, so shipped code will
    never reference that symbol: a verdict keyed on it reads as armed and is
    watching for something this design has ruled out. The sentence is kept as
    the record of what was believed; what binds is the FEATURES row, whose event
    is a verdict taken against a **real** engine host rather than a spike.
    ([Threat model §4.4](security/THREAT-MODEL.md))

    **Amended 2026-08-22 — every property now has a mechanism, and two of them
    decide the process type**
    ([ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md)).
    Measured on a host with the engine actually in it: (a) and (b) are obtained
    on an Electron utility process, read by main against the child's token and
    from behaviour beside a control with no job. **(c) and (d) are not, and no
    Node-level mechanism will ever supply them** — the permission model is
    enforced inside Node's own filesystem bindings, so a `CreateFileW` walks past
    it, which is the general rule this invariant now carries: *only
    kernel-enforced mechanisms contain native code.* Of any proposed containment
    mechanism, **ask who enforces it before asking what it denies.**

    Both remaining properties are supplied by an AppContainer, which
    `utilityProcess.fork` cannot create. So the containment is a property of the
    **creation route**, and the paragraph above is the reason it is settled now
    rather than deferred: deferring (c) and (d) would defer the route, and the
    route is what everything else is built on. The hosts are processes this
    application creates (§2).

    **The trigger in `docs/security/engine-advisories.json` is therefore aimed at
    a symbol shipped code will no longer name.** Re-pointing it at the creation
    route is owed before the host lands; until then it is a check that can no
    longer see its subject, which is the reassuring answer arriving for the wrong
    reason.

26. **Plain Node never loads Electron; it spawns the pinned binary by name.**
    No file that `node` starts — everything under `scripts/`, the launcher
    included — may reach the `electron` specifier by any route: static import,
    `export … from`, `import()`, `require()`, or `require.resolve`.
    `apps/desktop/src/` is out of scope and is not an exception: it runs *inside*
    the Electron runtime, where the specifier is the API surface.

    **Corrected 2026-08-21 — that last sentence is true of the app and false of
    its tests.** A module under `apps/desktop/src/` that a `.test.ts` imports is
    executed by vitest in **plain Node**, where the specifier is the download
    trigger and not an API surface. Measured: `shellFailure.ts` wrote
    `import { type App } from 'electron'`, which TypeScript emits as
    `import {} from 'electron'` — a side-effect import that survives because the
    braces keep the specifier — and `node_modules/electron/dist` appeared at the
    minute its unit test first ran.

    Two consequences, both stated because neither is obvious from the rule
    above. **`import type { … }` is required, not preferred**, for Electron
    types in any module a test can reach; it is erased entirely and leaves
    nothing to execute. And **neither enforcer covers this route** — ESLint's
    boundary exempts `desktop`, the runtime scan's root stops at `scripts/` —
    so the thing that catches it is `proof:electronimports` asserting that
    `node_modules/electron/dist` does not exist, which is only meaningful when
    it runs *after* the test suite. CI ran it 90 lines earlier and would have
    passed.

    **Third case, 2026-08-22 — the engine host, which runs the Electron binary
    in NODE MODE**
    ([ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md)). The
    host is started as `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so the
    process *is* Node and the specifier is the download trigger again — the same
    hazard as the test case, reached a third way.

    Three occurrences is enough to name the axis rather than add a clause:
    **`apps/desktop/src/` is exempted as a proxy for a runtime property, and the
    proxy is what keeps failing.** `eslint.config.js` already says so where the
    plain-Node block is defined — *"may import Electron" is a property of code
    that RUNS INSIDE Electron, and package membership is only a proxy for that.*

    **Fourth case, 2026-08-25 — a worker thread, where the import SUCCEEDS**
    ([ADR-0024](DECISIONS/0024-execution-mode-is-a-placement-axis.md)). Measured
    by `proof:workermode` under the pinned binary: a `worker_threads` Worker
    inside Electron's main process has `process.versions.electron` **set** and
    `process.type` **undefined**, and `import('electron')` there yields a module
    carrying **no `app`** — while main's control in the same run carries one.

    This is the quietest of the four. The others broke at the import; this one
    succeeds and fails later at the first property access, where nothing points
    back at it. The runtime is the Electron binary while the APIs are absent,
    which is the pair a directory-shaped proxy cannot express.

    **So the axis is now stated rather than applied per occurrence, and where
    Node-mode code GOES is part of the map** (§2): outside `apps/desktop/`, and
    in `packages/nodemode` where its subject is not the document engine.
    Harness and probe files are in scope by the same test — which mode they run
    in, not that they are harnesses.

    This case is answered by **placement, not by a fourth clause**: the host
    body lives in `packages/kernel` and **not** under `apps/desktop/src/`.
    `MAY_IMPORT_ELECTRON` is an exception list naming only `desktop`, so every
    other package fails lint on the specifier by all four routes `patternsFor`
    covers, and TypeScript project references reject it independently at compile
    time. The host cannot name Electron, so there is no rule about when it may
    (B5). The factory that *creates* the process stays in `apps/desktop/`, where
    Electron is the API surface and the code genuinely runs inside it.

    The mechanism is that the import IS the download.
    `node_modules/electron/index.js` ends with
    `module.exports = getElectronPath()`, and that function calls
    `downloadElectron()` when the binary is absent. `--ignore-scripts` moves the
    fetch from install time to first use; it does not remove it. `install.js`
    then reads `electron_use_remote_checksums`, which repoints verification at a
    remote source — so the pin recorded in `scripts/provision/electron.mjs` is
    bypassed by the act of importing. Naming the provisioned path makes
    `getElectronPath()` **unreachable**: B5, not a discouragement.

    **Two enforcers, split by node type, because one authority does not claim
    both halves.** `no-restricted-imports` owns the four static shapes and is
    registered against `scripts/`; `scriptsLoadingAtRuntime` owns the runtime
    residue. That split is measured, not assumed — in ESLint 10.8.1,
    `ImportExpression` appears nowhere in `no-restricted-imports.js` and its
    visitor object has no `CallExpression`, so `import('electron')` and
    `require('electron')` pass it. Neither enforcer is a second opinion about
    what the other says (B3a).

    **The launcher lives in `scripts/`, and that placement is load-bearing.**
    Under `apps/desktop/` it would be invisible to both enforcers at once:
    ESLint's boundary is per-package and exempts `desktop` by design, and the
    scan's root stops at `scripts/`. A `.ts` launcher there would be *permitted*;
    a `.mjs` one would match no package glob — they end `.ts,.tsx` — and no
    `scripts/` glob either, so no rule would apply to it at all. Both mechanisms
    would return the reassuring answer. Moving it is a B4 amendment, not a
    refactor.

    **Two alternatives rejected on measurement, recorded so neither returns.**
    `ELECTRON_OVERRIDE_DIST_PATH` does short-circuit both `downloadElectron`
    sites, but `index.js:31` joins it with `executablePath || 'electron'`, where
    `executablePath` comes from `path.join(__dirname, 'path.txt')` — `__dirname`
    being *the dependency's* directory, not the override's. With no `path.txt`
    it yields `<dir>/electron` and drops the `.exe` on Windows, turning a loud
    "downloading" into a confusing "file not found"; making it work means
    writing inside `node_modules/`, which `npm ci` erases. Setting it is worse
    than not setting it. And an `.npmrc` carrying `ignore-scripts=true` would
    disable this repository's own `prepare` script, silently disarming the
    secret scan and the escape-resolving-write guard — worse than the problem it
    solves.

    **Two stated limits, because a green result here means less than it looks.**
    A computed specifier — `import(name)` — cannot be read by a parse, so the
    scan reports it as a third state, *unreadable*, rather than as absent; each
    site is listed with a reason in `ACCOUNTED_COMPUTED`. And that list's
    declared count is **quantity, not identity**: a site swapped for a different
    computed load keeps the count and leaves the recorded reason describing a
    call that no longer exists. Neither is fixed by a checker; both are stated so
    the mechanism is not read as more than it is.

27. **The renderer's Content-Security-Policy is exactly this list.** One
    directive per line; the header is these lines joined with `; `.

    ```csp
    default-src 'none'
    script-src 'self'
    style-src 'self'
    img-src 'self' data: blob:
    font-src 'self'
    media-src 'self' blob:
    connect-src 'none'
    object-src 'none'
    base-uri 'none'
    form-action 'none'
    frame-ancestors 'none'
    ```

    **This document is the writer of record**, and the entire value of pinning a
    CSP is that loosening it becomes a diff in *this file* that someone has to
    justify — which only works if this file is the authority.
    `CONTENT_SECURITY_POLICY` in `apps/desktop/src/windowPolicy.ts` is the
    derived form.

    **§9.17 holds the pen for the memory budgets in the same direction, not the
    opposite one.** What differs between the two concerns is not who writes but
    whether the derived side keeps a **copy**. §9.17 states its numbers on one
    machine-read line and `scripts/lib/memoryBudgets.mjs` parses that line, so
    no copy exists and nothing can drift — which is why the check there points
    at *prose*: `check:docs` fails when the section restates a number, a second
    copy inside the section being the only way one can appear. A renderer cannot
    parse a markdown file and needs a header string, so here a copy is
    unavoidable, and `proof:rendererpolicy` exists because **a copy that exists
    must be proven equal**. `ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES` is the
    third case and the rule reaches it too: `apps/desktop/` cannot import a
    `scripts/` module, so the number is copied and `proof:composition`
    recomputes it. Copy only where the reader cannot reach the source; prove
    every copy you make. All three are B3, one writer per concern.

    **Four links, and each one is checked** (`proof:rendererpolicy`): the block
    above equals the constant; the constant equals the header **as Chromium
    received it**, read from the response and never from the constant that set
    it; the renderer is observed *refusing* a `connect-src` fetch and an `eval`;
    and a control asserts that a policy we do not serve is not reported as
    delivered. Delivery is covered for all eleven directives. **Enforcement is
    covered for two of them** — `connect-src` and `script-src` — because a header
    can arrive and be ignored, and Chromium drops a directive list it cannot
    parse. The other nine are pinned and delivered rather than exercised.

    **Order is part of the pin, and Chromium does not care about it.** The
    comparison is string equality, so a reordering fails it. That is a
    legibility choice: a set comparison would let the list be shuffled with no
    diff to read. Stated here because the tempting repair for a failing
    comparison is to sort both sides, which would spend the property to silence
    the check.

    **`style-src` grants `'self'` and nothing else, and this list carried
    `'unsafe-inline'` up to the moment it was pinned.** Nothing in this
    repository needs it: the renderer document is empty. Pinning it would have
    turned an unproven grant into law by arriving early — the precise failure the
    pin exists to prevent, since after this every relaxation must be argued and
    an inherited one never would be. The asymmetry decided it: keeping an
    unneeded grant fails **silently** — an injected `<style>` simply works —
    while dropping a needed one fails **loudly**, at development time, with a
    violation naming `style-src`.

    **What can actually trip it, corrected 2026-08-21.** This paragraph first
    named Vite's dev-server HMR, which **cannot** reach this directive: the
    window loads `RENDERER_HTML` as a `file://` URL, `lockNavigation` pins
    navigation to exactly that href, `connect-src 'none'` forbids the HMR
    socket and `script-src 'self'` forbids the dev-server origin. A
    dev-server renderer is a whole-policy question across four directives, and
    it must not be reachable by an argument about inline styles.

    The real exposure is narrower. `style-src` governs `<style>` elements and
    `style=` attributes; it does **not** intercept CSSOM writes, so React's
    `style` prop — which goes through `node.style.setProperty` — and
    `onColor()` computed at the point of use are unaffected. What can trip is a
    library that injects a `<style>` element or sets a style attribute at run
    time. **PDF.js's text and annotation layers are the first candidate**, and
    the measurement is **still owed with its trigger sharpened** rather than
    taken: `pdfjs-dist@6.2.108` became a dependency of `packages/ui` on
    2026-08-29, and the path built with it rasterises to a canvas and builds
    **no text layer and no annotation layer**. So the dependency arriving did
    not reach the exposure, and what owes the reading is now the first render
    that builds one of those layers — not the commit that added the package.

    **The policy is never split between development and production.** A
    dev-only CSP means the policy `proof:rendererpolicy` verifies is not the
    policy that ships — the exact set-versus-enforced gap the read-back exists
    to close. Prefer changing the build, or a hash, over a blanket grant
    ([ADR-0019](DECISIONS/0019-the-renderers-csp-is-pinned.md)).

    **One stated limit.** Where no Electron runtime is provisioned, the three
    runtime cases print UNVERIFIABLE and never pass — *could not look* is not
    *looked and found nothing*. The two string-level cases, including the
    agreement with this block, run everywhere.

---

## 10. Design law

The app's look is part of the codebase's public reputation. This section is as
binding as §1–§9, and B4 applies to it. `docs/UI-GUIDE.md` is its practical
companion, with do/don't examples.

### 10.1 Identity

A calm, professional Windows desktop tool. Benchmarks: PDF-XChange Editor,
Word's ribbon, modern Windows 11 apps. Dense enough for professionals, never
cramped, never playful.

Brand: Monstera green as the default accent (`#16a34a`, user-customizable),
neutral gray surfaces, both dark and light themes first-class from the first
screen. Default theme follows the OS.

**The anti-goal, named:** the app must never look AI-generated or hobbyist.
Concretely banned — emoji glyphs as icons, mismatched paddings, default browser
form styling, inconsistent icon sizes, and spinner-only loading states on
surfaces whose shape is known.

### 10.2 Tokens, and contrast as computation

One token file defines the 2/4/8 px spacing scale, the type scale (chrome
10/11/12/13 — **10 px is the floor**; content 14/16/20; one display size), radii,
elevation levels, and the semantic color roles. Light, dark and high-contrast
are token remaps under `data-*` attributes. **Components consume tokens only**;
a raw hex value or magic pixel number in a component is a lint error unless the
value is genuinely dynamic (a user-chosen annotation color).

**Contrast is enforced, not audited.** CI computes it from the token file
itself, so the check never needs a wholesale exemption — an exempted check is
the green-check-that-verifies-nothing Rule 0 bans.

Every role declares a **category** and, for foregrounds and boundaries, the
**set of surfaces it may sit on** ([ADR-0003](DECISIONS/0003-token-role-typing-and-declared-pairings.md)):

| Category | Obligation |
|---|---|
| `surface` | none itself; is a background others are checked against |
| `text` | 4.5:1 against its **declared** surface set |
| `boundary-control` | 3:1 against every surface it may sit on (WCAG 1.4.11) |
| `boundary-decorative` | none; **lint forbids its use as a control boundary** |
| `fill` | none itself; if it carries a foreground it is also a `surface` |

**CI checks exactly the declared pairs — no more, no fewer.** Checking every
role against every surface is over-broad: it fails pairings that never render,
and the only escapes are a hand-maintained exception list or a blanket
exemption, both of which are the banned shape. Invariant L16 is what makes the
declaration exhaustive — a foreground that is not a token cannot exist, so a
pair the check does not evaluate cannot render.

Two consequences of the typing:

- **`--accent` is `fill`.** It never carries text or an indicator.
- **Borders are two roles, not one.** `--border-control` (inputs, the find and
  page fields, the command search, the layout switcher, secondary buttons,
  checkboxes, radios, select triggers, the zoom slider track) is held to 3:1.
  `--border` and `--border-soft` are decorative region dividers and separators
  and are exempt — holding a hairline panel divider to 3:1 would turn a calm
  dense tool into a wireframe. The values of `--border-control` are **solved**
  by `onColor(--border, all chrome surfaces, 3.0)`, not chosen by eye.
- **`--accent-soft` is a state surface** whose only permitted foreground is the
  derived chrome accent text. `--muted` and `--faint` do not declare it, so that
  pair is not checked — because it is not permitted to render, not because it
  was excused.

**The root rule — one function, not stored companions.** The token file declares
exactly **one brand accent per theme**, and every color that must clear a
contrast threshold is computed at the point of use:

```
onColor(brand, background, minRatio)
  → the nearest color to `brand` that clears `minRatio` on `background`
```

Every companion role is a derived output of that function against the element's
**real** background:

- accent text on chrome — `onColor(accent, chrome surfaces ∪ soft composites, 4.5)`
- the primary button — a theme-aware pair. Light: darken the fill until a light
  label clears 4.5. Dark and high contrast: keep the bright brand fill and derive
  a near-black label, because dark mode's primary button must read as the
  brightest accent on screen, not a darker cousin. The fill is treated as a
  surface and its label checked against it at 4.5:1.
- selection chrome on the page — `onColor(accent, page, 3.0)`
- the selected-thumbnail ring — `onColor(accent, the sidebar it actually sits on, 3.0)`

Freezing one more hand-picked hex per newly discovered background is the patch
shape; the function is the fix, because a pairing nobody has discovered yet is
still computed correctly, and it keeps working when the user changes the accent.
**Storing a derived color value is a defect.**

Coverage rules: alpha-overlay roles (`--accent-soft`) are evaluated
**post-composite** against each surface they sit on. Surfaces are defined per
render context — *chrome*, *overlay-on-page* (chrome graphics drawn over the
document: selection rectangles and handles, marquee, redaction marks, field
outlines, edit covers — checked at 3:1 against `--page`, which is never a
surface for chrome text but always one for chrome graphics), and *document*
(the PDF's own content and user-colored annotations: not chrome, not checked).

And the inversion that closes the category: **every rendered
foreground/background pair must resolve to a pair the check evaluates.**
Invariant L16 guarantees no unchecked foreground exists, fill roles that carry a
foreground are themselves surfaces, and **CI exercises the derivation function
across every (context, minRatio) pair** rather than auditing a list of frozen
hexes. Raw `--accent` never carries text or an indicator; small non-text
indicators (the unsaved dot, the slider thumb) use the derived chrome accent
text at 4.5:1 and therefore always clear WCAG 1.4.11's 3:1.

Spacing: control interiors use even values (multiples of 2 px); 4/8 px between
elements; the 8 px grid between layout regions. Mockup page-content art and
brand artwork are content, not chrome — scale and token rules do not apply to
them.

### 10.3 Layout anatomy

- **Title bar:** integrated document tabs (Window Controls Overlay), the Ctrl+K
  command search, and the layout switcher.
- **Left section rail:** the eight feature sections — Home, Comment, Edit,
  Organize, Forms, Review, Protect, Tools — as labeled icons. Selecting a
  section populates the top tool ribbon. Beside it, one document panel at a
  time — Pages, Bookmarks, Comments, Forms, Layers, Search — switched by a
  **panel-tab strip** of six icon tabs (24 px tabs, 14 px icons) at the panel's
  top, with the collapse chevron at the strip's end. The active tab names the
  panel via tooltip and accessible name; there is no separate title row. The
  strip is permanent chrome.
- **Top tool ribbon:** the active section's tools — captioned groups, hairline
  separators, compact 52 px buttons — collapsible.
- **Floating quick toolbar:** a vertical pill on the canvas edge with the
  always-needed tools (select, hand, text selection, zoom in/out, crop,
  snapshot, bookmark, comment); repositionable and hideable. Hiding and
  restoring it is the registry command `view.toggle-quick-toolbar` — in the
  palette, on a shortcut, and as a status-bar toggle — so it can never be lost.
- **Canvas** (the star, quiet chrome) → right contextual panel → **status bar**.
  The status bar always carries page navigation: first / previous / an editable
  "page ⁄ total" field (type a number, Enter jumps) / next / last — present
  whenever a document is open, in every layout mode including Focus. The zoom
  cluster is zoom-out button · slider · zoom-in button · current percentage ·
  fit mode, all real controls.
- **Both side panels are collapsible**: a chevron in the panel header collapses
  it; a slim edge handle on the canvas reopens it. State is persisted per panel.
- **Layout switcher:** a segmented control in the title bar toggling three
  chrome modes, persisted per user — **Ribbon** (default) · **Studio** (the
  ribbon is auto-hidden; selecting a section opens its full tool set as a
  temporary overlay below the title bar, dismissed on tool choice, Escape or
  click-away) · **Focus** (chrome hidden except the title bar, floating toolbar
  and status bar; Esc returns — the title bar stays because it holds the tabs
  and the way out). Focus supersedes per-panel collapse state; each panel
  restores its own prior state on exit. **The rail's state model is identical in
  every mode**: the active section persists, and selecting a section — including
  re-selecting the current one — is what opens the overlay in Studio. One state
  model, two presentations. **Modes hide chrome, never capability.**
- Everything on an 8 px grid; panels resizable with persisted widths; compact
  desktop density throughout.
- **Start screen** (never a conventional two-column launcher): centered hero —
  the app logo, "PDF EDITOR" letterspaced beneath, tagline "Built For The Way
  You Work" — then one primary green **Open PDF… (Ctrl+O)** button, then a grid
  of six feature shortcuts (Annotate & mark up · Fill & create forms · OCR
  scanned pages · Split & merge · Encrypt & sign · Export anywhere), **each a
  real entry point**. Recent files appear below the grid when they exist.
  Footer: "Press F1 for keyboard shortcuts" and version + © Tenslor Inc.
  Drag-drop a PDF anywhere to open.

### 10.4 Type, icons and controls

- System font stack (`Segoe UI` first on Windows). No webfonts for UI chrome.
- **One icon set: lucide**, consistent stroke, at exactly four sizes with a
  stated use each: **12 px** panel tabs and inline chrome · **14 px** status bar
  and dense controls · **16 px** primary controls (rail, floating toolbar,
  buttons) · **20 px** ribbon buttons. Brand artwork is art, not an icon, and is
  exempt. Every icon-only control has a tooltip and an accessible name.
- One primitive set, grown in the primitives package. Stage 0 builds `Dialog`,
  `Button`, `IconButton`, `Input`; the rest (`Select`, `Checkbox`, `Radio`,
  `Switch`, `Slider`, `Tooltip`, `Menu`, `Tabs`, `Panel`, `Toast`,
  `ColorSwatch`) are added the first time a feature needs them — **in the
  package, never ad hoc in the feature.** All keyboard-first. A screen composed
  of anything other than primitives and tokens is not done.
- **Accessibility is enforced at runtime, not by a static lint rule.** The
  obvious static choice, `eslint-plugin-jsx-a11y`, last shipped 2024-10-26 and
  declares no ESLint 10 support, so it is not adopted. The mandated gate is
  axe-core running on every Playwright-rendered screen from Stage 0, with zero
  serious violations — which is the stronger check anyway: it sees composed
  screens, focus order and real contrast, where a static rule sees one element's
  props. Revisit if jsx-a11y resumes releases; it would be a useful second layer,
  never the primary one.
- Behavior comes from a headless primitive library skinned with our tokens.
  Accessible focus traps, menus and comboboxes are exactly the class of solved
  problem Rule 0 says not to re-derive by hand. The specific library is chosen
  by ADR in Stage 0.

### 10.5 States are designed, not improvised

Every surface explicitly designs its **empty** state, **loading** state
(skeletons where the content's shape is known; progress bars with real numbers
for long operations), **error** state (what went wrong and what to do next), and
**no-key / no-binary** state. **"It just shows nothing" is a defect.**

### 10.5a The error boundary, and the one class component

React has **no function form for an error boundary**:
`getDerivedStateFromError` and `componentDidCatch` are class members, there is
no hook, and an uncaught render error unmounts the entire component tree. So
`BUILD-PROMPT.md` B7's *"React function components only"* is amended by a second
confined exception, alongside the `any` adapters
([ADR-0036](DECISIONS/0036-the-error-boundary-is-the-one-class-component.md)):

> **Exactly one module may declare a React class component:
> `packages/ui/src/ErrorBoundary.tsx`.** It holds error state and renders a
> fallback, and contains no application logic. `monstera/no-class-components`
> is an error over `packages/ui` and exempts that one path, so the exception is
> enforced by the tree rather than remembered.

**The boundary is mounted BELOW the state it protects**, and §10.5 requires a
designed error state; this one additionally promises that recovery is cheap,
which means: after a throw the reader returns to **the same document, the same
page and the same zoom**.

**Placement is necessary and it is not sufficient, measured 2026-09-03.** The
state naming those three lives above the boundary and survives the failure
intact — and a reset remounts the scroller, which seeds its first page as
visible and *reports* it, overwriting the preserved page a moment later. So a
reader who threw on page 40 came back with every piece of state correct and the
view at page 1. The reset therefore **re-issues the scroll request** through the
`goTo` seam that already exists for *put the reader here*, in the same event, so
the remounted view starts where the reader was. The document and the zoom hold
by placement alone; the page needs both.

That distinction is the transferable part: **a view that derives state from its
own mount will overwrite what was preserved for it**, and asking what a remount
*reports* is the question placement does not answer. A renderer that throws
loses no *work* for §2's separate reason: the truth is main's canonical bytes
and the command log.

### 10.6 Motion

120–150 ms, ease-out, on opacity and transform only. `prefers-reduced-motion`
and the reduce-motion setting disable all of it. **Never animate page-wrapper
geometry** — a width or height transition forces a layout pass per frame.

### 10.7 Visual QA

Playwright screenshot baselines for the start screen, each ribbon section, one
dialog and one panel, in **all three themes**, compared by perceptual diff with
a stated tolerance. Exact hashes go flaky on environment updates, and a flaky
gate gets ignored — which is worse than no gate. Baselines are regenerated
deliberately, in their own commit, never as a side effect.

---

## Amendment log

Every entry names the founding clause it supersedes and links its ADR.

| Date | Amendment | Supersedes | ADR |
|---|---|---|---|
| 2026-09-04 | **A byte-image writer's session is minted per command from the live session, and its result replaces both the session and main's canonical image** (§2, §8). Seven `docs/FEATURES.md` rows route to `@cantoo/pdf-lib`, which §3's matrix names at `:381` and the seam declares as `readonly 'pdf-lib': ByteImage`, and none could be built: nothing said where a byte-image `apply`'s input comes from or what becomes of the MuPDF session afterwards. **Two blocks recorded against it dissolve on a read** and are written down because the same misreadings are available to the next author — invariant 20 bans *native* engine code in main and pdf-lib is pure JavaScript with no binding, and the placement was already made by §3's matrix, so no host and no `hostBody.ts` generalisation is in question. **Input:** the live writer's `serialise`, never main's image, which finding OOOOO-1 measured as stale for the whole life of an open document — watermarking it would silently discard every command since open and produce a well-formed document built out of two states. **Result:** it replaces the live session through `DocumentRestore`, the mechanism [ADR-0037](DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md) already built and `composition.ts` already composes, whose entire parameterisation is *which bytes*. **A pdf-lib session is minted for one call and never stored**, which makes `documentCommands.ts`'s open B4 — *"two live-session writers each return the WHOLE document from `serialise` and nothing in the law says which bytes win"* — unaskable rather than answered, and leaves it live for PDFium in Stage 5. **The refresh ADR-0032 rejected is taken, on the trigger ADR-0032 itself wrote**, and the arithmetic is what changed rather than the judgement: its 2.00× was a serialise on every command where none was performed, and this is none per command on a path that already performs one — a byte-image `apply` returns its image, and the input serialise is the checkpoint `execute` already takes for every `terminal` entry, which every non-invertible content command is. The peak is bounded by a shape that already exists and ADR-0021 already prices. **Not measured and named so:** the wall-clock of that serialise on a large document. **Rejected:** running pdf-lib in the engine host (containment exists for native faults, and it puts the produced bytes across a pipe from the image they must become); applying to main's image directly (cheapest, and its failure is invisible — the wrong document is well-formed); refreshing after every command (ADR-0032's rejected option restored to spare a serialise already performed); keeping a pdf-lib session across commands (buys nothing, since `PDFDocument.load` re-parses, and costs exactly the question above); the bus inferring shape from the return value (an adapter that forgets its return becomes a document that silently stops updating, so the shape is declared and derived from one table). | §2's *"A mutation reaches the screen through the view model, not through the bytes … a `DocumentRecord`'s bytes are `readonly` and **a command never replaces them**"*, and [ADR-0032](DECISIONS/0032-the-view-model-is-a-scoped-query.md)'s *"Rejected: refreshing main's canonical image"* together with the trigger that row wrote against itself | [ADR-0039](DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md) |
| 2026-09-04 | **A dialog that collects arguments answers the command that opened it** (§7). `DialogEntry` was *id, lazy component, props schema* and had no way to produce a value: `mount` receives props and nothing else — no client, no close, no callback — so a body that wanted to apply a command had to obtain one from outside the registry. `docs/FEATURES.md`'s mutation-dialog gate row had named this gap since 2026-09-01 (*"what it could not build is a dialog that collects arguments a command then applies"*); the first such dialog is what fired it. An entry may now declare a **result schema**, the host hands the body a `resolve`, and `ask` returns a promise settling with the parsed result or `undefined` on dismissal. Three properties follow: the command registry stays the **only** place a mutation is wired; the gate is **structural**, since a dismissal produces no value to apply rather than a branch someone must remember; and the value coming out is validated by a schema exactly as the value going in is — Decision 7's *"the one surface with no other error path"* running in both directions. `resolve` is deliberately **not** a prop. **Rejected: a callback in the props**, which puts a function inside a `.strict()` validator whose whole purpose is checking what reaches the body — `z.custom<Fn>()` accepts anything callable, which is B7's `any` argument one layer down; **a context holding the client**, read by the body, which is the second wiring place §7 exists to forbid and makes every dialog body a potential mutation site; **a `confirm` on the entry**, which needs the client at declaration time, before the composition root exists — the ordering that keeps `flush` off `EngineSessionSource`; **a second command that runs when confirmed**, two entries for one feature where the second has no placements and must never appear in the palette; **keeping `show` beside a new opener**, two ways to open a dialog, which is B3a's shape — `ask` replaces it, and an informational dialog declaring no result settles `undefined` exactly as its callers ignore `void` today. | §7's dialog registry row, which read *"id, lazy component, props schema \| one mount point, one focus trap, one Escape/backdrop handler"* | [ADR-0038](DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md) |
| 2026-09-04 | **Invariant 18 clause (ii)'s mechanism is chosen: forward replay by re-applied intent, with a checkpoint as a starting point rather than a requirement.** Both of the clause's triggers had fired. `CheckpointRestoreNotBuiltError`'s two stated reasons were each stale: the session's owner *"is `DocumentService`'s question"* was answered by this log's own 2026-08-28 row — the owner is the supervisor — and the replay §4 describes is **empty for every terminal entry**, because `CommandBus.execute` holds the only `Checkpoint` mint, takes one strictly before `apply`, stores it on the `terminal` variant alone, and `CommandLog.entries` is the applied prefix, so the tail entry's own checkpoint *is* the state undoing it must produce. That property expires as a **compile error** rather than silently: a checkpoint stored anywhere else needs a type change, and every reader of `entry.checkpoint` stops compiling. So undo of a terminal entry needs no replay mode, which is why it is buildable while recovery-from-a-rebuilt-session is not yet built. **The second trigger fired silently on 2026-09-03** — `document.close` was declared at `channels.ts:545` while this clause still counted ten channels and no close — which is why an event-keyed claim now belongs on a `docs/FEATURES.md` row. **Three components, three concerns:** the bus decides *that* a restore happens and *which* checkpoint (it holds the only `CommandWriter` mint and is the log's only reader); `DocumentService` writes the bytes (it owns them); the supervisor grants the destination, opens the new session, closes the old and holds the new. The supervisor receives a **writer, never the bytes**, so ADR-0021's *"the only way anything outside this service can obtain a document's bytes — and it does not obtain them"* keeps its no-exception form. **Rejected: the service selecting the checkpoint off its own log**, tidier and rejected because it makes a second component compute which entry undo is at (B3a, the `git diff --name-status` shape); **handing the supervisor the bytes**, one reference and no measurable cost, rejected because the exception is free to avoid; **the bus opening the session**, which needs a path the kernel may not name and makes the bus per-document, undoing ADR-0009's composition decision; **computing an inverse from the command**, §3's named defect; **making `deletePages` invertible instead**, which is a byte image produced by hand per command and leaves the refusal standing for every Track F command behind it; **dropping the terminal entry**, which makes undo unredoable and gives the cursor two meanings. **The schedule is not chosen and the exposure is stated:** a host death still loses every command since the last save, with no refusal available to it. | Invariant 18 clause (ii)'s *"The mechanism … is NOT CHOSEN HERE, deliberately"* and its two triggers, and its *"declares **ten** channels and no close (counted 2026-09-01)"* | [ADR-0037](DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md) |
| 2026-09-03 | **The error boundary is the one class component** (§10.5a). React declares `getDerivedStateFromError` on `StaticLifecycle` alone and ships no error-boundary hook — read 2026-09-03 from `node_modules/@types/react/index.d.ts:1225` at `@types/react` 19.2.18, against `react` 19.2.8 — so the feature cannot be built as a function component. Exactly one module, `packages/ui/src/ErrorBoundary.tsx`, may declare a class, confined by `monstera/no-class-components` the way the `any` adapters are confined. **Rejected: `react-error-boundary` 6.1.4**, which does not remove the class but relocates it and adds a production dependency — the i18n row measures one such dependency taking the tree 39 → 114 packages, and it would put the fallback's reset behaviour behind someone else's API at the point this build wants its own guarantee; **`createRoot`'s `onUncaughtError`**, which is a `void` reporting callback and cannot render, so substituting it yields a log line and a blank screen — finding AAAAAA-4 at application scale; **no boundary**, where the same declaration says the entire component tree unmounts; **relaxing B7 generally**, which the rule's own text forbids by name. The recovery guarantee — same document, same page, same zoom — comes from mounting the boundary **below** the state holding those three, not from restoring them. | `BUILD-PROMPT.md` B7, *"React function components only"* | [0036](DECISIONS/0036-the-error-boundary-is-the-one-class-component.md) |
| 2026-09-02 | **`main` never holds a document's extracted text, and search is a per-page query** (§9.17). The `main` clause named two things — canonical bytes, and no parsing — and a document's extracted text is a third: produced by the engine host, handed back, governed by neither half of the sentence. So the first channel that could break invariant 11 would have settled the question by accident. **Measured** with `scripts/research/textRetention.mjs` against a *text-heavy* document, which is the shape the perf corpus lacks — its 200 MB fixture is one image, and a budget argued against that says nothing about a file that is all words: **3.56× the file size at 40 pages and 3.59× at 200**, the ratio stable across a 5× change and the per-page figure falling as `1/N`. `main` already holds the canonical bytes at 1.00×, so retaining the text takes it to **4.59× against a 1.5× ceiling** — over three times the budget from the text alone, and transient does not help because the budget measures peak. Text is therefore read a page at a time, searched and dropped, with what is resident bounded by the **largest page**; the channel carries a **bounded** match list with truncation reported rather than implied, since an unbounded one is document-scaled by another name. **Rejected: retaining it in `main`** (dead on the arithmetic, and it would have made this very sentence false in a way no check could catch); **extracting the whole document transiently** (fails identically — a peak, not a residency — and reads as the cautious middle); **caching it in the engine host**, whose budget is 3 GB (nearly free, and it makes the host stateful about a *query*, whose invalidation is a second version question beside the one `DocVersion` answers); **a channel returning a page's text for the renderer to search** (moves the residency across the boundary, and puts a second extraction path one step from existing — Part E2's K.0); **an unbounded match list** (document-scaled for a common word). A document-wide search is N round trips, which is the design rather than a cost to reduce: the row specifies *cancellable background indexing*, which needs a per-page grain to cancel at. **Not measured and named as such:** the round-trip latency of that search across a large document. | §9.17's `main` clause, which read *"**`main`** holds canonical bytes and never parses, so exceeding its budget means parsing crept back in"* and named nothing else `main` may hold | [ADR-0035](DECISIONS/0035-extracted-text-is-never-resident-in-main.md) |
| 2026-09-02 | **The text substrate owns the engine's stext OPTIONS and implements no clustering of its own** (§3.2). Part E2 has one kernel module cluster glyph runs into lines and blocks, tuned against a corpus score with constants that change only with a score in the commit message. Measured on MuPDF 1.28.0 through the new `mz_stext_json` export, against fixtures whose ground truth is a property of the generator rather than of any clusterer — and whose two columns share every baseline, since staggered ones are handled correctly by the broken version and separate nothing. **The engine's lines never merged across the gutter at 268pt or 60pt**, so a line clusterer here would be a second opinion about a question MuPDF answers correctly (B3a). **`FZ_STEXT_SEGMENT` turned row-major reading order into column-major at both widths** and left single-column prose unchanged, so a block clusterer would be a second opinion too. **`FZ_STEXT_TABLE_HUNT` split a prose line in two**, inventing a table, and undid `SEGMENT`'s ordering — so it is off, per-consumer, and owes its own reading to whichever feature turns it on. E2's *purpose* is met and met harder: there is no algorithm for a second consumer to copy, and the K.0 regression it names becomes **a second set of stext options anywhere**. The accuracy score survives with a changed subject — it scores the flag choice against ground truth, which is what a MuPDF upgrade would move and nothing else in the build would notice. **Rejected: implementing the clustering as written** (the authority answers it, and a partial reimplementation is dangerous precisely because it agrees most of the time); **taking MuPDF's lines and clustering blocks ourselves** (reading order is what block grouping is for, and `SEGMENT` already produces it); **`TABLE_HUNT` on globally** (wrong for the common case); **no module at all** (each consumer would choose its own flags, and the flags demonstrably change the answer); **deferring for a real-document corpus** (the question is whether the grouping is usable, and fixtures with known ground truth settle that more sharply than documents whose correct answer nobody knows). | `BUILD-PROMPT.md` Part E2's mechanism — *"Line clustering is implemented exactly **once** … tuned against the fixture corpus with a measurable accuracy score (constants change only with a corpus score in the commit message)"* — and the open half of [ADR-0013](DECISIONS/0013-pdfa-export-and-text-extraction-engines.md), which left *"whether that geometry is sufficient for columns and tables"* unexecuted | [ADR-0034](DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md) |
| 2026-09-01 | **Invariant 18 clause (ii)'s deferral premise is corrected: the loss path has TWO routes and one of them has a caller today.** The clause read *"until it does, the loss path has no caller … that is why this clause is deferrable at all"*, naming only `document.close`. `onEngineHostEnded` rebuilds a dead host's sessions in each surviving document's lane ([ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9c), and the same day's §2 correction records that nothing replays the command log onto a rebuilt session — so a host death loses every command since the last save with no close anywhere in it. **This is the sweep the §2 amendment owed and did not run** (NNN-4's shape): the claim became false the moment §2's replay was found missing, in a clause no commit in that range touched, so nothing range-scoped could reach it, and the citation resolved throughout. **The deferral stands and its stated ground is replaced, not repaired.** *No caller* was never why a mechanism could not be chosen — it was why nothing was being lost meanwhile, and that comfort is withdrawn. The mechanism remains unchoosable while §4 declares `reapply-intent` and `stored-effect` and only the first exists; `CheckpointRestoreNotBuiltError`'s deletion is the trigger that closes it. **The exposure is stated rather than fixed:** live, bounded to a host death, and with **no refusal available to it** — `recycle` may refuse a document whose log holds entries because recycling is optional, and a dead host must be rebuilt for. Clause (i) is untouched, being a property of a poisoned document whatever the route. | Invariant 18 clause (ii)'s second trigger, which read *"**Until it does, the loss path has no caller**: nothing in the shipped application can drop a document's record … That is why this clause is deferrable at all"* | — (a correction of a premise; the restore mechanism itself is still owed an ADR, and [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9c is where the second route is decided) |
| 2026-09-01 | **§2's *"Reopening replays the log"* is corrected to a requirement that is not yet met.** Nothing replays it: `openEngineSession` writes the canonical image and opens a session on it, there is no replay anywhere in the repository, and `document.viewModel` reads page geometry from the **session** — so a rebuilt session is the document as of its last save while the log says otherwise, visibly, about a rotation the user made. **Found by building invariant 22's capability and asserting its precondition rather than assuming it**, which is what ADR-0023 §6 asks of every property that becomes a proof. The sentence was a statement of design in the present tense, and it made the conditional above it look discharged: invariant 22's condition is that no mutation exists **only** on the handle, which the log satisfies, and the recovery that makes the condition useful is the replay — two halves, one built. **What binds meanwhile:** `DocumentService.recycle` refuses a document whose log holds entries and names the gap, so the unsafe rebuild is unreachable rather than merely undocumented. The **host-death path has no such refusal available** — a dead host must be rebuilt for — so [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9c loses unsaved commands from the session today, which is stated here rather than left to be discovered. **Not fixed here, deliberately:** replay is a decision about how each command's declared `replay` mode is re-applied — §4 declares `reapply-intent` and `stored-effect` and only the first exists — and choosing that against two seams that do not exist is the retrofit B4 forbids. | §2's *"It is safe because the truth lives in main: canonical bytes plus the command log. **Reopening replays the log.**"* | — (a correction of fact; the replay mechanism itself is owed an ADR) |
| 2026-08-30 | **The view model is a QUERY scoped to the pages the renderer draws, not a delta the command returns** (§2). Finding OOOOO-1, measured 2026-08-30: a `DocumentRecord`'s bytes are `readonly` and a command never replaces them — the mutation lands in the engine session, so `document.readRange` serves the pre-command document for the life of an open file and a rotate can never reach the screen through bytes. Measured as an **equality**: a rotate MuPDF applied answers the byte length `document.open` reported. The first reading of that was a B4 about refreshing main's image — a full serialise per command, 2.00× against a 1.5× ceiling — and it was wrong by taking one of §2's two routes for the only one. §2 already names the other: a rotation is a page transform, and §3.2 already says PDF.js renders and is never a source of truth. Half of §2 had simply never been built (`grep -rl "viewModel\|ViewModel" packages apps` returned nothing). The fact the route rests on is **executed rather than declared** — `proof:viewportrotation`, six cases against a fixture authored with `/Rotate 90`, because at zero absolute and additive are the same function: `getViewport({ rotation })` **replaces** the page's own rotation, so the model carries where a page ended up rather than the turns a command applied. **Rejected: the delta §2's own sentence names** — not on cost, but because it needs somebody to know *which pages a command moved*, and that knowledge does not survive its second command: `deletePages` re-indexes and changes the page count, a text edit is not a transform at all. Its purpose — a bounded payload on the command path — is met more directly by scoping the query to what is displayed. **Rejected: refreshing main's canonical image**, the expensive first reading, which also answers a question nobody had. **Rejected: an unscoped model per version**, which is L11's defect the moment anything re-reads it. **Rejected: a renderer that keeps its model and applies a delta**, since the parser is discarded on every bump and there is no retained base. **A trigger is written into `docs/FEATURES.md`:** the first command whose effect cannot be expressed in the view model puts the byte-refresh question back, and this rejection is not evidence against it then. | §2's *"bumping `DocVersion` and returning a view-model delta"* — a clause `document.execute` had already diverged from before this range, which no range-scoped sweep could reach (finding PPPPP-3) | [ADR-0032](DECISIONS/0032-the-view-model-is-a-scoped-query.md) |
| 2026-08-29 | **The renderer reads the document by demand-paged byte ranges; no snapshot crosses** (§2). Three options were on the table — serialise, transfer detached, chunk — and all three shared a premise nobody had checked: that the whole document crosses. `pdfjs-dist@6.2.108` exports `PDFDataRangeTransport`, whose `requestDataRange` is abstract, so the renderer asks and main answers out of the canonical image it already holds. Measured 2026-08-29: opening `perf-image-200mb.pdf` (209,105,721 B) and producing page 1 crosses **7,779,129 B — 3.72%** — in 42 requests; the hard shape is the dense fixture at **29.52%** of 26 MB in 115 requests, because 127,082 objects spread the cross-reference structure across the file. **The transport is bound to one `DocVersion`** and a range for any other is refused, since a stale offset answered from new bytes assembles a document from two versions. Three things the probe settled rather than assumed: a range **must be answered in exactly one `onDataRange` call** (splitting a 5 MB range throws — so the transient copy is bounded by the largest single object, 5,111,808 B measured, not by a constant we choose); `disableAutoFetch` and `disableStream` are **not** load-bearing, because the transport supplies no progressive data and the streaming path is therefore unrepresentable rather than switched off (B5); and the modern build cannot load outside a browser. **Rejected: serialising `record.bytes`** — a second image in `main`, 1.00x becoming 2.00x against a 1.5x ceiling, measured by `perf:gate`. **Rejected: transferring detached** — respects the budget and defeats [ADR-0021](DECISIONS/0021-the-canonical-image-is-retained.md), leaving invariant 18 nothing to reopen from. **Rejected: chunking**, which was the leading candidate before the transport was measured and is demoted rather than deleted: it bounds the transient copy and still crosses 100% per version, leaving the renderer holding a whole second image so that the renderer's ceiling scales with document size. **Rejected: raising the budget**, refused by [ADR-0025](DECISIONS/0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md) before this question was asked. Round-trip **count** is measured and round-trip **latency** is not; that is the first thing to measure once the seam has a real caller. | `BUILD-PROMPT.md` Part C2's *"**one byte snapshot per DocVersion**, transferred as a detached ArrayBuffer for PDF.js to render from"*, and §2's own restatement of it | [ADR-0031](DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md) |
| 2026-08-29 | **Invariant 18 is split into a property that binds today and a mechanism that is deferred with named triggers.** Decision 9a poisons a document at two consecutive engine failures and gives it *no reopen*, which makes invariant 18's stated recovery — *"killing the host, restarting, reopening from the last-saved bytes, replaying the log"* — unavailable for exactly the document that most needs it. The sentence was not wrong when written; ADR-0023 arrived after it and took away its second attempt. **The amendment is LATE and that is finding BBBBB-1**: the save pipeline landed first, and the collision was found by `sweep:prose -- "the save pipeline"` run for an unrelated reason, not by any check. Clause (i) is statable with nothing built and is therefore stated rather than deferred — retain the log, leave the file untouched, refuse rather than close, tell the user — because a deferral that swallows the statable half is how an invariant quietly stops binding. Clause (ii) is deferred and **takes no candidate**: choosing a restore mechanism now would fix a design against two seams that do not exist, which is the retrofit this project exists to prevent (B4, B6). Its triggers name code sites rather than events, which is the class fix for BBBBB-1 — `CheckpointRestoreNotBuiltError` and the channel table — so the trigger fires where someone is already reading. **Rejected: resurrecting the poisoned session**, which is not available to reject in the ordinary sense, since [ADR-0009](DECISIONS/0009-document-identity-and-the-command-log.md) §7 removed resurrection by construction. **Rejected: deferring the whole invariant** until checkpoint restore lands, which would leave a poisoned document's guarantee unstated for the entire interval in which it is the only guarantee there is. | Invariant 18's recovery sequence, which read as unconditional: *"a save failure is answered by killing the host, restarting, reopening from the last-saved bytes, replaying the log, and telling the user what failed"* | [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9a, which removed the reopen |
| 2026-08-28 | **The engine session's owner is the supervisor, not `DocumentService`** (§2). The move itself happened at [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9, which put the sessions and the failure count on one per-document entry *"precisely so the count and the sessions cannot acquire separate owners"*. It was forced and correct — `DocumentService` is in `packages/kernel` and cannot create a remote session, which needs Win32 and a pipe the kernel may not name. **This amendment is LATE, and that is the finding (KKKK-5)**: Decision 9's opening quotes §2's sentence and checks it, deliberately and explicitly, for the **lifetime** clause only — *"session lifetime needs no amendment"* — and is right about lifetime, while ownership travelled with the sessions and no document said so. A four-clause sentence checked for one clause is three unchecked claims, and the check that was run is what makes the other three feel examined. No range-scoped sweep could have reached it: no commit ever changed both the sentence and the code that refuted it, and the citation resolves to a document that says the opposite, so every link check passes over it (UU-1). `DocumentTeardown` is what keeps the entry's lifetime the record's, since `DocumentService` remains the only component that knows a record ended. | §2's per-document ownership list, which read *"canonical bytes, **lazily-created engine handles** (invalidated together on any mutation), the command log and checkpoints, and the originating `FileHandle`"* | [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) Decision 9, where the move happened |
| 2026-08-28 | **`main` legitimately holds the process-creation binding, and §9.17's argument for its baseline is amended to say so** (§9.17). ADR-0022 makes `main` the process that creates a contained engine host — `CreateProcessW` suspended, a job object, an AppContainer token — and that requires an FFI binding in `main`, which the same sentence that derives `main`'s budget assigned to `mupdf-host` by name. The budget is not a limit with a rationale attached; the rationale is what derives it (ADR-0025), so weakening the argument silently weakens the budget silently. The permission is bounded by **two library names**, `kernel32.dll` and `advapi32.dll`, rather than by *"the binding it needs"* — a hole the next reader widens by arguing about need, where two names are a set somebody can be wrong about in public. Invariant 20 is untouched: what `main` may load is the operating system's own libraries through an FFI loader, and MuPDF in `main` remains forbidden by name. `mupdf-host`'s clause stops saying *"also"*, which had acquired a second meaning — *and `main` does not* — and was the half of a compound claim that goes stale without looking wrong. The surface is imported **statically**: ≤2.7 MB measured, against 43.7 MB for a Node-mode helper (~16×) that merely moves the FFI to a process §9.17 does not name, and against a lazy import rejected because a session is created at *open*, `baselineFor` measures every role against a document, and **no role measures composed `main` at all** — so the deferral would protect a state no instrument observes. **A second amendment is owed to this same clause and is named in it**: ADR-0025's `mupdf-host` baseline, blocked on host readings across days through the real host. | §9.17's `main` clause, which read *"`main` runs the language runtime and nothing else"* and assigned the FFI binding to `mupdf-host` by name | [ADR-0028](DECISIONS/0028-main-holds-the-process-creation-binding.md) |
| 2026-08-16 | Start screen and title bar use the supplied composite logo as-is; the separate circular-mark-plus-wordmark treatment is withdrawn (§10.3). | `BUILD-PROMPT.md` Part M3 "circular leaf logo, the Monstera wordmark" and Part M8's interim-placeholder step | [ADR-0002](DECISIONS/0002-brand-mark-treatment.md) |
| 2026-08-16 | Page reorder and form flattening move to MuPDF; field creation and content composition move to @cantoo/pdf-lib; pdf-lib removed; `rearrangePages` banned; §3.1 lifted. | `BUILD-PROMPT.md` Part C3's page-reorder and form-flatten rows and their stated justifications | [ADR-0006](DECISIONS/0006-engine-capability-spike-results.md) |
| 2026-08-16 | Token roles carry five categories and declare their permitted surfaces; `--border` splits into `--border-control` (3:1) and decorative `--border`/`--border-soft` (exempt) (§10.2). | `BUILD-PROMPT.md` Part M2's two-way "text-bearing or fill-only" role typing | [ADR-0003](DECISIONS/0003-token-role-typing-and-declared-pairings.md) |
| 2026-08-16 | The memory budget is stated **per process** with an absolute ceiling on each — main ≤ 1.5× and ≤ 1.5 GB, MuPDF host ≤ 6× and ≤ 3 GB as a containment limit, renderer provisional and two-term. Stage 0 exit is gated on the three budgets. *(This row originally also recorded a two-term heap model and an admission gate reading both terms; ADR-0007's own correction withdrew them the next day as WASM artefacts — see the 2026-08-17 row below.)* | `BUILD-PROMPT.md` Part G's "assert peak RSS < 1.5× file size" as a single whole-application number | [ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md) |
| 2026-08-16 | Save mode is chosen by the **purpose** of the save: never incremental for removal, always incremental to preserve a signature, full rewrite otherwise (§4, §9.19). | Nothing in the founding record — Part C4 states one pipeline and is silent on mode | [ADR-0008](DECISIONS/0008-save-mode-is-determined-by-purpose.md) |
| 2026-08-17 | MuPDF is reached through a **native shared library bound with koffi** behind a thin C shim, not through WASM; `mutool.exe` is not shipped; one held document handle per `DocId` in a utility process; the two-term memory model and admission gate are withdrawn; §8 now separates native code we build and statically link from prebuilt binaries we download, and the AGPL source offer covers the MuPDF version, our build configuration and the shim source (§2, §3, §8, §9.17, §9.20, §9.21). | `BUILD-PROMPT.md` Part C3's WASM assumption and Part J's bundled `mutool.exe` | [ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md) |
| 2026-08-27 | **A declaration is not an implementation, and a package's public surface carries no native binding** (§1, §3.2). Importing `@monstera/kernel` cannot load native code; the engine adapters are reached through `@monstera/kernel/engine`, from the process that runs them. And what a command *is* is declared in a module that imports no implementation, with the functions composed on in a second layer — one declaration, two layers, never two tables. Measured 2026-08-27 in a bare Node process: the barrel **+41.7 MB** over bare against the adapter's **+46.0 MB**, so the barrel was binding the library, and `commandBus.js` **+40.1 MB** by a second route while `documentCommands.ts` takes a third. Every routing consumer reads `spec.writer` and nothing else — `apply`/`capture`/`invert` have gone through the registered writer since ADR-0023 Decision 10 — so the value import bought routing and paid for a native binding, and had done since that decision landed. Rejected: keeping the barrel and importing narrowly (the rule was already there and the exposure still reached `main`'s baseline through `import { type X }`'s emitted `import {}`, in the file whose header documents that trap); a dynamic `import()` inside the barrel (hides the cost, moves the load to a moment nothing chose, and makes the export asynchronous for every caller); splitting the package (encodes the wrong axis — ADR-0024 established that the axis is which **mode** a module runs in, and these run in one package and two processes). | §1's package map, which stated what each package may import and never what its surface may export; and §3.2, which had no rule separating a command's declaration from its implementation | [ADR-0026](DECISIONS/0026-a-declaration-is-not-an-implementation.md) |
| 2026-08-18 | Opening a document runs none of its content, and an engine host contains a compromise rather than only a crash (§9.24, §9.25). Both land before the components they constrain, per the sequencing resolved the same day. | Nothing in the founding record — Part K is silent on active content, and Part C3's process split addresses faults rather than containment | [ADR-0017](DECISIONS/0017-the-security-substrate.md) |
| 2026-08-21 | **The renderer's Content-Security-Policy is pinned as invariant 27** — the exact eleven-directive list, with this document as the writer of record and `apps/desktop/src/windowPolicy.ts` as the derived form, checked in both directions by `proof:rendererpolicy` against a running Chromium (§2, §9.27). `style-src`'s `'unsafe-inline'` is dropped in the same commit rather than pinned, because nothing needs it and an unproven grant that arrives before the pin is never argued for afterwards. | `BUILD-PROMPT.md` Part C2's "CSP set" as one item in a configuration list, and §2's own line which repeated it | [ADR-0019](DECISIONS/0019-the-renderers-csp-is-pinned.md) |
| 2026-08-22 | **The engine hosts are processes this application creates, not Electron utility processes** (§2, §5, §9.25, §9.26). Invariant 25's (c) and (d) are supplied by an AppContainer, which `utilityProcess.fork` cannot create, so the containment is a property of the creation route — measured, including a native `CreateFileW` refused `ERROR_ACCESS_DENIED` and a loopback connection refused, with the engine still running inside. The host contract crosses a DACL'd named pipe and registers into `packages/contract`'s discipline rather than beside it; the host body lives in `packages/kernel`, which answers invariant 26's third case by placement instead of a fourth clause. | §2's `utility: mupdfHost` / `utility: pdfiumHost` topology, which ADR-0010 introduced; and §9.25's "policy before mechanism" | [ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md) |
| 2026-08-18 | **Distribution is the Microsoft Store only.** No direct download exists; the website's download button links to the Store listing. The two-flavour seam is kept — flavour switch, `WebUpdateProvider` registered with no implementation, signing certificate as an empty config value — so a signed direct download is later a config change rather than an amendment. Updates are Windows'; `StoreUpdateProvider` adds a static-manifest version check that sends nothing, an in-app indicator linking to the Store, and a settings toggle (§8). | `BUILD-PROMPT.md` Part J's two-flavour distribution with a direct download, and its self-update path | [ADR-0018](DECISIONS/0018-distribution-is-the-microsoft-store.md) |
| 2026-08-25 | **Execution mode is a placement axis, and `packages/nodemode` is the Node-mode side** (§1, §9.26). The map classified by what a package is *about*; this is the first module where subject and mode disagree — the engine host's reader is Win32 pipe plumbing for the shell that executes where the shell's API surface does not exist. Measured: a `worker_threads` Worker inside Electron main has `process.versions.electron` set, `process.type` undefined, and `import('electron')` yielding a module with **no `app`**, against main's control in the same run — the fourth failure of the `apps/desktop/src/` proxy and the only one where the import SUCCEEDS. A sixth package, not in `MAY_IMPORT_ELECTRON`, so the specifier is a red build with no rule to remember (B5). Harness and probe files are in scope by the same test. `packages/kernel` was rejected on subject rather than on mode: a Windows-only reader there breaks §1's own reason for the kernel's Electron-free property. The engine host body is unmoved and stays in `packages/kernel`. | §1's one-axis repository map, and invariant 26 answering each occurrence by moving one file rather than stating where Node-mode code goes | [ADR-0024](DECISIONS/0024-execution-mode-is-a-placement-axis.md) |
| 2026-08-26 | **A baseline budget is derived from what it must catch, and `main`'s becomes `base 80 MB`** (§9.17). A baseline budget sits above the honest measured fixed cost of every role it governs and **below that cost plus the smallest regression it exists to detect**; outside that window it is not a loose limit but one that cannot fail for its stated reason. `96 MB` was argued and never measured — its own commit says *"the budgets are argued rather than fitted"* — and landed within a megabyte of a bare interpreter plus the whole kernel barrel. Measured 2026-08-26: bare Node **55.0 MB**, `+mupdfWriter.js` **+39.2 MB**, the barrel **+48.8 MB**; `main-service` clean **63.4/63.5 MB**, and with the barrel accidentally loaded **98.1/98.6 MB here (gate FAILS) against 92.0 MB on the runner (gate PASSED)** — build-dependent, so the exposure was caught by `proof:perfbudget`'s variance-sensitive control rather than by the budget. Rejected: fitting the limit to today's measurement; deriving it from a bare-interpreter reading taken in the same disturbed environment, which reintroduces exactly the blindness the baseline term exists to remove. | §9.17's `base 96 MB` and its argument-only derivation, which states the lower bound and no upper one | [ADR-0025](DECISIONS/0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md) |
| 2026-08-26 | **A channel's DEFINITION lives where its schemas may live; the shared thing is the discipline** (§5). `packages/contract` defines every *renderer-facing* channel exactly once; the engine host's channels are declared in `packages/kernel` and still go through `channel()`, `wrapHandler` and `frame.ts`. Forced by a rule the contract package already states about itself — `commands.ts`: inverses "stay kernel-only: they carry structural prior state the renderer must not see" — and the host's `capture` channel answers with exactly that prior state, so its result schema cannot be declared in the package the renderer imports. Rejected: declaring it in `contract` anyway (breaks that rule at the only boundary it was written for); and a `contract`-side factory taking the prior schema as a parameter (splits one channel definition across two packages to preserve a sentence, and is an abstraction with one caller). | Part C5's "defines every channel once (zod schema per params/result)", and §5's unqualified restatement of it — both predate any non-renderer channel | [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) |
| 2026-09-01 | **A ratio budget governs a process that HOLDS bytes, and `mupdf-host`'s multiple is withdrawn** (§9.17). Its `6x` was exceeded by the real host on both content shapes where the model `perf:gate` asserts against cleared them, and the two breaches disagreed about which document was expensive — 6.26x cost 1.34 GB where 7.83x cost 284 MB, ranking the documents in the opposite order from their cost. A ratio against file size states something about a process that holds a copy, which is why `main`'s stands; the host parses, where cost tracks content shape. The absolute is enforced by the job object and read back off it (invariant 25(b)); the multiple had no mechanism and could not have one. `memoryBudgets.mjs` gains a parsed two-term state and **refuses** a `mupdf-host` line that restores the multiple, so the withdrawal is a decision with a mechanism rather than a fact about today's text. Gives up amplification detection — a 1 MB file parsing to 2.9 GB now clears every term — which is stated in the ADR beside the open question of a term keyed on object count. Rejected: raising the number (§9.17 forbids it in terms, and 7.83x is the larger of two documents rather than a ceiling). | §9.17's `mupdf-host = 6x, 3 GB, base 128 MB`, whose multiple this document already recorded as "not yet derived" | [ADR-0033](DECISIONS/0033-a-ratio-budget-governs-a-process-that-holds-bytes.md) |
