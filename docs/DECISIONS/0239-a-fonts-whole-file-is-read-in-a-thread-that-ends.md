# ADR-0239 — A font's whole file is read in a thread that ends

- **Status:** Accepted
- **Date:** 2026-10-14
- **Extends:** the catalogue's thread (`fontCatalogueApart.ts`, the owner's Part 7 A of run 3) to the other two places a
  host reads a font's whole file through HarfBuzz: an edit setting words in a catalogue face, and a composition. ADR-0172
  (one font resolver) and ADR-0173 (an edit's word in the resolver's face) are unchanged in what they decide.
- **Decided by:** the owner's cloud run 4, Part 2 item 12: *"The font library leak on every embedded font (run 3
  measured 20 uses of a 16 MB font holding 345 MB). Use the same answer as the font list: shape and subset in a thread
  that ends, or another mechanism that leaves nothing behind. Measure it."*

## Where it stood

harfbuzzjs 1.6.2 frees its WebAssembly memory only from a `FinalizationRegistry`, `referenceTable` keeps the whole
font's blob, and WebAssembly memory never shrinks. The catalogue was moved to a thread that ends for exactly that
reason. Two other paths read whole files the same way and stayed in the host:

- **An edit's word in a catalogue face** (`pdfiumFfi.ts`, `faceFont` and `boxFontLike`): the face's whole file through
  `readFace` for its name, then `namedSubset` or `boxFont` over the whole file, per face and command.
- **A composition** (`composeFonts.ts`, Markdown and CSV): a `ShapingFace` of each face's whole file for the life of the
  composition, its shaping and its `CidFont` subset.

## Measured, 2026-10-14

`scratchpad/hbleak` (this container, `node --expose-gc`, its resolution checked against a 16 MB fill and its positive
control against one blob of the font), 20 uses of the edit path over Noto Sans CJK Regular (18.6 MB):

| | resident after 20 uses | HarfBuzz memory | per use |
|---|---|---|---|
| in the host | +496 MB, and rising with every use | 418 MB, never returned | about 32 ms |
| a thread per use | +147 MB while running, +96 MB once every thread ended | the thread's, gone with it | 167 ms (20 of it loading HarfBuzz) |

## Decision

1. **One runner of work in a thread that ends** (`apart.ts`), synchronous for synchronous callers (`Atomics.wait` and
   `receiveMessageOnPort`, the catalogue's shape) and asynchronous for asynchronous ones; the catalogue's thread is
   rewritten onto it, so there is one way a host does this (B3a).
2. **An edit's face program is made apart**: the whole file goes to the thread, which answers the face's name and the
   subset (or the box font) the edit loads into PDFium; everything after that works on the small program, as before.
3. **A composition runs apart, whole**: the compose host's Markdown and CSV composers run in a thread that ends with
   the composition, so every face it shaped, every subset it made and every buffer pdf-lib held go with it.
4. **The cost is paid where it was measured to be acceptable**: about 135 ms more per face an edit loads (an edit loads
   a face only for a word the page's font cannot carry), and once per composition.

## Rejected

- **Freeing harfbuzzjs's objects by hand.** It has no `destroy()`; its frees run from a finaliser, which cannot run
  inside the synchronous loops these paths are, and the memory they would free is not returned to the system anyway.
- **One long-lived font thread.** It would hold the same memory in another isolate, for the host's whole life.
- **A HarfBuzz build without the leak.** The wrapper is outside this repository; the thread's end releases whatever it
  kept, including what a later version might keep.

## Consequences

- A host's memory after an edit or a composition no longer grows with the fonts it used.
- A worker entry ships beside the host (`shippedModules.mjs` lists each one a host loads by path).
