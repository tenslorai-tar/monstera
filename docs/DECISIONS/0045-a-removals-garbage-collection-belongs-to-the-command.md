# ADR-0045 — A removal's garbage collection belongs to the command that removes

**Date:** 2026-09-07
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §4 and §8's seam.** The
architecture amendment is a separate commit (B4); this ADR is the reasoning
behind it.

---

## The problem, measured

`docs/ARCHITECTURE.md` §4 has said this since 2026-08-16:

> Every command that reaches the save pipeline declares which row it falls
> under. A command whose purpose is removal cannot be added without classifying
> it.

**Flatten is the first command whose purpose is removal, and there is nowhere to
put that classification.** `commandDeclarations.ts` has nine axes and none of
them is purpose; `EngineWriter.serialise(session)` takes no mode; and
`mupdfWriter.ts` documents its own save as *"an empty option string is a plain
save: no incremental update, no garbage-collection pass"*.

What that costs is measured rather than argued
(`scripts/research/formFieldFlatten.mjs`, 2026-09-07). `bake(false, true)`
unlinks every widget — the walk answers zero and `@cantoo/pdf-lib` lists no
fields — and then the save writes them out anyway:

| save | objects | widget dicts | field dicts |
|---|---|---|---|
| unbaked fixture | 49 | 9 | 8 |
| `bake` + `saveToBuffer("")` | **55** | **9** | **8** |
| `bake` + `saveToBuffer("garbage")` | 22 | 0 | 0 |

The object count **grew**. Every flattened field's value stays readable to
anything that walks the cross-reference table instead of the catalog, which is
invariant 19's mechanism arriving through a route ADR-0008 did not name: not an
incremental save leaving a prior revision, but a full save carrying orphans.

## The decision

**Two parts, and the second is the one that is not obvious.**

1. A command declares its **purpose**, and the declaration is the writer's
   instruction: `EngineWriter.serialise(session, purpose)`, with
   `purpose: 'ordinary' | 'removal'`. A live-session adapter maps `'removal'`
   to MuPDF's `garbage` write option; there is no default and no setting, which
   is ADR-0008's rule kept rather than restated.

2. **The garbage collection happens where the command's bytes are made, not
   where they are written.** §4 assigns the mode to the save pipeline. That is
   right about a *disk* save and insufficient as the whole rule, because the
   save pipeline is not the only thing that emits a document's bytes.

## Why part 2, which is the whole of this ADR

`savePipeline.ts`'s `saveDocument` takes a `flush: () => Promise<ByteImage>` and
writes what it is handed. It cannot garbage-collect bytes that reach it already
serialised. So *"the pipeline chooses the mode"* has to mean *"the pipeline's
flush chooses it"*, and at that point the question is which flush.

`CommandBus.execute` already serialises after every terminal command, to take
the checkpoint ADR-0021 retains. If the removal's collection is deferred to the
disk save, then between the flatten and that save:

- **the canonical image carries the orphans**, and `document.readRange` answers
  the renderer out of it (ADR-0031);
- **the checkpoint carries them**, and a checkpoint restore (ADR-0037) writes
  bytes that were never collected;
- **every other byte-emitting path carries them** — save a copy, extract pages,
  export, the range served to a renderer — and each one would have to remember
  the removal rule for itself.

That last is the decisive one, and it is B3a rather than a list of bugs: a rule
re-derived at each site that emits bytes is a rule with several opinions about
what removal means, and a partial reimplementation is the dangerous shape
because it agrees with the authority most of the time. **One writer per
concern**: the command that removes produces removed bytes, once, and nothing
downstream has a question to answer.

It also costs nothing. That serialise happens on every terminal command anyway;
the removal case changes its option string, not its existence.

## Rejected alternatives

### Garbage-collect every save

The smallest diff and it needs no axis at all. Rejected on ADR-0008's own words
— *"the pipeline has one mode, and the purpose of the save chooses it — never a
default, never a setting"* — and on a second ground that is specific to this
repository: `foreignAnnotations.test.ts` pins the exact set of entries a plain
save re-encodes, measured at two of ten, because *a save never rewrites
annotations it did not author* is an invariant with a pinned divergence set. A
collecting save is a different write path and that set is not known to be the
same one. Making every save take an unmeasured path to fix one command is the
shape Rule 0 calls a workaround.

### A second seam method, `serialiseForRemoval(session)`

Rejected on B5. A parameter with a two-member union makes an adapter that
handles neither case a compile error and an adapter that handles one a visible
omission; a second method makes *not implementing it* the silent default, and
every writer that cannot collect would carry a stub whose failure is a runtime
one.

### Classify the disk save from the command log

Derive the purpose at save time by asking whether any removal command has been
applied. It works for the disk file and leaves all four leaks listed above, and
it puts the rule in the one place that has to consult history to apply it —
which is the second opinion this ADR exists to prevent.

### Do not ship flatten; record the block

Legitimate, and it is what the measurement would have justified if the amendment
were a stage's work. It is not: one axis, one parameter, one option string and
the registration that carries them across the host boundary.

## Consequences, including the unpleasant ones

- **`serialise` crosses the engine host**, so the purpose is a field on
  `engine/serialise` and a bounded enum on the wire. A host that ignored it
  would produce an uncollected image, which is why the adapter's mapping is
  exhaustive over the union rather than an `if`.
- **The axis has two members where §4's table has three rows.** The third —
  *always incremental to preserve a signature* — is deliberately absent. It is a
  property of how a **file is written**, not of what a command's bytes contain,
  and no command can express it until Stage 7 has a signature to preserve.
  Declaring a member nothing can produce is the shape this project has already
  paid for in an unreachable enum case; the axis gains it when signing does.
- **A removal command pays a collecting save.** Not measured on an object-dense
  document, and it is the same order as the save it replaces rather than an
  addition to it. Stated as unmeasured rather than assumed small.
- **`'ordinary'` is a positive name, not `'plain'` or a boolean.** A boolean
  would encode the mechanism (*does it collect*) at every declaration site, and
  the mechanism is the adapter's business; the purpose is the command's.

---

## Correction, 2026-09-07, the same day — the purpose is the SESSION's, not the executing command's

Written while building it, against the code rather than against the reading of
it. **The decision above stands and one sentence supporting it was false when it
was written**, which is this project's own rule about a claim recorded more
strongly than its evidence: nothing had changed, so no sweep would ever have
found it.

The false sentence is *"`CommandBus.execute` already serialises after every
terminal command… the removal case changes its option string, not its
existence."* It does not serialise after. It serialises **strictly before
apply**, and the code says so in a comment — that serialise is the checkpoint,
and a checkpoint is the document as it stands *before* the command it is stored
on. So a flatten's own execution produces no bytes at all: a live-session
mutation lands in the engine session and `docs/ARCHITECTURE.md` §2 is explicit
that the record's bytes are not replaced.

**And there is no in-session collection to reach for instead.** MuPDF collects
at write time; `mupdf.d.ts` 1.28.0 exposes no garbage-collection method on
`PDFDocument`, so nothing can make the session clean at the moment of the bake.

### What that changes

The orphans live in the **session**, from the bake until the session is closed.
So the property being declared is not *what these bytes are for* at one call
site; it is **what has been applied to this session**. Once a removal has run,
every serialise of that session must collect — the checkpoint the next command
takes, the disk save's flush, save-a-copy, extract, export.

The declaration axis is unchanged and still required: §4 asks a command to
classify itself and `purpose: 'removal'` is that classification. What changes is
who reads it. **One resolver answers *what purpose must this document's bytes be
serialised for*, from the commands that have been applied, and every call site
takes its answer** — which is the same B3a argument the body makes, arriving one
level up from where it was written.

### The rejected alternative that this partly rehabilitates

*Classify the disk save from the command log* was rejected above for leaving
four leaks. That rejection was of the **scope**, not of the mechanism: reading
the log to classify **one** call site leaves the other four, and reading it to
classify **every** serialise is the design. The distinction is worth keeping
rather than quietly dropping, because the sentence *"it puts the rule in the one
place that has to consult history to apply it"* was the wrong objection — a
removal's effect on a session **is** history, and there is nowhere else for that
fact to live.

*Collect every save* and *a `serialiseForRemoval` sibling* remain rejected on
the grounds given, unchanged.

---

## Correction, 2026-09-07 — it landed as adapter state, not as a resolver every call site asks

Found by `npm run sweep:prose "one resolver answers"` while sweeping the
architecture for the previous correction's own claims — which is the compensation
NNN-4 requires, working, and it found this file rather than the one being swept.

The correction above ends: *"One resolver answers what purpose must this
document's bytes be serialised for, from the commands that have been applied,
and every call site takes its answer."* The principle is what shipped and the
**mechanism is not**. What shipped is state on the adapter that owns the
session: `mupdfWriter.ts` holds a `WeakSet` of sessions a removal has been
applied to, `withDocumentRemoving` adds to it, and `serialise` reads it.

Three reasons it went that way, and the third is the one that makes it better
rather than merely different:

- **The adapter cannot reach the command log.** The log lives on the document's
  record (ADR-0009) and the writer is registered on the bus; a resolver reading
  one would have to be threaded to every call site, which is the parameter this
  correction had just rejected wearing a different name.
- **A `WeakSet` keyed on the session token cannot outlive the session**, and a
  closed session can never be serialised again.
- **A resolver every call site asks is still a rule five callers apply.** State
  on the component that owns the thing is B5: there is nothing to pass, so there
  is nothing to forget. That is the same move `serialise` losing its parameter
  made, one layer further in — and having made it once and then written a
  resolver into the correction is exactly why *a correction is a claim too*.

The transition is one-way: nothing removes a session from the set, because a
document that has had content removed does not stop having had it, and the
absent transition is the one whose bug is a leak.

**Three corrections to one ADR in one session is a fact about this ADR worth
leaving visible.** Each was found by executing rather than by re-reading, and
each moved the mechanism while the decision — *the command that removes produces
removed bytes, once* — has not moved at all.
