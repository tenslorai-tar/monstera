# ADR-0221 — A command that loops the engine three times is stopped, and the document stays open

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0023](0023-how-the-contained-engine-host-is-built.md) Decision 9a (two engine failures of a document's
  own poison it) for one class of ending: a host that was ended because a call ran past its deadline, while a document
  command was running.
- **Found by:** the owner's list of 2026-10-08, from the code review of 2026-10-03: *the same command makes the host loop
  three times: stop retrying it, keep the document open and its edits safe, and tell the person in plain words which action
  could not be done.*

## Context

What happens today, read from `onEngineHostEnded` and `endingCountsAgainst` on 2026-10-08. A command that runs the engine
past its deadline ends the host. The ending is counted against the document whose call was running, every session is
dropped and rebuilt from the canonical image, and the log is replayed. At the **second** such ending
(`POISON_AT = 2`) the document is **poisoned**: no session is rebuilt and every command, of every kind, answers
`document-poisoned`. The log is kept and the file on disk is untouched, so no edit is lost, but the whole document is
refused for the failure of one action. A person whose Watermark never finishes cannot rotate a page, save, or close it
cleanly.

## Decision

1. **A deadline ending that happens while a document command is running is a strike against that command, on that
   document, and not a failure of the document.** The ledger is `kind -> strikes`, per open document, on the supervisor's
   per-document entry (B3: one owner of a document's supervisor state). It is cleared for a kind when that kind succeeds,
   and the whole entry goes when the document closes.
2. **At three strikes the command is barred for that document**: a further attempt is refused before it reaches the host,
   with the declared failure `command-looped` naming the command kind. Every other command still runs, the sessions are
   rebuilt as before, and the log is replayed, so the edits made so far are safe.
3. **Every other ending keeps Decision 9a unchanged.** A crash, a memory kill, an ending between calls and a deadline during
   a read (no command running) still count against the document and poison it at two. A loop is a deterministic function of
   one input, which is why it earns three tries and a name; a crash is not known to be.
4. **The sentence is plain and names the action.** The renderer receives the command kind and shows the action's own label
   (derived from the kind, no second table). Nothing about the engine is said.

## Rejected alternatives

- **Raising `POISON_AT`.** Gives every ending one more try and still refuses the whole document at the bound.
- **A per-document timeout list kept in the renderer.** The renderer would hold a rule about the engine's health (L1).
- **Resetting the count on any success.** ADR-0023's correction of 2026-10-03 withdrew reset-on-success for documents,
  because a document that alternates a good command with a bad one never poisons. Here the reset is per command kind, so
  the good command does not hide the bad one's strikes.

## Consequences

- `engine-sessions` gains `commandBegan`, `commandEnded` and `commandBarred`; `documentCommands.ts` calls them around the
  bus in `execute` and `redo`.
- A new failure code in the contract for `document.execute` and `document.redo`.
- `proof:` is a unit case beside `engineSessions.test.ts` (three deadlines bar one command and nothing else; a crash still
  poisons at two; a success clears the strikes; closing clears the ledger).
