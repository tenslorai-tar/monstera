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
| Text extraction (layout-preserving when Poppler available) | — |
| Word (rich / layout / text modes) | — |
| PowerPoint | — |
| Excel: table detection (automatic / force-OCR / local handwriting / Azure) | — |
| Excel: editable review grid | — |
| Excel: styled output with real fonts, fills, borders, merges, number formats | — |
| Excel: combine-pages option | — |
| Email document | — |
| Print (MuPDF raster at chosen DPI to system dialog — never print the DOM) | — |
| PDF/A-2b export (honest blocker reporting) | — |
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
| Pre-commit guards (secret scan, file policy) + CI mirror + proofs | **done** |
| Pinned-hash binary provisioning primitive | **done** |
| Governing documents (ARCHITECTURE, CLAUDE, README, CONTRIBUTING, SECURITY, ADRs) | **done** |
| Monorepo workspaces + enforced import boundaries | wip |
| Contract codegen pipeline | — |
| DocumentService + CommandBus + FileHandles | — |
| Both utility hosts on the shared worker contract | — |
| Per-document stores | — |
| Command / dialog / settings registries | — |
| Design substrate: tokens, lint rules, `docs/UI-GUIDE.md`, 4 primitives | — |
| i18n scaffold + literal-string lint rule | — |
| Logging + crash reporter consent | — |
| CI: typecheck, lint, unit, proofs, Playwright smoke + axe on the browser shim | — |
| Packaging skeleton for both flavors + installer size arithmetic | — |
| **Gate:** engine-capability spike proving every C3 matrix row, recorded as an ADR | — |
| **Gate:** performance budget assertion (200 MB fixture, peak RSS < 1.5× file size, IPC bounded) | — |
| **Exit:** open via FileHandle → render → `rotatePages` + undo → save → one registered dialog, setting and shortcut | — |
