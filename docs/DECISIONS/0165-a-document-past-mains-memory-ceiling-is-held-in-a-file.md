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

## Correction, 2026-10-13 — two of the four paths named above now stream

The owner's list for cloud run 3, item 34, *"Save back / DocuSign (Group 10)"*: this decision's own remainder.

**A cloud *Save back* and *Upload a copy* no longer bring the image into `main`.** The document is STAGED where the
engine wrote it (`DocumentStage`, ADR-0121), in the same lane entry as before (CR-DOC-04's order is unchanged), moved
into a private file under the cloud working folder, and sent from that file by range: `PdfSource` in
`cloudStorage.ts` is a length and a read, and a `Uint8Array` is no longer a parameter there. An upload session reads
one request's bytes at a time, at most `UPLOAD_SESSION_CHUNK_BYTES` (40 MiB), whatever the document's size; the
one-request route reads the whole, which it reaches only at or under `MAX_SIMPLE_UPLOAD_BYTES` (250 MiB) and refuses
above. Every request is byte-identical to what the live runs proved: what changed is where its body is read from.
The file is removed when the send ends, sent or refused, and the staged image is discarded once.

**Still not reached, and still named:** *Send to DocuSign*, whose envelope carries the document as base64 inside one
JSON body (up to its 512 MiB bound), and signing (ADR-0148). Streaming DocuSign changes the framing of a request whose
only proof is a live run on the owner's demo account, so it waits for a run that can prove the new one.

## Correction, 2026-10-15 — *Send to DocuSign* streams too, and its framing does not change

The owner's addendum 4 to cloud run 4, item 1. The premise above, that streaming DocuSign *changes the framing*, held
only for one way of streaming it. A body written as a stream with no known length goes out chunked, which is a request
the live run never sent. A **file-backed `Blob`** goes out with its `content-length`, as the whole string did, and its
bytes are read as they are sent. Both were run against a loopback server (`stagedUpload.test.ts`): the Blob arrives
with `content-length` and no `transfer-encoding`, and the stream, its control, arrives chunked.

So the send is the cloud upload's shape with one step added. The document is STAGED in the lane (no flush into
`main`), moved into a private file under the cloud working folder by `sentFromStaged`, and read twelve MiB at a time
(`ENVELOPE_READ_BYTES`, a multiple of three, so every part's base64 ends on a whole group). The parts are written
between the two halves of the envelope's JSON (`envelopeJson`, the one spelling of the envelope) into a second private
file, which `fetch` sends as a Blob. Both files are removed when the send ends. A sign-in refused before anything is
moved discards the staged image, as a cloud upload does.

**The request is the proven one, byte for byte.** `docusign.test.ts` holds the streamed body to `JSON.stringify` of the
whole definition, the body the live run sent, for every length from 0 to 20 bytes across reads of 3, 6 and 21, with a
subject that carries the split's own text. What is not claimed: a live send of a document past `main`'s ceiling.

**Still not reached:** signing (ADR-0148), and the signed copy read back from DocuSign, which arrives whole within its
512 MiB bound before it is written.

## Correction, 2026-10-17: a byte-image command's answer takes the rule too (QQQQQQQ-11)

The lists above did not name the PDFium and pdf-lib commands, and the rule did not reach them. A byte-image writer's
`apply` answers the whole new document as bytes, and `replaceCanonicalImage` installed them in memory unasked, so one
edit made a document held in a file resident in `main` past the ceiling. `documentService.ts`' comment on
`#heldInMemory` said it was the rule at every replacement; this replacement did not ask it.

It does now: an answer that fits under the ceiling beside the other documents, not counting the image it replaces, is
held in memory as before, with no disk round trip; one that does not is written to the document's file and served
from it (`#replaceFromFile`, the hosted path's). `documentService.test.ts` holds both, each with a mutant that fails
it.

**Still not reached:** the answer itself still arrives in `main` whole, once, before it is placed. The full remedy is
the hosted result ADR-0121 Decision 3 gives MuPDF's commands, a file the host writes, which these writers do not have.
