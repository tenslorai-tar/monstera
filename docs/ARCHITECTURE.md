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

**ONE HOST BODY, PARAMETERISED BY ENGINE — never a second copy of it**
(amended 2026-09-08, ahead of `pdfiumHost`). The diagram above has shown two
contained hosts since Stage 0 and the body serving them is one implementation:
`hostBody` is generic over the writer of record it runs, each **entry** binds
exactly one engine, and a host that does not is unrepresentable rather than
discouraged.

**IT IS A DESCRIPTION AGAIN, as of 2026-09-09, and the specification note that
stood here is spent.** This paragraph read *"that sentence is a specification and
not a description"* because `hostBody.ts` took `CommandExecution<'mupdf'>` and
was generic over nothing — the amendment having been written ahead of
`pdfiumHost`, which is what B4 asks for. It was built: `startEngineHost` is
`<TMap extends ChannelMap>` and takes a channel set with its handlers, the MuPDF
binding moved to `engineHandlers.ts`, and `pdfiumHandlers.ts` is the second
composition through the same body.

**The correction was overdue by a full range, and that is the finding rather than
the fix** (audit of `63f10be..HEAD`, 2026-09-10). No commit in the range that
generalised the body opened this file, so the sentence saying it was *not* done
survived the doing of it — item 7's own stated hole, *a document can be falsified
by a commit that never touches it*. `CLAUDE.md` carried the same claim and is
corrected in the same commit. What makes it findable next time is cheap and is
the compensation now written down: **a paragraph whose subject is a symbol is
swept by grepping for the symbol**, and `hostBody.ts` appears in both documents.

**And its SIZE is now smaller than when it was written**
([ADR-0047](DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)).
PDFium's writer holds no session between commands, so of the five mechanisms
listed below as too costly to duplicate, the **session table** is not among what
a PDFium host needs at all — it serves the seven engine-agnostic channels plus
its own reads. The argument for one body is unchanged; the work it names is
less than it was.

The alternative is the pathology B3 exists to forbid, and it is the one that
arrives by itself: a second host is *the first host with a different import*, so
copying it is the cheapest edit at the moment somebody needs one. What that
would duplicate is not plumbing — it is the pipe framing, the startup
containment check, the session table, the failure classification and the
shutdown ordering, five mechanisms whose second copies would agree with the
first until one of them was fixed.

Three things follow, and each is a property the type system already carries for
one engine:

- **The command schema a host accepts is DERIVED per engine**, from the routing
  table, filtered to the kinds routed to that writer. `CommandExecution<W>`
  binds the accepted kinds to `KindsRoutedTo<W>`, so a command routed elsewhere
  arriving at a host is a compile error rather than a native library handed a
  pointer where bytes were expected — which is what it was before Stage 4
  narrowed the schema, inside the process invariant 25 assumes is hostile.
- **Each host has its own channel set**, in `packages/kernel` for
  [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md)
  Decision 11's reason, because the payload schemas differ by construction.
- **The containment is one problem and not two.** Both hosts contain a *native*
  parser reached through koffi ([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md),
  corrected 2026-09-08), so invariant 25's four properties are established the
  same way for both. This paragraph could not have been written before that
  decision: a process containing a WASM sandbox and one containing a native
  parser are not the same containment problem, and the generalisation would have
  been over two different kinds of thing.

**Two things the paragraph above left unstated, and a second host cannot be
built without either** ([ADR-0048](DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md),
2026-09-09).

**A host's reader set is its own engine's.** The twenty channels split
**six engine-agnostic** — `probe-containment`, `open`, `close`, `apply`,
`capture`, `invert` — one that belongs to the **live-session shape**,
`serialise`, and **thirteen MuPDF document-model reads**:
`page-geometry`, `page-text`, `page-links`, `destinations`, `layers`,
`annotations`, `form-fields`, `exportFormData`, `flat-fields`,
`duplicate-pages`, `extract`, `snapshotRegion`, `ocr-page`. **A second engine
owes none of the thirteen.**

**`ocr-page` is the thirteenth, added 2026-09-11 with D6 row 2, and it arrived
while this paragraph said twelve** — the count and the list were both written
before it and neither commit that added the channel opened this section, which is
item 7's hole rather than an oversight (finding FFFFFF-3). It is one of MuPDF's
reads on the same test this paragraph applies to everything else: recognition
consumes a bitmap **this engine produced, in the process that produced it**, so a
second engine owes it nothing. `coreChannels.test.ts` is where the split is
asserted, and its own comment cites this paragraph — a citation that resolved to a
section saying something else for the length of a range. They are MuPDF's model, answered by MuPDF's host, which is not
going away; a second host that declared them and stubbed them would be a
process answering questions with nothing behind it, and one that implemented
them would be a second reading of a model this package already has one reader
for (B3a). `EngineChannelsFor<W>` is where that is said — main's PDFium client
**cannot express** `engine/annotations` — and the runtime still terminates on
an undeclared channel, because a compile-time property says nothing about what
arrives on a socket from a process invariant 25 assumes is hostile.

**What a host holds between commands is a granted AREA**, and a document
session is what a *live-session* engine adds to it. The two directories are
held against the session id deliberately, and `HostSession`'s own comment is
the reason: *a `serialise` that carried a directory would be a channel through
which a confused main could redirect the document's bytes on every save.* A
byte-image host holds no parse between commands (ADR-0047), and the obvious
reading — that it therefore needs no table and can take its directories per
call — is exactly the shape that sentence refuses. So the entry generalises to
the pair main already names `SessionArea`, and **a byte-image host's
`engine/open` **registers a granted area and parses nothing**, because at that
moment there is no document: its area is a transfer buffer whose lifetime is the
host's, and every call mints a fresh file name inside it.

> **This read *parses once and discards it, so `open-failed` means the same
> thing from both hosts* until later the same day**, and writing main's side of
> the call withdrew it (ADR-0048's correction). Two independent reasons, either
> sufficient. A per-document open mints a per-document id and **main has nowhere
> to keep one**: `CommandBus` hands a byte-image writer the document's *bytes*,
> which carry no identity, and `SessionsByWriter`'s slot is typed the same way —
> ADR-0039 spent a decision removing identity from there. And `open-failed`
> does not mean the same thing to main anyway: an engine session that cannot be
> created **poisons the document** (ADR-0023 Decision 9a), which is right for the
> engine the document is read through and wrong for one that is only needed to
> edit. A document PDFium cannot parse now fails the call that needed it, at the
> moment the engine is wanted.

**And the differences between the two hosts belong to the writer SHAPE rather
than to either engine.** `coreEngineChannels` takes an engine's three command
schemas and one **wire shape** — a constant per `writerShapes` entry, not a set
of fields each engine fills in — so a third engine of either shape takes the
matching constant and supplies its commands. That is Decision 1's rule about a
channel's *answer* applied to the whole wire, and it is `writerShapes` reaching
the protocol, which is where a declaration table that decides behaviour ought to
reach.

**And a second engine owes its own AppContainer profile**, which is the third
thing ADR-0048 did not name and its correction of the same day adds. Two hosts
created from one profile moniker carry one SID, and `hostSessionDirectoryDacl`
grants that SID — so each would read and write the other's granted areas, and
*a breach of one engine would then hold the other's documents* would be true of
two processes as surely as of one. The separation is in the principal, never in
the process count.

**`engine/serialise` is the live-session shape's channel and a byte-image host
does not owe it.** Its meaning is *hand back what you are holding*, and holding
is what ADR-0047 removed; a byte-image `engine/apply` writes its result into the
granted output directory and answers a count, which is that channel's own result
schema. `CommandExecution<W>` had already declared the asymmetry — `apply`
returns a `ByteImage` for a byte-image writer and nothing for a live-session one
— so **a channel is engine-agnostic when its ANSWER means the same thing, not
when every engine can be asked it.** The input and output file **names** ride on
`apply`, `capture` and `invert` for a byte-image engine only, supplied through
the schema set an engine hands `coreEngineChannels`: names inside directories
the area already grants, never places, so a live-session client cannot name an
output file and a byte-image one cannot omit it.

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

**AND PDFIUM IS ONE OF THEM — amended 2026-09-09**
([ADR-0047](DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)).
`writerShapes` declared `pdfium: 'live-session'` from Stage 0 with nothing
behind it. **An in-place text edit is a byte-image command**, and the reason is
the paragraph above rather than a cost: replaced text is no more expressible in
a view model carrying rotations than a watermark is, so a live-session PDFium
edit would be correct, undoable, savable and **unseen**. Making it visible means
the bytes become main's image — which is exactly what a byte-image command does.

**What a live session WOULD save is the input half, and it is bounded.**
`#sessionFor` obtains a byte-image session from `ByteImageAccess.current`, a
full serialise, on every such command — and for an *invertible* one, which a
text replacement is, that serialise is not a checkpoint the bus was taking
anyway. Roughly 60 ms of 190 on a 997 KB document. It is **available inside this
shape**: `adopt` makes the new bytes main's canonical image, so after a
byte-image command that image *is* the document's current bytes and the
re-serialise reproduces them. That branch is **owed** and must never be taken
after a live-session command, where main's image is genuinely stale (OOOOO-1).
What the live session costs instead is not a number — the *which bytes win*
rule, a session table inside a contained host, and staleness in both
directions.

What it would have cost is written down and was **already queued against this
moment**: `savePipeline.ts` records that *two live-session writers each return
the whole document from `serialise`, and nothing in the law says which bytes
win*, and ADR-0039 Decision 2a names PDFium in Stage 5 as the day that fires. A
writer holding nothing between commands cannot hold a competing opinion, so the
question stays **unaskable** rather than being answered under a feature.

**And an edit generates content ONCE PER COMMAND.** Measured
(`npm run proof:editcost`): `FPDFText_SetText` is flat at 0.007–0.029 ms while
`FPDFPage_GenerateContent` after a set runs 0.17 ms on 3 KB to 29.18 ms on
997 KB, and tracks the **document's content** rather than the edited page — 500
pages of one line costs 12.54 ms against 500 of forty at 29.18, and 50 pages of
four hundred costs 23.93 with a tenth of the pages. Forty replacements on one
page cost **199.6 ms** regenerating per call against **14.6 ms** regenerating
once. So generation belongs to the command, which is §4's removal rule one
operation along, and for the same reason: a document-level operation performed
once per small edit.

**A READER's session is not this rule's business.** HD render rasterises through
PDFium and wants a session that outlives a call; a read-only session recycled
when the version moves cannot answer `serialise` and is not the two-writers
question.

**AND A REMOVAL'S PURPOSE IS CARRIED BY THE SESSION, NOT BY THAT CALL.**
`EngineWriter.serialise(session)` takes no mode
([ADR-0045](DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)).
A command declares `purpose: 'ordinary' | 'removal'`, and the adapter that owns
the session records that a removal was applied to it and maps that to its
engine's write options from then on — MuPDF's `garbage`, against an empty option
string otherwise. There is no default and no setting, which is §4's rule kept
rather than restated.

The reason it is state and not a parameter is measured rather than stylistic. A
live-session command produces no bytes of its own — `CommandBus.execute`
serialises **before** apply, to mint the checkpoint — and MuPDF collects only at
write time, with no in-session equivalent. So the objects a removal unlinks sit
in the session until it closes, and a parameter would have to be supplied
correctly by the next checkpoint, the save flush, save-a-copy, extract and
export: one rule five callers apply, where state on the owning adapter is one
place that cannot be forgotten (B5). Nothing about the purpose crosses to the
engine host, because the session it describes is already there.

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

**MuPDF runs in the contained `mupdfHost` process this application creates**
(§2, [ADR-0022](DECISIONS/0022-the-engine-host-is-a-process-we-create.md)), and
never by spawning `mutool`. `DocumentService` holds a **document handle** across
mutations, which is the difference between a mutation costing 0.004 ms and
costing seconds ([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md)).

**HOW it is reached is DECIDED — native, koffi — and NOT YET BUILT. This
paragraph asserted the built state until 2026-09-08.** It read *"MuPDF is
reached natively, as a shared
library built from source and bound with koffi behind a thin flat-C shim —
never as WASM"*. Measured: every MuPDF consumer in `packages/kernel` imports the
bare specifier `mupdf`, which resolves to the npm package's
`dist/mupdf-wasm.wasm`; **twenty-four non-test modules do so, and a search for
`monstera_mupdf` across `packages/` and `apps/` returns zero.** The shim is
built, is scanned by four security proofs, and is loaded by nothing the product
runs.

The clause about the held handle stayed true throughout, which is why the
sentence survived review: a compound claim whose live half vouches for its dead
one. So did *never by spawning `mutool`*.

ADR-0010's decision — native FFI, WASM withdrawn — was **not** withdrawn by that
correction; what it recorded is that the decision was **unbuilt** for the
document pipeline.

**THE DECISION IS TAKEN, 2026-09-08: native, both engines, koffi.** The kernel's
adapters move onto `mupdfRaw.ts`; the rejected option was amending ADR-0010 to
the WASM reach the product has, with the 2 GB cap and the whole-file copy
re-entered as live constraints
([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md), corrected that
date, which carries the founding-record clauses the ruling was taken against).

**The migration is not done, and this paragraph will be false in the other
direction until it is.** §9.17's budgets were read against the WASM route, and
the four security proofs that scan `monstera_mupdf.dll` move with the adapters.
Until that lands, the engine the product *reaches* is still the npm package —
which is what the measurement above says and what a reader must not infer their
way past.

**AND ITS SIZE IS NOT THE IMPORT COUNT, measured 2026-09-09 and re-measured
2026-09-11** (ADR-0010's correction of the first date; `npm run
proof:enginesurface`). The twenty-four modules call **125 distinct MuPDF
members**, of which `PDFAnnotation` declares 41, `PDFObject` 22, `PDFDocument` 20
and `PDFWidget` 15 — an object model. The shim exports **24** C functions and
hands back an opaque handle by design, so most of the 125 have nothing to move
onto and must be written behind an ABI that does not exist yet. Only **seven** of
the twenty-four load an engine at all; the other seventeen spell `import type`,
are erased by the compiler, and operate on handles those seven opened. So
changing the engine changes every one of the twenty-four **bodies** and not one of
their first lines — the count that reads like the work is a count of the thing
that does not have to change.

**THE FIGURES MOVED UP AND THE DOCUMENTS DID NOT, 2026-09-11** (finding
FFFFFF-3's sibling, FFFFFF-4). They read 19 modules, 4 loading, 15 type-only and
117 members — the 2026-09-09 reading — while Stage 6 added five kernel modules
that import the engine. Nothing was wrong when written and no commit in between
opened this paragraph, which is item 7's hole; what makes it worth a sentence
rather than a silent edit is the **direction**. A migration's size is read as a
debt being paid down, so a figure that grew while a stage was built on the engine
is the one a reader will not think to re-run. Re-run it: the command is one line
and prints the whole table.

**This does not gate Stage 5's editing rows**, and that is written here because
the opposite was assumed. Those rows are PDFium's by `BUILD-PROMPT.md`:257;
PDFium's API is already flat C, needs no shim, is provisioned, and is bound by
koffi in research today. They sit behind `pdfiumFfi.ts` and the second engine
host, not behind this migration.

**WHERE that engine is instantiated is a separate question, and it is answered:
the contained host, never `main`.** Measured 2026-09-08 by an observed run
(`scripts/research/engineReach.mjs`, the JOURNAL that date), not read off the
module graph, because the barrel is *written* to keep the engine out of its
importers and whether that holds today is a fact about a running process.
Importing `packages/kernel/dist/index.js` — the specifier `apps/desktop` uses —
loads 318 modules, none of them MuPDF's, and instantiates no WebAssembly.
Importing `packages/kernel/dist/host/hostEntry.js` loads `mupdf.js` and
`mupdf-wasm.js` and instantiates 10,408,550 bytes. Both controls separated on
the same run.

So **invariant 25's containment covers the process the document is parsed in**,
with a WASM engine rather than the native one ADR-0022 was written against.
Invariant 20's letter does not reach this: it keeps *native code* out of `main`,
and a WASM engine is not refused by that wording — what actually holds the line
is ADR-0026's barrel discipline and placement, guarded statically by
`proof:kernelload` and now confirmed by a run.

Two consequences a reader needs. The reach decision above is therefore **not a
containment decision** — it holds under either answer, so it must be taken on
which engine this project wants to own rather than on security. And the gap in
invariant 20's *wording* is real even though nothing exploits it today: the
invariant is about where a document is parsed, and *native* is a proxy for that
which the product has already stepped outside of.

**One consequence is already closed.** Invariant 24's mechanism —
`proof:activecontent` — scanned only `monstera_mupdf.dll`, so it was reading a
binary the shipped pipeline never opens. It now scans **the engine the
application's own import resolves to** as well, with its target derived from
that resolution rather than written down, and with both controls. The answer is
the same on both: no MuJS. That the answer did not change is the reason it is
recorded rather than quietly fixed — the mechanism would have read exactly as it
did if the answer had been the opposite.

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
| Form fields: delete | **MuPDF** — `deleteAnnotation` on the widget, then the empty field pruned from `/AcroForm`'s tree through the object API. Measured 2026-09-07: the engine removes the widget from `/Annots` **and** from wherever the tree references it, and leaves a field with an empty `/Kids` that every other reader still lists. MuPDF has no field-level API, so the prune is written here — which is why this is its own row rather than *create*'s inverse | MuPDF |
| Form fields: flatten | **MuPDF** — `bake(false, true)` | MuPDF |
| Form fields: create | **@cantoo/pdf-lib** — the one concern MuPDF has no API for | MuPDF |
| Metadata, outline/bookmarks, encryption, permissions, redaction, optimize | **MuPDF** | MuPDF |
| Print & export rasterisation | **MuPDF** | — |
| **OCR recognition: a raster becomes characters and their boxes** (added 2026-09-10 ahead of Stage 6's rows) | **`tesseract.js-core`, driven directly, executing inside the engine host.** The matrix had a row for the OCR text **layer** — the embedding, `@cantoo/pdf-lib` — and none for the recognition, so D6's rows 2 to 7 all sat on a concern with no writer. `BUILD-PROMPT.md`:473 names `tesseract.js`; :806 puts only the TrOCR/onnxruntime stack in the download-on-demand class, so this one ships. **THE BINDING IS THE CORE AND NOT THE WRAPPER, 2026-09-10** ([ADR-0050](DECISIONS/0050-the-ocr-binding-is-tesseracts-core-driven-directly.md)): `tesseract.js@7.0.0` reaches `tr46@0.0.3`, which ships no licence file while declaring MIT, so `generateNotice.mjs` refuses it — correctly, and that refusal is not waivable by an ADR. `tesseract.js-core@7.0.0` is the package the WASM is in, declares **no dependencies**, ships an Apache-2.0 LICENSE, and is the version the wrapper itself pins. Measured against the same page the wrapper was probed with (`scripts/research/ocrCore.mjs`): **2,016 non-whitespace characters, 41 lines, 402 words all carrying a box, mean confidence 94** — identical, in 3.8–4.4 s against 4.8–5.2 s. The wrapper's worker orchestration is what this build does not want, since recognition already runs in a contained process; its model CDN is what ADR-0014 constraint 1 rules against; and `api.GetJSONText()` is the core's own renderer for the word tree. **[ADR-0014](DECISIONS/0014-ocr-stays-inside-the-engine.md)'s second ground is measured false for the engine this application loads** (`scripts/research/ocrSurface.mjs`, 2026-09-10): `tesseract`, `leptonica` and `ocr_` occur **0** times in the WASM binary the kernel's own `mupdf` import resolves to and **0** times across its four declaration and wrapper files, against **2, 4 and 9** in `monstera_mupdf.dll` — the artefact nothing under `packages/` loads. Each count carries its own anchor: libmupdf's error text is present in both binaries, and `PDFDocument`/`StructuredText` in the two surface files that declare the API, so a zero is an absence rather than a blind scan. **WHERE it runs is decided here rather than at a call site.** Recognition consumes a bitmap **we produced**, so the document-parse boundary invariant 25 governs was already crossed by the rasteriser — and that rasteriser is MuPDF's, in the host, by the row above. Running recognition beside it means no eight-megabyte bitmap crosses a pipe per page, no second rasteriser exists for OCR input (B3a), and containment is unchanged: tesseract.js parses no document bytes. Its language and data directory are **ours** and are never influenced by a document (ADR-0014 constraint 1). **AMENDED 2026-09-11 — THE ENGINE IS NAMED BY THE REQUEST** ([ADR-0052](DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)), because D6 row 7's TrOCR is a second answer to this row's own question and two writers for one concern is B3 unless the choice lives in exactly one place. `OcrRequest` carries the engine, the two implementations sit behind one module boundary, and both answer a `RecognisedPage` — so nothing downstream chooses, and a third engine adds a member rather than a surface. **Both execute in the host, for the reason above unchanged**: ONNX parses model files that are ours, never document bytes, exactly as a `.traineddata` is. **What differs is arrival and scope.** Tesseract's WASM ships; TrOCR's runtime and models are **fetched on demand against pinned digests** into a `userData` cache that main grants to the host, since the host has no network — `tessdata`'s pattern, generalised. And TrOCR is offered **on a region only**: it reads one text line, measured at 2,899 ms of encoder warm against 3.8–4.4 s for a whole page through Tesseract, so a page-scoped control would work and take minutes. **AMENDED AGAIN 2026-09-12 — WHERE an engine runs is per engine, decided by what its input must reach** (ADR-0052's addition). *Both execute in the host* was true and about the two **local** engines; D6 row 8's Azure Document Intelligence is an HTTPS call, and invariant 25 gives the host no network — the same sentence that made TrOCR's download main's job. So `azure` executes in **`main`**, and what that gives up is precisely what the clause above protects: the raster crosses. Unavoidable and cheap in those terms, because the bytes are leaving the machine regardless and a pipe hop is nothing beside the upload. **No second rasteriser and no new channel**: `engine/snapshotRegion` already writes a region's PNG into the granted output directory, and it gains **the matrix mapping that PNG's pixels back to PDF user space** — six numbers — so the page transform, the crop origin and the `/Rotate` stay in the one process that holds them rather than being reconstructed main-side, which is FFFFFF-1 arriving in a third engine. Sending a rasterised region also keeps the service's answer in `pixel` rather than `inch`, so a third engine adds no fourth frame. **AMENDED 2026-09-13 — THE NETWORK ENGINES ARE A DECLARED SET, AND MAIN HOLDS ONE RECOGNISER PER ENGINE** ([ADR-0057](DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)). A second network engine (Claude, D6) arrived where *runs in main* was three literals, one of them a ternary that would have recognised any new engine as handwriting. `NETWORK_OCR_ENGINES` in the contract is the only list; main's recognisers sit in a record keyed by it, so an engine without one does not compile; each takes the host's raster and frame. Claude's raster is sized so it is never resized server-side, its answer is schema-constrained and re-validated, and every stop reason but `end_turn` is refused by name. Its key is the provider's — one secret Stage 9's registry takes | — |
| In-place text editing (line/run rewriting), styled runs, HD render | **PDFium** | PDFium. **The GAP, recorded 2026-09-09 ([ADR-0049](DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)): PDFium does not group runs into visual lines.** `FPDFText_CountRects` answers one rect per run — measured at 4 for four runs whether the two sharing a baseline are 170pt or 3pt apart (`scripts/research/pdfiumLines.mjs`) — so there is no engine answer for the substrate to own options over, which is the route [ADR-0034](DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md) takes for the reading side. What PDFium **does** answer is `FPDFText_GetTextObject`, which maps a character to its page object (40 of 45 in that run; the other five are its own *generated* spaces, flagged by `FPDFText_IsGenerated`) — so a range of text converts to editable objects inside one engine's frame. The editor therefore owns a grouping, by vertical **overlap** and with no tunable constant, and a person confirms it before anything is written |
| Content composition: new document generation (markdown/CSV/TOC/image-to-PDF), drawing onto pages (watermark, headers/footers, Bates, OCR text layer) | **@cantoo/pdf-lib** — pdf-lib itself is unmaintained since 2021-11-06 | — |
| Digital signatures (PKCS#7) | **`@signpdf/signpdf` + `@signpdf/signer-p12`, over a placeholder THIS BUILD writes** — executed 2026-09-12 against a real document, which is the gate ADR-0006 left for Stage 7 ([ADR-0054](DECISIONS/0054-the-signing-core-ships-and-the-placeholder-is-ours.md)). The signing core is **4 packages**, each carrying its licence; `@signpdf/placeholder-plain` would take it to **125**, seven of them shipping no licence text and one a deprecated `crypto-js`, which is ADR-0050's refusal at seventeen times the scale — so the placeholder is `@cantoo/pdf-lib`'s, as the form rows' dictionaries already are. The contract is a literal token shape, `/ByteRange [0 /********** /********** /**********]` with slots 1-3 as PDF **names**, written with `useObjectStreams: false` so the signer can find the `/Contents` hole in the raw bytes. Measured: the signed file is the **same length** as the placeholder, the signature verifies against the certificate, and the `messageDigest` attribute matches SHA-256 of exactly the covered ranges. **A timestamp is an unsigned `id-aa-timeStampToken` on the signature, requested through a port the composition supplies from a declared authority list, and verified before it is embedded** ([ADR-0058](DECISIONS/0058-a-timestamp-authority-is-verified-not-trusted-and-its-request-may-be-plain-http.md)) | node-forge (verify) — and it is also what **signs**: `signer-p12` peers on it for the PKCS#12 parse and the PKCS#7 build, so verifying a foreign signature needs no `@signpdf` at all |
| Text extraction, plain and layout-preserving | — (read-only) | **MuPDF** structured text. The founding record's "layout-preserving when Poppler available" is withdrawn: Poppler was named in no matrix row and no provisioning list, and MuPDF exposes block, line and span geometry. **The COLUMNS half is now executed** (2026-09-02, MuPDF 1.28.0): lines never merge across a gutter at 268pt or 60pt, and `FZ_STEXT_SEGMENT` yields column-major reading order — so no second engine and no clusterer of ours ([ADR-0034](DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)). **THE TABLES HALF IS EXECUTED, 2026-09-10** — it read *stay unexecuted* while no fixture contained a table, and the corpus now carries table-bearing documents. `FZ_STEXT_TABLE_HUNT` scored on against off over the eleven-document corpus: **two of the six documents carrying text change, at −1.5 and −17.5 points of line agreement against PDFium, and none improves**, with a constructed grid as the control that separates *found no table* from *the option never reached the engine*. It stays **off** and stays a per-consumer opt-in, now on a reading rather than on an absence — see §3.2, and note there why a fall in line agreement is not on its own the argument ([ADR-0013](DECISIONS/0013-pdfa-export-and-text-extraction-engines.md), corrected 2026-09-10) |
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
- **Unlocking an encrypted document is an OPEN, and `needsPassword` is banned**
  ([ADR-0055](DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md),
  added 2026-09-12 ahead of Stage 7's row). Measured that date: MuPDF's
  `needsPassword()` is `pdf_needs_password`, which calls
  `pdf_authenticate_password(doc, "")` — so **it is an authentication attempt,
  and a failed attempt destroys the file key a successful one derived.** One
  call after a correct password takes a page from 24 structured-text blocks to
  zero and rasters it blank, with the engine printing *incorrect header check*
  as it inflates streams nothing decrypted. The protocol is therefore **one
  password attempt per `openDocument`**: the host never holds a locked session
  between attempts, so *a session that was authenticated against and lost* is
  not a state the wire can produce. `monstera/no-needs-password` is the rule;
  the ban is on the member name, because the danger is that the call reads as
  the right one.

  **The password crosses into the engine host**, on `engine/open`, and that is
  the one thing here that looks like a containment decision and is not: a host
  that opens an unlocked document holds the plaintext, and a host given a
  password holds the same plaintext one call later. The containment is for the
  **parse**, which is unchanged. What the password must never do is persist —
  main does not keep it, no record holds it, no diagnostic names it, and
  `recycle` therefore **refuses** on a document that was unlocked rather than
  rebuilding a session that cannot read it.
- **A grouping of our own is permitted where no engine answers, and only where a
  person confirms it** ([ADR-0049](DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)).
  ADR-0034 forbids a second clusterer and leaves one test — *does it read a
  coordinate to decide grouping* — which the editor's line grouping fails. What
  makes it legal is not the reading but **where its output goes**: an extraction
  path's grouping becomes text somebody takes as the document's content, feeding
  search, export and the text layer, and a wrong answer there is silent. The
  editor's reaches a dialog and nothing else, so a wrong answer is on screen with
  the words it will replace and a dismiss beside them.

  So the rule stays checkable rather than becoming a judgement: **does this
  grouping's output reach any consumer other than a dialog a person answers?** A
  second caller is the moment it has become an extraction path, and ADR-0049
  stops covering it.

  This licenses no tolerance constant. The one grouping this permits is by
  vertical **overlap**, which is a relation and has no number to tune — Part E2's
  *"constants change only with a corpus score"* survives with nothing here to
  govern, exactly as ADR-0034 left it for the reading side.
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
  per-consumer opt-in that owes its own reading; **`FZ_STEXT_PRESERVE_IMAGES` is
  on from 2026-09-10**, because *this page has no text* and *this page is a
  picture of text* are otherwise the same empty reading, and D6's first row is
  the difference between them. It is part of the one option set rather than an
  opt-in for a reason the alternative makes clear: a second read would answer
  the attribution from a different walk than the lines it explains.

  **It is not inert, and that is measured rather than assumed.** Over the
  corpus, characters and every line boundary are unchanged, and **positional
  reading order moved on two of the six documents carrying text** — 28.2% to
  46.6% against PDFium on one, 14.9% to 13.2% on the other. The mechanism is
  `SEGMENT`: an image is a region, so a page holding one segments differently
  once the engine can see it. On a page with pictures, selection order and
  search-result order may therefore differ from what this build produced before
  that date.

  Measured 2026-09-02 on MuPDF 1.28.0, against fixtures whose correct grouping is
  a fact about the generator rather than an opinion of the thing under test: the
  engine's lines never merged across a gutter at 268pt **or** 60pt; `SEGMENT`
  turned row-major reading order into column-major at both widths and left
  single-column prose unchanged; `TABLE_HUNT` split one prose line into two,
  inventing a table, and undid `SEGMENT`'s ordering.

  **`TABLE_HUNT` is now measured against real documents too — 2026-09-10,
  `npm run proof:lineagreement` over the eleven-document corpus.** Asked for
  `segment,table-hunt` instead of `segment` and scored against the same
  independent PDFium reading: **two of the six documents carrying text change at
  all**, at −1.5 and −17.5 points of line agreement, and **none improves**. A
  constructed 3×3 grid is the control — its two readings differ, so a row of
  zeroes is the option finding no table rather than the option not reaching the
  engine, which produce the same output.

  **And the negative delta is not by itself the reason, which is the part worth
  carrying.** `TABLE_HUNT` exists to emit cells, and a cell is not a line, so
  lower agreement with a line-oriented reader is partly the option working. What
  makes it a loss *today* is that **no shipped consumer of this substrate wants
  cells** — the text layer, search, spell check and word count all read lines.
  The per-consumer opt-in is therefore unchanged and now rests on a reading
  rather than on nobody having taken one.

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

**AND THE REMOVAL ROW'S COLLECTION HAPPENS WHERE THE BYTES ARE MADE, NOT WHERE
THEY ARE WRITTEN** ([ADR-0045](DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md),
2026-09-07). `saveDocument` takes a `flush` and writes what it is handed, so it
cannot collect bytes that reach it already serialised — and the disk save is not
the only thing that emits a document's bytes. A command declares
`purpose: 'ordinary' | 'removal'`, and the adapter that owns its session records
that a removal was applied and collects from then on — `EngineWriter.serialise`
takes no mode.

**The purpose being read is the SESSION's, not the executing command's.** A
live-session mutation produces no bytes of its own — §2 above — and MuPDF
collects at write time with no in-session equivalent, so the orphans a removal
unlinks live in the session from that command until the session closes. The
adapter that owns the session therefore records the removal when it is applied,
and every serialise of that session collects from then on: the checkpoint the
next command mints, the disk save's flush, save-a-copy, extract, export. The
transition is one-way, because a document that has had content removed does not
stop having had it. Letting each of those call sites decide for itself is B3a's
several opinions rather than a list of bugs, and asking them to pass a purpose
is the same rule with five chances to forget it.

Measured, and it is why this is stated rather than assumed:
`bake(false, true)` unlinks nine widgets and `saveToBuffer('')` writes all nine
out again — the object count **grows**, 49 to 55, and every flattened field's
value stays readable to anything walking the cross-reference table instead of
the catalog. That is invariant 19's mechanism arriving by a route ADR-0008 did
not name: not an incremental save leaving a prior revision, but a full save
carrying orphans.

Save invariants (hard-won; each has a mechanism):

- **A save never rewrites annotations it did not author.** `srcRef` marking is
  a **private key on the annotation's own dictionary**, `/Monstera_Authored`,
  written where an annotation is created and read where the walk lists one
  ([ADR-0043](DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)).
  **The scheme is one-sided by construction**: we may not write onto an
  annotation we did not author, so nothing can ever be marked foreign, and
  *foreign* is the absence of the mark. It is **provenance, not permission** —
  a person erasing or moving an annotation another application wrote is doing
  what the tool is for; what this forbids is the pipeline touching an object
  the person did not aim at.
  **Byte-identity was measured on 2026-09-06 and it does NOT hold; text-identity
  does.** Against MuPDF 1.28.0, a plain save of an untouched document re-encodes
  **two entries of ten** — a literal with balanced parens `(see (this))` comes
  back `(see \(this\))`, and an ASCII hex string `<414243>` comes back `(ABC)` —
  and touches nothing else, UTF-16BE hex strings included. No foreign annotation
  loses a key, a value or a character. The divergence set is **pinned** by
  `foreignAnnotations.test.ts`, so a version that stops re-encoding or starts
  re-encoding something else is a red build rather than a silent move in what
  this invariant means. That was item 4 of
  [ADR-0008](DECISIONS/0008-save-mode-is-determined-by-purpose.md), executed;
  what it does **not** settle is the save-mode default, because a re-encoding is
  still a byte change and anything covering those bytes breaks — which is why a
  signature-bearing save is already routed to an incremental one.
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

**That pipe carries JSON, so it has no byte type, and a command that must carry
bytes travels the door the document already came through**
([ADR-0044](DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)).
Measured 2026-09-07: `host/client.ts` frames
`JSON.stringify({ id, channel, params })` and `host/runtime.ts` parses it, so a
`Uint8Array` arrives as an object of numeric keys and every schema that demands
one refines it away — at an encoding cost of 8.4×. `ENGINE_HOST_FRAME_MAX_BYTES`
is the *second* wall and raising it moves neither.

A command declares **`asset: 'none' | 'bytes'`** on the seam, beside `sources`
and `reads`. The member was spelt `'image'` until 2026-09-08 and the axis was
never about images: the question it asks is *does this command carry bytes the
wire cannot express*, which is a fact about the transport and not about the
payload's content. Nothing branched on the member — the transport tests
`asset === 'none'` — so the label could stay narrower than the concept
indefinitely without anything going wrong, which is exactly why it is corrected
by name rather than reused. Main writes the bytes into the session's `snapshotDirectory` — the
directory `engine/open` already grants the host READ on, and the one the
document itself arrives through — `engine/apply` carries the name beside a wire
form of the command with that field absent, the handler reads the file and calls
the same `apply` every local caller calls, and main deletes it when the call
returns. **The wire form is derived from the declarations**, never written
twice; two hand-kept schemas for one command would be a second opinion about
what a command is. The asset moves in the direction the host may only read, so
it grants the contained side nothing, and the command in the log still holds the
bytes, so undo, redo and `reproducible` are unmoved. Declared per command rather
than spilled by size, because a threshold is *"a generous maximum … one that
quietly accommodates the payload nobody decided to send"* — the frame constant's
own sentence, about itself.

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
registers a controller (`begin`, `update`, `commit`, `preview`, `complete`). The
overlay is a dispatcher, never a monolithic switch stack. Adding a type touches
one adapter and one renderer.

**That list read `begin`, `update`, `commit → Command`, `cancel` until
2026-09-06, and three of its four entries were false** — found by the stage
audit at `909c388`, not by any check. `cancel` is deliberately **not** a member
(`registries/tools.ts`: the gesture is a value the overlay holds, so cancelling
is dropping it, and the member would be an empty body in twenty tools);
`preview` **is** one and was unnamed; and `commit` has been able to answer
`Promise<Command | undefined>` since the text box, because a tool whose intent
comes partly from a person cannot answer at pointer-up. Two of those changes
were made by commits in the range that this clause was never edited by.

**The shape is the transferable part.** `begin` and `update` stayed true, and a
reader checking the sentence checks the half that is still right — so a
four-item list with three wrong entries reads as correct. The amendment below
even quotes this clause in its *Supersedes* column, naming `cancel` among the
members it was superseding around, which is a correction restating the thing it
was correcting.

**A gesture may span several presses, and the TOOL says when it is complete**
([ADR-0042](DECISIONS/0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md)).
The clause above models a gesture as one press, some movement and a release,
which is what eight tools needed and what a polygon, a polyline and a cloud
cannot express: a second press restarted the gesture, a release ended it, and
there was no finish signal because for a drag the release *is* the finish. So
`Gesture` records its **presses** beside its path, and `ToolController` gains
`complete(gesture)`, asked at pointer-up — false keeps the gesture alive across
the release. **No existing tool implements it**: the shared `pointerPath` all of
them spread answers `true`, so *a release ends the gesture* stays the default.
Rejected were a second controller member for presses (five lifecycle members,
eight tools declaring that a subsequent press means nothing to them), deriving
vertices from the decimated path (a click and a slow drag through one pixel are
the same points), an optional member (a runtime branch standing in for a type,
and a misspelling gets the default silently), and a third `commit` return (the
lifecycle decision inside the function that builds payloads). The finish signal
is a **double press recorded by the platform** and interpreted by the tool, which
is the same division as everywhere here. `complete` is asked **only at
pointer-up**; a tool finishing on a move, a timer or a keystroke would need the
overlay to ask there too, and that is the stated trigger rather than architecture
written ahead of need.

**An existing annotation is named by its place in the engine's walk, plus the
version of that walk** ([ADR-0041](DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)).
A handle is `{ page, index }` where the index is a position in MuPDF's
`getAnnotations()` for that page and **not** in the page's `/Annots` array —
measured, the two differ by the number of widgets above it, because MuPDF filters
form fields out of that walk. One function mints and resolves, since *which
objects on this page are annotations* is the engine's rule and a second opinion
about it is a defect (§3a). A command naming an annotation carries the
`DocVersion` its walk was read at and is **refused** if the document has moved:
within one version the walk is a total order over a fixed set and an index is
unambiguous, across versions it is not an identity at all. This is the
range transport's rule at `:305` on a different noun
([ADR-0031](DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md))
— a stale offset answered from new bytes builds a document out of two versions,
and a stale index answered from a new walk deletes an annotation out of two of
them. Handles are never written to the file and
survive no save.

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
source of truth (§3). **PDFium is an optional SECOND OPINION about how a page
looks, behind a setting — not a better one**, and **MuPDF** rasterises for print
and image export, where output goes to a file or a printer rather than to the
screen.

This sentence read *"an optional higher-fidelity rasteriser"* until 2026-09-10,
and **two measurements refuse the word**. `scripts/research/pdfiumRender.mjs`
(2026-09-08) found that the only metric available without a reference — each
engine against its own supersampled render — ranks hinting rather than accuracy,
so it cannot say which is better and neither can anything else here.
`scripts/research/pdfiumAgainstPdfjs.mjs` (2026-09-10) then compared the pair the
setting is actually about, pixel for pixel: **12.716 levels of mean difference
over inked pixels and 1.84% of the canvas differing.** They differ, materially;
difference is not quality.

**What the setting is for is therefore different from what this section said it
was for**, and that is the amendment rather than a wording change: a reader whose
document one rasteriser draws badly has a second one to try. That is a real need
and an honestly describable one. *Higher fidelity* was a claim the product could
not support, and a setting offering it would have been the display-only defect
with a settings entry on it — which is the objection `pdfiumRender.mjs` was
written to test and which it answered in the other direction.

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
| **Settings** | id, type, default, category, i18n key, **a title per member of an enumerated setting**, `secret?`, migration | the entire Settings dialog — **one control per schema kind, a secret write-only and never read back** ([ADR-0056](DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)) — persistence, export (secrets excluded) |
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
  | { surface: 'ribbon';        section: SectionId; group: MessageKey; order: number }
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

  **One exception, and only one: an RFC 3161 timestamp request may be plain
  HTTP**, to a host in the contract's declared authority list and nowhere else
  ([ADR-0058](DECISIONS/0058-a-timestamp-authority-is-verified-not-trusted-and-its-request-may-be-plain-http.md)).
  The widely used authorities publish HTTP endpoints only, and a token does not
  need the transport for its integrity. It is verified before it is embedded:
  the authority's signature, the imprint, the nonce and the timestamping key
  usage. The request carries a hash of a signature value and nothing else. No
  authority a person types exists until the SSRF guard above does.

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
9. **Every artefact this project fetches obeys these four guarantees, and this
   document is the writer of record for them.**

   1. **HTTPS only.**
   2. **Host-locked, re-checked on every redirect hop** rather than only on the
      first request. A release download redirects to a signed asset host, so a
      first-hop-only check leaves the hop that delivers the bytes unchecked. An
      entry may be `*.example.com`, which admits that domain and any subdomain
      of it and nothing else — needed because HuggingFace answers an LFS URL
      with a redirect to a **regional** host, so an exact list works on the
      machine it was written on and refuses everywhere else. It is still a
      compile-time constant and the choice of host still belongs to the vendor's
      DNS; what it gives up is that the whole subdomain space is reachable.
   3. **Size-bounded by counting received bytes, never by trusting
      `Content-Length`** — a header is a claim by the sender, not a limit.
   4. **SHA-256 verified in quarantine before any parser touches the bytes.**
      The download streams into a file nothing interprets, and only a matching
      digest moves it to its destination. A mismatch is **never retried**:
      retrying one is downloading until the hash matches, on the single check
      that stands between a pin and whatever the host served.

   This read *"downloaded executables are hash-verified before any parser
   touches them"* until 2026-09-11, which is one of the four and narrower than
   the code on two axes — the subject is every fetched artefact rather than
   executables, and the digest is the last of four checks rather than the only
   one.

   **Two derived forms, because there are two layers and neither can import the
   other.** `scripts/lib/fetchVerified.mjs` serves the bootstrap layer, which by
   §1.1 runs before dependencies exist; `packages/kernel/src/verifiedDownload.ts`
   serves the shipped application, which fetches at a user's request long after
   every build. This is invariant 27's situation and takes its rule: **copy only
   where the reader cannot reach the source, and a copy that exists must be
   proven equal.** `proof:verifieddownload` drives both through one table of
   cases — equal in what each **refuses**, never compared as text, since two
   implementations in two languages agree textually only by accident.

   What is pinned is the four guarantees and nothing else: retry policy,
   backoff, quarantine naming and error text are each form's own, so a
   difference outside the four is a difference nothing reports
   ([ADR-0053](DECISIONS/0053-the-download-rule-is-law-and-two-layers-enforce-it.md)).
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

    **THE SECOND RENDERER WAS READ AGAINST BOTH TERMS, 2026-09-10, and moves
    neither.** §6.1's setting makes the renderer decode a **PNG per draw**, which
    is the shape that would break the cap term's blocker if anything retained
    one. Nothing does: `document.renderPage` answers bytes, `App.tsx` hands them
    straight to `createImageBitmap`, `renderPage.ts` draws the result at 0,0 and
    calls `drawn.close()` on the next line, and neither the bytes nor the bitmap
    is stored anywhere. So *there is no bitmap cache to cap* is still true, and
    the proportional term still waits on the same instrument.
    
    What the second renderer does add is a **transient peak per draw** — the PNG
    and its decoded bitmap alive at the same moment — and a peak is what a
    budget measures, so it is stated rather than dismissed. It is bounded by the
    channel rather than by a convention: `MAX_RASTER_BYTES` 32 MB plus
    `MAX_RASTER_PIXELS` 16,777,216 × 4 bytes, so **99 MB at the bound**, for one
    page at a time. Measured on a real A4 page at 200 dpi it is 1.63 MB of PNG
    and 15.5 MB decoded, ≈ 17 MB.
    
    **And it leaves the owed instrument a requirement**: whatever eventually
    composes a renderer for `perf:gate` must draw with the second rasteriser
    **on**, or it will measure the path that does not decode anything and report
    a number about the other engine.

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

    **Amended 2026-09-09 — the mechanism holds and IT CANNOT START ON A STORE
    INSTALL, which is a different sentence and had never been said**
    ([ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md)'s
    correction and Decision 16 of that date). An AppContainer's access check
    grants on the token's own package SID, `ALL APPLICATION PACKAGES`, or a
    capability the token holds. The host's SID is derived from a moniker **this
    application mints**, its token is built with `CapabilityCount: 0`, and an
    elevated read of the install root retired the premise that MSIX grants
    `ALL APPLICATION PACKAGES` — three packages read, that principal in none of
    them. So under a Store install root the contained host is granted nothing
    where its runtime, its FFI and its shim live, and it dies before its first
    line rather than reporting why (measured twice, ADR-0025 and
    `containerGrants.mjs`).

    Nothing above is withdrawn: (c) and (d) are still supplied by an
    AppContainer and by nothing else, and the creation route is still the
    reason. What is added is the half a reader could not get from here — **a
    containment mechanism that is correct and unreachable is not a shipped
    containment mechanism**, and which of three routes restores the reach is
    Decision 16's, undecided and unmeasured. Development is blind to it by
    construction: a checkout grants the principal production does not.

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
| 2026-09-13 | **An RFC 3161 timestamp request may be plain HTTP, to a declared authority, and the token is verified before it is embedded** (§9's network rule; §3's digital signatures row). D7's TSA row found that the widely used authorities publish HTTP endpoints only and that no SSRF guard exists, so a timestamp server a person types is not buildable. The network rule gains **one** exception, for a timestamp request to a host in the contract's authority list: integrity comes from verifying the token — status, content type, imprint, nonce, signer, key usage, and the signing-certificate identifier RFC 3161 §2.2 requires (added by the ADR's same-day correction) — through `signedDataCheck.ts`, the one RFC 5652 verifier. The network reaches the kernel through a port the composition supplies, and a failed timestamp refuses the signing rather than signing without one. Sources read and dated in the ADR. | `BUILD-PROMPT.md`'s *Network: HTTPS only, host-locked per purpose* (line 405) and §9's restatement of it, for a timestamp request only; `BUILD-PROMPT.md` D7's TSA clause, which named no transport. Invariant 9 is not loosened: it governs pinned artefacts, and a reply that is new on every request cannot be one | [0058](DECISIONS/0058-a-timestamp-authority-is-verified-not-trusted-and-its-request-may-be-plain-http.md) |
| 2026-09-13 | **The network engines are one declared set, main holds one recogniser per engine, and a provider's key is the provider's** (§3's recognition row). D6 gained a second network engine after Stage 6 closed — Claude, beside Azure Document Intelligence — and *which engines run in main* was three literals: a composition branch, a request arm, and a pre-read **ternary that would have recognised any new engine as handwriting**. So `NETWORK_OCR_ENGINES` is declared once in the contract, main's recognisers sit in a record keyed by it, and each takes the host's raster and frame (ADR-0052 §7). Claude's raster is sized so the service never resizes it and its answer is re-validated in the kernel; every stop reason but `end_turn` is refused by name, because a refusal arrives as HTTP 200. **The Anthropic key is one secret, in an `ai` category, that Stage 9's provider registry takes** rather than a second recogniser key. Sources read and dated in the ADR. | ADR-0052 Decision 6's per-engine placement as call-site literals; `BUILD-PROMPT.md` E5's `AiProvider` key, which this places ahead of Stage 9 | [0057](DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md) |
| 2026-09-12 | **The Settings dialog derives a control from a setting's schema, an enumerated setting titles its members, and a secret is write-only** (§7's Settings row). §7 has said the registry derives *the entire Settings dialog* since Stage 0, and measured 2026-09-12 no dialog exists: nothing calls `inCategory`, `settings.loadSecrets` or `settings.saveSecret`, so a setting without its own command has no surface — the theme cannot be changed, the Azure endpoint and key cannot be entered, and D6 row 8's tool, whose visibility reads a key the renderer's store can never hold, cannot appear. Building it is registration except for one thing: an entry carries one title, and an enum's members are values rather than words (B9), so **an enumerated setting now carries a title per member**. The dialog derives one control per schema kind, excludes by name the kinds with no honest generic control, answers its command (ADR-0038), and a secret is **write-only** — `settings.loadSecrets` answers which ids are stored and never a value, which E5 requires and the channel did not do. | `BUILD-PROMPT.md` Part F's entry fields *(id, type, default, category, i18n key, `secret?`, migration)* | [0056](DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md) |
| 2026-09-12 | **Unlocking an encrypted document is an open, the password crosses into the host, and `needsPassword` is banned** (§3.2). `BUILD-PROMPT.md`:255 assigns encryption to MuPDF and says nothing about how a password reaches it, because nothing in any declaration says what the reaching costs. Measured 2026-09-12: `needsPassword()` is `pdf_needs_password`, which is `pdf_authenticate_password(doc, "")` — an authentication attempt, and a failed attempt re-derives and so **destroys** the file key a successful one left. One such call after a correct password takes a page from 24 structured-text blocks to zero and rasters it blank, the engine inflating streams nothing decrypted. Three consequences are law rather than practice. **Unlocking is an open**: one attempt per `openDocument`, the host holding no locked session between attempts, which makes *a session authenticated against and lost* unrepresentable on the wire rather than a state to be caught — the rejected shape is an `engine/authenticate` call on a held session, cheaper by one parse and reachable into exactly that state by any caller that sends two attempts. **The password crosses into the contained host**, because MuPDF is there by invariant 25 and `main` parses nothing; this grants the host no capability, since a host that opens an unlocked document already holds the plaintext and a host handed a password holds the same plaintext one call later — the containment is for the parse. **And it does not persist**: not in main, not on a record, not in a diagnostic, so invariant 22's `recycle` refuses on an unlocked document rather than rebuilding a session that cannot read it. The renderer learns `needs-password` and a minted pending-open token and nothing else, by invariant L2's own rule. | `BUILD-PROMPT.md`:255 (silent), `document.open` takes no parameters (§5) | [0055](DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md) |
| 2026-09-12 | **A recogniser runs where its INPUT can reach, and the third one's input is the network** (§3's recognition row). ADR-0052 Decision 2 put recognition inside the engine host and gave the reason twice — the input is a bitmap this build produced beside the rasteriser, and 1.7 MB of it would otherwise cross a pipe for ~20 KB of answer. That is true and it is about the two **local** engines. D6 row 8's Azure Document Intelligence is an HTTPS call, and **invariant 25 gives the host no network at all** — the same sentence that made TrOCR's download main's job — so it executes in `main`. **The placing rule is per engine and is the one already used for the download**: only the process with the network may do the thing that needs the network. What it gives up is exactly what Decision 2 protects, the raster crossing a boundary; that is unavoidable and cheap in those terms, since the bytes are leaving the machine regardless and a local pipe hop is nothing beside the upload. **No second rasteriser and no new channel**: `engine/snapshotRegion` already writes a region's PNG into the granted output directory (ADR-0044's shape, so a payload scaling with what the reader dragged never crosses), and it gains **the matrix mapping that PNG's own pixels back to PDF user space** — six numbers, bounded — so the page transform, the crop origin and the `/Rotate` stay in the one process holding them. A main-side reconstruction would be the second place that knows the frame, agreeing on unrotated pages and wrong on the rest, which is finding FFFFFF-1 in a third engine. Sending a rasterised **region** rather than the document also keeps the service's answer in `pixel` — Azure reports `inch` for a PDF — so this removes a unit conversion rather than adding a frame, and it sends what the reader asked about rather than their whole file. The endpoint is an ordinary setting and the key a **secret** one through `secretStore.ts`; `BUILD-PROMPT.md`:621's AI settings group is a Part F *category*, not a registry dependency, and Azure DI implements no part of `AiProvider`. **Rejected:** a network-capable engine host (invariant 25 by name, whose own argument is that a host reaching a socket can send a document through one); a third host with network and no document (answers the invariant literally, buys nothing — the thing needing containment is the parse, and there is none here — and costs a second containment story to keep true); sending the document rather than a raster (the service receives the whole file where one region was asked about, a privacy answer nobody chose, and a document-scaled payload on a channel); recognition in the renderer (invariant 2 gives it no bytes, and its raster is PDF.js's, which the 2026-09-10 §6.1 amendment makes a *view* concern). **Not claimed, and written into the row rather than here**: nothing has run against the live service, so every fixture asserts a reading of the documented schema and not the service's behaviour | §3's recognition row as amended 2026-09-11, whose *"both execute in the host"* named two engines and read as a rule about the concern | [ADR-0052](DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md), addition of 2026-09-12 |
| 2026-09-11 | **The download rule is law, with two derived forms and one proof between them** (invariant 9). D6 row 7 fetches a model in the shipped application at a user's request, and its FEATURES body recorded the blocker as a choice between moving `scripts/lib/fetchVerified.mjs` into a package, shipping `scripts/` with the app, or keeping two implementations. **All three share a false premise** — that provisioning and the application must reach one module — which §1.1 refutes in its own words: `scripts/` is *"the code that runs before dependencies exist"*, and an on-demand download runs long after every build. Measured on the ordering rather than argued from the principle: `ci.yml` provisions Electron at a step **before** *Typecheck and build*, and the Guards job runs no `npm ci` at all, so a bootstrap module importing `dist` would import something that does not exist yet on one job and can never exist on the other. So the question is not which module both use but **what the rule is and where it is written**, which is invariant 27's discipline exactly — *copy only where the reader cannot reach the source, and a copy that exists must be proven equal*. The invariant now carries **four** guarantees rather than one, and the widening is on two axes: it read *"downloaded **executables** are hash-verified before any parser touches them"*, where the subject is every fetched artefact and the digest is the **last** of four checks. `packages/kernel/src/verifiedDownload.ts` is the application's form, placed by asking **both** of §1's axes and recording that they agree — its subject is the OCR runtime's cache, and by [ADR-0024](DECISIONS/0024-execution-mode-is-a-placement-axis.md) it executes in `main`, where `apps/desktop/` would be *permitted* rather than required, and it needs no Electron API. Equality is **behavioural and never textual**: two implementations in two languages agree as text only by accident, and a comparison that moves both sides together is indistinguishable from absence. Every refusal case is built from an input the **absent** guard would let through — right digest, under the ceiling, a fetch that would have succeeded — and where an end state is ambiguous the case asserts the **decision**: the scheme refusal asserts the injected fetch was never called, the digest case that it was called exactly once. **Rejected:** moving the rule into a package (it inverts §1.1 — the bootstrap layer importing what it bootstraps); shipping `scripts/` (it ships the hooks, the provisioners and the launcher, and invariant 26 keeps the launcher there *because* the directory sits outside both enforcers); generating one form from the other at build time (a build step cannot run before the build, and a generated file a reader cannot tell from an authored one); comparing the two as text; and one implementation with the second trusted, which is what a reader assumes whenever two files state one rule. **Not claimed:** the forms are not identical — retry policy, backoff, quarantine naming and error text are each form's own, so a difference outside the four is one nothing reports; and Part C8's SSRF guard for **user-supplied** URLs is still unwritten, both forms taking a compile-time host list where host-locking *is* the guard | Invariant 9's single clause, which named executables and the digest alone; and `BUILD-PROMPT.md`:937, which states it in the same words | [ADR-0053](DECISIONS/0053-the-download-rule-is-law-and-two-layers-enforce-it.md) |
| 2026-09-11 | **A second recogniser arrives on demand, reads a region, and never ships in the installer** (§3's recognition row). D6 row 7's TrOCR is a second answer to *a raster becomes characters and their boxes*, which is B3 unless the choice lives in one place: `OcrRequest` names the engine, both implementations answer a `RecognisedPage`, and nothing downstream chooses. **Measured before designing, and two answers are not the row's own wording.** The founding record's *"200+ MB runtime"* is `onnxruntime-node` and the figure is exact — **220,344,078 bytes** — while the WASM runtime a run needs is **13,961,845**, 6.3% of it; *never bundled* survives that anyway, because the models are **63,242,844 bytes** at the smallest and the downloader, the pinned digests, the cache and the clear-caches control have to exist whatever the runtime does. Bundling would remove no mechanism, only pre-pay a download for readers who never use the feature — which is the opposite of the two constraints that dissolved this month under the same check, and is why the check is worth running rather than its outcome worth expecting. **The pipeline runs without `@huggingface/transformers`**, whose tree pins that 220 MB native package, a **dev prerelease** of `onnxruntime-web` and `sharp`: measured by writing it, the glue is a resize-and-normalise, a greedy argmax loop and an **id→piece table**, because decoding a `Unigram`/`Metaspace` tokenizer needs no merge rules and no encoder side. The spike's first detokeniser assumed byte-level BPE, found nothing, and printed an **empty string** — the reassuring answer, on the one feature whose product answer is *this page has no text*. **The scope is a REGION and never a page**, and that is the measurement forcing a design rather than a limitation being accepted: TrOCR reads one text line, at **2,899 ms** of encoder warm and 569 MB resident, against **3.8–4.4 s for a whole page** through Tesseract — so a *recognise this page* control would work and take minutes, which is the wired-tools rule's own territory. Row 6's region gesture is already *read this part of the page*, so the handwriting engine is an option on that path and page and document scope stay Tesseract's. **Main downloads and the host reads**: invariant 25 gives the host no network, so main resolves a `userData` cache, fetches what is missing against a pinned SHA-256 and grants the directory — `tessdata`'s pattern, generalised — and `BUILD-PROMPT.md`:627's clear-caches control lands with the row rather than after it. **Not claimed:** the merged decoder's KV cache and `numThreads > 1` are unmeasured headroom, the latter failing in Node because the threaded build fetches its worker through a URL the file scheme does not satisfy; and **handwriting accuracy is unmeasured**, the spike having read printed text, because a labelled sample is not something this repository has and the corpus's content may not be quoted | §3's recognition row, which named one engine for the concern; and `BUILD-PROMPT.md`:806's figure for the runtime, corrected while its conclusion stands | [ADR-0052](DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md) |
| 2026-09-11 | **A pre-read may be parameterised by the command that needs it, and a stored-effect replay re-applies the pre-read it stored** (§8's seam, §4's log entry) — two amendments for one command, both found by writing its caller. D6 row 3 writes a page's recognised text into that page: §3's content-composition row puts the write on `@cantoo/pdf-lib`, whose byte-image `apply` is `(image, command)` and holds **no engine session**, while the read runs **inside the engine host** beside the rasteriser that feeds it — 1.7 MB of bitmap against ~20 KB of answer, and ADR-0014's constraint 1 keeping the model and the datadir ours. That is the row below's own shape, *an apply may also need a value read through another engine*, and its axis cannot express this instance. **Wall 1: a pre-read takes no argument.** `PreReadAccess` was `{ outline: () => Promise<…> }`, which is the whole shape an outline needs, because an outline is a property of the **document**; a recognition is a property of a **page** and there was nowhere to say which — and `Apply` hard-coded `R extends 'outline'` beside it, so a second member would have been resolved and then dropped on the way to the apply. `PreRead`'s members now carry a **`needs` type beside their value type**, and `PreRead`, `CommandReads` and `PreReadAccess` are all **derived from that one declaration**, so the halves cannot drift and a member cannot be added without saying both what it answers and what it must be told. **Each member keeps its own signature** — `access.ocr()` and `access.outline(page)` are both compile errors — where an optional argument on every member, the cheap widening, makes both legal and leaves the rule in a comment (QQQ-3). The **declaration** carries the one expression that turns a command into the needs, `reads` and `read` being one arm of a union so neither can be written without the other and a `reads: 'none'` command cannot carry a resolver; the bus still indexes nothing and reads nothing. **That is the first function in `commandDeclarations.ts`**, taken deliberately rather than slipped in: ADR-0026's property is that nothing can value-import an engine through that file, the expression imports nothing and copies two fields, and it is the only spelling in which the command's kind and the pre-read's needs are correlated **by the checker** instead of by a cast or a runtime refusal. **Wall 2: `redo`'s compile-time trigger fired, and it is the first trigger in this repository to fire as designed** rather than to be found stale. §3a names the case in its own words — *"OCR output moves with the engine version"* — and §4 reserves checkpoints for *"redaction, flatten, encryption and OCR"*, so `ocrPage` declares `reproducible: false, replay: 'stored-effect'`, which is precisely what `const replay: 'reapply-intent' = spec.replay` was placed in 2026-09-04 to catch. A **terminal log entry now carries the pre-read value the apply was handed** and redo re-applies that one: re-running recognition costs **3.8–4.4 s per page** again and, after a model or engine upgrade between the undo and the redo, produces a document **different from the one that was undone** — the silent divergence §3a exists ahead of any command to prevent. Required and nullable rather than optional, which is `CommandLog.trimTo`'s own rule (*"an obligation that arrives as an absent value is one a caller forgets to check"*), and not document-scaled: a page's recognition is bounded by `engine/ocr-page`'s 2,048 lines of 4,096 characters, beside a checkpoint that is a whole document image and already governs retention. **Rejected:** the recognised text in the command payload — L11 by inspection and ADR-0035 by measurement, extracted text at **3.59×** a document's bytes and never resident in main; one access member taking the whole command union and narrowing by kind, which puts a refusal in main for a state the declaration table makes unreachable; building the access object per command, which `documentCommands.ts` already does and which would make every *other* command supply an `ocr` member with no page to give it — a branch on kind in the composition root, the second routing place §6's mapped types exist to prevent; a second accessor object beside `PreReadAccess`, refused by `CommandInputs`' own argument about a fifth positional parameter; routing the command to MuPDF so the read and the write share a session, which is the row below's *"classifying by convenience, which is how a matrix stops being evidence"*; declaring OCR reproducible so the existing replay path serves it, which contradicts §3a's own example and fails invisibly; storing the resulting bytes as the effect, a second whole document image per entry and a second write path into the document; and a third log-entry kind, where `retainedBytes` and `trimTo` both classify on `kind === 'terminal'` and a third state they do not know about is DDD-1's asymmetry exactly. **`outline` is unmoved and that is the evidence**: it is the existing implementer, it is the member that takes no argument, and its cases are what say the seam was generalised rather than widened | §8's `Apply`, whose `reads` branch named one member of an axis it is parameterised over; `PreReadAccess`' zero-argument members; and §4's two-shape log entry, whose terminal shape carried no room for what an apply was handed | [ADR-0051](DECISIONS/0051-a-pre-read-may-be-parameterised-and-a-stored-effect-replays-it.md) |
| 2026-09-10 | **The OCR binding is Tesseract's core, driven directly** (§3). The row above names `tesseract.js`, which `BUILD-PROMPT.md`:473 names and this build cannot ship: its production tree reaches `tr46@0.0.3`, a package that ships **no licence file of any kind** while declaring MIT, and `scripts/release/generateNotice.mjs` refuses to render a NOTICE that drops it. **That refusal is not waivable by an ADR** — its own wording is imperative, an exception to it would be an override standing in for missing coverage, and the substance is worse than the check, because a package whose terms do not travel is the actual AGPL failure (`BUILD-PROMPT.md`:813) and the generator is only what noticed. **The whole chain is otherwise AGPL-compatible**; this is a missing-text failure and not a compatibility one, which is worth stating because *a licence problem* reads as the harder kind. `tesseract.js-core@7.0.0` is the package the WASM is actually in, declares **no dependencies at all**, ships an `Apache-2.0` LICENSE, and is the exact version `tesseract.js@7.0.0` itself depends on. Measured before it was chosen (`scripts/research/ocrCore.mjs`, same document, same page, same rasteriser, same dpi): **2,016 non-whitespace characters, 41 lines, 402 words every one of them boxed, mean confidence 94** — identical to the wrapper's reading — in 3.8–4.4 s against 4.8–5.2 s, instantiating in 51–83 ms against 579–1041 ms. The character count needed **resolving** rather than accepting: `GetUTF8Text().length` is 2,435 here, and printing both spellings showed the earlier figure was the non-whitespace one. What the wrapper sells is worker orchestration, and this build does not want it — recognition runs inside a contained host process, which is the isolation invariant 25 already provides — plus a model CDN ADR-0014 constraint 1 rules against, image loading for inputs that are already a PNG in the same process, and a result walker `api.GetJSONText()` makes unnecessary. The remaining sequence is about sixty lines. **Rejected: shipping it with an ADR exception** (above); **widening the generator's family rule** (it covers a per-platform binary variant whose terms are published once by its family, on three assertions — `tr46` is a standalone package, so the rule refuses it correctly, and it has already been widened once for `koffi`); **patching the dependency out** by `overrides` or a fork (a maintained divergence, for a CDN this build never calls); **a different binding entirely** (open, and `BUILD-PROMPT.md`:67's `xlsx`→`exceljs` rule is the record's own precedent for replacing a named library that fails the policy — not needed, because the core is the same Tesseract at the version the named binding pins). | `BUILD-PROMPT.md`:473's `tesseract.js`, under :67's adoption policy and :821-822's *both halves are law* | [ADR-0050](DECISIONS/0050-the-ocr-binding-is-tesseracts-core-driven-directly.md) |
| 2026-09-10 | **OCR recognition is its own concern and `tesseract.js` writes it, inside the engine host** (§3). The matrix carried the OCR text **layer** — the embedding — and nothing for turning a raster into characters, so D6's six recognition rows had no writer of record to register into and would each have picked one at a call site. Written before them rather than under them. **The measurement that decides it**: [ADR-0014](DECISIONS/0014-ocr-stays-inside-the-engine.md) keeps Tesseract and Leptonica inside MuPDF *"reached only through MuPDF's own OCR API"*, and its second ground is that *"the integration it needs is exactly the one already present"* — which is true of `monstera_mupdf.dll` and **false of the engine the application loads**. `scripts/research/ocrSurface.mjs` reads the artefact the kernel's own bare `mupdf` import resolves to and finds `tesseract`, `leptonica` and `ocr_` at **0, 0, 0** in the binary and **0** across its whole JavaScript surface, against **2, 4, 9** in the shim, each with a per-artefact positive control — and the first run of that instrument **failed its own control**, having looked for the JavaScript wrapper's class names inside a WASM binary, which is what an anchor is for. The MuPDF route is therefore not *available today*; it is available after the native reach decided on 2026-09-08 is built, which is 117 API members and would queue the whole stage behind an adapter migration. `.ocr` is closed either way by invariant 23. **Rejected: recognition in `main`** (a WASM engine in the process ADR-0026's barrel discipline and `proof:kernelload` exist to keep clear of engines); **recognition in the renderer, beside spell check** (its raster is PDF.js's or PDFium's, both *view* concerns by the 2026-09-10 §6.1 amendment, and making a display raster the input would make PDF.js a source of truth); **a second rasteriser inside a recognition worker** (B3a, against the *Print & export rasterisation* row); **waiting for the MuPDF route** (it re-orders Stage 6 behind an unbuilt migration for an integration this build cannot reach). | `BUILD-PROMPT.md`:473 names `tesseract.js` and :806 excludes it from the download-on-demand class; [ADR-0014](DECISIONS/0014-ocr-stays-inside-the-engine.md)'s second ground, whose premise is corrected there | [ADR-0014](DECISIONS/0014-ocr-stays-inside-the-engine.md) (dated correction, 2026-09-10) |
| 2026-09-10 | **PDFium's rasteriser is a second opinion about how a page looks, not a better one** (§6.1). The clause called it *"an optional higher-fidelity rasteriser behind a setting"* and the HD render row is that setting, so the phrase was the row's whole justification. **Two measurements refuse it.** `pdfiumRender.mjs` (2026-09-08) established that the only reference-free metric — each engine against its own supersampled render — ranks **hinting** rather than accuracy: an engine that deliberately fattens stems at low resolution is scale-inconsistent on purpose, scores badly, and looks better on a screen. So *which is better* has no answer a script can give, and none is available from anywhere else here. `pdfiumAgainstPdfjs.mjs` (2026-09-10) then measured the pair the setting is about — PDF.js as the product drives it, against PDFium at the same device size, **pixel for pixel** through a canvas readback extended to carry pixels rather than counts: **mean 0.645 levels over the canvas, 12.716 over inked pixels, 1.84% of pixels differing, worst 255**, with PDFium laying 99,561 inked pixels against PDF.js's 97,670. **They differ materially, and difference is not quality.** What changes is the feature's PURPOSE, which is why this is an amendment and not a rewording: the setting exists so a reader whose document one rasteriser draws badly can try the other. Shipping it as *higher fidelity* would have been a claim no measurement supports — the display-only defect with a settings entry on it, which is the objection `pdfiumRender.mjs` was written to test. **No ADR: this narrows a clause to what was measured rather than deciding between alternatives, and the measurements are the record.** The row's citation is corrected with it — the sentence is §6.1's, not §3's. | §6.1's *"optional higher-fidelity rasteriser behind a setting"* | — |
| 2026-09-09 | **A grouping of our own is permitted where no engine answers, and only where a person confirms it** (§3, §3.2). ADR-0034 settled the reading side by owning the engine's OPTIONS and implementing no clustering, and left one test for anything that came after — *does it read a coordinate to decide grouping* — with three routes for an engine that cannot answer. The editing engine cannot: **measured 2026-09-09** (`scripts/research/pdfiumLines.mjs`, PDFium 155.0.8044.0), `FPDFText_CountRects` answers **4 rects for four runs** whether the two sharing a baseline sit 170pt or 3pt apart, so its rects are per-RUN and there is no line answer to configure. Route 1 has nothing behind it, so this takes route 2 — a recorded engine gap, with the command that established it. **What PDFium does answer is the mapping**: `FPDFText_GetTextObject` resolved 40 of 45 characters to their page objects, the other five being its own *generated* spaces which `FPDFText_IsGenerated` flags — so a range of text becomes editable objects inside one engine's frame, and the cross-engine join stays refused on `proof:lineagreement`'s **52.9%** verbatim line agreement. **The editor therefore owns a grouping, by vertical OVERLAP** — a relation, not a threshold, so Part E2's *"constants change only with a corpus score"* has nothing here to govern. Exact equality was rejected on the same run: two runs on one baseline came back with tops 237.9 and 238.0. **What keeps it outside ADR-0034's ban is where its output goes, not what it reads**: an extraction path's grouping becomes text somebody takes as the document's content and a wrong answer is silent; this one reaches a dialog and nothing else, so a wrong answer is on screen with the words it will replace. The rule stays checkable — *does this grouping's output reach any consumer other than a dialog a person answers?* | Nothing withdrawn. ADR-0034's decision for the reading substrate stands entirely; this takes the route that ADR reserved and names the gap it required to be recorded | [ADR-0049](DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md) |
| 2026-09-09 | **A byte-image host's `engine/open` registers an AREA and parses nothing, and the wire differences belong to the writer SHAPE** (§3). Found by writing main's side of the call, hours after the decision it withdraws. **Two independent reasons.** A per-document open mints a per-document id and main has nowhere to keep one: `CommandBus` hands a byte-image writer the document's **bytes**, which carry no identity, and `SessionsByWriter`'s `pdfium` slot is typed the same way — ADR-0039 spent a decision removing identity from there, and putting it back is a worse trade than the one Decision 3 was making. And the benefit claimed was that main's `open-failed` handling would otherwise be *correct for one host and dead code for the other*; main's handling **poisons the document** (ADR-0023 Decision 9a), which is right for the engine the document is read through and wrong for one only needed to edit — so identical protocols would have made the existing handling wrong for the second host. **What replaces it:** the area's lifetime is the HOST's, a transfer buffer with a fresh file name minted per call, and a document this engine cannot read fails the call that needed it, at the moment the engine is wanted. Decision 2 is untouched and is why the channel still exists — the place is named once and no later message can move it. **And the general form:** the two hosts differ as `byte-image` and `live-session`, not as PDFium and MuPDF, so `coreEngineChannels` takes an engine's command schemas and one **wire shape** constant per `writerShapes` entry | ADR-0048 Decision 3, withdrawn in full. Decisions 1 and 2 stand, as does the six-channel split of the same day | [ADR-0048](DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md) |
| 2026-09-09 | **`engine/serialise` is the live-session shape's channel, and a second engine owes its own AppContainer profile** (§3). Both found by writing the PDFium host against the amendment below, the same day. **A byte-image host's session has no current bytes**, so *write the session's current bytes into the output directory* has nothing behind it — and a host declaring it would answer by copying its input to its output, which is that amendment's own *process answering questions with nothing behind it* wearing a working channel's shape. `engine/apply` is what replaces it: a byte-image apply writes its result into the granted directory and answers a **count**, which is `engine/serialise`'s own result schema, and `CommandExecution<W>` had declared the asymmetry all along — `apply` returns a `ByteImage` for a byte-image writer and nothing for a live-session one. **The general rule: a channel is engine-agnostic when its ANSWER means the same thing, not when every engine can be asked it.** This also settles what ADR-0047 deferred to the first PDFium command — the input and output **names** ride on `apply`, `capture` and `invert` for a byte-image engine only, through the schema set an engine hands `coreEngineChannels`, so a live-session client cannot name an output file and a byte-image one cannot omit one; the cost is two whole-image writes and one read per command, which is *whether capture and apply share one open* arriving as bytes rather than as a parse and is **still open**. **And the second host owes its own container profile**: `hostSessionDirectoryDacl` grants the AppContainer's SID, which comes from a shared moniker, so two hosts from one profile read and write each other's areas and *a breach of one engine would hold the other's documents* would be true of two processes as of one — the separation is in the principal, not the process count | The seven-channel split of 2026-09-09 becomes six plus one live-session channel. Nothing else in that amendment moves: the twelve reads, the granted area and the parse-once open all stand | [ADR-0048](DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md) |
| 2026-09-09 | **A host's reader set is its own engine's, and what a host holds between commands is a granted AREA** (§3). The 2026-09-08 amendment required *one host body, parameterised by engine* and left two things unstated that a second host cannot be built without. **The nineteen channels split seven engine-agnostic — `probe-containment`, `open`, `serialise`, `close`, `apply`, `capture`, `invert` — and twelve MuPDF document-model reads, and a second engine owes NONE of the twelve.** They are MuPDF's model answered by MuPDF's host; a second host declaring them and stubbing them would be a process answering questions with nothing behind it, and implementing them would be a second reading of a model this package already has one reader for (B3a). `EngineChannelsFor<W>` is where it is said, so main's PDFium client cannot express `engine/annotations` — B5 over a runtime refusal, and the runtime still terminates on an undeclared channel because a compile-time property says nothing about what arrives on a socket. **The table entry generalises to a granted area** — the pair main already names `SessionArea` — with a document session as the live-session engine's addition. `HostSession` holds its directories against the id deliberately: *a `serialise` that carried a directory would be a channel through which a confused main could redirect the document's bytes on every save*, so a byte-image host taking directories per call would give up a containment property as a side effect of ADR-0047's decision about where a parse lives. **And a byte-image host's `engine/open` parses once and discards it**, so `open-failed` means the same thing from both hosts at the same point in the same protocol; what that parse costs on a large document through PDFium is **not measured and not claimed**. **Amendment only: nothing is built on it.** **Not decided:** how input bytes reach a byte-image host, whether capture and apply share one open, HD render's reader session, and the containment branch — ADR-0023 Decision 16 is decided and unmeasured, and gates the branch rather than the body, since no editing command reaches the install root | Nothing withdrawn. §3's 2026-09-08 amendment stands unaltered; what is added is the two questions it left open, both of which the first PDFium command would otherwise have answered under a feature | [ADR-0048](DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md) |
| 2026-09-09 | **An in-place text edit is a byte-image command, and it generates content once** (§2, §8). `writerShapes` declared `pdfium: 'live-session'` from Stage 0 with nothing behind it, and building the second host on that would have answered **by accident** a B4 `savePipeline.ts` carries in writing — *two live-session writers each return the whole document from `serialise`, and nothing in the law says which bytes win* — which [ADR-0039](DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md) Decision 2a names as firing on *"PDFium in Stage 5"*. **The shape argument needs no timing**: the renderer reads main's canonical image through `PDFDataRangeTransport` and the view model carries `{version, pageCount, rotations}`, so a live-session edit would be correct, undoable, savable and **invisible** — ADR-0039 Decision 3's defect arriving in a second engine. Making it visible means the bytes become main's image, which is the round trip a byte-image command already performs; so the live session buys nothing the renderer can use and costs the rule, a session table inside a contained host, and a second live entry in `SessionsByWriter`. **The second decision is measured** (`proof:editcost`, seven controls, ordinal assertions only): `FPDFText_SetText` is 0.007–0.029 ms and flat, while `FPDFPage_GenerateContent` after a set runs 0.17 → 29.18 ms and tracks the **document's content** rather than the edited page — 500 pages of one line costs 12.54 ms against 500 × 40 at 29.18, and 50 × 400 costs 23.93 with a tenth of the pages. Forty replacements on one page: **199.6 ms per-call against 14.6 ms once, 13.7×**, one generate flat in k and the k=1 case demanding the two strategies AGREE as its control. So generation belongs to the command — [ADR-0045](DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)'s shape one operation along — and `replaceTextObject`'s set-and-generate was correct for exactly one replacement — the adapter is `replaceTextObjects` since 2026-09-09, taking a list and generating once, so the expensive spelling no longer exists to be reached for. **The PDFium mechanism behind the scaling is not established and is not guessed at.** **Not decided:** how the input bytes reach the host (`ByteImageAccess.current` answers a `ByteImage` in main, the 2.00× [ADR-0030](DECISIONS/0030-a-remote-writer-does-not-open-from-an-image.md) exists because of; the candidate is `adopt`'s `SnapshotWrite`), whether capture and apply share one open, and the host's generalisation. A **reader's** session is explicitly outside the rule, so HD render is not blocked by it. **Amendment only: nothing is built on it.** Also corrected here: §2's *"`hostBody` is generic over the writer of record"* is a specification, not a description — `hostBody.ts` takes `CommandExecution<'mupdf'>` — and the tense is fixed rather than the requirement | §2's byte-image paragraph, which named only `@cantoo/pdf-lib`'s shape; and `engineSeam.ts`'s `writerShapes` entry for PDFium | [ADR-0047](DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md) |
| 2026-09-09 | **Invariant 25's containment is correct and cannot start on a Store install, and that half had never been written down** (invariant 25). ADR-0023 §5's premise P1 — *MSIX-installed files inherit read+execute for `ALL APPLICATION PACKAGES`, and every AppContainer is a member of it* — was carried unmeasured with three expiry conditions. The second fired: the owner's elevated read on 2026-09-09 returned three packages, `ALL APPLICATION PACKAGES` in none of them and `ALL RESTRICTED APPLICATION PACKAGES` in none either, with a per-package `S-1-15-3-…:(OI)(CI)(RX)` written instead — identical across two packages of one application and **not inherited**. An AppContainer's access check grants on the token's own package SID, that principal, or a capability the token holds; the host's SID is derived from a moniker `engineHostPlatform.ts` mints and `win32HostSurface.ts` encodes `CapabilityCount: 0`, so all three routes are closed under the install root, which is where the runtime, koffi and the shim live. **The failure lands earlier than the diagnostic designed for it**: `probeContainment` runs *inside* the host, so §5's P1 verdict cannot fire — the host dies before its first line, measured twice already (ADR-0025's re-extracted Electron, and `containerGrants.mjs`'s header). **And this machine is blind by construction**: the development grant names `ALL APPLICATION PACKAGES` *because* production was believed to, so the two configurations now differ in the principal, which is the one axis the choice existed to hold constant. Nothing about (c) and (d) is withdrawn and neither is ADR-0022; what is added is that a correct, unreachable mechanism is not a shipped one. Which of three routes restores the reach — a capability in the token, an app-writable copy, or retaking ADR-0022 — is Decision 16's, and it is undecided **and unmeasured** rather than chosen. | Nothing in the founding record; invariant 25's own silence about whether its mechanism can start where it ships, and ADR-0023 §5's premise P1 | [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md), corrected 2026-09-09 and Decision 16 |
| 2026-09-08 | **The asset axis is `'none' \| 'bytes'`, and the widening is a MISLABEL corrected rather than news** (§5). [ADR-0044](DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md) added the axis with the member spelt `'image'`, and its own header states the question as *"does this command carry BYTES that cannot travel on the wire the writer is reached over"* — a transport question, beside a content label. **The label was narrower than the concept from the day it was written**, and this amendment says so rather than presenting the widening as something learned since. The trigger is form-data import: an FDF is PDF syntax, so decoding it needs MuPDF, invariant 20 keeps MuPDF out of `main`, and the picked file's bytes must therefore reach the engine host by the one route bytes have. Declaring `'image'` for an FDF would have **worked** — the transport branches on `asset === 'none'` and reads no further — which is the argument for renaming rather than reusing: a label nothing reads is a label that stays wrong, and the next reader of the declaration table would have been told this command carries a picture. **`CommandAsset<K>`'s conditional is unchanged**: a kind whose payload has no `bytes` field still cannot declare the member, so the illegal state stays unrepresentable. **Nothing else moves** — the same granted `snapshotDirectory`, the same two transport modules, the same untouched `apply` signature, the same bytes in the log. **Rejected:** leaving the name and importing FDFs as `'image'` (a lie no mechanism can catch, since nothing compares the label to the payload); a second member per content type (`'image' \| 'form-data'`, which puts a content taxonomy on a transport axis and grows with every row); and inferring the axis from a payload carrying a `Uint8Array`, which ADR-0044 rejected on its own terms and which `insertImagePage` — bytes, `asset: 'none'` — is the standing counterexample to. | §5's *"A command declares `asset: 'none' \| 'image'`"*, and [ADR-0044](DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)'s member name | [ADR-0044](DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md), corrected 2026-09-08 |
| 2026-09-07 | **A removal's garbage collection belongs to the command that removes, not to the save pipeline** (§4, §8). §4 has required a removal-purpose command to classify itself since 2026-08-16, and flatten is the first one — with nowhere to put the classification: `commandDeclarations.ts` has nine axes and none is purpose, and `serialise(session)` takes no mode. Measured: `bake(false, true)` unlinks nine widgets and `saveToBuffer('')` writes all nine out again, the object count **growing** 49 to 55, so every flattened field's value stays readable to anything walking the xref rather than the catalog. A command declares `purpose: 'ordinary' \| 'removal'` and the adapter that owns its session records the removal and collects from then on — `serialise` takes no mode, because a live-session command produces no bytes of its own and a parameter would be one rule five callers apply. The second half is the amendment §4 did not already contain: `saveDocument` takes a `flush` and cannot collect bytes handed to it already serialised, and deferring to the disk save leaves the canonical image, the checkpoint, `readRange` and every copy/extract/export path re-deriving the rule. Collecting every save rejected on ADR-0008's *never a default* and on `foreignAnnotations.test.ts` pinning a divergence set measured for the plain path only | Nothing in the founding record — Part C4 states one pipeline and is silent on where a mode is applied | [ADR-0045](DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md) |
| 2026-09-07 | **Form fields: delete is its own concern, and MuPDF writes it** (§3). **THIS AMENDMENT ARRIVED AFTER THE FEATURE, WHICH IS THE PROCESS FAILURE B4 EXISTS TO PREVENT.** `deleteFormFields` landed in `6ec345d` writing a document property §3's matrix does not name — the matrix carried *fill*, *flatten* and *create* and no delete — and it was found by the stage audit rather than before the commit. Recorded here rather than quietly filled in, because §3.1 says every row was executed before the kernel was built on it and this one was not; the evidence exists (`scripts/research/formFieldDelete.mjs`) and its ORDER does not. **The substance:** MuPDF's `deleteAnnotation` removes a widget from `/Annots` and from wherever the field tree references it — a split field's `/Kids` 1 → 0, a group's 2 → 1 — and leaves a field with an empty `/Kids` that `@cantoo/pdf-lib` still lists by name, so the prune is owed and there is no field-level API to do it with. **The alternative that has to be argued rather than assumed** is that create and delete are one concern — the `/AcroForm` tree — and must therefore share a writer, which would put delete on pdf-lib beside create and make it cost the 225–320s this range measured for every byte-image row. This matrix already splits form fields by OPERATION rather than by structure (*fill* is MuPDF, *create* is pdf-lib, and both write field dictionaries), so a per-operation row is the table's own granularity rather than a new principle. **That reading is the reviewing seat's to overturn**, and it is stated here rather than settled silently. | §3's matrix, which named three form-field concerns and not this one, and §3.1's *"every row above was executed … before the kernel was built on it"* | — (the measurement is `scripts/research/formFieldDelete.mjs`; an ADR is owed only if the two-writers reading is taken) |
| 2026-09-07 | **A command may carry an ASSET, and it reaches the engine the way the document does** (§5, §8). Place image and stamps are one object — a `/Stamp` whose appearance draws an image XObject — so move, resize and delete already exist, and the image had no way to reach the writer at all. **The recorded block was the wrong wall.** `docs/FEATURES.md` row 128 said *"what blocks it is a number"*, 256 KiB against 64 MiB; measured 2026-09-07 the host's wire is **JSON**, so a `Uint8Array` arrives as an object of numeric keys, `MAX_IMAGE_BYTES`' own `instanceof` refines it away, and the encoding costs **8.4×** — no MuPDF-routed command has ever carried bytes, and raising the frame maximum would not help, since at 8.4× a 30 KiB image already spends 252 KiB of 256 and still arrives as the wrong type. **§3's matrix is NOT amended**: `:384` assigns *"Annotations (all types), appearance streams"* to MuPDF whole, and a writer of record chosen by pipe width is Rule 0's widen-the-type reflex one layer up. A third axis, **`asset: 'none' \| 'image'`**, joins `sources` and `reads` for their reason — a requirement of the apply, declared rather than inferred from a payload that happens to carry bytes — and the asset travels `snapshotDirectory`, which `engine/open` already grants the host READ on and which the document itself arrives through. Three properties fell out rather than being designed: the direction is the one the host may only read, so it grants the contained side nothing; the apply signature and every kernel caller are unmoved, the transformation staying in the two transport modules; and the log still holds the bytes, so undo, redo and `reproducible` are unaffected. **The strongest alternative was executed, not argued** — pdf-lib writes the `/Stamp`, MuPDF's widget-filtering walk sees it, `setRect` moves it **without regenerating the appearance**, delete removes it, and the `/Monstera_Authored` mark survives, five for five. It loses on a cost keyed on the wrong variable: one pdf-lib load and save is **197.3s and 224.8s, two runs, at 127,082 objects** against **0.57s and 0.64s at 122 objects and 199 MB**, and every byte-image row shipped so far is a document-level operation invoked once where a stamp is a repeated gesture. **That reading stands against the shipped byte-image rows and is deliberately not acted on here.** **Rejected:** chunking (refused by the frame constant's own header, at a boundary invariant 25 calls hostile); raising the maximum (a non-solution, and it spends *"a frame this size cannot be a document by accident"*); re-encoding the payload, which the constant's header demands be tried first and which an image has no reading for; resampling to the placed rectangle (degrades data the user supplied, and makes one field's bound a function of another's value); a content-stream image (renders identically, unselectable, unmovable, undeletable — which is the row); and a generic spill by size, which is the generous maximum that constant warns about, with a file behind it. **Built-in stamp artwork keeps its own block**, which this does not touch. | §5's account of the host pipe, which describes framing and validation and does not say what a payload the wire cannot express does; and §8's seam, whose axes were `sources` and `reads` | [ADR-0044](DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md) |
| 2026-09-06 | **An annotation this build wrote carries a private mark, and its absence is what foreign means** (§4). L5 named a `srcRef` marking scheme and never defined one, so *annotations it did not author* has never been a computable set — the clause was a description of an intention, and `pageAnnotations.ts`' header says so, refusing to invent a scheme inside the first drawing tool because the tempting fields already mean something else. [ADR-0041](DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md) closed the neighbouring question and said explicitly that it was not closing this one: *a handle says which one; the scheme says may I rewrite it*. **The mark is a private key on the annotation's own dictionary**, `/Monstera_Authored`, value boolean `true`, written at the single creation site and read at the single walk — the two functions that already mint and resolve the handle, for B3a's reason. **Measured before designing** (MuPDF 1.28.0, 2026-09-06): the key is accepted as a boolean, a name or a string; it survives a save, a reopen and a second save; and a key never written reads as `null` rather than throwing. **One-sided by construction, and that follows from the invariant rather than shortening it** — we may not write onto an annotation we did not author, so nothing can ever be marked *foreign*, and absence is what foreign means. **Provenance, not permission**: erasing or moving an annotation another application wrote is what the tools are for, and what L5 forbids is this build rewriting an object the person did not aim at. `ListedAnnotation` reports `authored`, which is what makes the set computable at the surface as well as in the kernel. Rejected: **`/NM`**, a per-page name **producers write**, so reading it as provenance misclassifies every foreign annotation whose producer set one — and it is one of the two entries MuPDF was measured re-encoding, so provenance would ride on a value known to change; **`/T`**, which means the author a person will eventually type and is the sidecar hack §3 bans; **a table in main**, which does not survive the save and reopen this invariant is about, and whose keys are handles meaningful against one version only; **inferring from `/AP`**, right about this project's fixtures and wrong about real documents, since most foreign annotations carry one; and **no mark at all**, which makes L5 vacuous rather than strict. **Stated limits**: a hostile document can write the key and claim to be ours, bounded by what the measurement found; annotations this build wrote before this commit read as foreign, and there is no repair that is not a rewrite on a guess. **The clause's own evidence is corrected here too** — *byte-identity is currently assumed, not measured* was executed on 2026-09-06 and is **false**: two entries of ten re-encode on a plain save, spelling rather than meaning, and text-identity is what holds. **Amendment only: nothing is built on it in this commit.** | §4's first save invariant, *"A save never rewrites annotations it did not author. `srcRef` marking; foreign subtypes and form Widgets pass through byte-identical. Byte-identity is currently assumed, not measured."* — of which the scheme was undefined and the byte-identity claim has since been measured false | [ADR-0043](DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md) |
| 2026-09-06 | **A gesture may span several presses, and the tool says when it is complete** (§6). The lifecycle modelled one press, some movement and a release — right for eight tools and unable to express three rows: polygon, polyline and cloud. All three failures are in the overlay rather than in any tool: `down` calls `begin` whenever a pointer goes down, so a second vertex discarded the first; `up` clears the gesture and commits, so a three-vertex shape committed after one; and nothing carried a finish signal, because for a drag the release is the finish. **The cheap widening was checked for first and found unnecessary one commit earlier** — the click gesture cost the platform nothing, since a click tool reads `startOf` and discards the rest — which is why this is an amendment rather than a fourth reflex to widen the seam. **`Gesture` records `presses` beside `points`**, its second widening and the same move as the first: the platform records what happened and each tool reads what it needs, where the alternatives were a parameter, a union or a second registry. Rejected: a `press` controller member, taking the lifecycle to five and making eight tools declare that a subsequent press means nothing to them; and deriving vertices from `points`, which decimates by distance and so cannot tell a click from a slow drag through the same pixel — the information is gone before a tool could read it. **`ToolController` gains `complete(gesture)`**, asked at pointer-up, and **no existing tool implements it**: `pointerPath`, which all eight already spread, answers `true`. That is what separates it from the `cancel` member the registry rejected — `cancel` would have been an empty body in twenty tools, this is one default a tool overrides when it means something else. Rejected: an optional member, where the overlay branches on presence and a misspelling silently gets the default; and a third `commit` return, which would put the lifecycle decision inside the function that builds payloads and widen seven signatures for a state they cannot produce. **The finish signal is a double press**, recorded by the platform and interpreted by the tool; Enter and a toolbar button are both real and neither is first, since one needs the overlay's focus behaviour settled and the other is a second control for a gesture already in flight. **Measured before designing**, because a gesture model is worth nothing if the writer cannot store the result: `Polygon.setVertices` stores `/Vertices` and computes `/Rect` with `/RD [2 2 2 2]`; `Polygon.setRect` is **refused**; `Polygon.setBorderEffect('Cloudy')` stores `/BE << /S /C /I 2 >>`, grows `/RD` to `[11 11 11 11]` and pushes `/Rect` past the page edge; and `PolyLine.setBorderEffect` is **refused** — *"PolyLine annotations have no BE property"*. So a cloud is a polygon with a border effect, not a third geometry, and the format refuses the polyline reading outright: three rows, two subtypes, one gesture. It also dissolves the **callout** question — one drag can define a box or a pointer and not both, and multi-press removes the premise. **Cancelling is still the absence of a member**: a half-drawn polygon makes abandoning matter more, and it would have been easy to read that as the trigger the original argument named — it is not, since the trigger was a tool holding a resource and a polygon holds only points. **The honest limit: `complete` is asked only at pointer-up.** A tool finishing on a move, a timer or a keystroke needs the overlay to ask there too, and that is the trigger rather than a call site added ahead of need. **Amendment only: nothing is built on it in this commit.** | §6's tool-lifecycle clause, which names `begin`, `update`, `commit → Command` and `cancel` and models a gesture as one press-to-release. It does not forbid a longer gesture; it cannot express one | [ADR-0042](DECISIONS/0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md) |
| 2026-09-06 | **An existing annotation is named by its place in the engine's walk, plus the version of that walk** (§6). `document.annotations` answers with page, kind and contents and **no identity**, so the eraser, select, `addAnnotation`'s inverse and a jump to the annotation cannot say *that one* — four D3 rows behind one missing concept. That is a B4 and `addAnnotation` was not: every command in the table is self-contained, carrying the whole of its intent, and applying one twice gives the same result or a second annotation but never the *wrong* one. Naming existing state is only meaningful against a particular version, and `grep -n docVersionSchema packages/contract/src/commands.ts` returned **nothing** — no command payload has ever carried one, so the concept does not exist to be configured. **The index is a position in MuPDF's `getAnnotations()`, not in `/Annots`**, and the difference is not theoretical: measured 2026-09-06 on one page carrying a text field and three squares, the walk answers **3** and `/Annots` holds **4**, because widgets are filtered out — so the two indices differ by the field count above them on exactly the documents Stage 4 exists for. One function mints and resolves (§3a: *which objects here are annotations* is the engine's rule). **The version travels in the payload and the kernel refuses a stale one**, which is `:305`'s rule on a different noun; the renderer already refuses to render a stale list, and a guard in the caller is a convention rather than a mechanism. **Rejected:** `/NM`, the format's own per-page annotation name — unwritable on a foreign annotation under `srcRef`, and *`/NM` where it exists, position where it does not* is two identity schemes for one question; **content addressing** by rect and kind, which is closer than it looks since staleness yields *no match* rather than a wrong one, rejected because two stacked identical marks become **unerasable** and refusing is not a state a person can act on, and because it makes the rect the identity that select exists to move; **a handle table in main**, which is this decision plus bookkeeping that can leak; **sending the index unchecked**, whose failure is a well-formed document with the wrong mark gone. **BUILT.** The mint landed in `5a5c87b`; `removeAnnotation`, the `targets` axis and the bus refusal followed, with the annotations panel's per-row control as the first caller. **The axis binds nothing at the type level and the ADR predicted it would**: `sources` binds one-way because it changes what an apply is handed, and this one changes what the bus decides *before* any apply runs, so a spec that names existing state is the same object as one that does not. An axis that changes a signature can be satisfied by ignoring it; an axis that changes a decision cannot be held by a type at all. What holds it is three bus cases plus a cast-only registration-defect case, and a mutual-assignability tie to the contract's list written in the same commit rather than a range later. | Nothing. §6 declared the geometry adapters and the tool controllers and never said how an existing annotation is named, because until `document.annotations` shipped nothing could read one | [ADR-0041](DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md) |
| 2026-09-05 | **An apply may also need a value READ through another engine, and the bus resolves that too** (§8) — an extension of the row below rather than a new decision, because it names a second instance of a shape that row already established. *Generate TOC from bookmarks* asked for it: §3's matrix at `:381` puts *"new document generation (markdown/CSV/**TOC**/image-to-PDF)"* on `@cantoo/pdf-lib` and the row above puts *"outline/bookmarks"* on MuPDF, while a byte-image `Apply` is `(image, command)` and holds **no session** — so a pdf-lib TOC would walk `/Outlines` itself, a second opinion about a question `destinations.ts`' `readDestinations` owns (B3a) that agrees for every ordinary outline and differs on a cycle, a name-tree destination, or an entry with no reachable page. **A `reads: 'none' \| 'outline'` axis sits BESIDE `sources`**, not folded into it: they answer *which documents* and *what pre-read data*, combine independently (a merge that regenerates a TOC is both), and one axis would make `sources: 'outline'` read as a document called outline. **`readDestinations` stays the one reader** — `documentCommands.ts` resolves the entries as it resolves sessions and the bus stays a router. **Resolved at APPLY time, inside the lane entry that writes**, because a TOC is almost entirely page numbers and an outline read when the dialog opened predates whatever the user did next. **Rejected:** the entries in the command payload — ADR-0038's established shape, and the renderer already holds them from `document.destinations`, so not even a second opinion; rejected on **staleness**, since a snapshot taken at an earlier `DocVersion` states page numbers for a document that may have lost pages, silently and looking correct, and refusing on a stale version makes *open the panel, delete a page, generate* a refusal the user must understand. **Rejected:** routing the TOC to MuPDF so read and write share a session — classifying by convenience, which is how a matrix stops being evidence; `setPageTransition` stayed on MuPDF because `/Trans` is a page attribute, not because it was easier. **Checked rather than assumed** when this was written: `grep -rn "sources:" --include=*.ts packages/` returned nothing. **The `sources` axis has since been built, the same day** — `CommandSources`, `Apply<W, K, S>`, `SourceRouting` on all fourteen declarations, and a cross-product `WriterBinding`; no command declares `'one'` yet, and Decision 3's bus parameter and this row's `reads` axis remain unbuilt. Building it corrected the row below twice: `Apply` needed a **third type parameter** rather than a lookup, because `commandDeclarations.ts` imports the seam and the seam cannot import it back; and the axis **binds in one direction only** — a `'none'` spec cannot supply a three-parameter apply, while a `'one'` spec can supply a two-parameter one, since a function that ignores arguments is assignable to a signature that passes them. That limit is carried as an `allow` case rather than worked around. | Nothing — it widens the row below before that row is built, rather than superseding a founding clause | [ADR-0040](DECISIONS/0040-a-command-names-a-second-document-by-docid.md) |
| 2026-09-04 | **A command may name a SECOND document, by `DocId`, and that document is open** (§2, §8). §3's matrix at `:372` assigns *"Page tree ops: delete/insert/extract/**merge**/split/crop/resize"* to MuPDF, so merge, insert-from-PDF and replace-page are specified work — and `Apply<W, K>` takes exactly one session, so a second document could not be expressed by any choice of arguments. That is what makes this a B4 where the two amendments before it were not: they registered into seams that already described them, and this one has no seam to register into. **Named by id**, because `WriterSession` is already a per-document map, `EngineSessionSource.sessions` already resolves one, and a `DocId` is the vocabulary the renderer already holds. **The source must be OPEN**, with a visible cost taken deliberately: *Insert from PDF* becomes pick, open, insert, where other applications hide the intermediate document. It buys one document-opening path — `DocumentService.open` is where identity is read, the merge-only dedup rule runs, the `FileHandle` is minted, the canonical image meets its ceiling and the engine session is granted its contained directory, and a second opener re-answers all five. **The sessions reach the bus as a resolved map**, not a lookup: the bus has never been able to find a document, and a lookup callback would be that index arriving by another name. **A `sources: 'none' \| 'one'` axis** sits beside the writer and §3a's two, so `Apply` is conditional on it as it already is on the writer's shape and every one-document command's signature is unmoved; declared rather than inferred from a payload that happens to carry a `DocId`, because the payload is the contract's and the session requirement is the seam's. **Rejected:** the source's bytes in the command (L11 by inspection, and a 200 MB IPC message); a path (L2, and a second opener); a transient `SourceHandle` (the tempting one — it removes the extra tab and re-answers identity, dedup, the ceiling and the directory, and leaks a lock on a user's file with nothing on screen to explain it); a pair session (bending the seam in place, changing every command's signature for what three need); assembling it in the renderer (every byte crosses twice, and PDF.js becomes a source of truth against §3.2). **Amendment only: nothing is built on it**, and ADR-0026's lesson is that a declaration shipped ahead of its implementation says so. | §8's `Apply<W, K>`, whose session parameter is singular, and §2's per-document framing — neither of which forbids a second document, and neither of which could express one | [ADR-0040](DECISIONS/0040-a-command-names-a-second-document-by-docid.md) |
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
| 2026-09-08 | **§3's claim that MuPDF is reached natively is corrected to an open decision, and invariant 24's mechanism was scanning the wrong artefact.** The paragraph read *"MuPDF is reached natively, as a shared library built from source and bound with koffi behind a thin flat-C shim … never as WASM"*. Measured: every MuPDF consumer in `packages/kernel` imports the bare specifier `mupdf`, which resolves to the npm package's `dist/mupdf-wasm.wasm` — **nineteen non-test modules**, against **zero** references to `monstera_mupdf` anywhere under `packages/` or `apps/`. The shim is built, is 39.4 MB, is scanned by four security proofs, and is loaded by nothing the product runs. **A compound claim whose live clauses vouched for its dead one:** the held handle and *never by spawning `mutool`* stayed true throughout, which is why the sentence survived review. `docs/JOURNAL.md`'s finding AAAAAA-1 had already recorded that structured text reaches the npm package — as a fact about one shim **export** being uncalled — and nobody asked what it implied about §3's own sentence, which is NNN-4's hole exactly: no range ever touched both the claim and the code that refutes it. **ADR-0010's decision is NOT withdrawn**; what is recorded is that it is unbuilt for the document pipeline, and which side moves is an owner-level decision owed an ADR. **One consequence is closed in the same commit:** `proof:activecontent` now also scans the engine the application's own import **resolves to**, with the target derived from that resolution rather than written down, and with both controls; the answer is the same on both binaries, which is why this is recorded rather than quietly extended. | §3's *"**MuPDF is reached natively** … never as WASM"*, and invariant 24's mechanism, which named "the shipped binary" and read only the shim | — (a correction of fact; the reach decision itself is owed an ADR) |
| 2026-09-01 | **A ratio budget governs a process that HOLDS bytes, and `mupdf-host`'s multiple is withdrawn** (§9.17). Its `6x` was exceeded by the real host on both content shapes where the model `perf:gate` asserts against cleared them, and the two breaches disagreed about which document was expensive — 6.26x cost 1.34 GB where 7.83x cost 284 MB, ranking the documents in the opposite order from their cost. A ratio against file size states something about a process that holds a copy, which is why `main`'s stands; the host parses, where cost tracks content shape. The absolute is enforced by the job object and read back off it (invariant 25(b)); the multiple had no mechanism and could not have one. `memoryBudgets.mjs` gains a parsed two-term state and **refuses** a `mupdf-host` line that restores the multiple, so the withdrawal is a decision with a mechanism rather than a fact about today's text. Gives up amplification detection — a 1 MB file parsing to 2.9 GB now clears every term — which is stated in the ADR beside the open question of a term keyed on object count. Rejected: raising the number (§9.17 forbids it in terms, and 7.83x is the larger of two documents rather than a ceiling). | §9.17's `mupdf-host = 6x, 3 GB, base 128 MB`, whose multiple this document already recorded as "not yet derived" | [ADR-0033](DECISIONS/0033-a-ratio-budget-governs-a-process-that-holds-bytes.md) |
| 2026-09-08 | **WHERE the engine is instantiated is separated from WHICH engine is reached, and answered: the contained host, never `main`** (§3). Measured by an observed run rather than read off the module graph — `packages/kernel/dist/index.js`, the specifier `apps/desktop` imports, loads 318 modules, none of them MuPDF's, and instantiates no WebAssembly; `hostEntry.js` loads `mupdf.js` and `mupdf-wasm.js` and instantiates 10,408,550 bytes; both controls separated on the same run. So **invariant 25's containment covers the process the document is parsed in**, and the reach decision recorded above is **not** a containment decision — it holds under either answer and must be taken on which engine this project wants to own. Two things are stated rather than left to be inferred. **Invariant 20's letter does not reach this**: it keeps *native code* out of `main`, and a WASM engine is not refused by that wording — what holds the line is ADR-0026's barrel discipline plus placement, guarded statically by `proof:kernelload` and now confirmed from a run. That is a gap in the invariant's **wording** rather than a live breach, and it is the shape that let content generation through in Stage 2: *native* is a proxy for *where a document is parsed*, and the product has already stepped outside it. And the run is the positive half nothing had — every existing check asserts main does **not** reach the adapter, none asserted the host **does**, which is 4b's *found nothing* sitting in a containment claim. | Nothing. It separates a question §3's 2026-09-08 correction left compound, and answers the half that was answerable | — (a measurement; the reach decision itself is still owed an ADR) |
| 2026-09-08 | **A ribbon placement's `group` is a `MessageKey`, not a `string`** (§7). The group's *caption* is what §10.3 puts on screen — *"captioned groups, hairline separators"* — so a plain string in that field is a visible user-facing literal that B9 puts in a catalogue, arriving through the one door the JSX lint rule cannot see: a variable. Nothing about the ribbon's own code looks wrong, and the string reaches the screen untranslated in every locale. **The alternative was worse in a way this seam exists to prevent:** a `Record<string, MessageKey>` inside the ribbon, mapping group names to captions, is a hand-maintained layout table owned by the surface — §7's own second wiring place, one field narrower. `MessageKey` keeps the declaration where it already is, on the command, and makes the untranslated spelling a compile error rather than something a reviewer has to notice (B5). **`SectionId` is untouched and stays a closed union**: a section is anatomy and its name is a display concern the ribbon resolves from a total record, where a ninth section fails to compile. The group stays free-form for the reason §7 gives — two features that never see each other's code must be able to interleave — and a `MessageKey` is free-form; it is a branded string, so `localeCompare` ordering and `Map` keying are unchanged. **Rejected:** leaving it a string and translating in the ribbon (the layout table above); a `groupTitle` field beside `group` (two fields that must agree, with nothing comparing them); and rendering the group id as its own caption (which is what the code did, and is how this was found). | §7's `Placement` snippet, which spelt `group: string` | — (a type refinement inside an existing seam; no ADR) |
| 2026-09-08 | **One host body, parameterised by engine — a second contained host is a generalisation of the first, never a copy of it** (§3). Written **ahead of `pdfiumHost`**, which is B4's whole point: `hostEntry.ts` imports `mupdfWriter` and `hostBody.ts` is typed `CommandExecution<'mupdf'>`, so a second host cannot be a registration into the seam as it stands, and bending it in place is what B4 forbids. **The pathology is the one that arrives by itself**: a second host is *the first host with a different import*, so copying is the cheapest edit at the moment somebody needs one — and what it duplicates is not plumbing but the pipe framing, the startup containment check, the session table, the failure classification and the shutdown ordering, five mechanisms whose copies would agree until one of them was fixed (B3). Three consequences, each a property the types already carry for one engine: the accepted **command schema is derived per engine** from the routing table (`CommandExecution<W>` binds the kinds to `KindsRoutedTo<W>`, so a command routed elsewhere is a compile error rather than a native library handed a pointer where bytes were expected); **each host owns its channel set**, in `packages/kernel` for ADR-0023 Decision 11's reason, because the payload schemas differ by construction; and **the containment is one problem**, since both hosts contain a native parser reached through koffi. **This amendment was not writable before 2026-09-08's reach decision** — a process containing a WASM sandbox and one containing a native parser are not the same containment problem, and the generalisation would have been over two different kinds of thing. **Rejected:** a second host body copied and edited (the five duplicated mechanisms above); one host serving both engines over one pipe (invariant 25 contains a compromise, and a breach of one engine would then hold the other's documents); and deferring the amendment until the feature needs it, which is the retrofit B4 exists to prevent. | Nothing. §3 has drawn two contained hosts since Stage 0; what it did not say is that the body serving them is one implementation | [ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md), corrected 2026-09-08 · [ADR-0023](DECISIONS/0023-how-the-contained-engine-host-is-built.md) |
| 2026-09-09 | **The MuPDF migration's size is 117 members, not 19 imports, and it does not gate Stage 5's editing rows** (§3). *"Nineteen non-test kernel modules import the bare specifier"* was written as what is not yet settled and was then read as the size of the work. Measured through `npm run proof:enginesurface`: the nineteen call **117 distinct MuPDF members** — `PDFAnnotation` 41, `PDFDocument` 20, `PDFObject` 20, `PDFWidget` 15 — against **24** C functions the shim exports, and the shim hands back an opaque handle representing no object model, by design. **Only four of the nineteen load an engine**; fifteen spell `import type` and are erased, so the count that reads like the work is a count of the lines that do not have to change, and what moves is nineteen module bodies against an ABI nobody has designed. The second half is the ordering: the editing rows are PDFium's by `BUILD-PROMPT.md`:257, PDFium's API is flat C needing no shim, and koffi drives it in research today — so they sit behind `pdfiumFfi.ts` and the second host, not behind this. Sequencing them after it would have parked five rows behind unrelated work. | Nothing decided. The reach ruling of 2026-09-08 stands unaltered; what is corrected is a size inferred from a sentence that was explicitly not settling it, and a dependency nothing had checked | [ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md), corrected 2026-09-09 |
