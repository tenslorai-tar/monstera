# ADR-0296 — The renderer is served from its own scheme, and a picture is never dropped silently

- **Status:** Accepted
- **Date:** 2026-11-17
- **Decided by:** the owner's order of 2026-11-17 (*"Fix the class, not this file. All three decoders have to work in
  the real app under its real policy … Measure what the policy refuses in the window and in the worker … Whatever the
  investigation finds gets fixed in this item"*), and this ADR's measurements. The route is this repository's, recorded
  here before the build as B4 requires.
- **Amends:** `docs/ARCHITECTURE.md` §2 (*Renderer hardening*: where the policy is delivered) and invariant 27's
  paragraph on what can trip `style-src` (the window no longer loads a `file://` URL). Invariant 27's directive list is
  **unchanged**.
- **Relates:** [ADR-0019](0019-the-renderers-csp-is-pinned.md) (the pinned policy, whose delivery this moves),
  [ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md) (the second sanctioned raster crossing,
  which the fallback in Decision 4 uses), `docs/ARCHITECTURE.md` §6.1 (the second engine).

## What was measured

A user's PDF drew every page blank and drew correctly in other editors. Each page is one Flate picture whose `/SMask`
is a one-bit `/CCITTFaxDecode` image.

1. **The pictures were dropped whole.** `pdfjs-dist` 6.2.108 decodes every CCITT, JBIG2 and JPEG 2000 picture through
   `WasmImage` alone. `documentView.ts` passed `useWasm: false` and no `wasmUrl`, so the worker imported
   `null` + `jbig2_nowasm_fallback.js`, a file nothing ships. The import failed, the decoder answered *JBig2 failed to
   initialize*, and PDF.js's `Unable to decode image` path sends the worker's image as `null`, which the canvas skips:
   colour data and mask together. `scripts/research/pictureCheck.mjs` on the user's file, the build of `05b9c999`,
   2026-11-17: **0 of 16 pages** drawn as MuPDF 1.28 draws them; every page's ink share 0.000 against MuPDF's 0.064 to
   0.992. The comment beside `useWasm: false` said *the shipped `*_nowasm_fallback.js` decoders are what run*; none had
   shipped since `pdfjs-dist` arrived in `75662ab2` (2026-08-29).

2. **The PDF.js worker ran with no policy at all.** A probe in the pinned Electron 43.8.3, a page and a module worker
   loaded from `file://` with the session's `webRequest.onHeadersReceived` adding the exact `CONTENT_SECURITY_POLICY`,
   as `window.ts` does (2026-11-17, scratch probe; its readings, verbatim in substance):

   | probe | window | worker |
   |---|---|---|
   | `WebAssembly.compile` | refused (`script-src 'self'`) | **allowed** |
   | `import()` of a decoder script from beside the page | allowed | allowed |
   | `new Function` (the control) | refused | **allowed** |

   The header hook logged the page and its scripts, and **no request from the worker**: Chromium loads a `file:`
   worker's scripts without passing them through `webRequest`, so the worker got no header and so no policy. Serving
   every `file:` response through `protocol.handle('file')` instead logged the same set and changed nothing. That
   worker is where PDF.js parses every document a person opens. `75662ab2` measured that the window's policy lets the
   worker *start*; nothing measured the worker's own policy, and its comment's *"measured refused in the window AND in
   a worker"* was not a reading of the worker.

3. **A scheme of the application's own gives the worker the policy.** The same probe served from a privileged
   standard scheme whose handler answers every request with the header: the handler saw the worker's script and its
   imports, and **in the worker** `WebAssembly.compile` and `new Function` were refused while the decoder script's
   `import()` was allowed — the window's readings exactly.

4. **Nothing told anyone.** A dropped picture leaves the page drawn without it and no marker; a page whose draw threw
   is marked `data-failed` on its canvas and shows a person a blank slot.

## Decision

1. **The renderer is served from `monstera://app/`**, a scheme registered privileged (standard, secure, with V8's
   code cache) before the application is ready, whose handler on the window's session is the **one writer** of the
   policy header: every response, the PDF.js worker's and its imports included, carries invariant 27's list. It serves
   only files inside the renderer build, by an allowlist of types, and refuses anything else; `webRequest`'s header hook
   goes, so the header has one writer. The navigation lock pins `monstera://app/index.html`.

2. **PDF.js decodes CCITT, JBIG2 and JPEG 2000 with its JavaScript decoders**, `jbig2_nowasm_fallback.js` and
   `openjpeg_nowasm_fallback.js`, which the renderer build emits beside the bundle at `pdfjs-decoders/` and the
   worker imports from `'self'` (`wasmUrl`). `useWasm` stays `false`. Invariant 27 is unchanged.

3. **A picture PDF.js could not decode is known after the draw**: the page's object table holds that image as `null`,
   which is the worker's own report of a failed decode reaching the drawing side. `drawWithPdfjs` reads it after every
   draw, of a page or of a tile.

4. **What a person sees:** a whole page that dropped a picture is drawn again by the second engine (`document.renderPage`,
   §6.1), at the same size, and that drawing is shown. Where the second engine cannot draw it, or the page is drawn in
   tiles, PDF.js's drawing stays and **the page says on it that a picture could not be shown**. A page whose draw failed
   says so on the page too, where it showed a blank slot. Never a silent drop.

5. **A rendered test fails when PDF.js reports an image it could not decode.** Every rendered case takes `test` from
   one module whose `page` fixture listens to the page and its workers and fails the case on PDF.js's report; a rule
   refuses a rendered case that takes `test` from Playwright directly.

## Rejected

- **The WASM decoders.** They need `'wasm-unsafe-eval'` in `script-src` (reading 2: refused in the window, and in the
  worker once the worker has the policy). That loosens the pinned policy for every script the renderer runs, to make
  three decoders faster; the JavaScript builds are PDF.js's own route for a policy that refuses WebAssembly. What it
  costs in speed is measured after the build and appended here.
- **Keeping `file://` and fixing only the decoders.** It mends the user's file and leaves the worker that parses every
  document without a policy, which reading 2 shows; the owner's order was to fix what the investigation found.
- **`protocol.handle('file')`** to put the header on `file:` responses: measured, the worker's requests do not reach it.
- **A blob worker**, which inherits its creator's policy: it needs `worker-src blob:`, a grant the pin would have to
  argue for, and the worker's own module imports from `file:` would still be answered with no header.
- **Showing the note and not redrawing.** The second engine draws the pictures PDF.js cannot (PDFium decodes all three),
  so a note alone would leave a page worse than the application can draw it.

## Correction, 2026-11-17, before the build — the page is NOT redrawn by the second engine; it says what it lacks

Decision 4's first half is withdrawn, and the rejection above with it, before any of it shipped. **`document.renderPage`
answers a finished page whether or not the second engine decoded the picture**: its answer is the page's pixels and
nothing about what it left out (`channels.ts`), and PDFium's page render reports no picture it could not decode. Since
the JavaScript decoders ship (Decision 2), what PDF.js still cannot decode is a picture whose data is broken, which the
second engine is as likely to drop; redrawn by it, that page would have shown **no note**, the silent drop arriving one
engine further on. *PDFium decodes all three* was asserted, not measured, and does not answer that.

So **every page drawn without a picture says so on the page**: *A picture on this page could not be shown here. It is
still in the file.*, at the page's foot, a tile's draw included; and a page whose draw failed says *This page could not
be drawn in full here*, where it showed a blank slot. A person who wants the other engine has §6.1's setting. A redraw
becomes right the day the second engine's answer can say what it left out; until then a note that is always true is
the better page.

**Not seen** (stated in `renderPage.ts`): an INLINE picture and an image MASK PDF.js cannot decode are warned about and
sent to no object table, so the page cannot say them; a rendered case still fails on either warning (the mask's added
by the stage audit's KKKKKKKKK-3). **And a picture shared between pages is read from the page's own operator list**,
since PDF.js keeps it under the id of the page that first shared it (KKKKKKKKK-1).

The WASM decoders' speed against the JavaScript builds, owed above, is not measured: under the shipped policy the WASM
builds cannot run in the application at all, so there is no comparison to make there, and none was made outside it.
