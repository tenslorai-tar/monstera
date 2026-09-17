# ADR-0076 — Barcodes are zxing-cpp's: read in the engine host, written for the place-image command

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §3, adding a row for reading and generating barcodes.
- **Relates:** [ADR-0044](0044-an-image-reaches-the-engine-the-way-the-document-does.md) (an image
  reaches the engine as the place-image command's bytes),
  [ADR-0070](0070-a-page-image-is-encoded-as-webp-by-libwebps-wasm-in-the-engine-host.md) (a WASM
  codec loaded from its own bytes in the host),
  [ADR-0026](0026-a-declaration-is-not-an-implementation.md) (the barrel discipline that keeps
  `main`'s startup clear of what it does not need).
- **Context:** D10's *barcode generate & read* (`BUILD-PROMPT.md`:506). The owner's answer
  (2026-09-15): a library chosen by licence that both reads and generates, with why recorded.

## The gap

§3 has no row. MuPDF 1.28's C source carries barcode support (`fitz/barcode.h`, built on zint
and zxing-cpp), and **the WASM build the kernel loads exposes none of it**: searched 2026-09-17,
`mupdf.d.ts` names no barcode member and the `.wasm` carries no `fz_*barcode*` symbol.

## Measured, 2026-09-17 (scratch tree and probe, generated fixtures)

1. **`zxing-wasm` 3.1.4** (published 2026-09-10) is zxing-cpp compiled to WebAssembly, reading and
   writing. Its production tree is four packages — itself, `type-fest` 5.10.0, `tagged-tag` 1.0.0,
   `@types/emscripten` 1.41.6 — each MIT (or MIT OR CC0-1.0) and each shipping its licence text;
   `npm audit` reports no vulnerability.
2. **What is inside the `.wasm`** is zxing-cpp at commit `0b2d9a8f` (the package's submodule at the
   `v3.1.4` tag), Apache-2.0, and zint 2.16.0's library backend (commit `55541e13`, zxing-cpp's
   submodule; `libzint` strings in the binary), BSD-3-Clause — zint's GPL front ends are not part
   of the library. **The package ships only its own MIT text**, so both nested texts are committed
   and rendered, as libwebp's owes.
3. **Round trip.** In plain Node with the `.wasm` handed in as bytes: a QR code, a Code 128 and a
   Data Matrix each written as PNG, placed on a PDF page, the page rasterised by MuPDF at 150 dpi,
   and each read back from the raster with its exact text. A blank page read none (the control).
   The first Code 128 run read nothing: the fixture drew the 748-point image off a 612-point page.

## Decision

1. **Barcodes are zxing-cpp's, through `zxing-wasm`**, loaded from the package's own `.wasm` bytes
   — no fetch, as ADR-0070 loads libwebp.
2. **Reading runs in the engine host.** The raster is a document's pixels, and a crafted image is
   input to a C++ decoder, so it is decoded where invariant 25 contains the rest of the document.
   A page is rasterised by MuPDF in the host and read there; `main` receives formats, text and
   boxes, bounded.
3. **Generating runs in `main`, lazily, and feeds the place-image command.** Its input is the text a
   person typed, not a document, so it is not parsing; the PNG it makes is the `bytes` of
   ADR-0044's `placeImage` command, placed by the same box gesture as an image or a signature. The
   module loads on first use, so it is not part of `main`'s startup (ADR-0026's barrel discipline).
4. **The notice renders zxing-cpp's and zint's texts** beside the package's own.

## Rejected

- **Binding MuPDF's own barcode support.** It is in the native build only; reaching it is the native
  migration recorded as decided and not built.
- **`bwip-js`** generates and does not read, so a second library would read.
- **`@zxing/library`** (0.23.0) is a TypeScript port of the Java ZXing; it was not measured, since
  `zxing-wasm` met both needs with zxing-cpp itself.
- **Reading in `main`.** A document's pixels decoded by native-compiled code outside containment.

## Consequences

- §3 gains the row and the amendment log a line; the index gains a row.
- The adoption commit adds the dependency with its licence check, audit and need, and the two nested
  texts to the notice.
- The feature commit adds the host read channel, the reader and writer modules, the barcode
  placement tool and its dialog, and the read command and its dialog.
