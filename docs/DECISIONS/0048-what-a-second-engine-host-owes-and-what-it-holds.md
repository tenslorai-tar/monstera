# ADR-0048 — What a second engine host owes, and what it holds between commands

**Date:** 2026-09-09
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §3** — a host's reader set
is its own engine's, and the host's table entry is a granted **area** to which a
live-session engine adds a document session. The amendment lands in the same
commit as this ADR, which carries no code (B4). **Nothing is built on it here.**

---

## The problem, in one sentence

`docs/ARCHITECTURE.md` §3 has required *one host body, parameterised by engine*
since 2026-09-08 and left two things unstated that a second host cannot be built
without: **which of the fifteen readers a second engine owes**, and **what its
table holds between commands** — the second having become a live question the
moment [ADR-0047](0047-an-in-place-text-edit-is-a-byte-image-command.md) made
PDFium a byte-image writer and listed *the host's generalisation* as not decided.

## Why now, and why not later

Stage 5's six remaining rows are PDFium's by `BUILD-PROMPT.md`:257 in both
columns. `KindsRoutedTo<'pdfium'>` is `never` today — 29 commands, 22 `mupdf`,
7 `pdf-lib`, none PDFium — and a zod union of zero options cannot be built, so
**the host and its first command land together**. That is precisely the shape
B4 exists to stop being answered under a feature: the host would be built while
somebody was building region replacement, and every question below would be
settled by whatever made that row work.

---

## Decision 1 — a second engine owes the seven engine-agnostic channels and its own reads, and none of the twelve MuPDF document-model reads

`engineChannels` holds **nineteen**, and they split cleanly:

| | channels |
|---|---|
| **engine-agnostic in shape** (7) | `engine/probe-containment`, `engine/open`, `engine/serialise`, `engine/close`, `engine/apply`, `engine/capture`, `engine/invert` |
| **MuPDF's document model** (12) | `page-geometry`, `page-text`, `page-links`, `destinations`, `layers`, `annotations`, `form-fields`, `exportFormData`, `flat-fields`, `duplicate-pages`, `extract`, `snapshotRegion` |

**A second engine owes none of the twelve.** They are MuPDF's document model
answered by MuPDF's host, which is not going away, and there is no question in
the application that would be better answered by asking a different engine the
same thing. PDFium owes the seven, plus one read of its own for the editing
rows.

The alternative that has to be named because it is the cheap one: a PDFium host
that *declares* the twelve and answers them with stubs. That is **a process
answering questions with nothing behind it** — the wired-tools rule at process
scale, and the display-only defect wearing a channel's clothes. Implementing
them for real is worse: a second reading of a document model `packages/kernel`
already has one reader for is B3a, and it would be a second opinion nobody
called for.

**The type is what says it, not a rule.** `EngineChannelsFor<W>` is the seven
plus that engine's own reads, so main's PDFium client **cannot express**
`engine/annotations` — a compile error rather than a runtime refusal, which is
B5 over a check. The runtime still terminates on an undeclared channel, because
the peer is hostile by invariant 25's premise and a compile-time property says
nothing about what arrives on a socket.

## Decision 2 — the host's table entry is a granted AREA, and a document session is what a live-session engine adds to it

`HostSession` is `{ session, snapshotDirectory, outputDirectory }` today, and
the two directories are held **against the id** on purpose. Its own comment says
why, and the reason is a containment property rather than convenience:

> a `serialise` that carried a directory would be a channel through which a
> confused main could redirect the document's bytes on every save

A byte-image host holds **no parse** between commands (ADR-0047), so the obvious
reading is that it needs no table at all and takes its directories per call.
**That is exactly the shape the sentence above refuses**, and it would be a
containment property given up as a side effect of an unrelated decision about
where a parse lives.

So the entry generalises rather than disappearing: it is a **granted area** —
which is the name main already uses for the pair, `SessionArea` in
`remoteEngine.ts` — and a live-session engine adds its document session to it.
A byte-image host's table holds areas alone.

**`engine/open` therefore does two different things and one of them is the
same.** For both engines it registers an area and mints an id main cannot
dereference. For a live-session engine it also parses and keeps the session; for
a byte-image engine it parses and discards it, which is Decision 3.

## Decision 3 — a byte-image host's `engine/open` parses once and discards it, so `open-failed` means the same thing from both hosts

The alternative is that a byte-image host's open validates nothing, and the
first command carries the parse failure instead. Then *this engine cannot read
this document* arrives at a different moment depending on which writer the row
routes to — and main's `open-failed` handling would be correct for one host and
dead code for the other.

The cost is one parse per open, and it is a parse that would otherwise happen at
the first command anyway. What it buys is that the two hosts answer the same
question at the same point in the same protocol, which is the property that
makes *one body, parameterised by engine* mean anything.

**Not measured:** what that parse costs on a large document through PDFium.
`FPDF_LoadMemDocument` is documented as lazy and `proof:editcost` measured
loading as far below the resolution of its clock, but neither is a reading of
this call on a large file and this document does not claim one.

---

## What this does not decide

- **How the input bytes reach a byte-image host.** ADR-0047 left it open and it
  stays open: `ByteImageAccess.current` answers a `ByteImage` in main, and the
  candidate is `adopt`'s `SnapshotWrite`. Decision 2 fixes only that a *place*
  is named once, not which bytes travel or when.
- **Whether capture and apply share one open.** Two channels, two calls, and a
  command that captures then applies would parse twice under Decision 3's rule
  as written. Left open deliberately — answering it needs a reading of what the
  second parse costs, which is the measurement above.
- **The containment branch's generalisation.**
  [ADR-0023](0023-how-the-contained-engine-host-is-built.md) Decision 16 is
  decided and **unmeasured**, and its own words say route A does not ship until
  measured. That gates generalising the containment branch to a second host; it
  does not gate the body, because no editing command reaches the install root.
- **HD render's reader session.** A read-only session recycled when the version
  moves is not the two-writers problem, and it owes a PDFium-against-PDF.js
  reading before it ships.

## Rejected alternatives

- **A second host body, copied and edited.** Rejected by §3's 2026-09-08
  amendment and not reopened here. What it duplicates is the pipe framing, the
  containment check, the failure classification and the shutdown ordering.
- **One host process serving both engines over one pipe.** Invariant 25 contains
  a compromise; a breach of one engine would then hold the other's documents.
- **One channel map for both engines, with a runtime refusal for the twelve.**
  The refusal is correct and the type is better: a client that cannot name a
  channel cannot call it by mistake, and the mistake this prevents is main's
  rather than the host's.
- **A wholly stateless byte-image host, taking both directories on every call.**
  Cheapest, and it gives up the property quoted in Decision 2 for a reason that
  has nothing to do with containment.
- **Deferring this until the second PDFium command needs it.** The retrofit B4
  exists to prevent, and here it has a specific cost: the first command would
  decide the table's shape, and the table's shape is a containment argument.
