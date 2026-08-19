# ADR-0009 — Document identity, the command log, and the engine seam

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** `docs/ARCHITECTURE.md` §2 (document ownership), §3.2 (engine handle
  invalidation), §4 (undo and versions), §9 (invariants).
- **Supersedes:** nothing in the founding record. Part C2 and C4 are silent on
  every question below; this ADR settles them rather than contradicting them.
- **Evidence:** measured `fs.realpath` behaviour (below), spike cases R1–R5,
  and three independently authored designs, each adversarially critiqued.

## Context

`DocumentService` and `CommandBus` are the last Stage 0 substrate before the
exit path. `ARCHITECTURE` §2 says who owns what and §4 gives the undo model,
but neither settles the questions an implementation is forced to answer — how a
`DocId` is derived, what a second open of the same file returns, what an inverse
actually stores, whether redo exists, what "dirty" means, or how concurrent work
on one document is ordered.

B4 requires those be settled in law before the code exists, in a separate
commit, so this ADR precedes the implementation rather than describing it.

## The falsified premise

The kernel's own comment and `docs/JOURNAL.md` both stated that identity would
come from `fs.realpath`, "which resolves symlinks and returns the canonical
case". **`fs.realpath` does not return the canonical case.** Measured on
Windows 11, Node v24.12.0:

| Input form | `fs.realpath` | `fs.realpath.native` |
|---|---|---|
| wrong case (`c:\...\alpha.pdf`) | returns the caller's case unchanged | `C:\...\Alpha.PDF` |
| 8.3 short name (`DOCUME~1\ANNUAL~1.PDF`) | returned verbatim | fully expanded |
| directory junction | path resolved, **case not** | both resolved |
| `\\?\` extended prefix | throws `EISDIR` | resolved |
| forward slashes, dot segments | folded | folded |

The mechanism: Node's JS `realpath` resolves symlinks by `lstat`-walking but
reconstructs every non-link component from the caller's own string — it never
asks the directory for the stored name. `realpath.native` calls libuv's
`uv_fs_realpath`, which on Windows is `CreateFile` + `GetFinalPathNameByHandle`
and returns the name as recorded on disk.

Had the stated primitive been used, `C:\a\b.pdf` and `c:\a\b.pdf` would have
produced two `DocId`s over one file — two command logs, two save pipelines, the
second silently discarding the first's edits. That is the exact data loss the
comment was written to prevent.

Note also that **`fs.promises.realpath.native` does not exist** — only the
callback `fs.realpath.native` and `fs.realpathSync.native`. The async form is
`promisify(fs.realpath.native)`, stated explicitly rather than assumed.

## Decisions

### 1. Identity is a three-way split

| Name | Names a | Visible to |
|---|---|---|
| `FileHandle` | a path **string** | the renderer |
| `CanonicalPath` | a **file** — from `realpath.native` | kernel-private |
| `DocId` | an **open document** | the renderer |

`CapabilityRegistry` is untouched: it keeps minting per path string and keeps
**not** canonicalising, because a fallible normaliser inside a security
primitive makes the primitive's correctness depend on the normaliser's.

`DocId` is **minted, never derived** — 256 random bits, the same way a
`FileHandle` is. Rejected alternatives:

- **A hash of the path.** It is the path in a lossy coat: the renderer can
  confirm a guessed filename by comparing hashes, and identity would change when
  the file is renamed, so an open document would acquire a new identity
  mid-session.
- **A counter.** Ids get reused after close, so a late renderer message naming
  document 3 lands on a *different* document that now holds id 3 — precisely the
  cross-document corruption invariant 10 exists to prevent. A random token makes
  that a lookup miss instead of a silent write to the wrong file.
- **`{dev, ino}`.** Our own atomic save (temp → fsync → rename) replaces the
  file index, so identity would change without the document changing.

### 2. One file is one document

Dedup lives in `DocumentService`, keyed by `CanonicalPath`, never by comparing
`FileHandle`s or raw paths. A second open of the same file returns the **same
`DocId`**, and returns it as a distinct outcome variant carrying no state — so
"render a second copy of an already-open document" cannot be written down.

**A not-yet-existing path gets no identity at all.** `realpath.native` throws
`ENOENT`, and there is no honest canonical form to compute; hand-folding case
and joining a canonicalised parent would reintroduce exactly the fallible
normaliser kept out of `CapabilityRegistry`. Save As therefore establishes
identity **after** the rename, when the OS can finally answer. `ENOENT` and
`ENOTDIR` mean "absent"; every other errno rethrows, so this is not a
`catch {}` wearing a normaliser's clothes.

**Close removes the document from the index synchronously**, before awaiting
teardown. This makes invariant 10 a lookup miss rather than a discipline every
commit path has to remember.

### 3. Inverses record prior state, verbatim, including absence

This is the finding that shaped the log, and it came from executing the easiest
imaginable command rather than reasoning about it.

Spike R3: the inverse of rotating a page that **inherited** its rotation is
`delete('Rotate')`, not writing back the value that was showing. Both render
identically; only `delete` restores the same document. Write-back leaves the
leaf declaring what it used to inherit, so it silently stops tracking its
branch.

Spike R4: MuPDF stores `/Rotate 45`, `450` and `-90` verbatim through a round
trip. Documents in the wild carry such values.

Together those two forbid a quantised inverse. If prior rotation were typed as a
quarter turn, rotating a page carrying `/Rotate 45` and undoing would write back
a *normalised* value — silently rewriting the document, which is R3's defect
wearing different clothes. So:

- prior state is `{ present: false } | { present: true; raw: number }`
- **forward commands normalise; inverses restore verbatim.** The asymmetry is
  deliberate and is the whole point.

This generalises past rotation: **every attribute-writing command over an
inheritable key needs prior own-state, not a reversing operation**, because
inheritable attributes are a general feature of the page tree.

The lesson worth keeping: **an inverse that restores the rendering is not an
inverse.** A test comparing rendered output passes on the wrong implementation.

### 3a. Reproducibility is a second axis, declared per command

Added 2026-08-17, before any command exists, because retrofitting it means
rewriting the log rather than extending it.

Invertibility ("can this be undone") and reproducibility ("does repeating it
produce the same bytes") are **independent**. A command that is not reproducible
— signing, which stamps a timestamp and signs over an exact byte range; OCR,
whose output moves with the engine version; AI, nondeterministic by design;
anything minting random PDF object identifiers — **records its effect rather
than its intent**, and replay re-applies the stored effect instead of re-running
the operation.

Stage 6 and Stage 7 both depend on this, and invariant 22's "no mutation may
exist only on the handle" is met by either form.

### 4. The log is a cursor, and redo exists

Neither the founding record nor `ARCHITECTURE` mentions redo. It is added now
rather than later because converting a stack into a cursor-plus-log is a
structural change *beneath already-built features*, which is the failure this
project exists to prevent. Undo moves a cursor and never pops; redo moves it
forward; a new command truncates the tail.

A log entry is one of exactly two shapes:

- `{ kind: 'invertible'; command; inverse }`
- `{ kind: 'terminal'; command; checkpoint }`

so **a non-invertible command without a checkpoint is unrepresentable**, and the
checkpoint is taken by the bus before `apply`, in one code path, never by a
handler.

### 5. `DocVersion` counts, `savedVersion` decides dirtiness

`DocVersion` starts at 1 (0 is reserved for "never"), is monotonic, is never
reused, and is bumped by every applied mutation **including undo and redo** —
so a late async result stamped with an old version is unambiguously stale.

`dirty` is `savedVersion !== currentVersion`. It is **not** cursor equality:
once a new command truncates the redo tail, the cursor can land back on the
saved index while the content differs, and the document would render clean while
holding unsaved work. Opening seeds `savedVersion` from the initial version, so
an untouched document is not dirty and closing it prompts nobody.

### 6. Routing is a mapped type, not a switch

Every command kind has a spec declaring its writer of record, and the registry
is a mapped type over the command kind union — the same mechanism that already
makes the IPC `Handlers` exhaustive. Omit a kind and it does not compile; add an
unrouted one and it does not compile. A spec's `apply` is bound to the session
type of its *declared* writer, so a B3 violation is a type error at the point of
authoring rather than a review comment.

The `Command` union is declared **once**, as a zod discriminated union in
`@monstera/contract`, with the TypeScript type inferred from it. Inverses stay
kernel-only: they carry structural prior state the renderer must not see, and a
renderer-supplied inverse would let the UI dictate undo.

### 7. One serial lane per document — covering save and close, not just commands

Two commands on one `DocId` queue; they do not interleave and are not rejected,
because rejecting on contention loses user intent and pushes a second scheduler
into the UI. The queue is capped so a runaway loop surfaces as a busy failure
rather than growing without bound.

**Save, queries and close run in the same lane.** This is not a detail: a save
that serialises the live engine session while a command mutates it writes a byte
image mixing pre- and post-command state, and the atomic rename then promotes
that over the user's file. Leaving byte-producing reads outside the lane is a
one-line omission with a corrupted-document consequence.

Query results carry the version **echoed by the engine host with the reply**,
never read from a main-side field after the await — otherwise a query that
executed at v3 gets stamped v4, the renderer's staleness check passes, and it
caches stale content as current.

### 8. The engine seam

Amends §3.2. "All engine handles invalidated together on any mutation", read
literally, forces the writer to re-parse its own output on every command. The
rule becomes: **the writing engine's session is mutated in place and
version-stamped; every non-writing engine's handle is invalidated.** One parse
per engine per version is preserved; a needless re-parse per command is not.

Two constraints the seam must satisfy from the start:

- **It must express whole-byte-image writers, not only index-based ops.** Three
  of the four writers of record — @cantoo/pdf-lib field creation, PDFium text
  editing, @signpdf — consume and produce whole byte images. A seam modelled
  only on live-session operations works for MuPDF and breaks at Stage 4, which
  would be a seam redesign underneath features already built.
- **`DocumentService` keeps the canonical bytes** (as §2 already says). An
  engine that solely holds current state has no recovery when its process dies —
  and [ADR-0007](0007-memory-budgets-and-the-document-size-ceiling.md) makes
  killing that process the *designed* response to a memory breach.

### 9. Errors crossing to the renderer are path-sanitised

Filesystem errors carry absolute paths in `message`. Passing them through
structurally leaks exactly what invariant 2 exists to prevent — a larger leak
than the path oracle used to justify minting opaque `DocId`s. The boundary maps
them to structured failures carrying no path.

## Left open, deliberately

Recorded rather than guessed, each with what would settle it:

- **Checkpoint retention and spill.** At 200 MB, two resident byte checkpoints
  already exceed main's ADR-0007 budget, so checkpoints cannot live on the main
  heap. The policy is decided against the Stage 0 performance gate, not ahead of
  it. §4's "every N commands" has no N until then.
- **Log granularity for page-tree commands.** A 5,000-page reorder must carry a
  full permutation (a short list is a *delete*), so freezing plans at engine-op
  granularity stores 5,000 numbers forward and 5,000 back per drag, for an
  intent that is "move page 3 to index 10". Plans are data — that part is right,
  and it serves the log, the crash journal and the worker boundary — but the
  granularity should be intent, not engine op. Settled when the second command
  lands.
- **`deletePages` has no cheap inverse.** Restoring a deleted page needs its
  objects, which cannot ride in a serialisable inverse, so it falls to
  non-invertible and forces a full checkpoint per delete — while §4 reserves
  checkpoints for redaction, flatten, encryption and OCR precisely because they
  are the exception. Flagged now so Stage 2 does not discover it.

Each of these is here because `rotatePages` is the *easy* shape — single engine,
in place, index-based, tiny inverse — and a design verified only against the
easy shape is not verified.

---

## Correction, 2026-08-18 — `realpath.native` is not sufficient for identity

The measured table above covers case folding, 8.3 short names and the `\\?\`
prefix. It omits the shape this application's users generate constantly, and
measuring it (`scripts/spike/pathIdentity.mjs`) shows the decision above is
**wrong as stated**.

### What was measured

One file, five path forms, on this machine:

| Form | `realpath.native` | `dev:ino` |
|---|---|---|
| `C:\…\probe.txt` | `C:\…\probe.txt` | `1182584447:14918173765904544` |
| `\\localhost\C$\…\probe.txt` | **`\\localhost\C$\…\probe.txt`** | `1182584447:14918173765904544` |
| `\\?\C:\…\probe.txt` | `C:\…\probe.txt` | same |
| `\\?\UNC\localhost\C$\…` | `\\localhost\C$\…` | same |
| `Y:\…` via `subst` | `C:\…\probe.txt` | same |

**`realpath.native` yields TWO identities for one file. `dev:ino` yields one.**

A DOS device mapping (`subst`) *is* resolved back to its target — so
`GetFinalPathNameByHandle`'s DOS volume-name flag does unfold drive
substitutions. A **UNC path is not folded to its local equivalent**, and nothing
in libuv's call would make it: the UNC *is* the canonical DOS-namespace name for
a redirector path.

Separately, hard links: `mklink /H` produces two names, `realpath.native` returns
each unchanged — it cannot fold them, **by construction**, because both are
equally canonical — while `dev:ino` is identical for both (`nlink=2`).

### What this means for the decision

`Z:\reports\annual.pdf` from Recent Files and
`\\server\share\reports\annual.pdf` from a colleague's link are one file. Under
identity-by-`realpath.native` they are **two `DocId`s, two command logs, and a
second save that discards the first's edits.**

### A claim in the first draft of this correction was wrong, and is withdrawn

That draft said `dev:ino` "requires the file to exist, which the Save As / ENOENT
resolution explicitly does not", and treated that as a second design gap.
**There is no such conflict.** §1 above resolves a not-yet-existing path by
giving it *no identity at all* — `realpath.native` throws `ENOENT` and Save As
establishes identity **after** the rename. Measured, rather than re-reasoned:

| Input | `realpath.native` | `statSync` |
|---|---|---|
| missing file | `ENOENT` | `ENOENT` |
| path through a file | `ENOENT` | `ENOENT` |

**Identical failure modes.** Both mechanisms have the same existence
requirement, so `dev:ino` does not fail that constraint any differently. The gap
narrows from two questions to one.

### What would invalidate these rows

**Every path-form measurement in this correction was taken on Node v24.12.0,
libuv 1.51.0, Windows 11 (10.0.26200), x64.**

Pinned because the rows are behavioural claims about
`uv_fs_realpath` — `CreateFile` plus `GetFinalPathNameByHandle` — and a Node or
libuv change could alter which volume-name form it returns without anything here
noticing. The constructed-identity cases in
`packages/kernel/src/documentIdentity.test.ts` exercise the *rule*, not the
platform, so **they keep passing if the platform's folding behaviour drifts**.

This is record-keeping rather than risk, and the merge-only design is why. A form
that stops folding stops *merging* — it never starts merging wrongly — so drift
degrades to two documents over one file, which the save-time re-verification
against the actual file catches as an error rather than an overwrite. The
consequence is bounded by the rule's shape, not by the accuracy of these
versions.

Re-run `scripts/spike/pathIdentity.mjs` on an engine upgrade or a Node major, and
correct the rows if they move.

### Extended measurement: a redirector path by machine name

`\\localhost\` is a special case Windows treats differently from an ordinary
share, so the same file was measured again through the machine's own name —
`\\EMEM-PC\C$\…`, a normal redirector path:

| Form | `realpath.native` | `dev:ino` |
|---|---|---|
| `C:\…\f.txt` | `C:\…\f.txt` | `1182584447:3377699720809809` |
| `\\EMEM-PC\C$\…\f.txt` | `\\EMEM-PC\C$\…\f.txt` | *identical* |
| `\\localhost\C$\…\f.txt` | `\\localhost\C$\…\f.txt` | *identical* |

**Three distinct `realpath.native` values for one file — the two UNC forms do not
even fold to each other. One `dev:ino`.**

### What remains unmeasured, stated rather than inferred

- **A genuine mapped network drive.** `net use` fails with "the network name
  cannot be found" for the admin share, from both Git Bash and `cmd`, while Node
  opens the same UNC path successfully. Mapping appears to need elevation this
  session does not have. **The `Z:` → `\\server\share` fold is inferred from its
  neighbours, not measured. Do not build on that inference.**
- **A remote share on a different volume and a different server implementation.**
  Every share reachable here is this machine's own NTFS volume, so a matching
  file index proves less than it looks. `net share` returns "Access is denied";
  WSL is installed with **no distribution**, and adding one needs the same
  elevation. Attempt abandoned rather than fought, per the time box.

A corporate NAS may report file indexes differently, or report zero. The rule
below is designed so that this uncertainty cannot cause loss.

### Decision: identity may MERGE on `dev:ino`, never SPLIT on it

This degrades safely whatever a future measurement returns.

| `realpath.native` | `dev:ino` | Verdict |
|---|---|---|
| match | — | **Same document.** High confidence, no dependence on file indexes |
| differ | match | **Same document.** The fold for UNC-versus-mapped, and for hard links |
| differ | differ | **Different documents** |

`dev:ino` is only ever allowed to *join* two paths that `realpath.native` kept
apart. It can never separate two paths `realpath.native` agreed on, so a
filesystem that reports unstable or zero indexes degrades to today's behaviour
rather than to a new failure.

The only risk is in the middle row, and it is a **false merge** — corruption
rather than loss. Guarded:

- **`dev:ino` must be non-zero.** A filesystem that supplies no index supplies no
  evidence, and zero is what that looks like.
- **A second attribute must corroborate** before merging — size and last-write
  time. Two genuinely distinct files colliding on file index *and* size *and*
  last-write time is not worth designing against.

### The save-time check is independent of all of it

Before writing, verify **against the actual file** that no other `DocId` is
managing it.

No path-derived identity can cover a file being replaced, renamed or hard-linked
*while open*, so this check is needed whatever wins. With it in place, a **false
split becomes a caught error rather than a silent overwrite** — which is what
makes the merge-only rule safe to ship ahead of the missing measurement.

### Consequence

`DocumentService` is built on the merge-only rule now. If a real share ever
contradicts a row above, the correction is a **verdict change rather than a
rewrite**, because nothing catastrophic was reachable in the meantime.

**Hard links are folded** by the middle row, so they are not a limitation under
this rule. They would be one under identity-by-`realpath.native` alone, and that
is precisely what this rule replaces.

---

## Correction, 2026-08-19 — row 1 compares EXACTLY; the case fold was the defect

Found by stage audit `caa59d0..d9f01b0`, finding R-2. **Row 1 of the rule above
is unchanged. What changes is how "equal" is computed**, and the answer is that
it is not computed at all.

### What was wrong

`isSameDocument` compared canonical paths with
`localeCompare(a, b, undefined, { sensitivity: 'accent' })`, and the comment
above it gave the justification: *"a caller may hold a value from a different
source, and NTFS is case-insensitive."*

That comparison is **locale-dependent**. Measured:

| locale | `FILE.pdf` vs `file.pdf` | `resume` vs `résumé` |
|---|---|---|
| `en-US` | EQUAL | differ |
| `tr-TR` | **differ** | differ |
| `lt-LT` | EQUAL | differ |

Under a Turkish locale the plain case pair stops matching, because both strings
contain `I`/`i` and Turkish collation pairs those with other letters. A row-1
miss where no file index exists is a **false split**: two `DocId`s for one file,
two command logs, one save discarding the other's edits.

### The obvious repair was worse, and this is the part worth keeping

`toUpperCase()` is locale-**in**dependent, so it fixes the split. It also
introduces a **false merge**, which is the worse direction. JavaScript expands
`ß` to `SS`; NTFS's `$UpCase` is a 1:1 16-bit table that cannot expand one code
unit into two, so it maps `ß` to itself.

Measured on this filesystem rather than reasoned about:

```
'straße.pdf'.toUpperCase()            -> 'STRASSE.PDF'
directory holds 2 file(s): STRASSE.pdf, straße.pdf
  straße.pdf   dev:ino -> 1182584447:5066549581804663
  STRASSE.pdf  dev:ino -> 1182584447:3659174698251406
NTFS treats them as TWO DISTINCT files.
CONTROL — plain ASCII case still folds: ONE file
```

So `toUpperCase` reports two genuinely distinct documents as one. The second
open returns `already-open`, one file becomes unopenable, and a write can land
on the other. That is a locale-independent false merge traded for a
locale-dependent false split — **the same class, a different character set**.

### The fold itself was the defect

Every fold on offer is wrong for some character class, and the reason a fold was
there at all is a limit nobody established: **the foreign caller did not
exist.** `canonicalPath` had one producer (`realpathNative`) and one consumer
(row 1).

So the fold is deleted and the comparison is `===`. `CanonicalPath` is now a
branded, kernel-private type with **no exported constructor**, so a hand-built
path cannot become one — a future caller holding a value from a different source
is a **compile error**, which is what the old comment was reaching for and could
not express (rule B5).

### Why exact comparison is strictly safer here

- **Where `dev:ino` exists, row 1 is an optimisation.** Row 2 carries the merge,
  so a row-1 miss degrades into a row-2 merge rather than into a split.
- **Where `dev:ino` is absent, row 1 is the only path** — and both sides still
  come from `realpath.native`, which the measured table above shows returns the
  name as recorded on disk, with case corrected. A false split would require
  that call to return two different strings for one file, which is the one thing
  it is specified not to do.

### Two controls, because three designs must be told apart

A proof that killed only the locale fold would have passed `toUpperCase()`, and
the merge bug would have shipped. Each case carries its own control asserting
the hazard is real in this runtime — an explicit `'tr'` collator so CI can see a
locale hazard it was structurally blind to, and the `toUpperCase()` expansion
named directly.

| implementation | `LOCALE FOLD` case | `UPPERCASE FOLD` case |
|---|---|---|
| `===` (shipped) | passes | passes |
| `localeCompare(…, undefined, …)` | **red** | passes |
| `toUpperCase()` | **red** | **red** |

Verified by substituting both, not by reasoning about it.

---

## Correction, 2026-08-19 — the instrument that produced the table above could report the opposite, silently

Same audit, finding R-1. **No row in the measured table changes.** What changes
is that re-measuring now refuses rather than lies, and the invitation this
document extends — *"what would invalidate these rows"* — stops being a trap.

`scripts/spike/pathIdentity.mjs` produced the path-form table. It carried a
positive control, added after its very first run reported `UNIFIES` having
resolved nothing at all: fewer than two resolvable forms printed
`MEASURED NOTHING` and exited 1.

**That control is a count, and a count is satisfied by the two easiest forms.**

`\\localhost\C$` is an **admin share**, disabled or elevation-gated on a great
many Windows machines. On such a machine every redirector form errors, `C:\…`
and `\\?\C:\…` resolve, and those two were never going to disagree. Measured, by
running a copy with the redirector host changed to an unreachable name:

```
2 form(s) resolved.
  realpath.native: 1 distinct
UNIFIES. Every form folds to one identity.        exit 0
```

That is **the opposite of the row recorded here**, printed cleanly, by an
instrument that never reached the redirector. A future reader following this
document's own instruction to re-measure would get it.

### The fix is the distinction `checkWriteTarget` already carries

"How many answers did I get" is not "which forms answered", and *could not look*
must never render as a measurement — `target-absent` versus `sole-writer`, in a
different file.

Each form now declares the **route** it exercises, `local` or `redirector`. The
run refuses unless at least one form of **each** route answered, and it refuses
**before printing any rows**: a table of local forms under a heading about
network paths is precisely what makes an unreachable redirector look like a
result. Forms that did not answer are reported as absences with their errno,
never as rows, because "this machine has no mapped drive" is a fact about the
measurement's coverage and belongs beside it.

Verified in both directions: the real invocation still reports
`realpath.native: 2 distinct` against `dev:ino: 1 distinct` — the row above — and
the unreachable-redirector invocation now exits 1 naming the route that did not
answer.

**The unmeasured row is unchanged.** A genuine mapped network drive still cannot
be produced on this machine, and it is still recorded as unmeasured rather than
inferred. What is fixed is that a machine which *cannot* answer now says so.

---

## Clarification, 2026-08-19 — §7 and §2 both bind on close, and close splits in two

Written when §7's lane was built, because **read literally the two sections
contradict each other** and the next reader deserves the resolution rather than
the puzzle.

- §2 requires the index entry to be gone **before anything is awaited**. That is
  what turns invariant L10 into a lookup miss instead of a discipline every
  commit path has to remember.
- §7 says save, queries and close run in the **same lane** as commands.

Queue the whole of close behind pending commands and §2's property is lost: the
document is closing and still findable, which is the window `c86b434` shut.
Bypass the lane entirely and §7's is lost: an engine session gets torn down
underneath a command still executing against it.

Both are wanted and both are reachable, because they are properties of
**different halves**:

| half | where it runs | why |
|---|---|---|
| index removal | synchronous, outside every lane | it is the part that must not wait |
| teardown | inside the document's lane | it is the part that must be serialised |

They compose safely because the lane **lives on the record**. Once the record is
gone the lane cannot be joined — lane lookup is get-or-**miss**, never
get-or-create — so the captured lane is a closed set of already-accepted work
and teardown is genuinely last. Teardown runs whether that work succeeded or
failed; a command that threw still leaves a session to release.

### Two related rules fixed at the same time, while there was one call site

**Lane ordering.** There are two lanes: the service-wide index lane, and §7's
per-document lane. The only permitted direction is **per-document → index**
(save runs in a document's lane and calls the write-target check, which enters
the index lane). Nothing may await a per-document lane from inside the index
lane: these are promise chains with no reentrancy, so that direction
self-deadlocks, and a `saveAll` or `closeAll` is the obvious future thing that
would try it. Enforced rather than only written — the index lane marks its async
context and `run` refuses inside it, so the violation is a named error rather
than a hang.

**No accessor for a document's current version.** §7 warns that a query result
must carry the version echoed with the reply, never read from a main-side field
after an await, or a query that executed at v3 gets stamped v4 and the
renderer's staleness check passes on stale content. `versionOf(docId)` was
exactly that field with a public getter on it. It is removed: the lane **hands**
work the version it is running at and returns the result stamped with it, so the
read-then-stamp sentence has no words. Building this now, while the API has one
shape to change, is cheaper than adding it under a renderer later.

### The version handed IN and the version stamped ON are two different values

Corrected the same day, before the counter was built. The lane first passed one
variable to both, reading it before the work.

Passing the pre-work version to the work is right — that is what the work
operates against. Using it as the result's stamp is not:

| kind | pre-work stamp | correct stamp |
|---|---|---|
| query | equal, nothing bumps during it | same |
| **command that bumps** | the version it **replaced** | the version it produced |

A command stamped with the version it replaced is **§7's failure with the sign
flipped**: instead of a query stamped too new, a command stamped too old. The
renderer's staleness check then reads a fresh result as stale, and can read a
later stale one as fresh.

So the stamp is read **after** `work` returns, still inside the lane. That is
exact for both kinds precisely *because* the lane is serial — nothing can bump
between the work finishing and the read — which is the same argument that makes
the lane worth having. Reading before is exact only for the kind that cannot
change it.

The only mechanism that can change a version is `DocumentContext.bumpVersion`,
reachable only from inside the lane, so a bump cannot race a stamp. What bumps,
and what `savedVersion` and `dirty` mean, stays §5's and arrives with the
command log; this is the seam, not the policy.

### Same-document lane reentry is refused

`run(A, work)` where `work` calls `run(A, …)` cannot complete: the inner entry
queues behind the outer while the outer awaits the inner. **No error, no
timeout, no stack — a document that stops responding.** Removing the guard does
not make its proof fail; it makes it hang to the test timeout, which is the
whole argument for closing it.

Refused by a second async-context marker carrying the executing `DocId`. **Keyed
on the `DocId`, not on "any nested run"** — refusing all nesting is stricter
than the evidence supports.

**`close(A)` from inside `run(A)` is refused too**, and the reason it is guarded
while its sibling is not is worth stating exactly, because "no call site yet" is
the argument that would have left it open.

The synchronous half behaves; the returned promise awaits a lane containing the
work that called it, so **`await close(A)` hangs and `void close(A)` does not**.
That inversion is what separates it. Every other refusal here punishes the wrong
shape; this one punishes the **careful** caller and rewards the careless — so
the person who eventually meets it is someone whose fire-and-forget version
already worked, and a recorded hazard does not reach that person. The flow is
ordinary rather than exotic: `run(A, async () => { await save(); await
close(A); })` is the obvious implementation of close-with-unsaved-changes.

Refused with a **named error, not a conditional contract**. Making `close`'s
promise mean "teardown finished" everywhere except inside the lane, where it
would mean "teardown scheduled", is the reasonable-looking exception that gets
cited later. The correct flow is available and simpler: run the save in the
lane, close outside it. Closing terminates the stream; it is not an operation
within it.

The guard is the **first statement** in `close`, before the index removal.
Placed after, it would refuse *and* remove — an error handed back with the index
already mutated, worse than either outcome alone. Its proof asserts both the
named error and that the document is still open, because a misplaced guard
passes the first assertion and fails only the second. Verified by moving it.

One sibling is left **open, with the analysis rather than a guard**:

- **`run(A)` from inside `run(B)`.** Independent lanes, so it completes unless
  B's work depends on A's. A lock-ordering hazard, not a certain deadlock, and
  **both forms fail the same way** — there is no inversion to punish a careful
  caller, and no call site. The fix when one arrives is a total order on
  `DocId`s acquired low-to-high, not a blanket refusal.

---

## Clarification, 2026-08-19 — §5's counter, and what `dirty` does not claim

Written with the counter, on the lane that was built first. §5 is unchanged;
these are the three things building it made explicit.

### `dirty` is a CONSERVATIVE APPROXIMATION, not a definition

`savedVersion !== currentVersion` has a false-dirty case, and it is reachable:

> Save at v5, undo to v6, redo to v7. The content is byte-identical to the file,
> and this reports dirty.

That is the **right trade** — it fails towards prompting for a save nobody
needed, and never towards losing work. But "right trade" and "exact" are
different claims and only the first is true. It is written down as an
approximation because an approximation recorded as a definition is how a later
reader concludes a real false-clean is impossible.

The direction is the whole point, and it is the opposite of what §5 already
rejects: cursor equality fails towards **clean**, because a new command
truncating the redo tail can land the cursor back on the saved index while the
content differs, and the document renders clean while holding unsaved work.

The false-dirty case has a proof of its own, asserting the approximate answer,
so nobody "corrects" it into the exact-looking rule that loses work.

### 0 is reserved for a state that does not exist yet, and `savedVersion` is never seeded to it

§5 seeds `savedVersion` from the **initial** version, so an untouched document
is not dirty and closing it prompts nobody. Every document `DocumentService`
opens comes from a file, so "never written" is unreachable through any existing
path — a path with no file gets no identity at all.

The reservation is kept for the case that **will** exist: File → New, a document
with no file behind it. A code comment beside `FIRST_VERSION` previously
justified the reservation by saying `savedVersion === 0` distinguishes a
never-written document from one saved at its opening version, which described a
state nothing can produce — and sat exactly where someone seeding `savedVersion`
would look. Seeding to 0 on its authority makes **every freshly opened document
dirty**; that mutation now turns a proof red.

### Writer of record for the counter: the `CommandBus`, once it exists

`bumpVersion` and `markSaved` sit on the lane's `DocumentContext` today, which
makes them reachable by anything running in a lane — so "queries do not bump" is
currently a convention rather than a constraint.

**Decided now rather than by whichever caller arrives first (B3):** when the
`CommandBus` lands, these narrow to it — the bus as writer of record for
`DocVersion`, since §5 says every applied mutation bumps and the bus is what
applies mutations, and the save pipeline for `savedVersion`. They are on the
context only because there is no bus and the context is the only thing that
exists inside a lane entry.

Not built now, deliberately: a seam with one side missing is a guess about the
side that does not exist. But B3 is cheapest to satisfy before there are two
callers, and this is the moment there are none.
