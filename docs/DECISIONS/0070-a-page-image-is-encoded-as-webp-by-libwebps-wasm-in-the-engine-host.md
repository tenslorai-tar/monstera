# ADR-0070 — A page image is encoded as WebP by libwebp's WASM, in the engine host

- **Status:** Accepted
- **Date:** 2026-09-16
- **Amends:** `docs/ARCHITECTURE.md` §3 — a new writer-of-record row, *Page image → WebP encoding*.
- **Relates:** [ADR-0050](0050-the-ocr-binding-is-tesseracts-core-driven-directly.md) (a WASM core driven directly, in
  the host), §3's *Print & export rasterisation* row (the pixels this encodes).
- **Context:** D10 *Pages → PNG / JPEG / WebP*. PNG and JPEG were built 2026-09-14 and WebP was blocked on an encoder.
  The owner chose the package on 2026-09-16: *"use `@jsquash/webp` (WASM) … Do not promote `sharp` to production."*

## The gap

The row names three formats and this build could write two. MuPDF 1.28.0's pixmap has `asPNG` and `asJPEG` and no WebP
writer, and Electron's `nativeImage` encodes PNG and JPEG only (both read 2026-09-14). So *turn a page's pixels into
WebP bytes* was a concern with no writer of record, and a feature without a writer is B4, not a branch.

## Decision

1. **`@jsquash/webp`'s encoder writes WebP.** It is libwebp compiled to WASM, from the Squoosh codecs. The export
   rasteriser is unchanged: MuPDF draws the page into a pixmap exactly as for PNG and JPEG, and this row only encodes
   those pixels. No second rasteriser.
2. **It executes in the engine host, beside the rasteriser**, for OCR recognition's reason (§3): its input is a bitmap
   this build produced, not document bytes, so containment is unchanged, and encoding in place keeps the page's RGBA
   buffer off the pipe — four bytes a pixel, up to `MAX_SNAPSHOT_PIXELS` (32,000,000 in `pageSnapshot.ts`), so up to
   128 MB for one page.
3. **The package's own `.wasm` bytes are read from disk and handed to its `init` as Emscripten's `wasmBinary`.**
   Measured 2026-09-16 in a scratch tree on Node 24.12.0: the package's default loader **fails** under Node
   (`TypeError: fetch failed`), because its Emscripten glue fetches the `.wasm` by URL. Two routes around it both
   encode a 64×48 image to a `RIFF…WEBP` file the package's own decoder reads back at 64×48: a compiled
   `WebAssembly.Module` passed to `init`, and the bytes passed as `wasmBinary`. **The bytes route is the one taken**,
   because this build's TypeScript libraries are ES2023 and Node's, which declare no `WebAssembly` value — the module
   route could not be written without widening every kernel file's library set to reach one constructor, and the
   bytes route leaves compiling to the glue that already does it. Which of the two encoder builds (SIMD or not) is chosen by
   `wasm-feature-detect`'s `simd()` — the detector the package itself calls — so this build holds no opinion about it
   (B3a). The files sit under `node_modules`, which provisioning already grants the host; nothing is fetched.
4. **Quality is the request's existing `quality`, 1–100**, which libwebp's `quality` option takes on the same scale.

## Rejected

- **Promoting `sharp`.** It is already a development dependency; in production it would be a native module carrying its
  own libvips — a second image stack beside MuPDF — and the owner said it must not reach production.
- **Encoding in `main`.** Moves the page's buffer across the pipe for no gain: the pixels are ours either way.
- **A WebP writer of our own.** A second opinion about libwebp's format, with no reference encoder to compare against.
- **Leaving WebP out of the row.** The founding record names it; dropping a format to avoid a dependency is the owner's
  call, and the owner made the other one.

## Evidence

A probe run in a scratch tree outside the repository, 2026-09-16, because a dependency is installed only in its own
adoption commit: the default route throws `fetch failed` inside `instantiateAsync`; the module route prints `RIFF WEBP`,
272 bytes, decoded 64×48; the `wasmBinary` route prints `RIFF WEBP`, decoded 64×48. The probe is committed with the
dependency, and the adoption commit records the licence check and the audit.
