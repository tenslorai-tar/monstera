# Engine capability spike — plan and evidence

**Status: executed 2026-08-16. Results are at the bottom of this file; the
matrix in ARCHITECTURE §3 has been amended to match
([ADR-0006](DECISIONS/0006-engine-capability-spike-results.md)).**

The hypotheses below are kept as written *before* the spike ran, deliberately.
They came from reading `mupdf@1.28.0`'s shipped `dist/mupdf.d.ts` and npm
registry metadata — and comparing them against what executing actually found is
the argument for §3.1 in concrete form. Type definitions prove an API is
*declared*; they do not prove it works, that it produces a correct PDF, or that
another reader accepts the output. H1 below reads as a straightforward win for
MuPDF's `rearrangePages`. Executing it showed the call silently destroys forms.

Each row is exercised by one throwaway script against a real document, and its
output is re-opened and verified — by a *different* reader where that is the
point of the test.

---

## The findings that change the matrix, if they hold

The founding matrix assigns **four** rows to pdf-lib. Two of its stated
justifications appear to be false, and pdf-lib itself appears to be abandoned.

### H1 — MuPDF has a first-class page reorder primitive

The matrix says page reorder goes to pdf-lib because *"MuPDF WASM has no reorder
primitive (only delete/insert/graft)"*.

`PDFDocument.rearrangePages(pages: number[])` is declared at `mupdf.d.ts:551`.

**Critical semantics to verify:** it is MuPDF's page-*selection* primitive — the
engine behind `mutool`'s page selection. It rewrites the page tree to contain
exactly the pages listed, in the order given, so **omitting an index deletes
that page**. It is reorder, subset and delete in one call. If adopted, the
command must always pass a full permutation unless deletion is intended, and
that constraint belongs in the type, not in a comment (B5).

**Must also verify — this is the whole reason invariant L6 exists:** that
`rearrangePages` rewrites `/Kids` in place and does **not** rebuild into a new
document, because rebuilding drops `/AcroForm`, `/Outlines`, `/Names` and
`/OCProperties`. Test with a document carrying all four, reorder, and confirm
every one survives. Page labels (`setPageLabels` / `deletePageLabels`) need
fixing up after a reorder and are part of the test.

### H2 — MuPDF can flatten form fields

The matrix says flatten goes to pdf-lib because *"MuPDF WASM 1.28 exposes no
createWidget and no flatten"*. The flatten half appears wrong.

`PDFDocument.bake(bakeAnnots?: boolean, bakeWidgets?: boolean)` is declared at
`mupdf.d.ts:553` — `bakeWidgets` flattens form fields into page content,
`bakeAnnots` flattens annotations, both defaulting on.

Verify that a baked field renders identically to its pre-bake appearance and is
no longer present in the AcroForm tree.

### H3 — MuPDF genuinely cannot create new form fields

The matrix's other half appears **correct**, and this is the one real gap.
`createWidget`, `addWidget`, `newWidget`, `createField`, `addField` and
`newField` return zero matches across both `dist/mupdf.d.ts` and the
`dist/mupdf.js` bundle. `PDFWidget` is read-and-fill only.

Partial escape hatch to evaluate: `"Widget"` *is* a member of
`PDFAnnotationType`, so `createAnnotation("Widget")` creates the annotation
object — but nothing in the API sets field type, name or default value, or
registers it in the AcroForm `/Fields` tree. Doing that by hand through the
low-level `PDFObject` API is possible, unsupported, and an easy way to produce
output that different readers disagree about. **Adobe Acrobat and PDF-XChange
must both be checked against any such output**, since "renders in our own
viewer" is not evidence.

### H4 — pdf-lib is unmaintained, and the matrix depends on it

Last release **1.17.1 on 2021-11-06**; last commit 2021-11-12; 317 open issues;
repository not archived, which makes it read healthier than it is. Nearly five
years cold.

This is a supply-chain exposure, not a style objection: an AGPL desktop
application will be handed arbitrary, sometimes hostile, user PDFs, and a parser
with no security-fix channel is in the blast radius.

If H1 and H2 hold, pdf-lib's remaining jobs are **new form field creation** and
**content composition** (new document generation, watermarks, headers/footers,
Bates numbering, OCR text-layer embedding). Candidate replacement to evaluate:
**`@cantoo/pdf-lib` 2.8.3** — MIT, published 2026-08-14, actively maintained, a
2.x fork with the same `createTextField` / `createCheckBox` / `form.flatten`
shape plus encryption and SVG. Its API surface was **inferred from it being a
fork, not read from its own types** — pull the tarball and confirm signatures
before committing to it. `pdf-lib-plus-encrypt` is dead since January 2023 and
is not a candidate.

### H5 — MuPDF ships a journal and incremental save

`enableJournal`, `beginOperation` / `endOperation` / `abandonOperation`,
`canUndo` / `canRedo`, `undo` / `redo`, `getJournal`, plus
`canBeSavedIncrementally`, `countUnsavedVersions`, `hasUnsavedChanges`.

This bears directly on §4, which specifies a command log with checkpoints. The
spike must establish whether MuPDF's journal can *back* that design without
becoming a second undo authority — two undo stacks would be a B3 violation of
the worst kind. The default assumption remains §4's command log; MuPDF's journal
is evaluated as an implementation detail beneath it, never as a parallel one.

---

## Rows to execute

Every row of the §3 matrix, each producing a real file that is re-opened and
checked.

| # | Row | What executing it must prove |
|---|---|---|
| 1 | Rendering / text layer (PDF.js) | `page.render({ canvas, viewport })` renders a rotated, cropped page correctly; the four runtime asset dirs resolve |
| 2 | Page tree ops (MuPDF) | delete / insert / extract / merge / split / crop / resize each survive reopen |
| 3 | **Page reorder** | H1 — in-place `/Kids` rewrite; AcroForm, Outlines, Names, OCProperties all survive |
| 4 | Annotations (MuPDF) | create / setRect / setInkList / setQuadPoints / setAppearance / update across the subtypes D3 needs |
| 5 | Form fill (MuPDF) | values persist and render after reopen in a third-party reader |
| 6 | **Form field create** | H3 — establish definitively that MuPDF cannot, and that the chosen alternative can |
| 7 | **Form flatten** | H2 — `bake(false, true)` flattens fields, appearance preserved |
| 8 | Metadata / outline / encryption / redaction / optimize (MuPDF) | each round-trips; redaction genuinely removes content, verified by text extraction, not by looking at the page |
| 9 | Print / export rasterisation (MuPDF) | renders at a chosen DPI |
| 10 | Text editing, styled runs, HD render (PDFium) | incremental save only — a full rewrite corrupts non-embedded font refs (K.1) |
| 11 | Content composition (pdf-lib / @cantoo) | new document generation and drawing onto existing pages |
| 12 | Signatures (@signpdf) | PKCS#7 detached; verification reads back CN, org, validity, byte-range hash |

## Environment findings to confirm while spiking

Collected during research; each is a claim to verify empirically on first build,
not a fact yet.

- **`mupdf` is ESM-only** — `"type": "module"` with no `require` condition in its
  exports map. A CJS `require("mupdf")` in the Electron main process fails.
- **`mupdf`'s `.wasm` must be asar-unpacked** or the instantiate path fails at
  runtime. It also ships `.br` precompressed variants that should not go to a
  local-file loader.
- **MuPDF is synchronous WASM** and must run off the UI thread — which C2
  already mandates via `mupdfHost`.
- **pdfjs-dist 6 ships four runtime asset dirs** that are not bundled into the
  worker and must be copied and pointed at: `wasm/` (`wasmUrl`), `cmaps/`
  (`cMapUrl`, with `cMapPacked: true`), `standard_fonts/`
  (`standardFontDataUrl`), `iccs/` (`iccUrl`) — each needs a trailing slash.
  A missing `wasmUrl` **silently degrades** JPX/JBIG2/ICC handling; a missing
  `cMapUrl` breaks CJK. Both are exactly the kind of silent degradation the
  fixture corpus must catch.
- **pdfjs-dist 6 removed `PDFDocumentProxy.destroy()`** — invariant L7 ("every
  replaced PDF.js proxy is destroyed") must be implemented with
  `loadingTask.destroy()` and `cleanup()`.
- **koffi resolves its native binary at runtime** via a computed `require`, so no
  bundler can analyse it. `koffi` and `@koromix/*` must be marked external and
  asar-unpacked. Failure mode is the verbatim error *"Cannot find the native
  Koffi module; did you bundle it correctly?"*
- **koffi is Node-API v8**, so one `koffi.node` works across Node and Electron
  versions — no `electron-rebuild` per upgrade. This is the main reason it is
  preferred over `ffi-napi`.
- **koffi 3.0 was breaking**: pointers are now `BigInt` rather than externals,
  and `koffi.type()` replaces `koffi.introspect()`. Most examples predate this.
- **PDFium build variant is a decision with a size consequence.** The default
  `pdfium-win-x64` is built `pdf_enable_v8=false`, `pdf_enable_xfa=false` —
  7.3 MB. The V8 build is **31.5 MB** and embeds a JavaScript engine in the
  attack surface. Against the < 150 MB installer budget, the hybrid worth
  evaluating is: ship non-V8 PDFium for rendering and editing, and use PDF.js's
  own `quickjs-eval.wasm` sandbox for AcroForm field scripts.
- **Pin the PDFium release tag** (e.g. `chromium/7999`) and verify against the
  published attestation. bblanchon rebuilds weekly, so tracking "latest" means a
  silent Chromium bump mid-development.
- **PDFium bundles thirteen third-party licences** (abseil, agg23, fast_float,
  freetype, icu, lcms, libjpeg_turbo, libopenjpeg, libpng, libtiff, llvm-libc,
  simdutf, zlib) which all must appear in the generated NOTICE.
- **Do not judge `mupdf` currency by GitHub releases** — `ArtifexSoftware/mupdf.js`
  has a stale feed returning `v0.3.0` from 2024. npm is the live channel. The
  C library is at 1.28.2 while npm ships 1.28.0, so the online docs may describe
  APIs the package does not yet have.

## Results — 2026-08-16

Run with `npm run proof:engines`. Against `mupdf@1.28.0` and
`@cantoo/pdf-lib@2.8.3`, on a self-generated 6-page fixture carrying
`/AcroForm`, `/Outlines`, `/Names`, `/OCProperties` and a foreign annotation.

| Case | Verdict | Evidence |
|---|---|---|
| H1 `rearrangePages`: page order | CONFIRMED | 1 2 3 4 5 6 → 6 5 4 3 2 1 |
| H1 `rearrangePages`: catalog survives (L6) | **REFUTED** | **loses `/AcroForm`**; keeps the other three |
| H1b `rearrangePages`: omitted indices delete | CONFIRMED | 3 of 6 indices → a 3-page document |
| H1c in-place rewrite on a **flat** tree | CONFIRMED | correct order, all four entries preserved |
| H1d naive `/Kids` reversal on a **nested** tree | **REFUTED** | permutes subtrees: gives `4 5 6 1 2 3`, not `6 5 4 3 2 1` |
| H1e in-place reorder on a **nested** tree | CONFIRMED | correct order, inherited `/Rotate` follows its pages, `/AcroForm` kept |
| H2 `bake(false, true)`: flattens widgets | CONFIRMED | widgets 2 → 0, `/AcroForm` removed |
| H3 no widget creation in MuPDF | CONFIRMED | no create/add method on `PDFDocument` or `PDFPage` |
| H4 `@cantoo/pdf-lib` creates fields MuPDF reads | CONFIRMED | MuPDF reads back `spike.created:text = "made by @cantoo"` |
| H5 journal: undo restores a deleted page | CONFIRMED | `canUndo=true`, 6 pages after undo |
| Annotations: create + persist through save | CONFIRMED | Highlight present after reopen |
| srcRef: foreign annotation survives a save | CONFIRMED | the Square is intact after a round trip |

### The finding that changed the architecture

`rearrangePages` drops `/AcroForm` **even for the identity permutation**, so
merely calling it destroys a form. A plain save with no reorder preserves it,
which isolates the cause to the primitive rather than the save pipeline. The
widget annotations survive on their pages, which is worse than losing them
outright: the fields still render while the field tree is orphaned, so the
document silently stops being a valid AcroForm.

Rewriting the `/Kids` array in place through MuPDF's `PDFObject` API — exactly
what invariant L6 already prescribed — reorders correctly and preserves all
four entries. **The founding record predicted this failure class; only its
stated reason was wrong.**

Recorded as [ADR-0006](DECISIONS/0006-engine-capability-spike-results.md). The
matrix in ARCHITECTURE §3 is amended and §3.1's provisional status is lifted.

### The second finding, from re-verifying the first

The in-place rewrite was initially proven only against a **flat** page tree and
written up as "rewrite `/Kids`, touching nothing else". That is wrong on a
**nested** tree in two ways, neither visible on a flat one: it permutes
subtrees rather than pages, and it drops attributes the leaves inherit from
intermediate `/Pages` nodes — turning a landscape page portrait while the page
*order* still looks correct.

The correct algorithm pushes inheritable attributes (`/Resources`, `/MediaBox`,
`/CropBox`, `/Rotate`) down onto each leaf **before** flattening, then rebuilds
`/Kids`, fixes `/Count`, reparents, and resets MuPDF's page-tree cache. Kept as
`scripts/spike/reorderInPlace.mjs` and proven against both tree shapes.

This is the same lesson as the first finding, one level down: an approach
verified against the easy shape is not verified.

### Still to execute

These rows are unblocked but not yet exercised, and remain provisional:
PDFium text editing and HD render (needs the koffi FFI host), signatures via
`@signpdf`, print/export rasterisation at DPI, and the PDF.js render path with
its four runtime asset directories. Each is executed as its stage arrives, and
its result appended here.
