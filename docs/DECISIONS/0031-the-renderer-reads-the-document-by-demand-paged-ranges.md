# ADR-0031 — The renderer reads the document by demand-paged byte ranges, not a per-version snapshot

**Date:** 2026-08-29
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §2**, whose "What crosses,
and how often" paragraph pins the mechanism this replaces: *"one byte snapshot
per `DocVersion`, transferred as a detached `ArrayBuffer`"*. The amendment is a
separate commit (B4). Invariant L11 is unchanged and this decision is what
finally satisfies it for the read path.

---

## The problem, in one sentence

Every way of handing `record.bytes` to the renderer breaches something: copying
them puts a second image in `main`, transferring them detached takes away the
image [ADR-0021](0021-the-canonical-image-is-retained.md) retains and invariant
18 recovers from, and raising the budget to fit is refused by
[ADR-0025](0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md) —
whose whole argument is that the upper bound is what makes a budget a detector.

The measurement that closes the first door is already in the tree, in
`documentService.ts`'s own comment on `DocumentRecord.bytes`: `npm run perf:gate`
reports `main` at **1.00x** of file size holding one canonical image and
**2.00x** holding two, against §9.17's `main = 1.5x`. A serialised copy is a
second image for the duration of the send.

**The premise all three share is that the whole document crosses.** It does not
have to.

---

## What was measured, and where

`pdfjs-dist@6.2.108` exports `PDFDataRangeTransport` — a class whose
`requestDataRange(begin, end)` is abstract (`build/pdf.mjs:15421` raises
`unreachable` if it is not overridden) and whose `onDataRange(begin, chunk)`
feeds the answer back. `getDocument({ range })` binds it
(`build/pdf.mjs:15213`). It is a runtime export of the package entry, not only a
type declaration — the distinction this project has paid for before, so it was
checked in `build/pdf.mjs`'s export list rather than in `types/`.

Read 2026-08-29 from `rangeProbe.mjs`, a probe that serves ranges out of the
fixture with `readSync` and counts every byte it hands over. **It is a scratchpad
instrument and is not in this repository**, because `pdfjs-dist` is not yet a
declared dependency of anything here — so these figures are reproducible only by
rebuilding it, and re-establishing them as a committed proof is owed the moment
the renderer declares that dependency. Fixtures are
`packages/testing/fixtures/generated/`, which are generated rather than tracked:

| document | file | opens after | + page 1 | share of file | largest single range | requests |
|---|---|---|---|---|---|---|
| `perf-image-200mb.pdf` | 209,105,721 B | 2,667,321 B | **7,779,129 B** | **3.72%** | 5,111,808 B | 42 |
| `perf-dense-127k.pdf` | 26,315,984 B | 7,310,544 B | **7,769,296 B** | **29.52%** | 327,680 B | 115 |

The probe asserts a positive outcome on every row — `numPages >= 1` and a
non-empty operator list for page 1 — because **a document that fails to open
serves almost no bytes, which is the answer this probe was hoping for**. It also
carries the resolution test from checklist 4a: two inputs differing ~8x in size
must produce two distinct byte counts, and it prints whether they did.

### Three things the probe settled that were going to be assumed

- **A range must be answered in exactly one `onDataRange` call.** Splitting a
  5 MB range into 256 KiB parts throws *"no `PDFDataTransportStreamRangeReader`
  instance found"* — the reader completes and is deleted after the first chunk.
  So the transient copy in `main` is bounded by the **largest single object**
  PDF.js asks for, not by a constant we choose. That is a real limit of this
  design and it is stated in Consequences rather than left to be discovered.
- **`disableAutoFetch` and `disableStream` are not load-bearing here.** Setting
  both to `false` produced byte-for-byte identical figures. The design is
  demand-only because the transport supplies **no progressive data** — we never
  call `onDataProgressiveRead`, so the full reader has nothing to deliver. That
  is a B5 shape: the streaming path is unrepresentable rather than switched off,
  and a future caller cannot re-enable it by flipping an option.
- **The modern build is unusable outside a browser** — `pdf.mjs` evaluates
  `new DOMMatrix()` at module scope. The legacy build is what pdfjs-dist names
  for that environment and carries the identical transport API. This matters for
  where a proof of this seam can run, not for the shipped renderer.

---

## Decision

**1. The renderer never receives the document's bytes. It receives the
document's `length` and asks for ranges.**

The view model already carries bounded structured data; it gains a byte length.
A renderer-side `PDFDataRangeTransport` subclass turns `requestDataRange` into a
contract query, and the reply carries the slice.

**2. The transport is bound to one `DocVersion`, and `main` refuses a range for
any other.**

Byte offsets are meaningful only inside the version that produced them. After a
command bumps `DocVersion` the layout is different, so answering a stale offset
out of the new bytes hands PDF.js a document assembled from two versions — a
corruption with no symptom at the point it happens. The query therefore carries
`{docId, version, begin, end}` and a version mismatch is a refusal, not a
best-effort read. The renderer rebuilds the transport on bump, which is the
existing "bytes cross once per version" cadence expressed as an invalidation
rather than as a transfer.

**3. `main` retains the canonical image, unchanged.**

Nothing about this decision touches what `main` holds. It removes a copy; it
adds none. `record.bytes` stays the single image, ranges are served as
`subarray` views of it, and the only copy is the one IPC serialisation makes for
the reply.

**4. L11 is satisfied by construction, and more strongly than before.**

Payload no longer scales with document size per *version* either — it scales
with what is actually read. A user who opens a 200 MB file and looks at page 1
causes 7.8 MB to cross.

---

## Rejected alternatives

- **Serialise `record.bytes` into an IPC message.** A second image in `main` for
  the duration of the send: 1.00x becomes 2.00x against a 1.5x ceiling,
  measured. Refused by the budget, not by taste.
- **Transfer the bytes detached.** Respects the budget and defeats
  [ADR-0021](0021-the-canonical-image-is-retained.md): `main` no longer holds the
  image, so a killed engine host loses everything since the last save and
  invariant 18's recovery has nothing to reopen from.
- **Chunk the transfer.** This was the leading candidate before the transport was
  measured, and it is genuinely better than the first two: it bounds the
  transient copy and satisfies L11, whose rule is about payload per *operation*.
  It loses on both axes that matter. **100% of the file still crosses per
  version** where demand paging crosses 3.72%, and the renderer ends up holding
  a whole second image — so the renderer's ceiling scales with document size,
  which §9.17 lists as `provisional` and would then have to accommodate.
  Retained as the fallback if the transport is ever withdrawn upstream.
- **Raise `main`'s budget to fit a second copy.** Refused by ADR-0025 before this
  question was asked: a baseline that sits above the cost plus the smallest thing
  it exists to catch cannot fail for the reason it was written.
- **Hand the renderer a `FileHandle` and let it read the file.** The renderer has
  no filesystem and never names a path (§2, L5), and the file on disk is not the
  document — it is the last-saved version, which is exactly the wrong bytes after
  the first edit.
- **`getDocument({ url })` against a custom scheme.** Requires the renderer to
  name a URL for a document and requires `connect-src` to permit it; invariant 27
  pins the CSP and this would be an amendment to it for no gain over a query.

---

## Consequences

**The unpleasant one first: the transient copy is bounded by the largest object,
not by a constant.** Measured at 5,111,808 B on a 199 MiB document — the image
XObject, requested whole. A pathological document holding one enormous stream
reduces this design toward the one it replaces *for that single read*. It never
reduces to worse than it, because the whole-file design pays that cost
unconditionally and this one pays it only if such an object is actually reached.
Splitting the answer is not available (measured above), so there is no mechanism
to add here — only a limit to know.

**Round trips replace one big send.** 42 requests for the image document, 115 for
the dense one, each a query through the contract. The **count** is measured; the
**latency** is not, and this ADR does not claim it is acceptable. That is the
first thing to measure once the seam has a real caller, and the number to beat is
whatever a single 209 MB transfer costs.

**The dense document is the hard shape, and it is the one to keep testing
against.** 29.52% of a 26 MB file to reach page 1, in 115 requests, because a
127,082-object document has its cross-reference structure spread across the file.
The image document's 3.72% is the flattering number; a corpus that contained only
documents like it would hide every cost this design has.

**A new refusal path exists and needs a proof with a control.** "A range for a
stale version is refused" is a decision, so — by the checklist's own rule — the
case must assert the **refusal**, not the absence of corruption: a renderer that
never asks produces the same clean document as one whose stale ask was refused.

**`renderer = provisional` in §9.17 can now be derived from something.** The
renderer's document-dependent memory becomes PDF.js's own cache rather than a
full image, which is what makes a real ceiling derivable at all. Not derived
here; named as newly possible.
