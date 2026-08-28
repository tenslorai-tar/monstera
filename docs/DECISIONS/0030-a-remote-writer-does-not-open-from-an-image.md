# ADR-0030 — A remote writer does not open from an image, and the bus never asked it to

**Date:** 2026-08-28
**Status:** accepted. Amends nothing in `docs/ARCHITECTURE.md`. §8's seam is
`EngineWriter`, and §8 does not say who calls it; this decides that, and reshapes
what a *registered* writer must supply so the answer is expressible.

**Does not relitigate how the bytes travel.** [ADR-0023](0023-how-the-contained-engine-host-is-built.md)
Decision 14 already refused an accessor on `DocumentService` and decided
`writeCanonicalImage(supervisor, docId, destination)`; Decision 10 already
decided that *"`open` receives the snapshot from the **read-only** handed
directory"*. Both stand. This ADR is about the **type** that could not express
them.

---

## The problem, in one sentence

`EngineWriter<TSession>.open(image: ByteImage)` (`engineSeam.ts:131`) takes the
document's bytes, and the route the engine host actually opens through takes a
**path** — so the one writer that has to be remote cannot implement the
interface a registered writer is required to satisfy.

### How it went unnoticed for as long as it did

**Neither `open` nor `close` has a caller anywhere in this repository.** Not in
`main`, not in the host, not in an instrument. `CommandBus` calls `capture`,
`apply`, `invert` and `serialise` and nothing else, so the two members that
cannot be implemented are exactly the two nothing exercised. The seam compiled,
its adapter compiled, and the disagreement was invisible until a composition
root tried to register one.

`remoteMupdfLifecycle` (`remoteLifecycle.ts:154`) is the adapter that was
written against it, and it does what the interface asks: `areas.writeSnapshot(area,
snapshotName, image)` — main holding the image. `engineSessions.ts:113` records
what that costs, measured: *"a second copy of the document in main for the
duration — 1.00× becoming 2.00× against a 1.5× ceiling"*.

**It is not a fork in the road. It is a module that predates Decision 14 and
never took it** — a stale second opinion about how bytes reach the granted
directory (B3a), sitting beside `openEngineSession`, which implements the
decided route.

---

## Decision 1 — What a REGISTERED writer must supply is what the bus calls

`RegisteredWriter<W>` is `EngineWriter<WriterSession[W]> & CommandExecution<W>`
(`commandSpecs.ts:249`). The intersection is wider than the bus, and the excess
is precisely the part a remote writer cannot honour.

**Decided: a registered writer supplies `serialise` plus `CommandExecution`. It
does not supply `open`.**

- `capture`, `apply` and `invert` are how a command runs.
- `serialise` is how a **checkpoint** is taken, and the bus genuinely calls it
  (`commandBus.ts:199`) on the terminal branch — so it stays.
- `open` is how a session comes into existence, which is the **supervisor's**
  job by ADR-0023 Decision 9, in the process that can create a contained host.
- `close` is how one ends, and it belongs with `open`.

This is not a narrowing to fit a feature. It is the type stating what the one
caller needs — the bus — instead of what a session's whole life needs, which no
single component owns.

### Rejected — leave `open` on the registration and have the remote writer throw

A method nobody may call is *"a narrowing that reads as a decision and behaves as
a deletion"* (`documentService.ts`'s own words about a capability with no
minter). It would also be a lie the compiler endorses: the registry's type would
promise an opener and the object would refuse at the native call.

### Rejected — an accessor on `DocumentService` so `open(image)` can be fed

**Already refused, by name, in ADR-0023 Decision 14, on a measurement.** Cited
here so nobody re-derives it: an accessor hands out a reference, and the second
reference in main is 2.00× of file size against a 1.5× ceiling. The capability
exists so the second copy is *unrepresentable* rather than discouraged.

### Rejected — a second `WriterRegistry` shape for remote writers

Two registries for one bus is the second wiring place the registry exists to
forbid, one layer down.

---

## Decision 2 — A session's granted area is held by the registry that mints its token, not by the adapter

`remoteMupdfLifecycle` keeps a module-private `WeakMap<MupdfSession,
SessionArea>` populated **only inside its own `open`**. Every other member reads
it first:

- `serialise` (`remoteLifecycle.ts:180`) — `const area = areaFor(session);`
- `close` (`remoteLifecycle.ts:191`) — `const area = areaFor(session);`

So a session opened by anyone else throws from **both**, not only from
`serialise`. Naming one and stopping there is the half-fix Rule 0 warns about,
and it is recorded that way because the first write-up of this finding did
exactly that.

**Decided: the area is recorded beside the handle in `RemoteSessions`, the one
registry that mints the token.** `adopt` is already the single mint — a token
main holds and cannot dereference (Decision 10b) — and the area is the other
half of what that token stands for. One owner for one identity (B3).

The `WeakMap` is removed rather than kept in sync. Two places holding half of a
session's identity is how a token becomes valid for one operation and not
another, which is the exact defect being fixed.

---

## Decision 3 — Closing a session is a shipped call, and today it is not made

`EngineSessions.releaseOnClose` deletes the supervisor's entry and nothing else
(`engineSessions.ts:579`). It does not close the session on the host and does
not remove the granted directory pair. So a document closed today leaves:

- a live session in the host, holding whatever MuPDF holds for it;
- a snapshot directory containing **a readable copy of the user's document**,
  granted to the container, until the process exits.

The second is the one that matters. ADR-0023's per-session directories exist so
that *"a snapshot's lifetime is the **session's** rather than the host's"* — and
a lifetime nothing ends is the host's lifetime with extra steps.

**Decided: teardown closes the session through the writer and removes the pair**,
in that order, and a failure to close still removes the pair. The ordering is the
same one `openEngineSession` already uses in reverse, and the reason is the same:
by the time anything can fail, the user's bytes are on disk.

**This is why `close` stays paired with `open` rather than following `serialise`
onto the registration.** Both are the supervisor's, both are about a session's
existence rather than its contents, and separating them would put the two ends of
one lifetime in two places.

---

## What this ADR does not decide

**Whether `EngineWriter` itself should change.** It should not, yet.
`pdf-lib` and `signpdf` are byte-image writers whose `TSession` *is* the image,
and for those `open(image)` is honest and identity. The interface is right for
the shape it was written for; what was wrong is that a *registration* required
all of it. Deciding the interface's future needs a second live-session writer to
compare against, and PDFium is that writer, in Stage 5.

**Where the ordering of teardown lives.** Decision 3 says what must happen; which
module holds it is `apps/desktop`'s composition question and needs no ADR.

---

## Consequences, stated rather than discovered

- `remoteMupdfLifecycle` loses `open` and gains an area it did not mint. Its
  proof gains a control that a session opened **the way the composition root
  opens one** is serialisable and closable — which is the case that fails today
  and is the reason this ADR exists.
- `CommandBus`'s registry type narrows. Nothing registered today is affected,
  because nothing is registered today (`composition.ts:193` is
  `new CommandBus({})`) — which is also the one line standing between this
  design and exit clauses 3 and 4.
- The `mupdf` writer becomes registrable, and the first command that runs
  against a real host is `rotatePages`.
