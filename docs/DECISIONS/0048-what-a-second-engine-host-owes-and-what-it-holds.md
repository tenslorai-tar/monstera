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

## Correction, 2026-09-09 — `engine/serialise` is not one of the seven, and a second host in the same AppContainer is not contained from the first

Both of these were found by writing the PDFium host against this document, on
the same day it was written. They are corrections rather than edits, because
what this document believed is the record — and the first one is a warning
about the shape of Decision 1's argument, not only about its answer.

### `engine/serialise` is the LIVE-SESSION shape's channel, and a byte-image host owes six

Decision 1's table lists seven as *engine-agnostic in shape*. Six of them are.
`engine/serialise` is not, and the reason is ADR-0047's, arriving one layer
down:

> Writes the session's current bytes into the output directory, under a name
> main chose.

A byte-image host's session **has** no current bytes. It holds a granted area
and no parse (Decision 2), so there is nothing for this channel to serialise —
and a host that declared it would answer it by copying its input to its output,
which is this document's own *process answering questions with nothing behind
it* wearing the shape of a channel that does something.

**What replaces it is not a seventh channel; it is `engine/apply`.** A
byte-image apply reads the image it is given, applies, and writes the result
into the granted output directory, answering a **count** — which is exactly
`engine/serialise`'s result schema. `CommandExecution<W>` has said so since it
was written: `apply` returns `Promise<ByteImage>` for a byte-image writer and
`Promise<void>` for a live-session one. So the asymmetry was already declared in
the type, and Decision 1 read the channel list without reading it.

The general form is worth more than the instance. **A channel is not
engine-agnostic because every engine can be asked it; it is engine-agnostic
because the answer means the same thing.** Six do. The seventh means *hand back
what you are holding*, and holding is precisely what ADR-0047 removed.

### How the input bytes reach a byte-image host, which ADR-0047 left for this commit

ADR-0047: *"**Settled by the commit that wires the first PDFium command**, and
named here so it is not discovered there."* It is settled here instead, one
commit earlier, because it turned out to be the same question as the one above
and answering it under a feature is what B4 forbids.

`engine/apply`, `engine/capture` and `engine/invert` carry, for a byte-image
engine only, the **names** of two files inside the directories the area already
grants: where the input image is, and where the output goes. Both are names and
neither is a place, which is `engine/open`'s `snapshotName` shape and
`engine/apply`'s `asset` shape — so nothing new can be expressed, and Decision
2's property is untouched. A live-session engine carries neither, and the type
says so rather than a comment: the fields come from the schema set an engine
supplies to `coreEngineChannels`, so main's MuPDF client **cannot** name an
output file and main's PDFium client cannot omit one.

**The cost is two whole-image writes and one read per command**, because the
bus calls `capture` and `apply` separately and neither may hold the file for
the other. That is the open question *whether capture and apply share one open*
arriving as a byte cost rather than a parse cost, and it is **not answered
here**: it stays open, now with a second reason to measure it.

### A second host needs its own AppContainer profile, or the separation is nominal

The rejected alternative *one host process serving both engines over one pipe*
was rejected because *a breach of one engine would then hold the other's
documents*. **That argument does not turn on the process.** It turns on the
principal in the DACL, and `hostSessionDirectoryDacl` names the AppContainer's
SID — which comes from a profile moniker, `monstera-engine-host`, that this
build resolves once and shares.

So two host processes created from the same moniker have the same SID, and each
one's granted areas are readable and writable by the other. The separation
would be a second process with the first's reach.

**This document therefore owes a third thing it did not name: a second engine
owes its own container profile, and its own areas within it.** What that costs
is a second moniker and the provisioning grant that goes with it; what it is
worth is the sentence the rejected alternative already relied on.

**And it is not free of ADR-0023's open branch.** The grant
`scripts/provision/containerGrants.mjs` writes names `ALL APPLICATION
PACKAGES`, which every AppContainer is a member of, so a second profile reaches
the install root in development exactly as the first does. Under a Store
install neither does — premise P1 is false, measured 2026-09-09 — and that is
Decision 16's, unmeasured, gating the containment branch and not the body.
Nothing here changes which of the three routes is taken.

## Correction, 2026-09-09 — Decision 3 is withdrawn: a byte-image host's `engine/open` registers an AREA and parses nothing, and the wire differences belong to the writer SHAPE

Decision 3 said a byte-image host's `engine/open` parses once and discards it,
*so `open-failed` means the same thing from both hosts*. It was written before
main's side of the call existed. Writing that side showed the premise is false
in two independent ways, and either one is enough.

### It has nowhere to keep a per-document id, and that is a fact about the seam

An `engine/open` that parses **a document** mints an id **per document**, and
main has to hold it somewhere. There is nowhere.

`CommandBus` hands a writer `WriterSession[W]`. For a byte-image writer that is
the document's **bytes** — ADR-0039's whole point, and what makes *which bytes
win* unaskable. Bytes carry no identity, so a registered PDFium writer receives
nothing it could look an area up by. `SessionsByWriter` cannot hold it either:
its `pdfium` slot is typed `ByteImage` for the same reason.

The alternative is to change what the bus hands a byte-image writer, which is to
put a document identity back into the one type ADR-0039 spent a decision
removing it from. That is a worse trade than the one Decision 3 was making.

### And `open-failed` does NOT mean the same thing to main, which was the whole argument

Decision 3's benefit was that *main's `open-failed` handling would be correct
for one host and dead code for the other* if the protocols differed. Read
main's handling: an engine session that cannot be created **poisons the
document** (ADR-0023 Decision 9a) — commands answer `document-poisoned` and
close-and-reopen is what clears it.

That is right for MuPDF, which is how the document is read at all. It is
**wrong** for PDFium, where the honest meaning is *this document cannot be
text-edited* — a refused command and nothing more. So making the two protocols
identical at that point would have made main's existing handling wrong for the
second host, which is the opposite of what the decision was buying.

### What replaces it

- **A byte-image host's `engine/open` registers a granted area and parses
  nothing.** It carries the two directories and no `snapshotName`, because at
  that moment there is no document. Decision 2 is untouched and is the reason
  the channel still exists: the place is named once and no later message can
  move it.
- **The area's lifetime is the HOST's, not a document's.** It is a transfer
  buffer, and every call mints a fresh file name inside it — which is
  `SessionAssets`' existing rule, and what makes one area safe for however many
  documents are open.
- **A document this engine cannot read fails the call that needed it**, with a
  declared code, at the moment the engine is actually wanted. That is a better
  moment than document-open: a document the viewer can display and PDFium
  cannot parse stays open and refuses one command, rather than being poisoned.

### The general form, which is worth more than the correction

Decision 1 already had to learn that a channel is engine-agnostic when its
**answer** means the same thing. This is the same lesson about the whole wire:
the differences between the two hosts are not PDFium's and MuPDF's — they are
**`byte-image`'s and `live-session`'s**, and `writerShapes` is the table that
names them.

So `coreEngineChannels` takes an engine's three command schemas and one **wire
shape**, and the wire shape is a constant per writer shape rather than a set of
fields each engine fills in. A third engine of either shape takes the matching
constant and supplies its commands. That is what makes *one host body,
parameterised by engine* a real claim rather than a set of parallel
parameters — and it is `writerShapes` reaching the wire, which is where a
declaration table that decides behaviour ought to reach.
