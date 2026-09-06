# 0043 — An annotation this build wrote carries a private mark, and its absence is what foreign means

Date: 2026-09-06
Status: accepted
Supersedes: `docs/ARCHITECTURE.md` §4's first save invariant, which names a
`srcRef` marking scheme without defining one and states its evidence as
*"byte-identity is currently assumed, not measured"*.

## Context

Invariant L5 reads *"A save never rewrites annotations it did not author.
`srcRef` marking; foreign subtypes and form Widgets pass through
byte-identical."* Two things about that sentence have been true since it was
written, and both are now due.

**The set it names is not computable.** *Annotations it did not author* has never
had a mechanism behind it: nothing this build writes leaves any trace of who
wrote it, so at the moment of a save every annotation looks the same. The clause
has therefore been a description of an intention. `pageAnnotations.ts`' header
says so in as many words — *"It does not mark authorship"* — and refuses to
invent a scheme inside the first drawing tool, which was right: the tempting
fields (`/NM`, `/T`) already mean something else, and smuggling provenance
through one is the sidecar hack §3 bans by name.

**Its evidence has since been measured, and the claim as written is false.**
`foreignAnnotations.test.ts`, 2026-09-06, against MuPDF 1.28.0: on a plain save
of an untouched document, two entries out of ten come back re-encoded — a
literal with balanced parens `(see (this))` becomes `(see \(this\))`, and an
ASCII hex string `<414243>` becomes `(ABC)`. Everything else is untouched,
UTF-16BE hex strings included. So **byte-identity does not hold and
text-identity does**: no foreign annotation loses a key, a value or a character.

[ADR-0041](0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
closed the neighbouring question and said explicitly that it was not closing this
one: *"A handle says which one; the scheme says may I rewrite it. The eraser is
the first caller of both, and they are separate questions."* The eraser and the
select tool are the next two rows, and select is the first command in this
project that will move an object it may not have authored.

## What was measured first

A scheme that the writer of record cannot store is worth nothing, so MuPDF was
asked before anything was designed (measured 2026-09-06, MuPDF 1.28.0, a
one-page document, a `/Square` created and saved):

| asked | answer |
|---|---|
| `annotation.getObject().put('Monstera_Authored', true)` | accepted; reads back as `true`, `isBoolean()` true |
| the same with a name value, `document.newName('Monstera')` | accepted |
| the same with a string value | accepted |
| the key after a **save and reopen** | present, still `true`, listed among the annotation's keys |
| the key after a **second** save | present, still `true` |
| a key that was never written, `get('Monstera_Absent')` | `null` — MuPDF's shared null object, not a throw |

So the private key survives the full rewrite that L5 is about, which is the one
property the scheme depends on. That MuPDF preserves a key it does not
understand was already asserted from the other side: `foreignAnnotations.test.ts`
carries `/Sound` on a `/Square` precisely because a writer rebuilding the
dictionary from what it understands would drop it.

## Decision

### 1. The mark is a private key on the annotation's own dictionary

`/Monstera_Authored`, whose value is the boolean `true`. Written at creation, in
the one place that creates an annotation, and read in the one place that walks
them — the same two functions that already mint and resolve ADR-0041's handle,
eleven lines apart, for B3a's reason: *which objects here are ours* must have one
implementation or a second caller writes a second opinion.

The key is private data in a dictionary the format allows private data in, and it
carries a producer-specific prefix so it cannot collide with a key PDF defines or
another application writes. It is checked as a boolean rather than for presence:
a document carrying `/Monstera_Authored false`, or the key with a string value,
is foreign.

**It is not named `SrcRef`, and the difference is the scheme's whole shape.** A
source reference records where an object came from, which is a thing we can never
write — the objects whose origin is interesting are exactly the ones we may not
touch. This key records the only provenance fact this build is in a position to
state: *this application wrote this object*.

### 2. Absence is what foreign means

The scheme is one-sided by construction, and that is a consequence of the
invariant rather than a shortcut. We may not write onto an annotation we did not
author, so we can never mark one as foreign; the mark can only ever be positive,
and everything without it is foreign. An annotation from a document another
application produced has no mark. An annotation this build wrote in an earlier
session has one, because the mark is in the file rather than in a session.

### 3. `ListedAnnotation` reports it

The walk answers `authored: boolean` beside `page`, `index`, `kind` and
`contents`. That is what makes the set computable at the surface as well as in
the kernel: the annotations panel can say which marks came with the document, and
a tool can behave differently on one.

### 4. It is provenance, not permission

The mark does **not** gate what a person may do. Erasing an annotation another
application wrote is an ordinary thing to ask for and the eraser does it; the
select tool moves one when the person drags it. What L5 forbids is this build
rewriting an annotation **the person did not aim at** — a save touching objects
it had no instruction about — and the mark is what makes that claim checkable
instead of merely stated.

### 5. L5's text is corrected in the same commit

*Byte-identical* becomes what was measured: a foreign annotation passes through
a full save **text-identical**, with the two known re-encodings pinned by name in
`foreignAnnotations.test.ts`, and the divergence set asserted exactly so a
future MuPDF that re-encodes something else is a red build.

## Consequences

- The eraser and the select tool are unblocked, and both can tell the person
  what they are about to change.
- The annotations panel gains a fact worth showing, which is the first surface
  where *this came with the document* is visible at all.
- A proof can now assert L5 rather than paraphrase it: after a command, every
  annotation without the mark is text-identical to what it was.
- **Nothing retroactively marks anything.** Annotations this build wrote before
  this commit read as foreign, correctly by the scheme's own rule and wrongly as
  a matter of fact. There is no repair that is not a rewrite of objects on a
  guess, which is the thing the invariant forbids.

## The honest limits

- **A hostile document can write our key.** Then its annotation claims to be
  ours and a save may re-encode it. The cost is bounded by what the measurement
  above found — a spelling change that preserves the text — and the alternative
  is a signed or salted mark, which is cryptography to protect a claim whose
  worst outcome is two escaped parentheses.
- **The mark says who wrote the object, not who wrote its contents.** An
  annotation this build created and a person later retyped through another
  application still reads as ours.
- **It does not travel with an export that rebuilds the document.** Anything
  that reconstructs annotations rather than grafting them loses the mark, and
  the mark's absence then means *foreign* about an object we did write. No such
  path exists today; `graftPage` carries the dictionary whole and was measured
  doing so on 2026-09-06.

## Rejected alternatives

### `/NM`, the annotation's own name

Rejected in ADR-0041 for naming an annotation, and rejected again here for a
second reason. `/NM` is a per-page unique name **a producer writes** — reading
one as *we wrote this* misclassifies every foreign annotation whose producer set
it, which is most of them. It is also the key MuPDF was measured re-encoding, so
provenance would ride on the one entry known to change on the way through.

### `/T`, the annotation's title

`/T` is the name displayed as the annotation's author, and a person will
eventually type into it. A field that means *who said this* holding *which
program wrote this* is the sidecar hack §3 bans, and the first comment-authoring
row would collide with it.

### A table in main, keyed by handle

Provenance held beside the document rather than in it. Rejected because it does
not survive a save and a reopen — which is precisely the span L5 is about — and
because a handle is only meaningful against one version (ADR-0041), so the table
would have to be remapped by every page operation.

### Inferring authorship from the appearance stream

This build calls `annotation.update()` on everything it writes, so its
annotations all carry `/AP`; `applyAddAnnotation`'s own cases already tell the
two apart that way on a fixture. Rejected as a scheme: a foreign annotation may
carry `/AP` too — most do — so the inference is right about this project's
fixtures and wrong about real documents, which is the fixture-shaped trap the
audit's item 2 is about.

### No mark, and treat every annotation as foreign

The conservative reading, and it is not free: it makes L5 vacuous rather than
strict, since a rule that forbids touching everything is one the save pipeline
already breaks by existing. It also gives the eraser and select nothing to tell
the person.
