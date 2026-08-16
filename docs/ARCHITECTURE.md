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
│   └── testing/     fixture corpus, proof harness, esbuild bundling helpers,
│                    browser shim.
├── apps/
│   └── desktop/     Electron shell: main entry, preload, window/menu, utility
│                    process hosts, generated IPC registration, packaging.
│                    The ONLY package that imports Electron.
├── scripts/         provisioning (binary downloads, fixtures), git hooks,
│                    release tooling. Plain .mjs — see §1.1.
└── docs/            ARCHITECTURE.md (this file), FEATURES.md, UI-GUIDE.md,
                     JOURNAL.md, DECISIONS/
```

**Why the kernel may not import Electron.** It is not aesthetic. It means the
entire document pipeline is unit-testable in milliseconds in CI, reusable for a
future CLI, and legible to reviewers as a library. A test that must fake
`DOMMatrix` or a window bridge just to exercise a save is evidence the boundary
is wrong — fix the boundary, not the test.

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
     │ generated typed IPC            │ typed worker contract
     ▼                                ▼
┌─ renderer (sandboxed) ──────┐  ┌─ utility: mupdfHost ─────┐
│  React, per-doc view state  │  │  MuPDF native, via koffi │
│  PDF.js — presentation ONLY │  │  behind a flat-C shim.   │
│  No Node, no fs, no paths   │  │  NO in-main fallback —   │
└─────────────────────────────┘  │  native faults are       │
                                 │  uncatchable (L20)       │
                                 └──────────────────────────┘
                                 ┌─ utility: pdfiumHost ────┐
                                 │  PDFium via koffi FFI    │
                                 │  NO in-main fallback —   │
                                 │  native faults are       │
                                 │  uncatchable             │
                                 └──────────────────────────┘
```

**Renderer hardening (non-negotiable).** `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, CSP set, deny-all
permissions except media, navigation locked, popups denied.

**Main owns the document.** The renderer holds an opaque branded `DocId` and a
monotonic `DocVersion`. Per document, `DocumentService` owns: canonical bytes,
lazily-created engine handles (invalidated together on any mutation), the
command log and checkpoints, and the originating `FileHandle`.

**Engine handles are disposable, and their lifetime is not the document's.**
MuPDF reclaims a page's object graph only when the document is closed, and
releasing pages as they scroll out of view does not help — measured, a session
that visits pages grows **linearly** and never falls. So the handle is treated as
a **cache that can be thrown away and rebuilt**, not as the document.

Rebuilding costs a close plus an open plus re-reading whatever the user is
looking at, and it returns memory to the open-cost floor. It is safe because the
truth lives in main: canonical bytes plus the command log. Reopening replays the
log.

That safety is conditional, and the condition is a requirement on every command
(invariant 22): **no mutation may exist only on the handle.** Measured directly —
an unsaved rotation is gone after close and reopen, and comes back only by
replaying the command. A command that cannot be replayed cannot be issued.

This is the same mechanism as the kill-and-restart response to a host memory
breach (§9.17) and as the failed-save recovery path (§9.18); one recovery route,
reached three ways. **No memory limit or recycling schedule is stated here** —
the containment budget already decides when, and a second number would be a
second policy for one concern.

**What crosses, and how often.** The renderer receives a **view model** (page
count, page sizes and transforms, annotations, form fields, outline — structured
data, bounded size) and **one byte snapshot per `DocVersion`**, transferred as a
detached `ArrayBuffer` for PDF.js to render from. Bytes cross once per
*version*, never once per *operation*. **Any design where payload size scales
with document size per operation is wrong** (invariant L11).

**Mutations are commands.** `doc.command` with `{docId, command}`, handled in
main, validated at the boundary, routed to the writer of record, bumping
`DocVersion` and returning a view-model delta. `deletePages([3,5])` is bytes of
intent regardless of file size.

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
with koffi behind a thin flat-C shim, running in the `mupdfHost` utility
process — never as WASM, and never by spawning `mutool`. That is what gives
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
- **Text inside Form XObjects** (how Office and InDesign emit text): implement
  **normalize-then-edit** — on first edit of such a page, promote the XObject
  content into the page content stream with its matrix composed in, then edit in
  flat space. A hand-rolled content-stream parser is the **last** resort,
  permitted only after normalization provably fails a corpus case, and then
  quarantined behind one interface with an ADR.

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

`packages/contract` defines every channel exactly once, with a zod schema per
params and result. Generated or type-derived from it:

1. the `ipcMain` registration — **exhaustive; an unhandled contract entry is a
   compile error**,
2. the preload bridge,
3. renderer types,
4. the browser-shim stubs, which must implement the full contract or fail to
   compile.

**All validation happens once, in the generated boundary wrapper.**
Hand-writing the same channel in several places drifts silently and surfaces at
runtime.

The worker protocol has the same shape via one `defineWorkerContract` helper
shared by both hosts. Errors cross every boundary **structurally**
(`{name, message, stack, cause}`), never as a bare string. Silent `catch {}` is
banned except with a comment stating what is swallowed and why that is safe.

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
| **Dialogs** | id, lazy component, props schema | one mount point, one focus trap, one Escape/backdrop handler |
| **Settings** | id, type, default, category, i18n key, `secret?`, migration | the entire Settings dialog, persistence, export (secrets excluded) |
| **Annotation types** | geometry adapter, renderer, kernel writer mapping | overlay, panel, persistence |
| **Tools** | controller (begin/update/commit/cancel) | toolbar, overlay dispatch |
| **AI providers** | id, models, validateKey, chat, vision? | onboarding, settings, assistant |
| **Update providers** | detect, check, apply/redirect | About panel, update flow |
| **Import/Export formats** | id, extensions, direction, handler command | dialogs, file associations |
| **Cloud providers** | id, auth, list, fetch | cloud storage panel |

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

Chrome visibility is itself commanded: `view.toggleQuickToolbar`,
`view.togglePanel` and the layout-mode switch are registry commands, which is
what guarantees a hidden surface can always be restored from the palette or a
shortcut.

---

## 8. Cross-cutting services

- **Observability.** A rotating local log (`userData/logs`, capped, with a
  "Reveal log" menu item) is always on. Electron `crashReporter` is **opt-in,
  off by default**, with a consent prompt on first run. **No telemetry.** This
  is a privacy-respecting open-source app and its audience will read the network
  tab.
- **Recovery.** Crash-recovery sidecars for dirty documents, change-detected
  rather than timer-spammed, offered on next launch.
- **Native binaries** (mutool, Ghostscript, LibreOffice, `pdfium.dll`) are
  provisioned by a pinned, SHA-256-verified script: pinned version, host-locked
  download, size bounded independently of `Content-Length`, hash verified
  **before** any parser or unzipper touches the bytes. Spawned without a shell;
  `-dSAFER` for Ghostscript; isolated LibreOffice profile; kill-all-children on
  quit; resolved from `app.asar.unpacked` when packaged.
  The single implementation is `scripts/lib/fetchVerified.mjs`.
- **Network.** HTTPS only, host-locked per purpose, with an SSRF guard carrying
  a private-range blocklist and a DNS-rebinding pin — re-validated on **every**
  resolution, not just the first — for user-supplied URLs.

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
    process is for — never from the measurement it is meant to constrain. The
    two-term cost model and the admission gate an earlier revision of this
    invariant carried are **withdrawn**: they were fitted to WASM, which
    materialises objects eagerly because it cannot page from disk, and MuPDF is
    no longer reached that way
    ([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md)). Budgets:
    main ≤ 1.5× and ≤ 1.5 GB (it
    holds canonical bytes and never parses, so more means parsing crept back
    in); the MuPDF host ≤ 6× and ≤ 3 GB as a containment limit whose breach
    means kill-and-restart, not a raised number; the renderer **provisional,
    two-term** — a file-size-proportional term plus an absolute bitmap-cache cap,
    both unmeasured until the renderer exists. A budget set only from the
    measurement it constrains can never fail.
    ([ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md))
18. **A failed save never loses work.** The command log lives in main and
    survives a host crash, so a save failure is answered by killing the host,
    restarting, reopening from the last-saved bytes, replaying the log, and
    telling the user what failed — never by a dialog whose only option discards
    their edits. The original file is intact until the atomic rename. Proven
    with a control case that shows the same scenario losing work without the
    guard. ([ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md))
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
    engines live in utility processes. Every `fz_try`/`fz_catch` pair stays
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
    may exist only on the handle** — a command that cannot be replayed cannot be
    issued. Handle lifetime is therefore not document lifetime, and §2 states no
    recycling schedule because the host containment budget already decides when.

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
  restoring it is the registry command `view.toggleQuickToolbar` — in the
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
| 2026-08-16 | Start screen and title bar use the supplied composite logo as-is; the separate circular-mark-plus-wordmark treatment is withdrawn (§10.3). | `BUILD-PROMPT.md` Part M3 "circular leaf logo, the Monstera wordmark" and Part M8's interim-placeholder step | [ADR-0002](DECISIONS/0002-brand-mark-treatment.md) |
| 2026-08-16 | Page reorder and form flattening move to MuPDF; field creation and content composition move to @cantoo/pdf-lib; pdf-lib removed; `rearrangePages` banned; §3.1 lifted. | `BUILD-PROMPT.md` Part C3's page-reorder and form-flatten rows and their stated justifications | [ADR-0006](DECISIONS/0006-engine-capability-spike-results.md) |
| 2026-08-16 | Token roles carry five categories and declare their permitted surfaces; `--border` splits into `--border-control` (3:1) and decorative `--border`/`--border-soft` (exempt) (§10.2). | `BUILD-PROMPT.md` Part M2's two-way "text-bearing or fill-only" role typing | [ADR-0003](DECISIONS/0003-token-role-typing-and-declared-pairings.md) |
| 2026-08-16 | The memory budget is stated **per process** with an absolute ceiling on each — main ≤ 1.5× and ≤ 1.5 GB, MuPDF host ≤ 6× and ≤ 3 GB as a containment limit, renderer provisional and two-term. File size is not the driver: heap use is `(stream bytes × ~3.7) + (object count × ~4 KB)`, so admission reads both (§9.17). Stage 0 exit is gated on the three budgets. | `BUILD-PROMPT.md` Part G's "assert peak RSS < 1.5× file size" as a single whole-application number | [ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md) |
| 2026-08-16 | Save mode is chosen by the **purpose** of the save: never incremental for removal, always incremental to preserve a signature, full rewrite otherwise (§4, §9.19). | Nothing in the founding record — Part C4 states one pipeline and is silent on mode | [ADR-0008](DECISIONS/0008-save-mode-is-determined-by-purpose.md) |
| 2026-08-17 | MuPDF is reached through a **native shared library bound with koffi** behind a thin C shim, not through WASM; `mutool.exe` is not shipped; one held document handle per `DocId` in a utility process; the two-term memory model and admission gate are withdrawn (§2, §3, §9.17, §9.20, §9.21). | `BUILD-PROMPT.md` Part C3's WASM assumption and Part J's bundled `mutool.exe` | [ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md) |
