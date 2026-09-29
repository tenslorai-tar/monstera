# ADR-0121 — `main` never holds two images: checkpoints live on disk, a new image arrives as a file, and a byte-image apply runs beside its session

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decided by:** the owner's list of 28 September, item 4 — *"measure; ADR and fix if it is over 1.5×"*. It is.
- **Amends:** `docs/ARCHITECTURE.md` §4 (*"Memory is one document plus a few checkpoints"*), §3's *Content composition*
  row (drawing onto pages), and the amendment of 2026-09-04 that placed the pdf-lib byte-image writer in `main`.
- **Takes the decision [ADR-0021](0021-the-canonical-image-is-retained.md) deferred:** *"How many checkpoints may exist
  and what spills when is still deferred."*
- **Keeps:** ADR-0007's budget — `main` **≤ 1.5× the file, as peak RSS** — and §9.17's clause *"`main` holds canonical
  bytes and never parses"*. This ADR exists to make them true, not to move them.

## The measurement

`scripts/perf/roleMainByteImage.mjs`, 2026-09-29, on this machine: the real `DocumentService` with the production
reader, the real `CommandBus`, the shipped `localPdfLibWriter`, one *watermark* on the 199.4 MB stream-heavy fixture.
The engine host is the only stand-in — its serialise is the canonical image written out and read back, a fresh buffer
of the document's size, which is what the host's answer is once it reaches `main`. Buffer memory is read after two
collections with a turn between them (one collection read an image nothing held; the settled reading agreed with the
service's own count, and the instrument's control is the open step, which reads 1.00× as `roleMainService` does).

| step | ArrayBuffer memory over file |
|---|---|
| opened | 1.00 |
| the serialised input arrives (the byte-image session) | ~3 (one transient) |
| pdf-lib's work done, the new image in hand | 4 |
| after the command | **2.00** — the new image and a whole-image checkpoint |
| after a second command | 3.00 |

**Peak RSS over the baseline: 4.02×, 4.91× and 5.02×** across three runs. The service's `residentDocumentBytes` agrees
with the settled readings at every point, so nothing leaks; everything above 1× is held on purpose.

Three causes, and each is a different mechanism:

1. **The checkpoint.** A terminal entry keeps a `Checkpoint`, a whole image, in memory, uncapped (JJ-2) — 2× steady
   after one command, 3× after two.
2. **Co-residence at every replacement.** The new image and the old one are both in memory between their arrival and
   `replaceCanonicalImage`; so are the canonical image and the serialised input the byte-image session is made from.
   Every path that refreshes the image — a byte-image install, an *image*-display command (ADR-0084), a restore — has
   this shape.
3. **Parsing in `main`.** `@cantoo/pdf-lib` loads and saves the whole document in `main`. The amendment of 2026-09-04
   found no block because invariant 20 bans *native* code and pdf-lib is JavaScript — true, and beside the point:
   §9.17's clause is *"never parses"*, and ADR-0007 names exactly this as what the budget exists to catch.

## Decision

1. **A checkpoint is a file.** It lives in a per-document directory in `main`'s own storage — granted to no container —
   and the log holds its path and length, not its bytes. It is **made from the file the engine host already writes**
   (`engine/serialise` writes into the output directory and answers a count), moved into that directory, so a
   checkpoint's bytes never pass through `main`'s memory. A restore copies it to the snapshot directory the host opens,
   which is what `writeCheckpoint` does today with a buffer. The log's memory term for checkpoints becomes zero; their
   disk bytes are counted against the same ceiling the retention rule already uses, so trimming still ends undo past
   the oldest kept checkpoint. A trimmed checkpoint is deleted; a closed document's directory is removed; a start
   sweeps what a crash left.
2. **A new canonical image arrives as a file and replaces the old one without both being held.** Replacing the image
   switches the record to serve ranges from that file — a synchronous read of the range, the record's version and
   bytes still read together with no await between them (the argument `readRange` states) — and releases the old
   buffer in the same step. The file is then read into memory, and the record moves back to serving from memory when
   it is. Every replacement takes this one path: a byte-image install, an *image*-display refresh, a restore.
3. **A byte-image apply runs in the engine host, beside the session it came from.** The host serialises its own
   session, runs the pdf-lib apply there, writes the result into its output directory, and reopens its session from it;
   `main` receives a count and replaces its image from the file (Decision 2). `main` holds neither the serialised input
   nor pdf-lib's working set, and parses nothing. The writer of record is unchanged — `pdf-lib` — and its execution
   joins the MuPDF host's channels the way the one host body is parameterised (§3), never as a copied host.

## What stays in `main`, said so

**Signing.** `@signpdf` places and fills a signature over the whole document in `main`, because that is where the
private key is, and a hostile host must never hold it (invariant 25's premise). That is the same shape as cause 3 and
is **not** decided here: it trades the budget against key custody, and that trade is the owner's.

## Rejected

- **A cap on checkpoints kept in memory.** It rations the breach rather than removing it: one checkpoint of a 1× image
  is already 2×.
- **Loading the new image before releasing the old, faster.** Speed does not change a peak.
- **pdf-lib in the compose host.** ADR-0060 makes that host hold no document; the byte-image session is the document.
- **A file-backed canonical image always.** It answers every range read from disk; ADR-0021 retained the image in memory
  because a demand-paged renderer issues tens of reads per page. A window is enough.
- **Leaving it, and raising the budget.** ADR-0007: *"a budget derived only from the measurement it is supposed to
  constrain can never fail."*

## Built in order, each measured by the same instrument

Decision 1, then 2, then 3. Each is its own commit and moves `roleMainByteImage.mjs`' readings, which are recorded in
the row. The budget is met when the peak is at or under 1.5× — expected only after all three.

## Addendum, 2026-09-29 — the save flush is cause 2's shape, and Decision 2 covers it

Found while building Decision 1, by reading the flush Decision 2 changes rather than by a measurement: a **save**
asks the host to serialise its session, reads the result into `main` (`takeOutput`), and writes it to a temporary
file beside the user's — so for the length of a save `main` holds the canonical image and the flushed one. So does
*Save a copy*. Neither is a *replacement*, which is why Decision 2's list does not name them; both are the
co-residence that decision exists to end.

**Decision 2 therefore also covers every write of the session's bytes to a file**: the flush fills the file it is
given (`serialiseInto`) and `main` never reads it. `atomicWrite` already hands its writer the temporary path, so the
seam is unchanged and only what fills it moves. A temporary file beside the user's document can be on another volume
than `main`'s own storage; a move there is a copy and a delete, which is what a move across volumes is.

Also found, and the same class: `takeOutput` returned `new Uint8Array(bytes)` of a buffer the read already owned — a
second whole image for as long as both lived.
