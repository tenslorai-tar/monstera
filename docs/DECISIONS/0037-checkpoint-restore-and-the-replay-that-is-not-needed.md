# ADR-0037 — Checkpoint restore, and the replay that is not needed

**Date:** 2026-09-04
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` invariant 18 clause (ii)**,
whose two named triggers have both now fired, and settles the mechanism that
clause deliberately left unchosen. The architecture amendment is a separate
commit (B4); this ADR is the reasoning behind it.

---

## The problem, in one sentence

`CheckpointRestoreNotBuiltError` refuses undo of a terminal log entry, which
makes every non-invertible command unbuildable — *delete pages* first, and every
Track F command after it — and the two questions the refusal named as its reason
have both been answered elsewhere since it was written.

## What the refusal said, and why both halves are stale

`packages/kernel/src/commandBus.ts:122-140` and `:309-315`, as written:

> §4's answer — restore the nearest checkpoint and replay forward minus the
> undone command — means **opening a new session from those bytes**, and who
> then owns the old session is `DocumentService`'s question, not this bus's.

Two claims, and neither survives a read of the documents.

**1. The ownership question was answered on 2026-08-28.** The amendment log's
entry for that date: *"The engine session's owner is the supervisor, not
`DocumentService`"* ([ADR-0023](0023-how-the-contained-engine-host-is-built.md)
Decision 9 put the sessions and the failure count on one per-document entry).
So the comment was asserting a **superseded mechanism** — B6's own class, and
the shape `docs/JOURNAL.md` records twice already: a justification written
beside a settled decision, where the conclusion survives and the stated reason
quietly stops being true. The conclusion here did not survive either.

**2. The replay this quotes is not needed, and that is structural.**

`§4` at `docs/ARCHITECTURE.md:476-477` reads *"Undo restores the nearest
checkpoint and replays forward minus the undone command."* That sentence
describes a log with **periodic** checkpoints — §4's own *"Checkpoints also
occur every N commands to bound replay depth"* — where undoing command *n* means
starting from a checkpoint at *n − k* and re-running *k − 1* commands.

This log has no periodic checkpoints. Read from the code rather than from the
sentence:

- `CommandBus.execute` holds the **only** `Checkpoint` mint in the kernel
  (`asCheckpoint`, module-private), and takes one at exactly one moment: after
  `capture` reports that prior state cannot be recorded, and **strictly before
  `apply`**.
- The checkpoint it takes is stored on the `terminal` entry for *that* command
  and nowhere else — `LogEntryFor<K>`'s `checkpoint` member exists on the
  `terminal` variant alone (`commandLog.ts:137`).
- `CommandLog.entries` returns the **applied prefix** (`slice(0, #applied)`), so
  `entries.at(-1)` is the last applied entry and undo is strictly
  last-applied-first.

Compose those three: a terminal entry's checkpoint is the document's bytes at
the moment after entries `0 … n−1` had been applied and before entry `n` was.
That is precisely the state undoing entry `n` must produce. **The replay set is
empty, for every terminal entry, always.**

**This is a property with an expiry and the expiry is a compile error.** The day
a checkpoint is stored somewhere other than on the entry it immediately
precedes — a periodic checkpoint is the obvious candidate — the type has to
change to hold it, and every reader of `entry.checkpoint` stops compiling. The
argument above cannot go stale silently, which is the only reason it is safe to
rest a mechanism on it.

**3. `stored-effect` is not on this path, and the paragraph that says otherwise
is about a different mechanism.** Invariant 18 clause (ii) records the mechanism
as unchoosable because *"§4 declares two replay modes, `reapply-intent` and
`stored-effect`, and only the first exists"*. That is true of **recovering a
rebuilt session from a log**, which does replay. Undo of a terminal entry
replays nothing at all, so it needs no replay mode — and it is therefore
buildable while the other half is not.

## The decision

Three components, three concerns, no concern in two places.

| who | what it decides | why it and not the others |
|---|---|---|
| `CommandBus` | *that* a restore happens, and **which** checkpoint | it is the only reader of the log — `commandLog(writer)` takes `CommandWriter`, minted in one module-private line in `commandBus.ts` |
| `DocumentService` | that the bytes reach a destination | §2's first clause: it owns the canonical bytes, and the log — with every checkpoint in it — lives on its record |
| the session supervisor | granting the destination, opening the new session, closing the old, holding the new | the 2026-08-28 amendment: the session's owner is the supervisor |

The seam is a capability the bus is handed, alongside the sessions it is already
handed:

```
type SnapshotWrite = (destination: string) => Promise<number>;
type CheckpointRestore = (write: SnapshotWrite) => Promise<void>;
```

The supervisor receives a **writer**, never the bytes. It creates the granted
directory pair it already knows how to create, calls `write` with the snapshot
path inside it, and opens the engine on that path — which is `openEngineSession`
with one parameter replaced, not a second way to build a session. The bus closes
over `context.writeCheckpoint(COMMAND_WRITER, entry.checkpoint, destination)`,
so the bytes travel from the record to the disk without passing through the
supervisor, which is exactly the property `writeCanonicalImage` was shaped to
have (ADR-0021, measured at 1.00× becoming 2.00× when a second reference exists
in `main`).

`undo` therefore takes the capability as a **required** third parameter. An
optional one is a caller that keeps the old refusal by not passing anything, and
the refusal is what this ADR deletes.

## Rejected alternatives

**The bus opens the session itself.** It cannot: `packages/kernel` may not name
a filesystem path for a granted directory, may not create a process, and holds
no session map. Giving it one makes the bus per-document, which ADR-0009's
composition decision removed for a stated reason — one bus and no
`Map<DocId, bus>`.

**`DocumentService.writeCheckpointImage(supervisor, docId, destination)`,
reading the checkpoint off its own record's log.** This is the tidier-looking
option: it is exactly `writeCanonicalImage` with one field changed, and the
supervisor never even holds a writer. It is rejected because it puts **a second
opinion about which entry undo is at** into a second component (B3a). The bus
computes the tail from the applied cursor; the service would compute it again;
and the two agree until the first time undo is called with anything unusual in
flight. That is the `git diff --name-status` shape — two hand-written parsers of
one authority, both correct in isolation — and the remedy there was to have one
owner and callers, not to make the second one careful.

**Hand the supervisor the checkpoint bytes.** One reference, not a copy, so it
costs nothing `perf:gate` could measure. Rejected because *"the only way anything
outside this service can obtain a document's bytes — and it does not obtain
them"* is a property currently true without exception, and the exception is free
to avoid here. A property with one exception is a property nobody can check by
reading a signature.

**Compute a reversing operation from the command instead of restoring bytes.**
This is §3's named defect — *an inverse that restores the rendering is not an
inverse* — and it is what `Invert`'s signature already refuses by not carrying
the command. A delete cannot be reversed by an insert: the objects are gone.

**Make `deletePages` invertible instead, so no terminal entry is ever
recorded.** Capturing a deleted page's prior state means capturing the page
objects and everything they reference, which is a byte image under another name,
produced per command by hand. It would also leave the refusal standing for every
Track F command behind it, so the work is paid once here or six times there.

**Drop the terminal entry rather than restore it.** Undo would then be
unredoable, and the log's cursor would have two meanings. `record` already
truncates the redo tail for a stated reason; a second truncation path with
different semantics is how a cursor drifts.

## Invariant 18 clause (ii): both triggers have fired

The clause named two, each pointing at a code site so that *"the trigger arrives
where someone is already looking rather than in a document nobody opens"*.

- **`CheckpointRestoreNotBuiltError` being deleted** — fired by this ADR's
  feature commit.
- **`document.close` being declared** — **fired on 2026-09-03**, one commit
  before this one, and nobody noticed. `packages/contract/src/channels.ts`
  declares it at `:545`; the clause still read *"which declares ten channels and
  no close (counted 2026-09-01)"*.

The second is worth recording on its own account. The trigger was written into
prose precisely so it would be met by a reader, and the reader it was waiting
for was the author of the commit that fired it — who was editing the channel
table at the time. **A trigger whose only mechanism is a sentence in a document
fires into that document**, which is the memory this project already keeps under
*an expiring claim needs a reader*. The advisory register exists for symbol-keyed
expiry and could not have held this one, because *a channel being declared* is
an event and not a symbol shipped code names; a `docs/FEATURES.md` row is where
an event-keyed claim belongs, and this one had no row.

**The mechanism is now chosen: forward replay by re-applied intent.** A document
whose session is gone — a dead host, or a poisoned document the user reopens —
is brought back by opening a session on the canonical image and re-applying each
applied entry's `command` in order. Every command declared today is
`replay: 'reapply-intent'`, and `CommandBus.redo` already makes a spec that
declares otherwise a compile error rather than a silent wrong branch. Where the
prefix contains a terminal entry, its checkpoint is a **starting point** that
shortens the replay; it is never required for correctness, because a terminal
entry's command is re-appliable even though it is not invertible — *terminal*
means prior state could not be recorded, not that the operation is
irreproducible.

**The build is deferred and owed a row**, not left implicit: `docs/FEATURES.md`
carries it with the trigger written into the body. What it needs beyond this ADR
is a decision about *when* replay runs — `onEngineHostEnded` rebuilds inside each
document's lane today and hands back a session at the last-saved state — and
that is a scheduling question for the supervisor, not a mechanism question.

Clause (i) is untouched. It is a property of a poisoned document and binds
whatever the route.

## What is proven, and the control

`scripts/proofs/` and `packages/kernel/src/commandBus.test.ts`:

- Undoing a terminal entry **calls the restore capability with a writer that
  produces exactly that entry's checkpoint bytes**, and does **not** call
  `writer.invert`. The assertion is on the calls, because the end state a
  correct restore produces is one an absent restore also produces in a stub
  whose session is an object nobody reads — the `docs/JOURNAL.md` rule that a
  decision is asserted by the call that was or was not made.
- The control: with the terminal branch reverted to the old throw, the case
  reddens. With the restore made a no-op that returns without writing, the case
  reddens on the write assertion rather than on the state.
- The version bumps and the cursor steps exactly once, which is what separates a
  restore from a refusal that happened to leave the document alone.
