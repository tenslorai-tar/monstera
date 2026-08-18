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
| DocumentService + CommandBus | wip |
| Both utility hosts on the shared worker contract | — |
| Per-document stores | — |
| Command / dialog / settings registries | — |
| Design substrate: tokens, lint rules, `docs/UI-GUIDE.md`, 4 primitives | — |
| i18n scaffold + literal-string lint rule | — |
| Logging + crash reporter consent | — |
| CI: typecheck, lint, unit, proofs (Windows + Linux) | **done** |
| CI: Playwright smoke + axe on the browser shim | — |
| Packaging skeleton for both flavors + installer size arithmetic | — |
| Packaging test — asserts, against a **built application** rather than a source tree, that (a) the unpacked `.node` addon is found through `process.resourcesPath` from `app.asar.unpacked`, and (b) `NOTICE` is present in the installed layout. **Blocked:** `electron` is not a dependency yet and there is no packaging configuration, so this cannot be written as anything that runs. It is not a placeholder — nothing is registered for it, per the wired-tools rule. The FTL half is the reason it is a compliance item and not only a robustness one: FreeType's binary-distribution clause requires its disclaimer in the **distribution** documentation, and a `NOTICE` that exists only in this repository does not discharge it. `proof:licences` covers the other half — that the disclaimer is in the file's bytes — so the gap is delivery, not content. | — |
| **Gate:** engine-capability spike — MuPDF/@cantoo rows executed, matrix amended (ADR-0006); PDFium, @signpdf and PDF.js rows pending their stages | **partly done** |
| **Gate:** performance budget assertion — **per-process** peak RSS against the `main` and `mupdf-host` budgets, read from invariant 17's machine-read line rather than restated here or defined as constants ([ADR-0012](DECISIONS/0012-memory-budgets-are-machine-read-from-the-invariant.md)). `npm run perf:gate` runs **both content shapes**, because they are not interchangeable evidence. Measured: image-heavy 199.4 MB → main **1.00×**, host **1.30×**; object-dense 25.1 MB / 127K objects → main **1.00×**, host **3.71×**. The multiple is of the document's cost, above each role's measured baseline, per invariant 17. `proof:perfbudget` mutates the declared line and requires the verdict to follow it, stating no limit of its own. **Owed before this is done:** these are the roles in their own processes, not Electron's, so it must be re-measured when the utility process lands. **The renderer half cannot be asserted at all yet** — invariant 17 declares it provisional and two-term, both unmeasurable until a renderer exists, and asking for its limit throws rather than substituting one; the single figure this row used to carry is recorded in ADR-0007 as the mistake it was, having no derivation. | **partly done** |
| **Gate:** no document-size ceiling is enforced, and the reason is recorded — the ~650 MB ceiling this row used to gate on was a **WASM** ceiling, withdrawn by ADR-0007's correction; natively that file opens in 144 MB and saves incrementally in 4.5 s (ADR-0010, invariant 17). What replaces it is the per-process budget row above, plus invariant 18: a save that fails never loses work. Reinstating a ceiling requires a native measurement showing one exists. | **done** |
| **Gate:** the PreToolUse write guard has been **observed to fire** — recorded in `docs/hook-probe.json`, verified by `proof:hookprobe` and enforced by `check:docs`, which fails if this row is marked done without the evidence. **Observed 2026-08-18T06:45Z:** a `node -e` call was denied by the guard, unprompted, while doing ordinary work. The denial is self-certifying — a session that never loaded the guard cannot be blocked by it — which is why the record accepts it despite the session predating the configuration. | **done** |
| **Exit:** open via FileHandle → render → `rotatePages` + undo → save → one registered dialog, setting and shortcut | — |
