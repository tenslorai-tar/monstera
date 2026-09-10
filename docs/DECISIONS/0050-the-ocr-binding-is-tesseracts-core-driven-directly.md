# 0050 — The OCR binding is Tesseract's core, driven directly

Accepted 2026-09-10.

## Context

`BUILD-PROMPT.md`:473 names `tesseract.js` for D6 row 2, and the 2026-09-10
amendment made OCR recognition its own concern in §3's matrix with
`tesseract.js` as its writer. Probing that dependency in a scratch tree — the
route this project takes before an adoption — produced the measurements D6 row
2 is built on: 4.8–5.2 s per A4 page at 200 dpi, mean confidence 94, word
geometry present, and no network needed once the models are local.

**It cannot be a production dependency of this build**, and the rule that
refuses it is this project's own. `tesseract.js@7.0.0` declares
`node-fetch@^2.6.9`, which resolves to `node-fetch@2.7.0 → whatwg-url@5.0.0 →
tr46@0.0.3`, and **`tr46@0.0.3` ships no licence file of any kind** while
declaring MIT in its manifest. `scripts/release/generateNotice.mjs` refuses to
render a NOTICE for it, in the words its own header uses: *an SPDX identifier is
not a licence notice — the terms have to travel with the software*. That
generator exists because AGPL compliance requires the third-party terms to reach
the user (`BUILD-PROMPT.md`:813).

The whole chain is otherwise clean. Every declared licence in
`tesseract.js@7.0.0`'s production tree is AGPL-compatible — `bmp-js`, `is-url`,
`zlibjs`, `node-fetch`, `regenerator-runtime`, `whatwg-url` and `tr46` MIT;
`idb-keyval`, `tesseract.js-core` and `wasm-feature-detect` Apache-2.0;
`webidl-conversions` BSD-2-Clause. **This is a missing-text failure and not a
compatibility one**, and saying so matters: a reader who meets *a licence
problem* will assume the harder kind.

One other thing that tree carries is worth recording beside it:
`opencollective-postinstall@^2.0.3`, a package whose entire purpose is a
postinstall script, in a repository that installs with `--ignore-scripts`
deliberately.

## Decision

**The binding is `tesseract.js-core@7.0.0`, driven directly. The wrapper is not
taken.**

`tesseract.js-core` is the package the WASM is actually in. It declares **no
dependencies at all**, ships an `Apache-2.0` LICENSE file, and is the exact
version `tesseract.js@7.0.0` itself depends on (`tesseract.js-core: ^7.0.0`).

### What the wrapper does that we would have to write, measured

Its `src/` is 1,950 lines. What of that is load-bearing for this build:

| what the wrapper provides | what happens here |
|---|---|
| worker orchestration, scheduler, job queue (~600 lines) | **not wanted.** Recognition runs inside the engine host, which is already a separate contained process — invariant 25 is the isolation. A worker inside it would be a second isolation mechanism for the same reason |
| the model CDN, via `node-fetch` | **ruled against.** ADR-0014 constraint 1 makes the language and data directory ours; the models are provisioned by digest (`scripts/provision/tessdata.mjs`) and the host has no network |
| image loading from URLs, paths and data URIs | **not needed.** The raster is MuPDF's, in the same process, as a PNG buffer |
| `bmp-js`, for BMP inputs Leptonica mishandles | **not needed**, same reason |
| `wasm-feature-detect`, to pick a SIMD build | replaced by trying the builds in order and keeping the first that instantiates — a measurement rather than a detection, and it needs no dependency |
| `dump.js`, walking the result into blocks and words | **replaced by the core itself.** `api.GetJSONText()` is the core's own JSON renderer and returns the whole block/paragraph/line/word tree with a `bbox` on every node |

What is left is the call sequence, and it is about sixty lines: instantiate a
core build, write the decompressed model into its Emscripten filesystem, `Init`,
write the PNG to `/input`, `SetImageFile`, `Recognize`, `GetJSONText` and
`MeanTextConf`, `End`.

### The route was measured before it was chosen

`scripts/research/ocrCore.mjs`, 2026-09-10, against the first textless corpus
page rasterised at 200 dpi through MuPDF — the same subject and the same
rasteriser the wrapper was probed with:

| | wrapper (2026-09-10, `7beee3a`) | core direct |
|---|---|---|
| instantiate | 579–1041 ms | **51–83 ms** |
| `Init` | — | 62–65 ms |
| recognise one A4 page | 4.8–5.2 s | **3.8–4.4 s** |
| non-whitespace characters | 2,016 | **2,016** |
| lines / words | 41 / 402 | **41 / 402** |
| words carrying a box | all | **402 of 402** |
| mean confidence | 94 | **94** |

**The character count needed resolving rather than accepting.**
`GetUTF8Text().length` here is 2,435, and the earlier figure was 2,016; printing
both spellings showed the earlier reading was non-whitespace characters, and the
two routes then agree exactly. A discrepancy between two readings of the same
page is either explained or it is a difference nobody has looked at.

### And it hands us two more rows

`TessModule.TessPDFRenderer` is in the core. With `textonly` it produced a
7,010-byte PDF from the same page, and **MuPDF read 109 text spans back out of
it** — which is D6 row 3's invisible selectable text layer and row 5's
searchable-PDF export, from the writer that already holds the characters. Those
rows are not built by this decision; what it records is that they do not need a
third library.

## Rejected

**Ship `tesseract.js` and record the exception in an ADR.** Refused, and not on
judgement. `generateNotice.mjs`:44-45 is written in the imperative — *a package
with no resolvable licence identifier, or no licence text on disk, fails the
run* — and an ADR granting an exception to it is an override standing in for
missing coverage, which is the workaround shape `CLAUDE.md` names and
`MONSTERA_GITLEAKS` is this project's own recorded example of. The substance is
worse than the check: a package whose terms do not travel is the actual failure,
and the generator is only the thing that noticed.

**Widen the generator's family rule.** Its `:391-431` clause lets a per-platform
binary variant take its terms from a family meta-package, on three assertions —
name prefix, same version, same SPDX id. `tr46` is a standalone package, not a
platform variant, so the rule refuses it **correctly**. That rule was already
widened once, for `koffi`'s real publishing shape; widening it again for a
package that simply omits its terms is the rule dissolving.

**Patch the dependency out** — an `overrides` entry or a fork. A maintained
divergence from a published tree, for a package that is in the chain only for a
CDN this build never calls.

**A different OCR binding entirely.** Open, and the founding record contains the
precedent rather than forbidding it: `BUILD-PROMPT.md`:67 is the adoption policy
— *every dependency is licence-checked against AGPL-3.0 before adoption… use
`exceljs`, never `xlsx`* — which is the record replacing a **named** library
because it failed the policy, and :821-822 makes both halves law. Not taken,
because it is not needed: the core is the same Tesseract, from the same authors,
at the version the named binding pins.

**Wait for MuPDF's own OCR API.** ADR-0014's route, and its second ground is
measured false for the engine this application loads (§3's amendment,
2026-09-10). It becomes available after the native reach decided on 2026-09-08
is built, which is 117 API members.

## Consequences

- `packages/kernel` declares `tesseract.js-core@7.0.0`, pinned exactly. It is a
  **kernel** dependency, where `koffi` and `mupdf` are, because that is the
  package that runs it.
- NOTICE renders, and now names `tesseract.js-core@7.0.0 — Apache-2.0` with its
  text.
- §3's matrix row for OCR recognition names this binding. The *where* half of
  that row is unchanged and unaffected: recognition still runs inside the engine
  host, beside the rasteriser that feeds it.
- **A caveat that is stated rather than hidden**: `tesseract.js-core`'s `latest`
  dist-tag is `6.1.2`, not `7.0.0`. Read from the registry, `7.0.0` was
  published at 2025-12-15T02:37:00Z and `6.1.2` at 02:47:16Z — **ten minutes
  later** — so `latest` follows a backport publish rather than saying 7.x is
  abandoned, and `tesseract.js@7.0.0` depends on `^7.0.0`. Pinned exactly, so a
  tag that moves changes nothing here.
- `index.js` in that package falls back to `require('./tesseract-core.asm')`
  where `WebAssembly` is absent, and that file is **not in the package's `files`
  list**. The fallback cannot resolve. Nothing here takes it — the variant is
  required by name — and it is recorded so the next reader does not discover it
  as a runtime failure.
