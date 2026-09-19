# ADR-0087 — Optimize is MuPDF's own image rewriter, reached natively, in the compose host, as a copy

- **Status:** Accepted
- **Date:** 2026-09-19
- **Decided by:** the owner, in the reviewing seat's block of 2026-09-19 (*"Optimize: MuPDF's own
  image rewriter, native, through the shim with koffi, from the contained host (B4 first if
  needed)"*), and the owner's answer of 2026-09-16 (*the person chooses image quality, the sizes
  before and after are shown, and a result larger than the input is never saved*).
- **Amends:** `docs/ARCHITECTURE.md` §3 — the matrix's *optimize* row keeps MuPDF as the writer and
  gains its **reach**; the first product consumer of `monstera_mupdf.dll`.
- **Keeps:** [ADR-0010](0010-native-mupdf-through-an-ffi-shim.md)'s decision (native, koffi) and
  its unbuilt migration for the document pipeline, which this does not begin;
  [ADR-0060](0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)'s
  compose host, unchanged in what it holds.

## Why a B4

The row was blocked on its writer (FEATURES, 2026-09-17): §3 names MuPDF for *optimize*; lossless
save options measured **+0.8%** over the corpus, so the size comes from recompressing images; and
MuPDF's image rewriter, `pdf_rewrite_images`, is in its C source and **not bound in the WASM build
the kernel loads**. Reaching it means loading the native library, which nothing in the product
does today. Where that happens, and against which bytes, is not a registration into an existing
seam.

## What was measured, 2026-09-19

`scripts/research/imageRewrite.mjs`, against MuPDF 1.28.0 through two new shim exports —
`mz_rewrite_images` (lossy images re-encoded as JPEG at a chosen quality, lossless images kept
lossless, colour and grey images subsampled above a DPI threshold, bitonal images left alone, a
new stream kept only when smaller) and `mz_save_compacted` (garbage level 3, compressed streams,
**object streams on**) — over the owner's eleven-document corpus, at three settings:

| setting | JPEG quality | subsample | corpus bytes | tagged documents keeping their tree |
|---|---|---|---|---|
| high | 85 | above 300 dpi, to 200 | **−10.6%** | 4 of 4 |
| medium | 70 | above 225 dpi, to 150 | **−11.6%** | 4 of 4 |
| low | 50 | above 150 dpi, to 100 | **−25.6%** | 4 of 4 |

Every page count held. Page 1's render moved by a mean of at most **1.25 of 255** per channel,
at the lowest setting on one document, and 0.00 on nine of eleven at *high*. The largest single
document went from 1,377,202 bytes to 878,388 at *high* and 192,518 at *low*. Four documents come
out between 17 and 52 bytes **larger** at every setting — the ones with nothing to recompress —
and are exactly the case the owner's rule refuses to save.

**Two controls run on every invocation**: a page carrying an 850 dpi quality-95 JPEG must shrink
by more than half at *low* (it shrinks 88.9%), and a document given a `/StructTreeRoot` must be
seen as tagged — so neither *little to gain* nor *kept its tags* can be the answer of a rewriter
that did nothing or a detector that sees nothing.

**Two instrument defects were found before any figure was read.** The first run reported three
documents **growing** up to 11.4%; a plain re-save with no image touched grew the same document by
12%, because the default write unpacks the object streams the original used — so object streams
are now on, and the growth is gone. It also reported `NaN` render differences on pages whose
geometry and render size were identical: `getPixels()` is a view into the WASM heap and the next
document opened detached it. The pixels are copied, and a size mismatch now throws rather than
reading as a number.

Against Ghostscript on the same corpus (FEATURES, 2026-09-17): 7 of 11 shrank, 4 grew, and
**4 of 4 tagged documents lost their structure tree**.

## Decision 1 — Optimize writes a COPY, and never changes the open document

*Save an optimized copy…*: the person picks a setting, the host rewrites a copy, the sizes before
and after are shown, and only then is a destination picked. A result that is not smaller is
answered as such with both sizes, and nothing is written.

The open document is not mutated because its writer of record holds a **live WASM session** in
the MuPDF host; replacing that session with bytes a different build of the engine wrote would be a
session swap under the undo log for a command whose whole point is to be compared before it is
kept. A copy makes *compared before it is kept* the shape of the operation rather than a check
inside it — and it is what *a result larger than the input is never saved* describes.

## Decision 2 — it runs in the COMPOSE host, never in `main` and not in the MuPDF host

`main` runs no native engine (invariant 20) and parses no document (threat model §2), so the
rewrite runs in a contained host. ADR-0060's compose host is the one whose shape this is: bytes
in through the granted pair, a new PDF out, **no document held**. That last property is the
reason for it over the MuPDF host: a native fault on a hostile image ends a process whose ending
poisons nothing, where the MuPDF host's ending poisons every open document.

The input is main's canonical image of the document, written into the pair's snapshot half — the
bytes a save would write — and the output is read back from the output half by `main`, which
compares the two sizes and streams the output to the destination the person picks. The host
never names a path of its own and the setting crosses as three integers, so no option string
reaches MuPDF's parser.

## Decision 3 — the three settings are the measured ones, and the person picks by name

*High*, *medium* and *low*, with the numbers above, and *high* selected first. What the person
chooses is image quality, in words; the numbers are this build's and are recorded here and in the
shim's comment rather than shown.

## Decision 4 — the native library is loaded by koffi in the host, through one module

`mupdfRaw.ts` is the one module that binds `monstera_mupdf.dll` and alone may carry the
native-boundary lint disable (B7), as `pdfiumFfi.ts` does for PDFium. It binds the exports this
feature calls and no more; the document pipeline's migration onto it stays the separate, unbuilt
work §3 records.

## What changes in the documents with the feature commit

The sentences that say nothing in the product loads `monstera_mupdf.dll` — §3, `CLAUDE.md` and
`native/mupdf-shim/README.md` — become false in the commit that loads it, and are corrected there.
The four security proofs that scan the DLL then scan a binary the product loads.

## Rejected

- **Ghostscript's `pdfwrite`.** Provisioned, and it drops the structure tree from every tagged
  document measured, which trades accessibility for bytes without saying so.
- **An image rewriter of this build's own over MuPDF's object model.** A second opinion about image
  dictionaries — soft masks, decode arrays, indexed colour, JPEG 2000 — which B3a refuses.
- **Rewriting the open document in place.** Decision 1.
- **The MuPDF host.** Decision 2: its ending poisons every open document.
- **A fourth host.** The compose host already has the shape, its own principal and a
  document-free ending; a fourth would be a copy of it (§3, *one host body*).
