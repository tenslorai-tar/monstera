# ADR-0008 — Save mode is determined by the purpose of the save, not by a default

- **Status:** Accepted, with one question deliberately left open
- **Date:** 2026-08-16
- **Amends:** `docs/ARCHITECTURE.md` §4 (save pipeline) and §9 (invariants).
- **Evidence:** `scripts/spike/engineSpike.mjs` (R1–R5), and the incremental-save
  measurement recorded in [ADR-0007](0007-memory-budgets-and-the-document-size-ceiling.md).

## Context

An incremental save was executed for the first time while measuring the Stage 0
memory gate. It works: `canBeSavedIncrementally()` is `true`, saving one page
rotation appended exactly **201 bytes**, and the result reopened as 320 pages
with `/Rotate 90` intact and `countVersions()` 1 → 2.

The obvious next question is whether it should become the default. **It is the
wrong question.** Two cases are settled by the PDF format itself and are not
open to investigation, and treating this as a tunable default would leave both
to be discovered later — one of them as a security failure in shipped software.

## Decision

Save mode is a property of **what the save is for**. Three rules.

### 1. Never incremental when the purpose of the save is removal

Applies to: **redaction · sanitize · flatten · changing or removing
encryption · metadata scrub · password removal.**

These require a full rewrite with object garbage collection, and the output
must contain **zero prior revisions**.

The mechanism is the file format, not MuPDF's behaviour, so no test result can
change it: an incremental save *appends* a new revision and leaves the earlier
ones intact in the file. Anyone can walk the cross-reference chain backwards
and recover the previous revision — which, after a redaction, is the
un-redacted document. This is how real organisations have leaked documents they
believed were redacted.

It directly contradicts D7's promise of true content removal, so it is recorded
as an **invariant** (`ARCHITECTURE` §9.18) rather than as guidance. A redaction
that ships as an incremental save is a security defect, not a performance
choice.

### 2. Always incremental when a digital signature must survive

A full rewrite re-serialises the file and changes the byte ranges a PKCS#7
signature covers, which invalidates it. Also a property of the format. This is
the reason incremental save is worth having at all, and it is what makes D7's
"sign, then continue annotating without breaking the signature" possible.

### 3. Full rewrite is the default for everything else — for now

Ordinary edits (annotations, form fill, page-tree operations, rotation) use a
full rewrite today. This is the conservative choice: it is what the spike has
always exercised, and its output is predictable.

Whether incremental should become the default for ordinary edits is left
**open**, and is not to be settled by preference.

## The open question, and what must be executed to close it

Incremental save is currently proven for exactly one thing: a single rotation,
on one fixture, saved once. That is the easy shape. Before it becomes a
default, all of the following must be executed:

1. **Annotations, form fill, and page-tree operations** each saved
   incrementally, reopened, and verified — including a reorder, which rewrites
   the page tree in place and is the operation least like a leaf-attribute
   write.
2. **A document that already carries several incremental revisions**, saved
   incrementally again. Depth is the case where appending goes wrong.
3. **Growth behaviour over a long editing session.** Every incremental save
   appends; a session of hundreds of edits must not turn a 10 MB document into
   a 400 MB one. Measure, do not assume a compaction step exists.
4. **Does a full save preserve foreign annotations byte-identically?**
   Invariant L5 says a save never rewrites annotations the app did not author.
   A full rewrite re-serialises every object, so **L5 is currently assumed, not
   measured.** If MuPDF normalises string encoding, filter choice or
   compression on round-trip, then *full save already violates L5* — and that
   inverts this decision, because incremental would become the only mode that
   can honour it. The spike's current srcRef case checks that the foreign
   annotation *survives*, which is a strictly weaker claim than that its bytes
   are unchanged.
5. **Redaction of a document that already carries prior incremental
   revisions.** This is where rules 1 and 2 collide, and it is the case most
   likely to ship broken: verify the output carries no prior revisions at all,
   and that the redacted content cannot be recovered by walking the xref chain
   of the *output*. Verification must be by extracting text and searching the
   raw bytes, never by looking at the rendered page.

Item 4 is the one that could change the rule rather than merely confirm it, and
it is cheap. It should be executed first.

## Rejected alternatives

**"Default to incremental now."** Smallest writes, fastest saves, and it serves
L5 well by not touching bytes we did not author. Rejected because it is proven
for one operation on one fixture, and because items 3 and 5 above are exactly
the kind of failure that does not appear until a user has done real work.

**"Full rewrite always, simplest."** Rejected because it makes signature
preservation impossible, which is a D7 feature, not an edge case.

**"Make it a user setting."** A setting would expose a choice whose wrong
answer is a silent security failure in the redaction case. Rules 1 and 2 are
not preferences.

## Consequences

- `ARCHITECTURE` §4's "save is one pipeline" gains a mode selected by purpose;
  the pipeline itself (flush each writer once → atomic write → stamp saved
  version) is unchanged.
- Every command that will eventually route through the save pipeline must
  declare which of the three rules it falls under. A command whose purpose is
  removal cannot be added without classifying it.
- The Stage 7 security work inherits item 5 as a required proof, with a control
  case: the same redaction on a document *without* prior revisions must pass
  the same xref-chain check, so the check is proven to be looking at something.
