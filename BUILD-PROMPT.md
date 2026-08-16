# Monstera PDF Editor — Founding Build Prompt

**To the building agent:** this document is your permanent instruction set for building
Monstera PDF Editor from an empty folder. It is the project's constitution. Read all
of it before writing any code. Where this document and your instincts disagree, follow
this document, or amend the living law via B4 — never silently deviate. Copy this file into the
repository root as `BUILD-PROMPT.md` in your first commit, and derive the project's
`CLAUDE.md` and `ARCHITECTURE.md` from it. **Precedence from that moment:**
`ARCHITECTURE.md` is the **living law**, amended only via B4; `BUILD-PROMPT.md` is
the **immutable founding record**, never edited after its first commit; `CLAUDE.md`
is the derived operational digest, updated in the same commit as any amendment that
affects it. Where living law and founding record diverge, the living law wins, and
the amendment names the founding clause it supersedes — three documents with one
truth, not three truths.

---

# Rule 0 — The Guiding Principle

This rule governs every other rule in this document. Internalize it before writing
any code, and re-read it every time something breaks:

> **This app is going public for the whole world to see and read its code. When you
> hit a problem, a bug, or an issue, do not quickly find a workaround, investigate
> the root cause of the problem and fix it from the root. When you encounter an
> issue, your first intuition must not be a workaround; it must be investigation.**

Every workaround in a public codebase is a permanent, signed statement that nobody
understood the problem. Investigate until you can state the actual mechanism in one
sentence; then fix that. A workaround is acceptable only when the root cause is
proven to lie outside this repository, and the commit message names the cause and
why the workaround is the correct response. Rule B1 operationalizes this principle,
B2 makes every such fix provable, and Part K is this rule in practice: every
entry there records a mechanism someone found instead of patching around.

---

# Part A — Mission

Monstera is a **free, open-source, professional-grade PDF editor for Windows**,
published by Tenslor Inc., distributed through the **Microsoft Store** (primary) and
**monsterapdf.com**. Target quality: PDF-XChange Editor parity or
better.

The single most important fact about this project: **the codebase is the product as
much as the app is.** It will be read by thousands of developers, and their judgement
of the code determines whether the project grows or dies. Every architectural shortcut
is a permanent public statement. "Works" is the floor, not the bar.

The founding method, and the failure mode it exists to prevent: **the
architecture is built first, complete, with the full feature catalog known in
advance (Part D), and features are then registered into it.** The opposite —
retrofitting structure underneath features added faster than the structure can
carry — is how an application accumulates patched approaches, guard code, and
translation layers, and repeating it defeats the entire project. No feature may
be built by modifying the architecture ad hoc.

The user may supply **reference materials** during the build — test fixtures,
empirically tuned constants (for example, the text-line clustering tolerances of
Part K), proof scripts, and behavioral specifications. Treat them as
authoritative inputs and incorporate them as first-class assets. Never copy
implementation code from any external source: every line of *implementation* is
written deliberately for this architecture.

**Licence: AGPL-3.0-or-later**, forced by MuPDF (WASM linkage + bundled `mutool.exe`).
Every dependency is licence-checked against AGPL-3.0 before adoption. GPL-2.0-only is
incompatible. node-forge is taken under BSD-3-Clause. Use exceljs, never xlsx (audit
history). Third-party notices are generated from the lockfile, never hand-maintained.

---

# Part B — Process law (how you work)

These rules govern every session, from the first commit to the last.

**B1 — Root cause over symptom.** When anything misbehaves, find the mechanism and
state it in one sentence before fixing anything. No retries with different flags, no
swallowing catches, no special-casing the failing input. A workaround is legal only
when the root cause is proven to be outside the repository, and the commit message
says what it is. Corollary: be equally suspicious of things that work — a green check
that doesn't verify what it claims is worse than a red one.

**B2 — Every fix ships a proof with a control case.** The proof exercises real
project code and includes a control that reproduces the original bug without the fix
(i.e., the proof fails if the guard is removed). A bug fix without a control case is
not finished. Proofs run in CI from day one — a proof gated on developer discipline
proves nothing.

**B3 — One writer per concern.** Any property of a document has exactly one component
permitted to write it (Part C3). Multiple readers are fine. Two writers of the same
concern is how a codebase acquires translation layers, sidecar hacks, and
cross-parser identity joins.

**B4 — Architecture change control.** If a feature cannot be built by registering
into the existing seams (commands, tools, dialogs, settings, providers — Part C7),
STOP. Do not bend the seam in place. Amend `ARCHITECTURE.md` first, in its own
commit, with the rationale and the rejected alternatives, then build. The amendment
commit and the feature commit are separate. This is the rule that keeps the
architecture ahead of the features instead of underneath them.

**B5 — Make illegal states unrepresentable.** Prefer a type or a capability token
that cannot express the bug over a runtime check that catches it. A renderer that
cannot name a filesystem path needs no path allowlist. A branded coordinate type
needs no y-flip audit.

**B6 — Comment culture.** No comments except where the *why* is non-obvious — and
there, the comment states the mechanism ("chokidar holds a directory handle open for
ReadDirectoryChangesW, and an open handle blocks RENAME"), not the history of who
fixed what. In a public codebase this is what makes every non-obvious decision
auditable by strangers. It is a requirement, not a habit.

**B7 — TypeScript strict everywhere, `any` is an error** (not a warning —
warnings accumulate into hundreds of escapes and are then "tightened later,"
which is never). The sanctioned exception, stated now so the rule
survives contact with FFI reality: `any` is confined to **one typed adapter module
per native boundary** (`mupdfRaw.ts`, `pdfiumFfi.ts`); those files alone may carry
a file-level lint disable, and everything outside them is fully typed. The koffi
edge and the WASM heap are genuinely untypeable at the raw boundary; the adapter
is where that untypedness dies. A rule weakened by ad-hoc exceptions stops being
law, so this is the only one. React function components only. All four React Compiler
ESLint rules (`purity`, `refs`, `immutability`, `set-state-in-effect`) are errors
from the first commit. No premature abstractions inside modules — the architecture
provides the boundaries; interiors stay concrete and plain.

**B8 — Commit discipline.** Commit after each working, proven unit. Bump the version
on every packaged build; never reuse a number. Never build installers unless the user
asks. Never commit binaries (Part J).

**B9 — i18n and a11y are not features, they are the substrate.** A lint rule bans
literal user-facing strings in JSX from the first component. Every dialog uses the
one `<Dialog>` primitive. These are unskippable because they are the two things
that cannot be retrofitted across tens of thousands of lines of component code.

**B10 — Develop in public, from the first commit.** The repository is public from
day one (Part J, "Public repository from the first commit"). Every push is
permanent — GitHub retains commits by hash even after history rewrites, so there
is no later scrub. Consequences: never commit a secret, a binary, or an unvetted
fixture; never force-push or rewrite published history on main; write every commit
message as if a stranger will read it, because one will. Push protection is
enabled on the repository **before the first push** — retained-by-hash permanence
is exactly why it cannot help retroactively.

---

# Part C — Architecture

## C1. Repository topology — boundaries the module graph enforces

npm workspaces monorepo. The boundary rules are enforced by ESLint import
restrictions and per-package tsconfigs, so a violation is a red build, not a review
comment.

```
monstera/
├── packages/
│   ├── shared/      # branded types, geometry, Result type, pure utils.
│   │                # Imports: nothing internal. Runs anywhere.
│   ├── contract/    # THE IPC contract: every channel, command, query, event,
│   │                # defined once with zod schemas. Imports: shared only.
│   ├── kernel/      # the headless document engine: DocumentService, CommandBus,
│   │                # engine adapters (MuPDF, PDFium, pdf-lib), undo log, save
│   │                # pipeline, OCR, export, text-edit. Node-only.
│   │                # Imports: shared, contract. NEVER Electron, NEVER React.
│   │                # Fully testable in plain Node — this is the point.
│   ├── ui/          # the React app: components, per-document stores, registries,
│   │                # PDF.js presentation. Browser-only.
│   │                # Imports: shared, contract. NEVER kernel, NEVER Node.
│   └── testing/     # fixture corpus, proof harness, esbuild bundling helpers,
│                    # browser-shim (devBrowserApi successor).
├── apps/
│   └── desktop/     # Electron shell: main entry, preload, window/menu, utility
│                    # process hosts, generated IPC registration, packaging.
│                    # The ONLY package that imports Electron.
├── scripts/         # provisioning (bin downloads, fixtures), release tooling
└── docs/            # ARCHITECTURE.md (law), FEATURES.md (catalog + status),
                     # DECISIONS/ (dated ADRs for every B4 amendment)
```

The kernel having zero Electron imports is not aesthetic: it means the entire
document pipeline is unit-testable in milliseconds in CI, reusable for a future CLI,
and legible to reviewers as a library. A test that must fake `DOMMatrix` or a
window bridge just to exercise a save is evidence the boundary is wrong.

## C2. Process topology and document ownership

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
│  React, per-doc view state  │  │  MuPDF WASM              │
│  PDF.js — presentation ONLY │  │  in-main fallback via    │
│  No Node, no fs, no paths   │  │  ONE shared ops module   │
└─────────────────────────────┘  └──────────────────────────┘
                                 ┌─ utility: pdfiumHost ────┐
                                 │  PDFium via koffi FFI    │
                                 │  NO in-main fallback —   │
                                 │  native faults are       │
                                 │  uncatchable             │
                                 └──────────────────────────┘
```

- Renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  CSP set, deny-all permissions except media, navigation locked, popups denied.
  Non-negotiable.
- **Main owns the document.** The renderer holds an opaque branded `DocId` and a
  monotonic `DocVersion`. Per document, `DocumentService` owns: canonical bytes,
  lazily-created engine handles (invalidated together on any mutation), the command
  log and checkpoints, and the originating `FileHandle`.
- The renderer receives a **view model** (page count, page sizes + transforms,
  annotations, form fields, outline — structured data, bounded size) and **one byte
  snapshot per DocVersion**, transferred as a detached ArrayBuffer for PDF.js to
  render from. Bytes cross once per *version*, never once per *operation*. Any
  design where payload size scales with document size per operation is wrong.
- **Mutations are commands** (`doc.command` with `{docId, command}`), handled in
  main, validated at the boundary, routed to the writer of record, bumping
  DocVersion and returning a view-model delta. `deletePages([3,5])` is bytes of
  intent, regardless of file size.
- **Reads are queries** (`getPageText`, `findText`, `getStyledRuns`…), served from
  cached engine handles — the renderer never ships a whole document to ask a
  question about it.
- **FileHandles:** `CapabilityRegistry` mints an unguessable handle wherever the
  *user* or the *app* produces a path (dialogs, drag-drop, argv, file association,
  app-created temp files). Every path-consuming operation takes a handle; a string
  path in a renderer-facing type is a compile error. The rejected alternative is
  a runtime path-allowlist check, which fails open at every handler that forgets
  to call it — a handle design makes that omission unrepresentable. A
  persistence layer re-mints handles for Recent Files.

## C3. Engines and the writer-of-record matrix

Four engines, each covering a gap the others cannot; the law is who *writes*.
**MuPDF is the structural writer of record from day one**, and nothing is ever
written by one engine and re-read for truth by another. Violating that breeds
two specific pathologies: sidecar hacks (data smuggled through unrelated PDF
fields so the writer's model survives a round trip through a reader that cannot
express it) and fragile identity joins between two parsers' object numbering.
Both are banned at the root by this matrix.

| Concern | Writer of record | Reader for view model |
|---|---|---|
| Rendering, text layer, text selection, search display | — (presentation) | **PDF.js** |
| Page tree ops: delete/insert/extract/merge/split/crop/resize | **MuPDF** | MuPDF |
| Page reorder | **pdf-lib** — MuPDF WASM has no reorder primitive (only delete/insert/graft); implement as an in-place `/Kids` rewrite per invariant L6 | MuPDF |
| Annotations (all types), appearance streams | **MuPDF** — verified: `createAnnotation`, `setRect`, `setInkList`, `setQuadPoints`, `setAppearance`, `update()` all exist | MuPDF |
| Form fields: fill | **MuPDF** | MuPDF |
| Form fields: create, flatten | **pdf-lib** — verified: MuPDF WASM 1.28 exposes no `createWidget` and no flatten; `PDFWidget` is fill-only | MuPDF |
| Metadata, outline/bookmarks, encryption, permissions, redaction, optimize | **MuPDF** | MuPDF |
| Print & export rasterisation | **MuPDF** | — |
| In-place text editing (line/run rewriting), styled runs, HD render | **PDFium** | PDFium |
| Content composition: NEW document generation (markdown/CSV/TOC/image-to-PDF), drawing onto pages (watermark, headers/footers, Bates, OCR text layer embedding) | **pdf-lib** | — |
| Digital signatures (PKCS#7) | **@signpdf** | node-forge (verify) |

Rules:
- **The matrix is provisional until the Stage 0 engine-capability spike stamps
  every row with evidence** (Part G): one throwaway script per row exercising the
  claimed API against a real document, findings recorded as an ADR, the matrix
  amended to match what actually ran. A row nobody has executed is a guess, and
  guesses about engine capability otherwise surface four months late, with the
  architecture already shaped around them.
- **PDF.js is never a source of truth.** It renders. The renderer's annotation and
  form models come from the kernel via the view model.
- Engine handles are cached in `DocumentService`, created lazily, and all
  invalidated together on any mutation. One parse per engine per version, maximum.
- If MuPDF's JS API genuinely lacks a needed write (document the gap: which API was
  checked, what is missing), pdf-lib may take that concern — recorded as an ADR, so
  the matrix stays truthful. The matrix is law; silent second writers are defects.
- Adding an engine requires an ADR: the gap, the engines checked, the licence and
  its AGPL interaction, the process it runs in. A fifth engine is not forbidden; an
  undeclared one is.
- **Text inside Form XObjects** (how Office/InDesign emit text): implement
  **normalize-then-edit** — on first edit of such a page, promote the XObject
  content into the page content stream with its matrix composed in, then edit in
  flat space. A hand-rolled content-stream parser is the last resort, permitted
  only after normalization provably fails a corpus case, and then quarantined
  behind one interface with an ADR.

## C4. Undo, save, and versions

- **The command log is the undo stack.** Each command records its inverse or is
  marked non-invertible. Non-invertible commands (redaction, flatten, encryption,
  OCR embedding) force a **checkpoint** — a byte snapshot taken before execution.
  Checkpoints also occur every N commands to bound replay depth. Undo = restore
  nearest checkpoint, replay forward minus the undone command. Memory is "one
  document + a few checkpoints" — never full-byte snapshots rationed by a
  memory budget, whose worst case is several resident copies of a large file.
- **Save is one pipeline:** flush each writer of record once → atomic write (temp,
  fsync, rename, `.bak`, Windows EPERM/EBUSY retry ladder) → stamp saved version.
- Invariants (hard-won; see Part K):
  - A save never rewrites annotations it did not author (`srcRef` marking; foreign
    subtypes and form Widgets pass through byte-identical).
  - Page reordering rewrites the page tree **in place**; rebuilding into a new
    document drops `/AcroForm`, `/Outlines`, `/Names`, `/OCProperties`.
  - Text edits save **incrementally**; a full PDFium rewrite corrupts
    non-embedded font references.

## C5. The IPC contract — one definition, four generated surfaces

`packages/contract` defines every channel once (zod schema per params/result).
Generated or type-derived from it: the `ipcMain` registration (exhaustive — an
unhandled contract entry is a compile error), the preload bridge, renderer types,
and the browser-shim stubs (which must implement the full contract or fail to
compile). **All validation happens once, in the generated boundary wrapper.**
Hand-writing the same channel in several places drifts silently and surfaces at
runtime; here every channel is written exactly once.

The worker protocol is the same shape via one `defineWorkerContract` helper shared
by both hosts. Errors cross every boundary structurally
(`{name, message, stack, cause}`), never as a bare string. Silent `catch {}` is
banned except with a comment stating what is swallowed and why that is safe.

## C6. Renderer architecture

- **State is per document:** a store instance per `DocId`, created on open, dropped
  on close. Tab switching changes which store the UI reads — nothing is
  snapshotted, restored, or re-parsed. This makes the cross-tab race class —
  an async result landing in the wrong document's state and the next save
  writing one document's content into another's file — unrepresentable *by
  shape*, with no generation tokens to remember. Retain a document-still-open
  check only where an async result can outlive its document's close.
- App-shell state (theme, active tab, panels, settings cache) is a separate small
  store. Never let a singleton store accumulate document state.
- **Registries drive the UI** (Part C7). `App.tsx` composes surfaces; it holds no
  feature wiring, no dialog flags, no 90-case switches.
- **Annotations:** one geometry vocabulary. Every annotation type registers a
  geometry adapter (`bounds`, `transform`, `hitTest`) and a renderer; every tool
  registers a controller (`begin`, `update`, `commit → Command`, `cancel`). The
  overlay is a dispatcher (~200 lines), never a monolithic switch stack. Adding
  a type touches one adapter + one renderer, never a set of duplicated switches.
- **Coordinates:** five spaces exist — `PdfPoint` (y-up), `FitzPoint` (y-down),
  `ViewportPoint` (CSS px), `XObjectPoint`, `RasterPoint`. They are **branded
  types**; passing one where another is expected is a compile error. One
  `PageTransform` (derived from the viewport transform, correct under `/Rotate`
  and CropBox origin) is the only converter; one affine implementation total; a
  lint rule bans bare y-flips, because an inline flip silently assumes rotation
  0 and a zero CropBox origin — the most expensive recurring bug class in PDF
  UI code, and the branded types make it unrepresentable.
- **CSS:** design tokens in one global file — light/dark/high-contrast as token
  remaps under `data-*` attributes, contrast-bearing colors derived per M2's
  `onColor` rule, never stored; component styles in CSS modules; inline
  `style={{}}` only for genuinely dynamic values. The full visual design
  language lives in **Part M** and is as binding as this section.

## C7. The registries — how every feature lands

A feature is finished when it is *registered*, not when it is wired. The seams:

| Registry | Entry | Derives |
|---|---|---|
| **Commands** (`UiCommand`) | id, title(i18n key), icon, shortcut, `when(ctx)`, `run(ctx)`, **`placements[]`** | ribbon, floating toolbar, menus, command palette, shortcut map, context menus, start-screen shortcuts |
| **Dialogs** | id, lazy component, props schema | one mount point, one focus trap, one Escape/backdrop handler |
| **Settings** (Part F) | id, type, default, category, i18n key, `secret?`, migration | the entire Settings dialog, persistence, export (secrets excluded) |
| **Annotation types** | geometry adapter, renderer, kernel writer mapping | overlay, panel, persistence |
| **Tools** | controller (begin/update/commit/cancel) | toolbar, overlay dispatch |
| **AI providers** (Part E5) | id, models, validateKey, chat, vision? | onboarding, settings, assistant |
| **Update providers** (Part E4) | detect, check, apply/redirect | About panel, update flow |
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
// a command may carry several placements — Highlight legitimately lives in
// Home › Quick tools AND Comment › Markup AND the annotation context menu
```

The `SectionId` namespace is exactly the eight M3 sections. The ribbon, the
floating toolbar, context menus, and the start screen's six shortcuts are all
*derived* from placements — a hand-maintained layout file for any of them is the
second wiring place this registry exists to forbid. Chrome visibility is itself
commanded: `view.toggleQuickToolbar`, `view.togglePanel`, and the layout-mode
switch are registry commands, which is what guarantees a hidden surface can
always be restored from the palette or a shortcut.

Keyboard shortcuts, menus, the palette, and the ribbon are *projections* of the
command registry. There is no second place where a feature is wired.

## C8. Cross-cutting services

- **Observability:** rotating local log (`userData/logs`, capped, "Reveal log" menu
  item) always on; Electron `crashReporter` **opt-in, off by default**, consent
  prompt on first run; **no telemetry**. This is a privacy-respecting OSS app and
  its audience will read the network tab.
- **Recovery:** crash-recovery sidecars for dirty documents (change-detected, not
  timer-spammed), offered on next launch.
- **Native binaries** (mutool, Ghostscript, LibreOffice, pdfium.dll): provisioned
  by a pinned, SHA-256-verified script — pinned version, host-locked download,
  size-bounded independently of Content-Length, hash verified **before** any
  parser or unzipper touches the bytes.
  Spawned without a shell, `-dSAFER` for Ghostscript, isolated LibreOffice profile,
  kill-all-children on quit, resolved from `app.asar.unpacked` when packaged.
- **Network:** HTTPS only, host-locked per purpose, SSRF guard with private-range
  blocklist and a DNS-rebinding pin (re-validate every resolution, not just the
  first) for user-supplied URLs.

---

# Part D — The complete feature catalog

This is the full scope, known before the first line of architecture code. The
complete catalog is the **destination**, reached through the staged releases of
Part G beginning with a deliberately smaller 1.0; Part E details the signature
features.

**Ribbon placement uses exactly the eight M3 sections** — the D-groups below
are thematic, and each command's `placements` (C7) names its real section(s).
The canonical mapping: D1 → Home (view/display controls under Tools › Display)
· D2 → Organize · D3 → Comment · D4 → Edit · D5 → Forms · D6 → Tools
(OCR group) · D7 → Protect · D8 → Review · D9 → Tools (Import group) · D10 →
Home (Export group) + Tools (Convert group) · D11 → Review (AI group) · D12 →
shell chrome, no section. A feature whose header and placement disagree is a
defect in one of them. Track status in `docs/FEATURES.md`. Every entry lands through the
seams in C7; if one cannot, invoke B4.

## D1. Viewer & navigation (ribbon: Home; display controls in Tools › Display)
Continuous scroll with lazy per-page render (IntersectionObserver) · zoom
(fit-width/fit-page/presets/± /Ctrl+scroll, two-tier: instant CSS stretch + 150 ms
debounced re-render) · thumbnail sidebar (lazy, drag-reorder) · page navigation
(go-to, PageUp/Down, Home/End, Alt+arrow history, click-to-jump) · recent files ·
start screen (features grid, errors inline) · multi-document tabs · split view (two
pages) · side-by-side document compare · loupe · rulers & grid · dark page mode ·
named destinations panel · links panel · layers (OCG) panel with visibility toggle ·
search (case/whole-word/regex, Unicode-normalized, CSS Custom Highlight API,
cancellable background indexing) · status bar · command palette · themes
(light/dark/high-contrast, accent color) · HD render toggle (PDFium).

## D2. Page management (ribbon: Organize)
Delete · rotate 90/180/270 · drag-reorder · duplicate · insert blank ·
insert from PDF · insert from image · extract to new PDF · merge PDFs · split
(ranges / one-per-page) · crop · resize pages · replace page · swap pages · find
duplicate pages · deskew & enhance scans · page transitions (/Trans) · generate TOC
from bookmarks · Bates numbering · headers & footers · watermark · background.

## D3. Annotations & markup (ribbon: Comment)
Tools: highlight, underline, strikethrough (text-markup via selection) · ink ·
rectangle, ellipse, line, arrow · polygon, polyline, cloud · text box · sticky note
· callout · caret · typewriter · stamps (built-ins + custom image + multi-page
apply) · measure distance/area/perimeter with calibration · link (URL / page) ·
snapshot region to PNG · place image (move/resize/delete) · eraser · select
(multi, resize handles, arrow-nudge, clipboard copy/paste, Delete) · redact marks
(solid + blur preview). Style controls: color, opacity, line width, font, size.
Annotations panel (by page, click-to-jump) · comment styles panel · persistence as
real PDF annotation objects · **`srcRef` invariant: never rewrite annotations the
app did not author** · annotations survive page ops via command remapping.

## D4. Text (ribbon: Edit)
Select & copy (native text layer) · **in-place text editing**: line-level (visual
line clustering, run diffing — tuned constants and corpus may arrive as
user-supplied reference material, see Part A and Part K),
region replacement, object-level edit (move/scale/recolor/delete any page object),
document-wide replace-all · typewriter · find & replace · spell check (nspell +
dictionary management) · translate document text · word count.

## D5. Forms (ribbon: Forms)
Render & fill all AcroForm field types (text, checkbox, radio, dropdown, listbox,
signature) · create fields by drawing · delete fields · flatten · forms panel ·
export/import data (JSON, XFDF, FDF) · heuristic field detection on flat documents.

## D6. OCR (ribbon: Tools › OCR)
Scanned-page detection · tesseract.js OCR, 13+ languages, page scope choice ·
invisible selectable text layer · search integration · export searchable PDF ·
OCR region (drag a rectangle) · local handwriting OCR (TrOCR small/base, on-demand
download, cached, offline) · Azure Document Intelligence integration.

## D7. Security & signatures (ribbon: Protect)
Open encrypted PDFs (auto password prompt) · set user/owner password (AES-256) ·
permission flags · remove password · true redaction (MuPDF content removal; solid
and blurred; mixed in one pass; confirm dialog) · find-and-redact by search ·
sanitize/flatten document · digital signing (PFX/P12, PKCS#7 detached, TSA
timestamping **implemented correctly or not offered** — a signing flow that
requests a timestamp and discards the TSA response is decorative, and that
class of feature is banned by B1's corollary) · certify · signature verification (CN, org, validity, byte-range hash
check) · visible signatures (draw / type with font choice / upload) · DocuSign
integration.

## D8. Review (ribbon: Review)
Comment summarization (AI) · document compare · annotation import/export ·
spell check pass · reading-order / tagged-PDF inspection · accessibility check.

## D9. Import & create (ribbon: Tools)
Markdown → PDF (new or append) · CSV → PDF table · Office import (LibreOffice) ·
image(s) → PDF · open from URL (SSRF-guarded) · webcam capture · document scan
(edge detection) · edit page in external app & reimport · import page as OCG layer
· cloud storage: Google Drive, Dropbox, OneDrive, Box, SharePoint.

## D10. Export & convert (ribbon: Home › Export + Tools › Convert)
Pages → PNG/JPEG/WebP (range, DPI, quality) · text extraction (layout-preserving
when Poppler available) · Word (rich/layout/text modes) · PowerPoint · **Excel**
(table detection: automatic / force-OCR / local handwriting / Azure; editable
review grid; styled output with real fonts, fills, borders, merges, number formats;
combine-pages option) · email document · print (MuPDF raster at chosen DPI to
system dialog — never print the DOM) · PDF/A-2b export (honest blocker reporting) ·
optimize/compress · barcode generate & read.

## D11. AI (ribbon: Review › AI; provider-routed, Part E5)
Assistant dialog (chat about the open document) · comment summarization · vision
analysis (table reading assist) · all through the active provider; graceful,
honest empty-states when no key is configured.

## D12. Shell & UX
Settings (Part F) · keyboard shortcut reference (F1) + customizable bindings ·
autosave (interval setting; **off by default** — silent overwrites are opt-in,
never a surprise) · crash recovery offer · error
boundary with reload · toasts · window title sync (`file ● — Monstera`) ·
file associations & drag-drop open · About (version, licences, source offer) ·
native-binaries manager (status, verify, download) · updater (Part E4) · review
prompt (Part E3) · onboarding (Part E5).

---

# Part E — Signature features (architected in, not bolted on)

## E1. Document render quality
The bar: glyph edges are pixel-exact at every zoom on every display.
- Render at **exactly `devicePixelRatio × zoom`** — 1:1 device pixels. Never
  supersample-and-CSS-downscale as a default (it blurs text); the
  `renderQuality` multiplier remains an explicit user setting only.
- CSS-stretched stale bitmaps are permitted **only transiently** during a zoom
  gesture, always replaced by a true re-render (two-tier zoom).
- Above a zoom threshold, render **tiles**, not whole pages, to keep memory
  bounded at 400%+.
- Optional PDFium HD path for its rasterizer; print path renders at print DPI.
- Acceptance proof: **perceptual diff with a stated tolerance** at 100%/200% on
  1× and 2× DPR against reference renders (never exact hash — a Chromium, font,
  or driver update would go red, and a flaky gate gets ignored, which is worse
  than none). References are regenerated deliberately, in their own commit.

## E2. Text quality substrate
(supports E1 and D4) One shared text-structure module in the kernel — glyph runs →
lines → blocks — consumed by editing, Excel export, search, and extraction alike.
Line clustering is implemented exactly **once** — the classic failure is the
same clustering re-implemented per consumer with constants "required to mirror
exactly" across copies. It is tuned against the
fixture corpus with a measurable accuracy score (constants change only with
a corpus score in the commit message). **Built at the start of Stage 1, before
search — its first consumer.** The deep tuning lands with Stage 5, but from day
one there is exactly one implementation; a second extraction path anywhere is an
immediate K.0 regression.

## E3. Review prompt (Store rating)
`EngagementService` in main; persisted state in `userData`
(`installDate, lastPromptAt, promptCount, reviewedAt, optedOut`).
- First prompt no sooner than 3 days after install **and** after real use (≥2
  sessions); then every 3 days while unreviewed, max 5 prompts total.
- Non-modal banner/toast — never interrupts editing, never on a dirty close.
- Actions: **Rate now** (Store build: deep-link
  `ms-windows-store://review/?ProductId=<id>`; web build: Store web listing) →
  sets `reviewedAt` · **Already reviewed** → sets `reviewedAt` · **Later** →
  resets the 3-day clock · **Don't ask again** → sets `optedOut`.
- The Store cannot be queried for review status; `reviewedAt` is the honest local
  record and the code must not pretend otherwise.
- A Settings toggle surfaces `optedOut` so the choice is reversible and visible.

## E4. Updates
One `UpdateService`, two providers behind one interface; the **install channel is
baked at build time** (Store MSIX flavor vs website NSIS/portable flavor), and
exactly one provider is active.
- **Store channel:** the Store delivers updates. In-app: detect channel, show
  "Updates are managed by Microsoft Store" in About, optionally query
  `Windows.Services.Store` for an available-update hint. Never self-update.
- **Web channel:** electron-updater against GitHub Releases (feed also linked from
  monsterapdf.com). Check on launch + manual "Check for updates"; download in
  background; install on quit with consent. Portable builds: notify-only.
- Update checks are the only phone-home in the app, and the About panel says so.

## E5. Multi-LLM AI assistant
`AiProvider` registry in the kernel: `{id, displayName, models[], validateKey(),
chat(messages, opts), vision?(image, prompt)}`.
- Ship providers: **Anthropic** (default model `claude-fable-5`; also Opus/Sonnet
  tiers), **OpenAI**, **Google Gemini**. Adding a provider = one module + registry
  entry.
- **First-run onboarding step**: choose a provider → paste key → `validateKey()`
  round-trip before accepting → or **Skip** (prominent, no dark patterns). Keys
  can always be added/changed/removed later in Settings → AI.
- Keys stored via `safeStorage` (OS keychain). If `safeStorage` reports
  unavailable, **say so and refuse to store** — a silent plaintext fallback is
  banned. Keys never appear in settings export, logs, or renderer state
  (write-only field with `••••` placeholder; the UI can replace or remove a key
  but never read it back).
- Document content goes to a provider **only on explicit user action**, and the
  consent copy in the assistant panel says which provider receives it.
- Every AI feature has an honest, useful no-key state.

---

# Part F — Settings (registry-driven; the full inventory)

Every setting is declared once (id, type, default, category, i18n key, `secret?`,
migration) and the Settings dialog is *derived*. Versioned migrations read the raw
stored version (migration flags must come from the raw stored JSON, never the
defaults-merged object, or every migration runs as if already applied). Export excludes every `secret`. Categories and contents:

- **Appearance:** theme (light/dark/system) · high contrast · accent color
  (auto-adjusted or rejected if it cannot reach the M2 contrast floor) ·
  reduce motion · UI language (i18n locale) · ribbon collapsed · thumbnail size
- **Viewing:** default zoom mode & level · zoom step · page layout (continuous /
  single / facing) · smooth scroll · autoscroll speed · dark page mode · rulers ·
  grid · loupe · page number badges · restore last session · recent-files length
- **Rendering:** render engine (PDF.js / PDFium HD) · render quality multiplier ·
  tile threshold · print default DPI
- **Editing defaults:** annotation color · opacity · line width · font & size
  (textbox/typewriter) · measurement unit & scale · RTL text · stamp library ·
  signature library
- **Saving:** autosave interval (off/1/2/5/10/30 min) · backup copies to keep ·
  confirm redaction · warn before signature-breaking save
- **OCR:** default language(s) · TrOCR model size (small/base) · auto-OCR scanned
  pages on export
- **AI:** provider · model · per-provider API keys (secret) · Azure DI endpoint +
  key (secret)
- **Integrations (all secret):** Google Drive, Dropbox, OneDrive, Box, SharePoint
  tokens · DocuSign key/account/basePath
- **Keyboard:** shortcut editor (rebind any registry command; conflict detection)
- **Privacy:** crash reporting opt-in · review-prompt opt-out · clear recent files
  · clear caches (TrOCR models, thumbnails)
- **Updates (web channel only):** auto-check toggle · check now
- **Advanced:** reveal log · log verbosity · native binaries status/manage ·
  settings export/import (JSON, secrets excluded) · reset to defaults

---

# Part G — Build order (architecture first, features second)

Each stage exits only when its criteria are proven. Do not start a later stage to
escape a blocked earlier one — invoke B1/B4 instead.

**Your first actions, in order, before anything else — including before Stage 0:**
1. Commit this document to the repository root as `BUILD-PROMPT.md` — renaming
   it first if it arrived under any other name — and push. Commit the design
   draft beside it as `DESIGN-DRAFT.html` (M7 references it).
2. Commit the pre-commit hooks (gitleaks secret scan, file size/extension guard),
   the `core.hooksPath` bootstrap, and the hardened `.gitignore`; push.
3. Only then begin Stage 0. From here on, commit and push every working unit
   (B8) — never in stage-sized batches.

The order is the point: the guards must exist before there is anything they
could fail to catch.

**Baseline estimates, recorded now so the Stage 1 trajectory gate has a number
to measure against:** Stage 0 ≈ **15 working days**, Stage 1 ≈ **10 working
days**. Actuals are tracked in `docs/JOURNAL.md` as stages run. Exceeding an
estimate by 3× is what arms the gate's decision (continue / cut scope / halt
and reassess with the user); a gate with no recorded baseline is inert.

**Stage 0 — The walking skeleton (the architecture, whole).**
Monorepo + boundaries enforced · contract codegen pipeline · DocumentService +
CommandBus + FileHandles · both utility hosts on the shared worker contract ·
per-document stores · command/dialog/settings registries · the Part M design
**substrate** — tokens, lint rules, `docs/UI-GUIDE.md`, and only the primitives
Stage 0's own exit needs (`Dialog`, `Button`, `IconButton`, `Input`); the
remaining primitives land on first use, in the primitives package, never ad hoc
in a feature, so Stage 0 stays finite ·
i18n scaffold + lint rule · logging + crash reporter consent ·
CI (typecheck, lint, unit, proof harness, Playwright smoke on the browser shim) ·
packaging skeleton for both flavors.
*Exit:* open a PDF via FileHandle → render → one command (`rotatePages`) with undo
→ save → one registered dialog, setting, and shortcut — every seam exercised once,
all green in CI. Exit additionally requires:
- the **engine-capability spike** — throwaway scripts proving every C3 matrix row
  against real documents, findings recorded as an ADR, the matrix amended to
  match the evidence before it becomes load-bearing;
- the **performance budget assertion** — open the 200 MB fixture, run one
  command, save; assert peak RSS < 1.5× file size and total bytes crossing IPC
  bounded per L11. If the architecture's central claim fails in the walking
  skeleton it will not hold in Stage 8, and this is the only cheap moment to
  find out.

**A failed gate blocks Stage 1.** The response is an ADR that either amends the
architecture or restates the budget with reasons — never "note it and proceed."
A gate whose failure path is unstated degrades into exactly that.

**No feature work before this exits.**

**Stage 1 — Viewer core.** Begins with the E2 text substrate (search is its
first consumer). Then D1 complete (search, tabs, zoom quality E1 tier-1).
**Ends with the trajectory gate:** compare actual effort against the estimate,
in writing. The honest options are continue, cut scope, or halt and reassess
with the user. A project with no defined abort condition dies slowly.
**Stage 2 — Page management.** D2 as commands with inverses; remap invariants
proven (annotations/bookmarks follow pages).
**Stage 3 — Annotation platform, then tools.** Geometry adapters + tool
controllers; then all D3 tools land as registrations. Persistence + `srcRef`
proofs.
**Stage 4 — Forms.** D5.

**→ SHIP 1.0 — the Minimum Shippable release.** Stages 0–4 (viewer, page
management, annotations, forms, save) go to the Store as **1.0**, with the
remaining gaps stated honestly in the README and the listing. Everything after
ships as 1.1, 1.2, … A project that ships at month six and grows beats one that
ships "complete" at month eighteen — the trap is an unshippable everything-app,
and this gate is its guard. The full Part D catalog is the destination, not the
launch bar.
**Stage 5 — Text editing.** E2 substrate → D4 (user-supplied tuning constants
and corpus if provided, per Part A);
normalize-then-edit for XObjects; fidelity proofs (pixel-diff untouched runs).
**Stage 6 — OCR.** D6.
**Stage 7 — Security & signatures.** D7 (TSA done right or absent).
**Stage 8 — Import/export/convert & review tools.** D9, D10, and D8's
non-AI items (document compare, annotation import/export, spell-check pass,
tagged-PDF inspection, accessibility check). D8's AI-dependent items (comment
summarization) land with Stage 9.
**Stage 9 — AI & cloud.** E5, D11, D8's AI items, cloud providers.
**Stage 10 — Ship.** D12 completed in full (whatever earlier stages didn't
already deliver: file associations, binaries manager, About —
error boundary, crash recovery, and toasts are Stage 0/1 substrate, not
Stage 10 work) · E3 review prompt · E4 both channels · onboarding · a11y audit
to WCAG 2.1 AA · full visual QA pass against Part M (all three themes, all
baselines) ·
i18n extraction complete (en + one proof locale) · perf pass
(200 MB scan: open < 3 s, tab switch instant, memory < 1.5× file size steady) ·
Store submission assets · monsterapdf.com release feed.

---

# Part H — Definition of done (per feature, no exceptions)

A feature is done when: command(s)/tool(s)/dialog(s)/settings are **registered**
(no bespoke wiring) · contract entries exist and validate · kernel logic is
unit-tested · a proof with a control case covers its invariant · strings are i18n
keys · dialogs use the primitive and pass the a11y lint · configurable behavior is
in the settings registry · `docs/FEATURES.md` row updated · comments state
mechanisms only · committed as a working unit.

**The wired-tools rule (absolute).** A control that renders but does nothing is a
defect, not a placeholder. A Select tool that selects nothing, an object-edit
tool that cannot edit or resize — tools that exist only as UI are banned in
both directions: never register a command without a
working `run`, and never mount a button for an unimplemented command (the
registry's `when` predicate hides what does not exist yet). Done for a tool means
**end-to-end**: click it → use it on a real document → observable, correct
effect → survives save/reopen. **Wired is proven by a pair of tests, and neither
alone counts:** a kernel-level proof (Part I level 1/2) that the command produces
the document effect and survives round-trip, plus a UI-level test (level 3) that
the control dispatches exactly that command. Level 3 runs against the browser
shim, whose kernel is stubbed — on its own it would prove a button dispatches
into the void — the display-only sin wearing a green check. A tool missing
either half of the pair is not done.

---

# Part I — Testing

Four levels, all in CI on every push (windows-latest):
1. **Unit (vitest):** kernel logic, geometry, command inverses, contract schemas.
2. **Proofs (vitest, control-case rule):** the user may supply a seed corpus of
   proof scripts and test fixtures as reference material (Part A) — incorporate
   them as first-class tests. The fixture corpus covers rotated, cropped, CJK,
   encrypted, and deliberately corrupt documents, and grows with every fix
   per B2.
   **Fixture size rule:** only fixtures under the pre-commit size guard are
   committed; anything larger — above all the 200 MB document the Stage 0
   performance assertion needs — is **generated deterministically by a script**
   at test time. Without this rule, the perf
   gate and invariant 15 contradict each other and one of them would quietly
   lose.
3. **UI (Playwright)** against the browser shim (`packages/testing`) — the shim
   implements the full contract, so the entire renderer runs in a plain browser.
   Every Playwright-rendered screen also runs an **axe-core pass from Stage 0**,
   with zero serious violations as the gate. This is what makes B9 enforcement
   rather than slogan — rich keyboard shortcuts are not screen-reader
   accessibility, and this is the check that catches the difference — and it
   covers focus order, roles, and composed-screen contrast continuously instead
   of once at Stage 10.
4. **Native (packaged-app sweep):** proves `pdfium.dll` loads from
   `app.asar.unpacked`, `mutool.exe` spawns, both flavors boot. Pass
   `--disable-features=CalculateNativeWinOcclusion` (occluded windows suspend
   IntersectionObserver and the test measures window stacking otherwise).

Rules: a native-behavior claim is proven at level 4 or it is unproven · tests that
depend on the developer's desktop are defects · CI ordering: build before proofs
that drive compiled output · **the L11 performance smoke runs on every push**
(generate the large fixture, open it, run one command, save; assert peak RSS
< 1.5× file size and bounded bytes across IPC) — the architecture's central
claim is a per-commit gate, not a Stage 0 and Stage 10 measurement with nine
unguarded stages between them; that late-audit shape is the same one M2's
contrast rule just eliminated.

---

# Part J — Packaging & distribution

- Two build flavors from one codebase: **Store (MSIX)** — Microsoft signs,
  publisher Tenslor Inc., updates via Store; **Web (NSIS installer + portable)** —
  GitHub Releases, linked from monsterapdf.com, electron-updater feed,
  `CSC_IDENTITY_AUTO_DISCOVERY=false` (unsigned direct builds are a known,
  documented tradeoff).
- Renderer dependencies live in **devDependencies** (Vite bundles them; listing
  them as `dependencies` double-ships them, a trap worth tens of megabytes).
- Native binaries in `app.asar.unpacked` (`fs` is shimmed inside asar; the OS
  cannot execute or `LoadLibrary` from an archive).
- **No binaries in git, ever** — provisioning script with pinned SHA-256 hashes
  (every native binary, `pdfium.dll` included). Git history is permanent
  the moment the repo is public.
- **Heavy optional runtimes download on demand:** the TrOCR/onnxruntime stack
  (a 200+ MB runtime serving one niche feature) follows the same
  pinned-hash-on-demand pattern as its models — never bundled. Target
  installer: **< 150 MB** —
  validated with arithmetic at the Stage 0 packaging skeleton (Electron runtime +
  mutool + pdfium + app bundle, compressed) and resized only via ADR. A budget
  nobody computed is a wish.
- AGPL compliance: LICENSE, per-file headers not required but a NOTICE generated
  from the lockfile, source offer covering the shipped MuPDF version, "Source
  code" link in About.
- **Dependency policy** (the licence check alone is half a policy): the
  lockfile is committed and CI installs with `npm ci`, never `npm install` —
  the installer-budget arithmetic and the NOTICE generation both assume a
  reproducible tree. `npm audit` runs in CI. Adding a dependency requires three
  things in its commit: the AGPL licence check (Part A), the audit result, and
  one stated line of need. Part A's xlsx→exceljs rule is a licence *and* a
  vulnerability decision — both halves are law, not just the licence half.
- **AGPL × Microsoft Store — resolved 2026-08, record as ADR-0001.** GPL-family
  apps ship on the Store today (VLC, Krita, Inkscape are precedents); the modern
  App Developer Agreement accepts OSI-approved licences, and provider-supplied
  licence terms in the listing supersede Microsoft's Standard Application License
  Terms. Consequences: declare AGPL-3.0 as the app's licence terms in the Partner
  Center listing and keep the source link in both the listing and About.
  Re-verify the current Store Policies once at submission prep — as a checklist
  item, not an open question.

## Public repository from the first commit

**Decision: the repository is public from commit one, and the entire development
history is part of the product.** The conventional route (develop privately,
scrub, publish at launch) is rejected: it creates a time-critical
pre-publication scrub with no margin for error, and a sanitized history is worth less to reviewers than a
real one. An honest history of root-caused fixes is evidence of exactly the
discipline this project claims. Messy intermediate states are normal open-source
history; laundered history is not.

Public-from-start means every mistake is permanent, so the safety net is
mechanical, not disciplinary:

- The **user** creates the GitHub repository (public, under the project's
  organization) with the AGPL-3.0 `LICENSE` in the first commit — all published
  code must be licensed from the moment it is visible — and **enables GitHub
  secret-scanning push protection** (free for public repos) the day the repo is
  created, so a leaked credential is blocked at push time, before it becomes
  permanent. The agent builds against this repo from the first commit.
- `README.md`, `CONTRIBUTING.md`, and `SECURITY.md` (vulnerability reporting
  contact) land during Stage 0, not at launch.
- Local enforcement mirrors the platform: a pre-commit hook runs a secret scanner
  (gitleaks) and rejects files over 5 MB or with binary/executable extensions;
  CI runs the same scan. The hook ships in the repository so every contributor
  inherits it.
- **Fixture provenance rule:** test fixtures are self-generated or verifiably
  public-domain only. Never a real-world document — a fixture PDF carrying a
  stranger's name or metadata becomes permanently public the moment it is pushed.
- **History is append-only on main.** No force-push, no amend-after-push, no
  rebase of published commits. A bad commit is corrected by a new commit that
  says what was wrong. (GitHub retains orphaned commits regardless, so a rewrite
  would add dishonesty without adding safety.)
- Branches are cheap and disposable; main is protected and CI-green by policy —
  the full Part I suite passes before merge.
- Secrets the app needs during development (test API keys, tokens) live only in
  local untracked files and OS keychains; never in the repo, never echoed in CI
  logs.

---

# Part K — Lessons ledger (paid for once; do not pay again)

## K.0 — Banned patterns, named, and the mechanism that bars each

This table exists so the question "are we drifting into a banned pattern?" is
auditable rather than assumed. If a change would recreate a row's pattern, that
change is wrong regardless of how expedient it looks, and B4 applies.

| Banned pattern | Mechanism that makes it unrepresentable |
|---|---|
| Architecture retrofitted under features | Stage 0 gate (Part G) + architecture change control (B4) |
| Renderer owned the document bytes; whole file shipped across IPC per operation | DocumentService + DocId (C2); payload-size invariant L11 |
| IPC channels hand-written in several places with silent drift | one generated contract (C5) |
| Singleton store + copy-the-world tabs → cross-tab corruption races | per-document stores (C6) |
| Runtime path allowlist that fails open at any handler that forgets it | FileHandle capabilities — a path in a renderer type is a compile error (C2) |
| A presentation engine used as reader-of-record for another engine's writes → sidecar hacks, object-number joins | writer-of-record matrix; PDF.js is presentation only (C3) |
| Appearance streams written in two places; text extraction ×3; three affine-math implementations | one writer per concern (B3); one text substrate (E2); one PageTransform (C6) |
| Full-byte undo snapshots rationed by a memory budget | command-log undo with checkpoints (C4) |
| Dozens of dialog open-flags and callback props wired by hand | registries (C7) |
| Proof suite gated on one person's discipline; CI proved nothing about behavior | all four test levels in CI from Stage 0 (Part I) |
| English hardcoded across the whole component tree; a renderer with near-zero aria | i18n + a11y as substrate, lint-enforced (B9) |
| Binaries committed to git history; secrets needing a scrub before publication | no-binaries rule + public-from-day-one hygiene (B10, Part J) |
| Plaintext fallback when the OS keychain was unavailable, silently | refuse-and-say-so (E5) |
| Decorative features: a TSA that discarded its response, green checks verifying nothing | done-right-or-absent (D7); Rule 0 corollary |
| A 200+ MB ML runtime bundled in the installer for one niche feature | on-demand pinned downloads (Part J) |
| No logs, no crash reporting, in a publicly distributed app | observability from Stage 0 (C8) |
| Hand-rolled PDF content-stream parsing as a first resort | normalize-then-edit first; quarantine-with-ADR only on proven engine gap (C3) |
| Emoji glyphs as toolbar icons; ad-hoc inline styles by the hundreds; one monolithic stylesheet | Part M: tokens-only lint, one icon set, primitives, CSS modules |
| Display-only tools: controls that rendered but did nothing (Select selected nothing; Object Edit couldn't edit or resize) | the wired-tools rule (Part H): the proof **pair** — kernel effect + UI dispatch — or it is not done; a UI test alone proves a button dispatching into the void |

## K.1 — Mechanisms already paid for

Build/tooling: Vite's watcher must ignore `release/` (chokidar holds a directory
handle for `ReadDirectoryChangesW`; an open handle blocks RENAME → EPERM) ·
tesseract worker/wasm/traineddata must be static-copied (CSP blocks CDN) · PDF.js
v6 `render()` takes `canvas`, worker wired via `?url` import · settings migrations
read the raw stored version, not the merged object.

Engines: MuPDF annotation rects are fitz y-down · MuPDF WASM buffers are views
into the whole heap — copy exact-size out · call MuPDF via the worker client, not
directly, or the UI freezes · never load pdfium.dll in main (native faults are
uncatchable) · PDFium full rewrite corrupts non-embedded font refs — incremental
save only · tesseract v7 word boxes need `{blocks: true}` · PDF base font names
are anonymised (`CIDFont+F1`) — resolve real families from the font program's name
tables · a subset font physically lacks unused glyphs; coverage must be proven
(the "document proves the font can encode chars it already renders" rescue) or a
system substitute harvested · text-layer spans are `color:transparent` — sample
ink color from the rendered canvas, never from the DOM.

React/UI: no CSS width/height transitions on page wrappers (layout pass per
frame) · destroy every replaced PDF.js document proxy and `cleanup()` pages that
scroll away (gigabyte-class leaks otherwise) · `memo` per-page components ·
supersample-then-downscale blurs text — 1:1 device pixels.

Process: a green check that doesn't verify what it claims (an `available: true`
for a binary that cannot be spawned; a timestamp request whose response is
discarded) is worse than a red one · fix the class, not the instance (closing
one vulnerable handler and leaving its six siblings is the classic half-fix) ·
every "weird constant" carries a comment or it will be "cleaned up" into a
regression.

---

# Part L — Invariants (regression = defect, regardless of tests)

1. Renderer sandbox on; preload uses only `contextBridge`/`ipcRenderer`/`webUtils`.
2. The renderer never holds a filesystem path or document bytes it can mutate.
3. All coordinate conversion through `PageTransform`; a bare y-flip is banned.
4. One writer per concern (C3 matrix); PDF.js is never a source of truth.
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
15. No secrets, no binaries, and no real-world personal-data fixtures ever enter
    the repository. The pre-commit hook and CI secret scan enforce this; their
    absence is itself a defect.
16. No raw colors or magic pixel values in components — design tokens only
    (Part M). No emoji as UI icons, anywhere.

---

# Part M — UI design language

The app's look is part of the codebase's public reputation. An app that looks
improvised reads as improvised, no matter what the architecture underneath is.
This part is as binding as Part C, and the design system is Stage 0 work — the
primitives and tokens exist before the first feature screen does.

## M1. Identity

- **A calm, professional Windows desktop tool.** Benchmarks: PDF-XChange Editor,
  Word's ribbon, modern Windows 11 apps. Dense enough for professionals, never
  cramped, never playful.
- **Brand:** Monstera green as the default accent (`#16a34a`, user-customizable
  per the settings registry), neutral gray surfaces, both dark and light themes
  first-class from the first screen. Default theme follows the OS.
- **The anti-goal, named:** the app must never look AI-generated or hobbyist.
  Concretely banned: emoji glyphs as icons (a toolbar reading "🔒 Security"
  reads as a prototype), mismatched paddings, default browser
  form styling, inconsistent icon sizes, spinner-only loading states on surfaces
  whose shape is known.

## M2. Design tokens — the single source of visual truth

One token file defines: a **2/4/8 px spacing scale** — the 8 px grid governs
layout regions; 2/4 px increments are for control interiors · a type scale split
into **chrome sizes (10/11/12/13 — 10 px is the floor; no UI text renders
smaller)**, **content sizes (14/16/20)**, and **one display size** (the
start-screen wordmark) · radii · elevation/shadow levels · semantic color roles
(`--bg`, `--bg2`, `--surface`, `--surface2`, `--border`, `--border-soft`,
`--text`, `--muted`, `--faint`, `--page`, `--canvas`, and one `--accent` per
theme, with every contrast-bearing companion derived by `onColor` below — the
design draft's token set is the seed and the naming authority). Light, dark, and high-contrast are
token remaps under `data-*` attributes. **Components consume tokens only**;
a raw hex value or magic pixel number in a component is a lint error unless it is
genuinely dynamic (e.g. a user-chosen annotation color).

**Contrast is enforced, not audited — and roles are typed so the check can be
strict without being exempted.** Every color role is declared in the token file
as **text-bearing** or **fill-only**. The CI check computes, from the token file
itself: 4.5:1 for every text-bearing role on every surface it may sit on, 3:1
for UI boundaries — and ignores fill-only roles, so the check never needs a
wholesale exemption (an exempted check is the green-check-that-verifies-nothing
Rule 0 bans). Consequence discovered by sweeping the draft: **`--accent` is
fill-only**. **The root rule — one function, not stored companions.** The token
file declares exactly **one brand accent per theme**, and every color that must
clear a contrast threshold is **computed at the point of use**:

```
onColor(brand, background, minRatio)
  → the nearest color to `brand` that clears `minRatio` on `background`
```

Every companion role is a derived output of that function against the element's
**real** background, never a stored hex: accent text on chrome =
`onColor(accent, chrome surfaces ∪ soft composites, 4.5)` · the primary button
is a theme-aware pair (light: darken the fill until a light label clears 4.5;
dark and high contrast: keep the bright brand fill and derive a near-black
label — dark mode's primary button must read as the brightest accent on screen,
not a darker cousin), with the fill treated as a surface and its label checked
against it at 4.5:1 · selection chrome on the page = `onColor(accent, page,
3.0)` · the selected-thumbnail ring = `onColor(accent, the sidebar it actually
sits on, 3.0)`. Freezing one more hand-picked hex per newly discovered
background is the patch shape; the function is the
fix, because a pairing nobody has discovered yet is still computed correctly,
and it keeps working when the user changes the accent (Part F; the settings
registry still rejects an accent so extreme no derivation reaches the floor).
**Storing a derived color value is a defect.** The design draft implements the
derivation live and is the reference for it.

Coverage rules, so the check verifies what actually renders: alpha-overlay
roles (`--accent-soft`) are evaluated **post-composite** against each surface
they sit on. Surfaces are defined **per render context** — *chrome* (text and
controls on chrome surfaces), *overlay-on-page* (chrome graphics drawn over
the document: selection rectangles and handles, marquee, redaction marks,
field outlines, edit covers — checked at 3:1 against `--page`, which is never
a surface for chrome text but always one for chrome graphics), and *document*
(the PDF's content and user-colored annotations: not chrome, not checked).
And the inversion that closes the category: **every rendered
foreground/background pair must resolve to a pair the check evaluates** — L16
(no literal colors in components) guarantees no unchecked foreground exists,
fill roles that carry a foreground are themselves surfaces, and **CI exercises
the derivation function across every (context, minRatio) pair** rather than
auditing a list of frozen hexes. Raw `--accent` never carries text or an
indicator; small non-text indicators (the unsaved dot, the slider thumb) use
the derived chrome accent text, held to 4.5:1 and therefore always clearing
WCAG 1.4.11's 3:1. Spacing scale
clarification: control interiors use even values (multiples of 2 px); 4/8 px
between elements; the 8 px grid between layout regions. Mockup page-content art
(fake document ink) and brand artwork are content, not chrome — scale and token
rules do not apply to them.

## M3. Layout anatomy (user-approved; binding)

- **Title bar:** integrated document tabs (Window Controls Overlay), the Ctrl+K
  command search, and the **layout switcher** (below).
- **Left section rail**: the eight feature sections — Home,
  Comment, Edit, Organize, Forms, Review, Protect, Tools — as labeled icons.
  Selecting a section populates the top tool ribbon. Beside it, one document
  panel at a time — Pages, Bookmarks, Comments, Forms, Layers, Search — switched
  by a **panel-tab strip** of six icon tabs (24 px tabs, 14 px icons — primary
  navigation, not inline chrome) at the panel's top, with the collapse chevron
  at the strip's end. The active tab names the panel via tooltip and accessible
  name; there is no separate title row. The strip is permanent chrome,
  specified here so it is never improvised in a feature stage.
- **Top tool ribbon:** the active section's tools —
  captioned groups, hairline separators, compact 52 px buttons — collapsible.
- **Floating quick toolbar**: a vertical pill on the canvas
  edge with the always-needed tools (select, hand, text selection, zoom in/out,
  crop, snapshot, bookmark, comment); repositionable and hideable. Hiding and
  restoring it is the registry command `view.toggleQuickToolbar` (C7) — in the
  palette, on a shortcut, and as a status-bar toggle — so it can never be lost.
- **Canvas** (the star, quiet chrome) → right contextual panel (annotations
  list / properties) → **status bar** (page position, tool hint, zoom slider +
  fit). The status bar always carries **page navigation**: first / previous /
  an editable "page ⁄ total" field (type a number, Enter jumps) / next / last —
  present whenever a document is open, in every layout mode including Focus.
  The zoom cluster is **zoom-out button · slider · zoom-in button** · current
  percentage · fit mode, all real controls (wired-tools rule applies).
- **Both side panels are collapsible**: a chevron in the panel header collapses
  it; a slim edge handle on the canvas reopens it. Collapsed/open state is
  persisted per panel. This is independent of the layout switcher — Studio and
  Focus hide chrome wholesale; these collapse one panel at a time.
- **Layout switcher** (adopted from the third reference): a segmented control in
  the title bar toggling three chrome modes, persisted per user —
  **Ribbon** (default, everything above) · **Studio** (the ribbon is
  auto-hidden; selecting a section opens its full tool set as a **temporary
  overlay** below the title bar, dismissed on tool choice, Escape, or
  click-away — the Office collapsed-ribbon pattern, so capability is identical
  to Ribbon mode) · **Focus** (chrome hidden **except the title bar**, floating
  toolbar, and status bar; Esc returns — the title bar stays because it holds
  the tabs and the way out). Focus supersedes per-panel collapse state: reopen
  handles are hidden in Focus, and each panel restores its own prior state on
  exit. **The rail's state model is identical in every mode**: the active
  section persists (it is not cleared when Studio's overlay dismisses);
  selecting a section — including re-selecting the current one — is what opens
  the overlay in Studio. One state model, two presentations. Every mode is reachable from every mode; no feature is exclusive to a
  mode — modes hide chrome, never capability, and Studio's overlay is what makes
  that claim true rather than aspirational.
- Everything on an 8 px grid; panels resizable with persisted widths; compact
  desktop density throughout.
- **Start screen (user-approved; never a conventional
  two-column launcher):** centered hero — circular leaf logo, the Monstera
  wordmark (final treatment arrives with the user-supplied logo per M8; interim
  builds render the plain word), "PDF EDITOR" letterspaced beneath,
  tagline "Built For The Way You Work" — then one primary green **Open PDF…
  (Ctrl+O)** button, then a grid of six feature shortcuts (Annotate & mark up ·
  Fill & create forms · OCR scanned pages · Split & merge · Encrypt & sign ·
  Export anywhere), each a real entry point (opens a file then routes to that
  feature — the wired-tools rule applies to these buttons too). Recent files
  appear below the grid when they exist. Footer: "Press F1 for keyboard
  shortcuts" and version + © Tenslor Inc. Drag-drop a PDF anywhere to open.

## M4. Type, icons, and controls

- System font stack (`Segoe UI` first on Windows). No webfonts for UI chrome.
- **One icon set: lucide**, consistent stroke, at exactly four sizes with a
  stated use each: **12 px** panel tabs and inline chrome (tab close, field
  chevrons) · **14 px** status bar and dense controls · **16 px** primary
  controls (rail, floating toolbar, buttons) · **20 px** ribbon buttons. Brand
  artwork (the logo) is art, not an icon, and is exempt. Every icon-only
  control has a tooltip and an accessible name (B9 enforces the latter).
- One primitive set, grown in the primitives package: Stage 0 builds `Dialog`,
  `Button`, `IconButton`, `Input`; the rest (`Select`, `Checkbox`, `Radio`,
  `Switch`, `Slider`, `Tooltip`, `Menu`, `Tabs`, `Panel`, `Toast`,
  `ColorSwatch`) are added the first time a feature needs them — in the package,
  never ad hoc in the feature. All keyboard-first. A screen composed of anything
  other than primitives + tokens is not done.
- **Behavior may come from a headless primitive library** (Radix, Base UI, Ark —
  all MIT, AGPL-compatible) with our tokens as the skin. Decide by ADR in
  Stage 0, defaulting to the library: accessible focus traps, menus, and
  comboboxes are exactly the class of solved problem Rule 0 says not to
  re-derive by hand.

## M5. States are designed, not improvised

Every surface explicitly designs its **empty** state (what a new user sees),
**loading** state (skeletons where the content's shape is known; progress bars
with real numbers for long operations like OCR), **error** state (what went
wrong + what to do next, per C5's structural errors), and **no-key / no-binary**
state (E5's honest empty states; the binaries manager pattern). "It just shows
nothing" is a defect.

## M6. Motion

120–150 ms, ease-out, on opacity/transform only. `prefers-reduced-motion` and
the reduce-motion setting disable all of it. **Never animate page-wrapper
geometry** (a width/height transition forces a layout pass per frame).

## M7. Visual QA

- `docs/UI-GUIDE.md` documents the tokens and primitives with do/don't examples,
  written in Stage 0 and updated when the system grows (B4 applies to the design
  system too).
- Playwright screenshot baselines for the start screen, each ribbon section, one
  dialog, and one panel — in **all three themes (dark, light, high-contrast)** —
  run in CI, compared by perceptual
  diff with a stated tolerance (exact hashes go flaky on environment updates, and
  a flaky gate gets ignored). Baselines are regenerated deliberately, in their
  own commit, never as a side effect. Visual drift is a red build, not a
  surprise.
- Each stage's exit includes a visual pass of its new surfaces against this part.
- The design-draft HTML that accompanies this document is **illustrative only**:
  Part M prose is the law, and the draft's markup is not reference code — the
  real app is composed from the primitive set.

## M8. Brand assets — owned by the user, never invented by the agent

The logo is a **design the user will supply**; it does not exist at build
start. The agent never generates or improvises brand identity. It requests each
asset from the user and blocks only the affected step, not the build:

- **App logo (logo.png) + wordmark** — needed for the start screen and title
  bar. Until supplied, interim builds use a clearly-labeled placeholder.
- **Multi-size `.ico`** — needed for the first packaged build; a placeholder dev
  icon is acceptable there, never in anything submitted to the Store.
- **Store listing assets and monsterapdf.com imagery** — needed at Stage 10
  submission prep; list the required sizes/formats for the user well in advance.


If you have any questions or confusion, feel free to ask, do not assume or quickly conclude.
