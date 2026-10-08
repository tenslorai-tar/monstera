# ADR-0200 — Commands the person made in one gesture are one undo step

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0009](0009-document-identity-and-the-command-log.md) §3 and §4 (the log's cursor moves one entry at a time)
  and [ADR-0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md) (a terminal entry's undo restores its own
  checkpoint). Their rules stand for an entry that joins nothing, which is every entry today.
- **Found by:** the owner's order of 2026-10-08, item 5.4: *a whole-document translation is ONE undo step.*

## Context

Translating a document writes the page's translation as one block edit per page (ADR-0097), so a document of forty pages
is forty commands and forty entries in the log. Undo then takes forty presses to take back one thing the person did once.
The same will be true of any gesture that is a loop of commands: a text-box format applied to a selection, a replace across
pages by pages.

The kernel has no way to say *these entries are one step*. Four routes were considered.

## Decision

1. **An entry may join the one before it.** The log keeps, beside its entries, which of them joined the one before. A *step*
   is an entry and the entries after it that joined, in order; undo and redo move over a whole step. An entry that joins
   nothing is a step of one, so every command recorded today behaves as it did.
2. **A command is recorded as joining only on the caller's word AND when the document is where the caller says.**
   `document.execute` takes an optional `joinsStep`: the version that the previous command of the step produced. The bus
   joins only if the document is still at that version when the command is recorded and the log has an applied entry; any
   other command in between has moved the version, so the new entry is a step of its own and nothing is swallowed.
   The caller never learns whether it joined, because it cannot be wrong in a way that matters: the worst case is the old
   behaviour, one step per command.
3. **Undo of a step restores once.** When every entry of the step is terminal, the document is restored from the checkpoint
   of the step's *first* entry — the document as it was before the step — and the cursor moves back over all of them: one
   restore, whatever the length of the step. A step with an invertible entry is undone entry by entry, last to first, by the
   existing path. Redo applies the step's entries in order, each by the existing path.
4. **A trim never splits a step into something unreachable.** `trimTo` already sheds the oldest entries up to and including a
   terminal one. An entry left at the front that joined a shed entry is the head of the step it has become: undoing it
   restores its own checkpoint, which is the document as it was after the shed entries — a shorter step, still coherent.
   The entry's `joins` flag is ignored when it is the first in the log.
5. **One result for a step.** Undo and redo of a step bump the version once and answer once (`Undone` names the entry the
   step began at); the renderer redraws once.

## Rejected alternatives

- **One command that carries every page's edit.** A whole-document payload scales with the document, which invariant L11
  forbids per operation; it would also need a second apply beside the page writer's, or a loop inside one apply that gives
  up the writer's per-page read-back checks (ADR-0169).
- **The renderer calling undo N times.** Forty restores of whole documents, forty redraws, and a failure half-way leaves a
  document at a state no person chose; the count is also the renderer's guess about what the kernel recorded.
- **A step id minted by the renderer.** An id is a claim the kernel cannot check; the version it already holds can be.
- **Grouping by time.** Two commands a second apart are not one gesture.

## Consequences

- `CommandBus.execute` takes the optional join; `CommandBus.undo` and `redo` move over steps; `CommandLog` gains the join
  record and two reads (`stepBack`, `stepForward`). `document.execute`'s request gains `joinsStep`.
- The translate command sends it from the second page on, so a whole-document translation is one step; a translation of
  one page or of a selection is a step of one and unchanged.
- Cases: a step of three terminal entries restores the first checkpoint once and redoes in order; a command between breaks
  the join; a trim leaves a coherent head; an ordinary entry is unchanged. The old per-entry cases stay and pass.
