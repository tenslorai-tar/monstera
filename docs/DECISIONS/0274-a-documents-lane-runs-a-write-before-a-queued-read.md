# ADR-0274 — A document's lane runs a write before a queued read, and drops a read the write has made pointless

- **Status:** Accepted
- **Date:** 2026-10-27
- **Decided by:** the owner, 2026-10-27, on the local agent's measurement of the speed regression since M1: *a save
  never waits behind a read. The read on open runs once per block and version, off the save's path or yielding to it; a
  read for a version the save has replaced is dropped, not run.*
- **Amends:** [ADR-0009](0009-document-identity-and-the-command-log.md) §7 (*one serial lane per document*), its
  ordering only. Its safety rule is unchanged: nothing in one document's lane interleaves.

## Context

Measured by the local agent on the owner's laptop, clean runs, nothing else running:

| | M1 | M2b |
|---|---|---|
| Finish, a heavy page with drawn fonts | 1.50 s | 3.8 s |
| Finish, a heavy brochure page | 1.97 s | 4.8 s |
| The save (median) | 653 ms | 1,440 ms |
| Keystroke (median / worst) | 12 / 23 ms | 22 / 36 ms |

The writer did not get slower. The finish waits in the document's one lane behind reads M1 did not run beside it:
`document.blockFaces`, the read on open, about 0.9 s in the queue at every first press on a block;
`document.pageObjects`, the check after every save, 77 runs against 51 and 125.7 s against 17.9 s; and
`document.fonts`, the same 43 calls taking 34.1 s against 5.2 s. The control was the same build with only the read on
open answering at once: finishes of 2.35 s and 3.5 s and a save of 904 ms.

ADR-0009 §7 runs commands, queries, save and close in one lane per document, first come first served. The lane is
right: a save that serialised a session while a command mutated it would write a document made of two. **First come
first served is what costs the time**, and it was never argued: §7 argues that nothing may interleave, and says nothing
about order beyond *they queue*.

## Decisions

1. **The lane runs one entry at a time, as before, and picks the next by kind.** An entry is a **write** (a command,
   undo, redo, save, close, an unlock, a session's rebuild and replay) or a **read** (every query). When the running
   entry ends, the lane takes the oldest queued write if there is one, else the oldest queued read. Writes keep their
   order among themselves; reads keep theirs.
2. **A read is never interrupted.** One that is running when a write arrives finishes first: there is no safe point
   inside a native call. So a save waits for at most the read already running, never for the reads queued behind it.
3. **A read may name the version it is for, and is dropped when it starts at another.** It then runs nothing and answers
   `stale-target`, which the asker treats as *ask again if still wanted*. `document.blockFaces` names it: its answer
   describes the block the editor opened, which a write replaces.
4. **A read's answer still carries the version it ran at** (§7's second paragraph, unchanged), so a read queued before a
   write and run after it answers for the document as it then is. That is correct by §7's own rule: *a read answers
   with whatever is there now*.

## Consequences

- A save, a finish and an undo no longer wait for queued reads. The reads the measurement names wait for the write
  instead, which is where a person is not waiting.
- A read can wait behind a stream of writes. Writes arrive at a person's pace (one per finish, undo or save), so this
  is a delay of a write's length, not a starvation; stated so the next reader does not rediscover it.
- `document.blockFaces` gains a required `version` and the `stale-target` answer.

## Rejected

- **Reads outside the lane, against an immutable image.** The PDFium reads take the document's bytes, which come from
  the live MuPDF session where the canonical image is behind it (`currentBytes`), and the MuPDF reads run on the session
  itself. Outside the lane they would read a session a command is mutating, which is §7's corruption.
- **Cancelling a running read.** No native call here has a safe point to stop at, and one stopped half way leaves a
  host in a state nothing has measured.
- **A second lane for reads.** Two lanes over one session is interleaving by another name.
- **Leaving the order and making the reads faster.** They are made fewer (one read on open per block and version, the
  check after a save confined to the edited block's area and run once the editor has let go), and that is owed anyway;
  but a read of any length ahead of a save is a save that waits for it.
