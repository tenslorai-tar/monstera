# 0052 — A second recogniser arrives on demand, reads a region, and never ships in the installer

Accepted 2026-09-11.

## Context

D6 row 7 is *local handwriting OCR (TrOCR small/base, on-demand download, cached,
offline)*. Three things about it are already decided by the founding record and are
not re-opened here: it is TrOCR, the stack downloads on demand with pinned hashes,
and it is **never bundled** (`BUILD-PROMPT.md`:475, :806, with the installer target
of **< 150 MB**). What that record does not settle is which runtime, where it
executes, what the glue costs, and what the feature can honestly be offered *on* —
and every one of those turns on numbers nobody had.

So they were measured before anything was designed, and two of the four answers
are not the ones the row's name suggests.

### What the stack actually weighs, measured 2026-09-11

| artefact | bytes | read from |
|---|---|---|
| `onnxruntime-node@1.24.3` (native, all platforms) | 220,344,078 | npm registry |
| `onnxruntime-web@1.29.0` (package, 509 files) | 142,027,824 | npm registry |
| `ort-wasm-simd-threaded.wasm` — the CPU runtime a run needs | **13,961,845** | the unpacked tarball |
| TrOCR small, quantised: `encoder` + `decoder` | **63,242,844** | `Xenova/trocr-small-printed` |
| TrOCR small, all `.onnx` at full precision | 683,298,960 | the same repository |
| TrOCR base, quantised `encoder` + `decoder_merged` | ~816 MB over four files | `Xenova/trocr-base-handwritten` |
| TrOCR base, all `.onnx` at full precision | 3,906,494,376 | the same repository |

**The founding record's *"200+ MB runtime"* is `onnxruntime-node`, and it is exact
— 220 MB.** The runtime this build would actually load is the WASM one, and it is
**6.3% of that**. That is the figure worth writing down, because the obvious next
thought is that the constraint has dissolved the way ADR-0050's and enhance-scans'
did.

**It has not, and the reason is the mechanism rather than the size.** The models
are 63 MB at the smallest and stay on demand whatever the runtime does, so the
downloader, the pinned digests, the cache and the clear-caches control all have to
exist regardless. Bundling 14 MB into every installer would remove **no**
mechanism; it would only pre-pay one download for the readers who never use the
feature. *Never bundled* survives its own figure being wrong by an order of
magnitude — which is worth recording, because the same check dissolved two
constraints this month and the habit of expecting that is its own trap.

### The pipeline runs without the wrapper, and the glue is small

Measured by writing it (`.probe/trocrSpike.mjs`, not committed): MuPDF rasterises
a drawn line, the raster is normalised into a `[1, 3, 384, 384]` tensor, the
quantised encoder answers `[1, 578, 384]`, a greedy loop over the decoder produces
token ids, and the ids detokenise to text. Against a drawn line reading
`Monstera deliciosa` it answered `MONSTERA DELICIOSKA`.

The pieces the glue needs are exactly: a resize-and-normalise, a greedy argmax
loop, and an **id→piece table**. Nothing else.

**The detokeniser is where the spike first lied, and the shape is worth keeping.**
It assumed GPT-2 byte-level BPE, found nothing in the vocabulary, and printed an
**empty string** — which reads precisely like *the model saw nothing on this page*,
the reassuring answer for an OCR feature. The tokenizer is `Unigram` with a
`Metaspace` decoder: the vocab is an array of `[piece, score]` indexed by id, and
detokenising is joining pieces and replacing `U+2581` with a space. Decoding needs
no merge rules and no encoder side, which is why no tokenizer library is required.

### What it costs per line

Warm, single-threaded, quantised small, no KV cache:

| | cold | warm |
|---|---|---|
| both sessions created from bytes | 12,264 ms | 3,426 ms |
| encoder, one line | 10,138 ms | 2,899 ms |
| greedy decode, 8 tokens | 4,888 ms | 1,044 ms |
| peak RSS | 581 MB | 569 MB |

Against **3.8–4.4 s for a whole page** through Tesseract. A page of thirty lines is
thirty encoder runs: a minute and a half of encoder alone, before decoding, with
half a gigabyte resident.

Two things that number is **not**. It is not the best this stack can do — the
merged decoder's KV cache was deliberately not wired, and `numThreads > 1` failed
in Node because the threaded build fetches its worker through a URL the file scheme
does not satisfy, so both are unmeasured headroom. And it is not an accuracy
reading: the spike's resize is nearest-neighbour where the preprocessor config asks
for bicubic, so the substitution above is at least partly this build's.

### And handwriting accuracy is not measured at all

The spike read **printed** text, because a labelled handwriting sample is not
something this repository has. The corpus is not one either: its content may not be
quoted, and an accuracy figure without a ground truth is a number with nothing
behind it. So the row ships a feature whose *quality* on its own subject is
unmeasured, and this ADR says so rather than implying the spike covered it.

## Decision

### 1 — The recognition concern gains a second engine, and the choice has one place

§3's matrix row assigns *a raster becomes characters and their boxes* to
`tesseract.js-core` inside the engine host. TrOCR is a second answer to that
question, which is B3's *one writer per concern* unless the selection is made
somewhere single and explicit.

The row becomes **recognition by an engine the request names**: `OcrRequest` gains
an engine, the two implementations sit behind one module boundary, and nothing
else in the build chooses between them. The alternative — a second command, a
second channel and a second surface — would put *which recogniser* in as many
places as there are callers, and the two engines answer in the same shape
(`RecognisedPage`) precisely so they do not need one each.

### 2 — It runs where Tesseract runs: inside the engine host

For the reason the matrix already gives, unchanged and now doubly true: the input
is a bitmap this build produced beside the rasteriser, it is 1.7 MB against ~20 KB
of answer, and a second rasteriser for a second recogniser would be B3a. Nothing
about ONNX changes the containment argument — it parses model files that are
**ours**, never document bytes, exactly as `.traineddata` is.

### 3 — The runtime is `onnxruntime-web`'s WASM, never `onnxruntime-node`

14 MB against 220 MB is the smaller half of it. The larger half is what the two
artefacts *are*: a fetched-at-runtime **native DLL** that the application then
loads is a different security proposition from a fetched WASM module the JS engine
parses, it is the class invariant 20 exists for, and it is the one a Store
submission has the most to say about. The WASM runs in the host's Node mode today,
which is measured rather than assumed.

### 4 — The feature is offered on a REGION, never on a page or a document

This is the decision the measurement forced and the one most likely to be read as a
limitation rather than a design. TrOCR reads **one text line** — that is the model,
not the wiring — and a line costs seconds. A *recognise this page* control built on
it would be a control that works and takes minutes, which is the wired-tools rule's
own territory: a button whose honest behaviour nobody would choose.

Row 6's region tool is already the gesture for *read this part of the page*, so the
handwriting engine is an option on that path and the page and document scopes stay
Tesseract's. A reader who drags a box over a handwritten line gets an answer in
seconds; nobody is offered a minutes-long page run they did not ask for.

### 5 — Main downloads, the host reads, and the cache is the user's to clear

The host has no network by invariant 25, so it cannot fetch anything. Main resolves
the cache directory under `userData`, downloads what is missing against a **pinned
SHA-256**, and grants the directory to the host — which is `tessdata`'s pattern
exactly, already built and already in `containerGrants.mjs`.

A download is user-initiated and per-model. `BUILD-PROMPT.md`:627's *clear caches
(TrOCR models, thumbnails)* is the other end of it and lands with the row, not
after it: a feature that writes hundreds of megabytes into a user's profile with no
way to remove them is not finished.

## Rejected

**`@huggingface/transformers@4.2.0`.** It is the obvious way to run TrOCR and its
tree is the objection, which is ADR-0050's situation one package along: it depends
on `onnxruntime-node@1.24.3` (220 MB of native binaries, bundled by npm), a **dev
prerelease** of `onnxruntime-web` (`1.26.0-dev.20260416-b7804b056c`), and `sharp`
— the same dependency the enhance-scans row measured as unnecessary and the wrong
tool. What it would buy is a preprocessing call, a generation loop and a
detokeniser, all of which the spike wrote in under two hundred lines. A pinned
prerelease in a shipped build is not a thing to accept for that.

**Bundling the runtime.** Measured at 14 MB and rejected above: it removes no
mechanism, because the models need the downloader regardless.

**A page-scoped handwriting command.** Rejected on the measurement in §4, and named
here because it is what the row's own wording invites and what a reader will ask
for.

**TrOCR base as the default.** 816 MB quantised, nearly 4 GB at full precision, and
its encoder is four times the small one's. It stays available — the founding record
names both sizes and `BUILD-PROMPT.md`:619 puts the choice in settings — and small
is what a first run gets.

## What this does not claim

The KV cache and threading are unmeasured headroom, not promised speedups.
Handwriting accuracy is unmeasured. Neither is a reason to delay the row, and both
are reasons not to write a number into a FEATURES body that nothing produced.

---

## Addition, 2026-09-12 — a recogniser runs where its INPUT can reach, and the third one's input is the network

Decision 2 above says recognition runs inside the engine host, and gives the
reason twice: the input is a bitmap this build produced beside the rasteriser,
and 1.7 MB of it would otherwise cross a pipe for about 20 KB of answer. That is
true, it is about the two **local** engines, and D6's last row is not one of them.

**Azure Document Intelligence cannot execute in the engine host.** Invariant 25
gives that process no network at all — the same sentence that made the TrOCR
download main's job — so a recogniser whose whole operation is an HTTPS call has
to run where the network is. Found by starting the row rather than by re-reading
this ADR, which is the argument for starting rows early rather than designing
them whole.

### 6 — WHERE a recogniser executes is decided per engine, by what its input must reach

Not by the concern. `tesseract` and `handwriting` stay in the host for Decision
2's reasons, unchanged. `azure` runs in **`main`**, and the rule that places it is
the one already used for the download: *only the process with the network may do
the thing that needs the network*.

What this gives up is exactly what Decision 2 was protecting — the raster crosses
a boundary. It is unavoidable and it is also cheap in the terms that mattered
there: the bytes are going to a cloud service over the internet regardless, so
the question is which local process hands them over, and a pipe hop is nothing
beside the upload. §3's matrix row is amended to say *recognition by an engine the
request names, in the process that engine's input can reach*.

### 7 — The raster is produced by the HOST and read by main, through the channel that already does that

`engine/snapshotRegion` rasterises a region into the granted output directory and
answers a byte count, which is the shape ADR-0044 chose so a payload that scales
with what the reader dragged never crosses the pipe. Main reads the file.

So there is no second rasteriser (B3a, against §3's print-and-export row) and no
new channel. What the channel gains is **the matrix that maps that PNG's own
pixels back to PDF user space**, six numbers, and the reason is the wired pair's
coordinate blind spot: the host holds the page transform, the crop origin and the
`/Rotate`, and a main-side conversion reconstructing them would be the second
place that knows the frame — agreeing on unrotated pages and wrong on the rest,
which is finding FFFFFF-1 exactly, in a third engine.

Sending a **rasterised region** rather than the document also keeps the service's
answer in `pixel` units. Azure reports `inch` for a PDF and `pixel` for an image,
so this removes a unit conversion rather than adding a frame.

### 8 — The endpoint is an ordinary setting and the key is a secret one

`BUILD-PROMPT.md`:621 puts *"Azure DI endpoint + key (secret)"* in the AI settings
group, which is a Part F **category** — where a control renders — and not a
registry dependency: Azure DI is not an `AiProvider` and implements none of that
interface. The key goes through `secretStore.ts`, whose rule E5 fixed and which
refuses rather than falling back to plaintext.

### 9 — The row is NOT done until one live run, and that is written into the row

A cloud engine nobody has run against the real service is the display-only defect
with a unit test over it. Every fixture here is written from the documentation, so
what the mapping proves is a reading of a schema rather than the service's
behaviour; one run with a real key settles it and the key is the owner's to
supply. The trigger lives in the FEATURES row body where something reads it,
never in a plan.

### Rejected

**A network-capable engine host.** It is invariant 25 by name, and the invariant's
own argument is that a host that can reach a socket can send a document through
one. The whole containment design exists because the host parses hostile bytes;
the recogniser that needs the network parses none.

**A third host, with network and without a document.** It answers the invariant
literally — a process that never opens a document may have a socket — and it buys
nothing: the thing needing containment is the parse, and there is no parse here.
What it would cost is a second containment story to keep true.

**Sending the document rather than a raster.** The service would receive the whole
file where the reader asked about one region, which is a privacy answer nobody
chose, and it puts a document-scaled payload on a channel (L11). It also changes
the answer's unit from `pixel` to `inch`.

**Recognition in the renderer, beside the fetch.** The renderer has no document
bytes it may read (invariant 2) and its raster would be PDF.js's, which the
2026-09-10 §6.1 amendment makes a *view* concern — a display raster as the input
would make PDF.js a source of truth.
