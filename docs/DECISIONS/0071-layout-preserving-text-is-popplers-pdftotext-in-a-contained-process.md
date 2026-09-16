# ADR-0071 — Layout-preserving text is Poppler's `pdftotext`, run as a contained separate process

- **Status:** Accepted
- **Date:** 2026-09-16
- **Amends:** `docs/ARCHITECTURE.md` §3 — the *Text extraction, plain and layout-preserving* row's layout half, which
  read *NO WRITER, and choosing one is the owner's*.
- **Relates:** [ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md) (stands, not
  amended), [ADR-0013](0013-pdfa-export-and-text-extraction-engines.md) (dropped *"layout-preserving when Poppler
  available"* as a conditional; this makes Poppler a pinned writer instead),
  [ADR-0063](0063-an-office-file-is-converted-by-a-pinned-libreoffice-in-a-contained-process.md) (the external-converter
  seam, and the contained launcher's `converter` kind this reuses).
- **Context:** the owner's decision of 2026-09-16: *"OPTION 1, POPPLER, owner-approved"*, through the external-converter
  seam, with conditions to be met before any feature line. This ADR is where each condition is answered.

## The gap

`BUILD-PROMPT.md` D10 names text extraction, layout-preserving. ENGINE-SPIKE H7 (2026-09-14) found MuPDF's lines right on
every fixture and **no layout output** under any option the engine names; a row grid over those lines is the clustering
ADR-0034 keeps out of the kernel, and it failed a `/Rotate 90` page laid out in display space. So the layout half had no
writer. Plain extraction stays MuPDF's and stays done.

## Decision

1. **`pdftotext -layout`, from Poppler 26.09.0, writes layout-preserving text.** Poppler's own text output places each
   line by its geometry; this build adds no grid and no clustering, so ADR-0034 is unchanged.
2. **It runs as a separate process and is never linked.** It is spawned through the contained launcher's `converter`
   kind (`containedProgram.ts`): an AppContainer and a one-process job, granted only the input file's snapshot directory
   and the output directory. Nothing of Poppler loads into `main`, the renderer or an engine host.
3. **The build is conda-forge's**, pinned per package by SHA-256, and only the executable and the DLLs it loads are
   provisioned — see *The exact build*.
4. **Its terms travel with it.** The licence notice names Poppler and every library in the closure with its licence
   text, and carries a written offer of the corresponding source, in the commit that adopts it.

## The exact build

`win-64/poppler-26.09.0-h924501e_0.conda` from conda-forge, sha256
`bb319f6881d91e175f90a9d33a25313e4cfddc15dd234521519985baf92fefcd`, uploaded 2026-09-08, built by
`conda-forge/poppler-feedstock` from the Poppler 26.09.0 source release at `poppler.freedesktop.org`
(`poppler-26.09.0.tar.xz`, sha256 `8059eadb6805340768f138c465b57f8164c92b4a0773c37ef031ea6c0d987b2e`, which publishes a
detached `.sig`). The dependency set is conda-forge's own solve for exactly that build (`micromamba` 2.9.0, dry run,
2026-09-16), each package pinned by the sha256 the channel publishes. **conda-forge publishes no signature for a
package**; the channel's sha256 is the verification available, and this records it rather than implying more.

The files `pdftotext.exe` loads were read with `dumpbin /dependents`, transitively, against the extracted packages:

| file | conda-forge package | licence (the package's own text) |
|---|---|---|
| `pdftotext.exe`, `poppler.dll` | poppler 26.09.0 `h924501e_0` | GPL-2.0-or-later; the xpdf-derived code GPL-2.0 or GPL-3.0 |
| `freetype.dll` | libfreetype6 2.14.3 `hdbac1cb_2` | FTL, or GPL-2.0-or-later — taken under the FTL |
| `lcms2.dll` | lcms2 2.19.1 | MIT |
| `Lerc.dll` | lerc 4.2.0 | Apache-2.0 |
| `libcurl.dll` | libcurl 8.22.0 | curl |
| `deflate.dll` | libdeflate 1.25 | MIT |
| `jpeg8.dll` | libjpeg-turbo 3.2.0 | IJG AND BSD-3-Clause AND Zlib |
| `liblzma.dll` | liblzma 5.8.3 | 0BSD |
| `libpng16.dll` | libpng 1.6.58 | libpng |
| `psl-5.dll` | libpsl 0.23.1 | MIT |
| `libssh2.dll` | libssh2 1.11.1 | BSD-3-Clause |
| `tiff.dll` | libtiff 4.7.2 | libtiff |
| `zlib.dll` | libzlib 1.3.2 | Zlib |
| `openjp2.dll` | openjpeg 2.5.4 | BSD-2-Clause |
| `libcrypto-3-x64.dll` | openssl 3.6.4 | Apache-2.0 |
| `icuuc78.dll`, `icudt78.dll` | icu 78.3 | Unicode License v3 |
| `zstd.dll` | zstd 1.5.7 | BSD-3-Clause |
| `MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll` | vc14_runtime 14.51.36247 | Microsoft Visual C++ redistributable terms |

Twenty-two files. Every package but `libfreetype6` ships its licence text under `info/licenses`; FreeType's
`LICENSE.TXT`, `docs/FTL.TXT` and `docs/GPLv2.TXT` come from its `VER-2-14-3` tag. Poppler's package carries `COPYING`
(GPLv2) only, byte-identical to the source release's, and `COPYING3` comes from that release. The `poppler-windows` zip
for the same version (below) loads the same twenty-one DLLs from its `pdftotext.exe`, read the same way — the
cross-check that the solve is the build that project ships.

## The licence chain

- **Poppler**: the Glyph & Cog (xpdf) files are *GPL version 2 or 3*, and every Poppler change is *GPL version 2 or
  later*, per each source header (for example `utils/pdftotext.cc`). Taken under GPL-3.0, with which AGPL-3.0 §13 is
  compatible.
- **FreeType**: conda-forge's package index reads `GPL-2.0-only`, and that is **a truncation**. The recipe reads
  `GPL-2.0-only OR FTL`, and FreeType's own `LICENSE.TXT` offers two mutually exclusive licences, the FreeType License or
  GPLv2 where *"any later version can be used also"*. Taken under the FTL, which requires crediting the FreeType project
  in documentation.
- **So no GPL-2.0-only component is in the chain** — the owner's stop condition, checked against each licence's own
  text rather than an index field, because the index field alone would have stopped this row wrongly.
- Every other library in the closure is permissive, and none of the environment's LGPL-2.1-only libraries (`cairo`,
  `libiconv`) is loaded by `pdftotext.exe`, so neither is provisioned.
- Separate process: Poppler's GPL does not reach this application's code by linkage. Distributing the binary still
  obliges the licence texts and the offer of source, which is why the adoption commit carries both.

## Measured in containment, before this was written

A scratch instrument over the product's own launcher (`createWin32HostSurface` with `runs: 'converter'`), 2026-09-16,
on the twenty-two files staged from the extracted packages:

| cell | result |
|---|---|
| contained, stage granted RX to `ALL APPLICATION PACKAGES`, input in the granted pair | exited; wrote `T1`, `T2`, `T3` page by page |
| uncontained, same | the same text |
| **control**: contained, stage NOT granted | exited, wrote nothing — so the first cell ran inside a container |
| **control**: contained, input OUTSIDE the granted pair | `I/O Error: Couldn't open file …`, nothing written |
| the same outside path, uncontained | read and extracted |

So `pdftotext` starts under the one-process job — it spawns no child, unlike LibreOffice's front ends (ADR-0063) — and
reaches only what it was handed. The instrument is committed with the provisioning.

## Rejected

- **A grid of our own over MuPDF's lines**, amending ADR-0034. The owner rejected it; H7 measured it failing a rotated
  page, and it is the clusterer ADR-0034 keeps out of the kernel.
- **Plain text only.** Leaves D10's named feature unbuilt.
- **Linking Poppler**, a native binding inside a host. It would put a large C++ parser into a process that holds
  documents, and make Poppler's GPL a question about this build's linkage; a separate process holding one file, with no
  network, is smaller on both counts.
- **The `poppler-windows` zip** (v26.09.0-0, sha256 `7a6f256a…c8d0`, matching its GitHub digest). It repackages the same
  conda-forge build but copies every DLL of an unpinned environment — 143 files in `Library/bin` — and ships none of
  their licence texts, so neither the versions nor the terms of what it carries could be stated.
