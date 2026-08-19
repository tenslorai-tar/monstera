# Feature catalog and status

The complete scope, known before the first line of architecture code. This is
the **destination**, reached through the staged releases in
`docs/ARCHITECTURE.md` and `BUILD-PROMPT.md` Part G — beginning with a
deliberately smaller 1.0.

**Part H requires the row for a feature to be updated in the same commit that
finishes it.** A row that says `done` for a feature whose control renders but
does nothing is a defect in this file as much as in the code — see the
wired-tools rule.

## Legend

| Status | Meaning |
|---|---|
| `—` | Not started. |
| `wip` | In progress. Not reachable in the UI: the command registry's `when` predicate hides what does not exist yet. |
| `done` | End to end. Registered, contract entry validates, kernel proof **and** UI dispatch test both pass, strings are i18n keys, survives save and reopen. |

## Progress

| Stage | Scope | Status |
|---|---|---|
| 0 | Walking skeleton — the architecture, whole | **wip** |
| 1 | Viewer core (D1) | — |
| 2 | Page management (D2) | — |
| 3 | Annotation platform, then tools (D3) | — |
| 4 | Forms (D5) | — |
| **1.0** | **Minimum Shippable release — Stages 0–4** | — |
| 5 | Text editing (D4) | — |
| 6 | OCR (D6) | — |
| 7 | Security and signatures (D7) | — |
| 8 | Import/export/convert and non-AI review tools (D9, D10, D8) | — |
| 9 | AI and cloud (D11, E5, D8 AI items) | — |
| 10 | Ship (D12, E3, E4, a11y and visual QA, perf, Store assets) | — |

---

## D1 — Viewer and navigation · ribbon: Home (display controls in Tools › Display) · Stage 1

| Feature | Status |
|---|---|
| **Gate:** IPC payloads bounded per invariant 11 — no channel's payload scales with document size per *operation*; the one sanctioned byte crossing is a snapshot, once per **version**. Moved here from the Stage 0 gate rather than asserted there: at Stage 0 the contract declares a single channel carrying a version string, so a check would have passed without inspecting anything and stayed green while the channels that make L11 bite — page rasters, document bytes, save output — did not exist. A vacuously-green invariant check is worse than an honestly-deferred one. Assert it as the first document-carrying channel lands. | — |
| Continuous scroll with lazy per-page render (IntersectionObserver) | — |
| Zoom: fit-width / fit-page / presets / ± / Ctrl+scroll | — |
| Two-tier zoom: instant CSS stretch + 150 ms debounced true re-render | — |
| Thumbnail sidebar (lazy, drag-reorder) | — |
| Page navigation: go-to, PageUp/Down, Home/End, Alt+arrow history, click-to-jump | — |
| Recent files | — |
| Start screen (features grid, errors inline) | — |
| Multi-document tabs | — |
| Split view (two pages) | — |
| Side-by-side document compare | — |
| Loupe | — |
| Rulers and grid | — |
| Dark page mode | — |
| Named destinations panel | — |
| Links panel | — |
| Layers (OCG) panel with visibility toggle | — |
| Search: case / whole-word / regex, Unicode-normalized, CSS Custom Highlight API, cancellable background indexing | — |
| Status bar | — |
| Command palette | — |
| Themes: light / dark / high-contrast, accent color | — |
| HD render toggle (PDFium) | — |

## D2 — Page management · ribbon: Organize · Stage 2

| Feature | Status |
|---|---|
| Delete pages | — |
| Rotate 90 / 180 / 270 | — |
| Drag-reorder | — |
| Duplicate | — |
| Insert blank | — |
| Insert from PDF | — |
| Insert from image | — |
| Extract to new PDF | — |
| Merge PDFs | — |
| Split (ranges / one-per-page) | — |
| Crop | — |
| Resize pages | — |
| Replace page | — |
| Swap pages | — |
| Find duplicate pages | — |
| Deskew and enhance scans | — |
| Page transitions (`/Trans`) | — |
| Generate TOC from bookmarks | — |
| Bates numbering | — |
| Headers and footers | — |
| Watermark | — |
| Background | — |

## D3 — Annotations and markup · ribbon: Comment · Stage 3

| Feature | Status |
|---|---|
| Highlight, underline, strikethrough (text-markup via selection) | — |
| Ink | — |
| Rectangle, ellipse, line, arrow | — |
| Polygon, polyline, cloud | — |
| Text box | — |
| Sticky note | — |
| Callout | — |
| Caret | — |
| Typewriter | — |
| Stamps: built-ins, custom image, multi-page apply | — |
| Measure distance / area / perimeter with calibration | — |
| Link (URL / page) | — |
| Snapshot region to PNG | — |
| Place image (move / resize / delete) | — |
| Eraser | — |
| Select: multi, resize handles, arrow-nudge, clipboard copy/paste, Delete | — |
| Redact marks (solid + blur preview) | — |
| Style controls: color, opacity, line width, font, size | — |
| Annotations panel (by page, click-to-jump) | — |
| Comment styles panel | — |
| Persistence as real PDF annotation objects | — |
| `srcRef` invariant: never rewrite annotations the app did not author | — |
| Annotations survive page ops via command remapping | — |

## D4 — Text · ribbon: Edit · Stage 5

| Feature | Status |
|---|---|
| Select and copy (native text layer) | — |
| In-place text editing: line-level (visual line clustering, run diffing) | — |
| In-place text editing: region replacement | — |
| Object-level edit (move / scale / recolor / delete any page object) | — |
| Document-wide replace-all | — |
| Typewriter | — |
| Find and replace | — |
| Spell check (nspell + dictionary management) | — |
| Translate document text | — |
| Word count | — |

## D5 — Forms · ribbon: Forms · Stage 4

| Feature | Status |
|---|---|
| Render and fill all AcroForm field types (text, checkbox, radio, dropdown, listbox, signature) | — |
| Create fields by drawing | — |
| Delete fields | — |
| Flatten | — |
| Forms panel | — |
| Export / import data (JSON, XFDF, FDF) | — |
| Heuristic field detection on flat documents | — |

## D6 — OCR · ribbon: Tools › OCR · Stage 6

| Feature | Status |
|---|---|
| Scanned-page detection | — |
| tesseract.js OCR, 13+ languages, page scope choice | — |
| Invisible selectable text layer | — |
| Search integration | — |
| Export searchable PDF | — |
| OCR region (drag a rectangle) | — |
| Local handwriting OCR (TrOCR small/base, on-demand download, cached, offline) | — |
| Azure Document Intelligence integration | — |

## D7 — Security and signatures · ribbon: Protect · Stage 7

| Feature | Status |
|---|---|
| Open encrypted PDFs (auto password prompt) | — |
| Set user / owner password (AES-256) | — |
| Permission flags | — |
| Remove password | — |
| True redaction (MuPDF content removal; solid and blurred; mixed in one pass; confirm dialog) | — |
| Find-and-redact by search | — |
| Sanitize / flatten document | — |
| Digital signing (PFX/P12, PKCS#7 detached) | — |
| TSA timestamping — **implemented correctly or not offered** | — |
| Certify | — |
| Signature verification (CN, org, validity, byte-range hash check) | — |
| Visible signatures (draw / type with font choice / upload) | — |
| DocuSign integration | — |

## D8 — Review · ribbon: Review · Stage 8 (AI items Stage 9)

| Feature | Status |
|---|---|
| Document compare | — |
| Annotation import / export | — |
| Spell check pass | — |
| Reading-order / tagged-PDF inspection | — |
| Accessibility check | — |
| Comment summarization (AI) — Stage 9 | — |

## D9 — Import and create · ribbon: Tools · Stage 8

| Feature | Status |
|---|---|
| Markdown → PDF (new or append) | — |
| CSV → PDF table | — |
| Office import (LibreOffice) | — |
| Image(s) → PDF | — |
| Open from URL (SSRF-guarded) | — |
| Webcam capture | — |
| Document scan (edge detection) | — |
| Edit page in external app and reimport | — |
| Import page as OCG layer | — |
| Cloud storage: Google Drive, Dropbox, OneDrive, Box, SharePoint — Stage 9 | — |

## D10 — Export and convert · ribbon: Home › Export + Tools › Convert · Stage 8

| Feature | Status |
|---|---|
| Pages → PNG / JPEG / WebP (range, DPI, quality) | — |
| Text extraction, plain and layout-preserving — **MuPDF** structured text; the founding record's "when Poppler available" is withdrawn, since Poppler was named in no matrix row and no provisioning list ([ADR-0013](DECISIONS/0013-pdfa-export-and-text-extraction-engines.md)). Layout fidelity is **unexecuted**: ENGINE-SPIKE H7 compares it against `pdftotext -layout` before this is built on | — |
| Word (rich / layout / text modes) | — |
| PowerPoint | — |
| Excel: table detection (automatic / force-OCR / local handwriting / Azure) | — |
| Excel: editable review grid | — |
| Excel: styled output with real fonts, fills, borders, merges, number formats | — |
| Excel: combine-pages option | — |
| Email document | — |
| Print (MuPDF raster at chosen DPI to system dialog — never print the DOM) | — |
| PDF/A-2b export (honest blocker reporting) — **Ghostscript**, which is **not provisioned and does not ship until this is built** ([ADR-0013](DECISIONS/0013-pdfa-export-and-text-extraction-engines.md)). The provisioning script and its registration into the external-converter seam are part of this row's work, not a prerequisite sitting in a binary list. **Unexecuted**: ENGINE-SPIKE H6 converts a document with a non-embeddable font, transparency and an untagged image, and validates with veraPDF rather than Ghostscript's own exit code | — |
| Optimize / compress | — |
| Barcode generate and read | — |

## D11 — AI · ribbon: Review › AI · Stage 9

| Feature | Status |
|---|---|
| Assistant dialog (chat about the open document) | — |
| Comment summarization | — |
| Vision analysis (table reading assist) | — |
| Provider registry: Anthropic, OpenAI, Google Gemini | — |
| First-run onboarding: choose provider → paste key → `validateKey()` → or Skip | — |
| Keys via `safeStorage`; refuse-and-say-so if unavailable | — |
| Honest no-key empty states everywhere | — |

## D12 — Shell and UX · Stage 0/1 substrate, completed Stage 10

| Feature | Stage | Status |
|---|---|---|
| Settings (registry-driven, full inventory) | 0 → 10 | wip |
| Keyboard shortcut reference (F1) + customizable bindings | 10 | — |
| Autosave (interval setting; **off by default**) | 10 | — |
| Crash recovery offer | 0/1 | — |
| Error boundary with reload | 0/1 | — |
| Toasts | 0/1 | — |
| Window title sync (`file ● — Monstera`) | 1 | — |
| File associations and drag-drop open | 10 | — |
| About (version, licences, source offer) | 10 | — |
| Packaging test — against a **built application**, not a source tree: (a) the unpacked `.node` addon is found through `process.resourcesPath` from `app.asar.unpacked` ([ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md)'s correction records this as a packaging obligation, not an ABI one); (b) **`NOTICE` is present in the installed layout**. (b) is compliance, not robustness: the FreeType License's binary-distribution clause requires its disclaimer in the **distribution** documentation, and a file that exists only in this repository does not discharge it — `proof:licences` covers the content, so what is missing is delivery. Belongs to the **first build that reaches a user**, not to Stage 0: `electron` is not a dependency yet and there is no packaging configuration, so against Stage 0 this obligation could only block the stage wrongly or be waved past. Recorded-and-undelivered is the state it is in, and this row is where it stops being invisible. | SHIP 1.0 | — |
| Native-binaries manager (status, verify, download) | 10 | — |
| Updater: Store channel and web channel | 10 | — |
| Review prompt (EngagementService) | 10 | — |
| Onboarding | 10 | — |

---

## Stage 0 — architecture substrate

Not user-facing features, but the exit gate for everything above.

| Item | Status |
|---|---|
| Pre-commit guards (secret scan, file policy, lockfile integrity) + CI mirror + proofs | **done** |
| Pinned-hash binary provisioning primitive | **done** |
| Governing documents (ARCHITECTURE, CLAUDE, README, CONTRIBUTING, SECURITY, ADRs) | **done** |
| Monorepo workspaces + enforced import boundaries | **done** |
| Contract: channels defined once; the four surface **types** are derived from it and exhaustive at compile time (proven — narrowing a handler map to `Partial<>` turns `proof:contract` red) | **done** |
| Contract: the four surfaces **implemented** — main handlers, preload bridge, renderer client, browser shim. Today `apps/desktop`, `packages/ui` and `packages/testing` are each a bare `export {}`, and nothing outside `contract.proof.mjs` is annotated `ContractHandlers` or `ContractClient` | — |
| CapabilityRegistry (FileHandles, invariant L2) | **done** |
| DocumentService — the open-document index: `DocId` minted never derived, one file is one document (dedup on the merge-only identity rule), close removes from the index before awaiting teardown, and the **save-time write-target check** re-verified against the actual file. Four verdicts and only one permits a write; the walk carries its own positive control and refuses a verdict when it comes back empty (audit item 4b). Six widenings applied and confirmed red, including one that exposed a vacuous control. **Not done, and not claimed:** version bump and `savedVersion`, the per-document serial lane of [ADR-0009](DECISIONS/0009-document-identity-and-the-command-log.md) §7, handle recycling, and the Save-As target check. | **partly done** |
| ADR-0009 §7's **per-document serial lane** — commands, queries, save and teardown queue per `DocId`; the lane lives on the record so lookup is get-or-miss and cannot resurrect a closed document; close splits into synchronous index removal plus lane-ordered teardown (dated clarification in the ADR); lane ordering is per-document → index only, enforced by an async-context marker so a `saveAll` reentry is a named error rather than a silent deadlock; the queue cap is 64, chosen so a proof can drive it. No accessor for a document's current version exists — the lane hands work the version it operates against and reads the stamp back **after** the work, so a command that bumps is stamped with the version it produced rather than the one it replaced. Same-document reentry is a named error, not a hang — for `run` and for `close`, the latter because `await close(A)` hangs while `void close(A)` behaves, so that hazard punishes the careful caller and a recorded note would not reach them. The cross-document sibling stays recorded rather than guarded: both its forms fail alike and it has no call site. Ten widenings confirmed red, two of them separating a removed guard from a misplaced one. | **done** |
| ADR-0009 §5's **version counter** — `DocVersion` monotonic from 1, bumped by every applied mutation including undo and redo; `savedVersion` seeded from the initial version so a freshly opened document is clean; `dirty` is `savedVersion !== currentVersion`, recorded as a **conservative approximation** with its false-dirty case (save, undo, redo back to identical content) proven, because it fails towards prompting rather than towards losing work — the opposite direction from cursor equality. No service-level `isDirty(docId)`: read outside the lane the stale answer is *clean*, which closes a document without prompting. Writer of record decided ahead of any caller: `bumpVersion` and `markSaved` narrow to the CommandBus and the save pipeline when those land. Four widenings confirmed red. | **done** |
| ADR-0009 §8 — the **engine seam**. Both writer shapes live in the type: `Apply<W, K>` is conditional on the declared writer, so a live-session writer mutates in place and returns void while a byte-image writer consumes an image and produces one. **Exactly one adapter** implements it — MuPDF, live-session — and the byte-image side deliberately has nothing behind it. Its control is a type-level fixture in `proof:contract` that builds a byte-image writer and a byte-image `Apply` **with no type assertion**; modelling the seam on live-session ops alone turns it red. Sessions are opened from the kernel's bytes and serialise back, so no engine owns authoritative state (ADR-0007's kill-the-process recovery stays open). Sessions are **branded** (fabrication is a compile error, as for `CanonicalPath`) and the native document lives in a `WeakMap` beside the token — the brand and the map do different jobs: the brand stops fabrication, the map catches a real session that was already closed, so a second `close` is a named error rather than a double `destroy()`. | **done** |
| **`DocumentService` holds the canonical bytes** ([ADR-0009](DECISIONS/0009-document-identity-and-the-command-log.md) §8, [ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md)). The seam **enables** this and does not satisfy it: `open` takes bytes and `serialise` returns them, so no engine is forced to become authoritative — but the record holds no bytes, so killing an engine host today loses everything since the last save. Retaining a full image per open document is a design unit with budget consequences and is sized rather than added as a field. Trigger, not an owed-list line: `kernel-holds-canonical-bytes` turns `check:advisories` red the day `documentService.ts` names `ByteImage` or `Uint8Array` (verified by making it fire). What this row owes is the retention policy — how many images are resident, what happens at the ADR-0007 ceiling, and whether a killed host actually recovers, asserted against a **running** process. | — |
| ADR-0009 §6 + §3a — the **command union and routing table**. `Command` declared once as a zod discriminated union in `@monstera/contract`, TS type inferred. `commandSpecs` is a mapped type over the kind union, so a missing kind and an unrouted kind are both compile errors. Both axes are declared per command and **neither can be declared without its consequence**: `reproducible: false` requires `replay: 'stored-effect'` (§3a's sentence as a type), `invertible: false` requires `undo: 'checkpoint'` (§4's, so a checkpoint cannot quietly become optional). Ten compile-fail cases in `proof:contract`, three of them controls; every reject case declares the error code and the reason it expects, matched against the diagnostic with type dumps elided, and must declare a name that appears in the diagnostic but is **not** the reason (or `null` to say there is none). `apply` is deliberately absent — §6 binds it to the declared writer's session type, which needs the engine seam. | **shape done, dispatch pending** |
| CommandBus — the log as a cursor, inverses recording prior state, invertibility and reproducibility declared per command. Takes over as writer of record for `DocVersion` per the decision above. | — |
| **Errors crossing to the renderer carry no filesystem path** ([ADR-0009](DECISIONS/0009-document-identity-and-the-command-log.md) §9, invariant L2). `readFileIdentity` rethrows every errno that is not `ENOENT`/`ENOTDIR`, which is correct — the kernel throws honestly and the boundary sanitises — but a rethrown `EACCES` is a Node `fs` error carrying the absolute path in both `.message` and `.path`. Nothing leaks today only because no IPC handler calls `DocumentService`, so the expiry is mechanical rather than remembered: `kernel-error-path-sanitisation` in `docs/security/engine-advisories.json` turns `check:advisories` red the day `DocumentService` or `readFileIdentity` is named from `apps/*/src/**` (verified by making it fire, then removing the reference). That trigger catches "a handler reached the kernel"; this row is "and its errors were sanitised" — the mapping to structured failures, **plus a control asserting a path DOES appear when the mapping is removed**, because a test that finds no path in a message it never populated is the vacuous shape. | — |
| Both utility hosts on the shared worker contract | — |
| **Engine host containment asserted against a RUNNING process** (invariant 25). Not against the options passed to `utilityProcess.fork` — a flag that did not take effect and one that did are indistinguishable until it matters, which is the whole lesson of the compiler-mitigations check reading the PE image rather than the build flags. Three assertions, each on a live host: (a) its **integrity level** is the lowest workable one, read back from the process token; (b) its **job object** bounds memory and forbids process creation, read back from the job; (c) a **network connection attempt from inside the host fails** — the only form of "no network" that is evidence rather than configuration. The declaration in `docs/security/engine-advisories.json` (`engine-host-containment`) turns the build red the day shipped code names `utilityProcess`, which is what forces this row rather than leaving it to whoever writes the host. That trigger catches "a host was written"; this row is "and it was contained". | — |
| **The exact CSP is pinned as an invariant, once a renderer exists to read it from** (threat model §4.13). The value is deferred because the renderer does not exist and the policy would be a guess — an invariant relaxed in its first week teaches that relaxing invariants is normal. **The mechanism is not deferred, and this row is it:** a stage item does not fail a build, so the CSP would otherwise be the one security decision holding a note where invariant 25 holds a trigger. When the renderer lands, this row requires (a) the **exact directive list** written into `docs/ARCHITECTURE.md` §9 as an invariant, not "a CSP is set"; (b) the policy **read back from the running renderer** — `document.querySelector` on the delivered meta tag, or the response header as received — and compared to the invariant, never read from the source that sets it, for the same reason the mitigations check reads the PE image and the containment row asserts against a live process; (c) a control proving the comparison can fail, by asserting a policy the renderer does not have. Any later relaxation is then an ARCHITECTURE diff someone justifies, which is the whole point of pinning it. | — |
| **Active content runs on no open path** (invariant 24). A fixture PDF carrying embedded JavaScript, an `/OpenAction`, an external reference and an embedded file, opened through the real shim: nothing executes, nothing is fetched, nothing reaches disk. Needs a fixture whose active content is *observable when it fires* — a proof that the JS did not run is worthless if the same result appears when the JS is absent, so the control is the same document opened by something that DOES run it. | — |
| Per-document stores | — |
| Command / dialog / settings registries | — |
| Design substrate: tokens, lint rules, `docs/UI-GUIDE.md`, 4 primitives | — |
| i18n scaffold + literal-string lint rule | — |
| Logging + crash reporter consent | — |
| CI: typecheck, lint, unit, proofs (Windows + Linux) | **done** |
| CI: Playwright smoke + axe on the browser shim | — |
| Packaging skeleton — **Store (MSIX) is the only distribution** ([ADR-0018](DECISIONS/0018-distribution-is-the-microsoft-store.md)); the flavour switch stays as a seam so a signed direct download is later a config change rather than an amendment. **Two MSIX assumptions must be checked here, early rather than at submission:** (a) an MSIX application **cannot write to its install directory**, so anything that expects to — provisioned binaries, caches, the shim's neighbours — has to be found now, not by a rejected submission; (b) its **data paths differ from the installer flavour's**, so any path assumption baked in while developing unpackaged is wrong under MSIX. Both are executable only once this skeleton exists, which is why they are recorded against this row. Plus installer size arithmetic. | — |
| **Gate:** engine-capability spike — MuPDF/@cantoo rows executed, matrix amended (ADR-0006); PDFium, @signpdf and PDF.js rows pending their stages | **partly done** |
| **Gate:** performance budget assertion — **per-process** peak RSS against the `main` and `mupdf-host` budgets, read from invariant 17's machine-read line rather than restated here or defined as constants ([ADR-0012](DECISIONS/0012-memory-budgets-are-machine-read-from-the-invariant.md)). `npm run perf:gate` runs **both content shapes**, because they are not interchangeable evidence. Measured: image-heavy 199.4 MB → main **1.00×**, host **1.30×**; object-dense 25.1 MB / 127K objects → main **1.00×**, host **3.71×**. The multiple is of the document's cost, above each role's measured baseline, per invariant 17. `proof:perfbudget` mutates the declared line and requires the verdict to follow it, stating no limit of its own. **Owed before this is done:** these are the roles in their own processes, not Electron's, so it must be re-measured when the utility process lands. **The renderer half cannot be asserted at all yet** — invariant 17 declares it provisional and two-term, both unmeasurable until a renderer exists, and asking for its limit throws rather than substituting one; the single figure this row used to carry is recorded in ADR-0007 as the mistake it was, having no derivation. | **partly done** |
| **Gate:** no document-size ceiling is enforced, and the reason is recorded — the ~650 MB ceiling this row used to gate on was a **WASM** ceiling, withdrawn by ADR-0007's correction; natively that file opens in 144 MB and saves incrementally in 4.5 s (ADR-0010, invariant 17). What replaces it is the per-process budget row above, plus invariant 18: a save that fails never loses work. Reinstating a ceiling requires a native measurement showing one exists. | **done** |
| **Gate:** the PreToolUse write guard has been **observed to fire** — recorded in `docs/hook-probe.json`, verified by `proof:hookprobe` and enforced by `check:docs`, which fails if this row is marked done without the evidence. **Observed 2026-08-18T06:45Z:** a `node -e` call was denied by the guard, unprompted, while doing ordinary work. The denial is self-certifying — a session that never loaded the guard cannot be blocked by it — which is why the record accepts it despite the session predating the configuration. | **done** |
| **Exit:** open via FileHandle → render → `rotatePages` + undo → save → one registered dialog, setting and shortcut | — |
