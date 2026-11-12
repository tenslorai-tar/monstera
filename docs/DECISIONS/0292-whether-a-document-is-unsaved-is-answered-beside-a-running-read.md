# ADR-0292 — Whether a document is unsaved is answered beside a running read, and a read cannot move the version

- **Status:** Accepted
- **Date:** 2026-11-12
- **Decided by:** the owner, 2026-11-12: *a person pressing × must not wait behind a read* (route D of the local agent's
  report on the close of 2026-11-11).
- **Amends:** [ADR-0274](0274-a-documents-lane-runs-a-write-before-a-queued-read.md) Decision 2 (*a running read is
  never interrupted*, so every other entry waits for it) for one question only, and ADR-0009 §7's *commands, queries and
  save share one lane* for that question. ADR-0274's rejection of *reads outside the lane* stands for every other read.

## Context

A tab's × asks main whether the document is unsaved before anything is released (`App.tsx`, the one close path), and
the tab leaves the screen only once every answer is in: `releaseTabs` removes it before it awaits `document.close`, so
the drain and teardown after that are never seen. `document.unsaved` runs in the document's lane as a write
(`unsavedHandler`, `DocumentService.run`), so it waits for the entry that is running.

Measured on 2026-11-11 (`_review/walks/edit-open-cost/2026-11-11T22-47-12`, `logs/shell.log`): in every one of seven
rounds `document.unsaved` answered only when `document.blockFaces`, the read on open, ended, after 3.5 to 13.7 s, the
read itself taking 11.6 to 19.1 s. On 2026-11-12, in a faster run, 0.7 to 1.5 s against reads of 4.6 to 6.8 s. The read
is long because the MuPDF host loads its font catalogue on its first block read (3.9 to 9.3 s on six corpus documents,
`scripts/research/blockFacesCost.mjs`), which is a separate decision. This one is about the wait: whatever makes a read
slow, a person pressing × waited all of it.

The question needs nothing a read touches. It is two numbers in `main`, the version and the version last saved. The
reason it was put in the lane is written at `DocumentContext.isDirty`: read outside the lane, it can race a command
that moves the version, and the stale answer is *clean*, which closes without asking and loses work. That race is with
a WRITE. A read moves neither number: the four things that do (`bumpVersion`, `replaceCanonicalImage`,
`replaceCanonicalImageFrom`, `markSaved`) are called by the command bus and the save pipeline, both in write entries.
But nothing makes that so; every lane entry's context carries all four.

## Decisions

1. **`DocumentService.state(docId, ask)` answers a question about a document's state in `main`.** `ask` is synchronous
   and is handed a view holding the version and `isDirty()` alone, so it cannot reach a session, the image or the log.
   It runs once no write is running and no write queued before it is waiting: it waits for those writes, never for a
   running read, and a write queued after it waits for it. The answer is stamped with the version it read, as every lane
   entry's is.
2. **A read cannot move the version.** A read entry's context refuses `bumpVersion`, `replaceCanonicalImage`,
   `replaceCanonicalImageFrom` and `markSaved` by throwing, so Decision 1's premise is the lane's and not a habit of its
   callers (B5).
3. **`document.unsaved` takes `state`.** Nothing else does: no other question has been measured waiting for a read.
4. **A close is unchanged.** It still removes the document at once and drains the lane before teardown; the tab has
   already gone by then.

## Consequences

- The × answers in about the time the question takes, beside a read of any length.
- ADR-0274's bound stays for everything else: a finish, a save or a close's teardown still waits for the one read that
  is running. The read on open's length is what makes that bound felt; that is the catalogue's decision, not this one.
- `isDirty` keeps its rule, *never read beside a write*, now held by the lane rather than by every caller.

## Rejected

- **Every read outside the lane.** ADR-0274's rejection stands: a read hands an engine the document's bytes and must
  not run beside a write that is changing them. This is one question that hands nothing to anything.
- **Interrupting the running read.** There is no safe point inside a native call (ADR-0274 Decision 2).
- **A dirty flag in the renderer.** A second opinion about what `main` holds (B3a), whose stale answer is *clean*.
- **Answering from the last write's result.** The renderer would hold a version the lane may already have moved.
