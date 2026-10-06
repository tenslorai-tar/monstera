# ADR-0165 — A document past `main`'s memory ceiling is held in a file, and opens

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** `docs/ARCHITECTURE.md` §4, *Memory is one document; checkpoints are files*, and
  [ADR-0121](0121-main-never-holds-two-images.md)'s rejected alternative *"a file-backed canonical image always"*,
  whose reason this measures again for the case it now covers. Keeps ADR-0007's budget (`main` ≤ 1.5× the file and
  ≤ 1.5 GB), [ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)'s range transport, and its one-version rule.
- **Decided by:** the owner's list for cloud-4, F row 1 and Group 10: *"large documents held in a file instead of
  memory, so a 1.5 GB scan or several huge files open"*.

## Context

`DocumentService` reads a document into memory at open, and refuses it as `at-capacity` when the images already
resident and this one would pass `documentBytesCeiling`: `budget.ts`' `MAIN_DOCUMENT_BYTES_CEILING`, 1.5 GiB less
the 80 MiB base. So a 1.5 GB scan is refused outright, and two 800 MB files cannot both be open.

ADR-0121 Decision 2 already gave the canonical image a second state, a file in the document's own directory in
`main`'s storage, served by a synchronous `readSync` of each range, so the version and the bytes are still read
together with no await between them. It is used only between a replacement's arrival and its read into memory.
ADR-0121 rejected holding every image that way, because *"a demand-paged renderer issues tens of reads per page"*.

## Measured, 2026-10-04

`rangeCost.mjs` (a scratch instrument, not committed), three runs on this session's container, 2026-10-04T21:49Z: a
200 MiB image, 2 000 ranges of 64 KiB at random offsets, each one allocated and filled as `readRange` does.

| | per read |
|---|---|
| from memory | 14.6 – 16.9 µs |
| from an open file, its pages already read once | 14.0 – 16.2 µs |
| resolution check, from the file: 1 KiB against 1 MiB | 2.0 – 2.7 µs against 262 – 271 µs |

So a warm read costs what a memory read costs, and the 42 ranges a 199 MB document's first page needed cost under a
millisecond either way. A cold read, a page nobody has read since the file was written, costs what the disk costs;
that is not measured here, and it is the price this decision pays only for a document that would otherwise not open.

## Decision

1. **An image is held in memory when it fits under the ceiling with every other resident image, and in a file when
   it does not.** One rule, at open and at every replacement, so a document is never refused for its size. The file
   is a copy in the document's own directory, the one its checkpoints and arriving images already use, granted to no
   container; the copy is made by the filesystem and never passes through `main`'s memory.
2. **The ceiling keeps its meaning and its figure.** It bounds what `main` holds; a file-backed image holds nothing
   there. Checkpoint retention keeps shedding against it as before.
3. **`at-capacity` now means the machine has no room**: the image file could not be made because the disk is full
   (`ENOSPC`, `EDQUOT`). Its words already say *"There is not enough room to open that document. Close another one
   first."*, and closing one does free its file.
4. **A replacement follows rule 1**: after the swap to the arriving file, the image is read into memory only if it
   fits, and otherwise the record keeps serving from the file.

## What this costs, said plainly

A large document is on disk twice in `main`'s and the engine host's storage: the image file and the host's snapshot,
each its size, for as long as it is open. Opening it copies it once, at the disk's speed. A cold range read waits on
the disk.

**Not reached by this decision, and named so nobody reads them as covered:** the paths that bring a whole image into
`main`'s memory by design still do so for a large document: a cloud *Save back* and *Upload a copy*
(`currentImage`), *Send to DocuSign*, and signing, which reads the prepared bytes for the length of one signature
(ADR-0148). Each needs its own streaming, and none is a reason to refuse opening.

## Rejected

- **Every image in a file.** It costs every document a copy at open and a cold first read, to serve documents that
  fit in memory no faster.
- **Reading the person's own file in place.** Another program may change it while it is open, and a range answered
  from changed bytes builds a document out of two of them, the failure ADR-0031's one-version rule exists for.
- **A higher ceiling.** ADR-0007: a budget raised to meet the case it refuses can never fail.
- **A read window, an in-memory cache over the file.** The measurement shows warm file reads at memory's cost, so a
  cache would be a second copy of what the page cache already holds.
