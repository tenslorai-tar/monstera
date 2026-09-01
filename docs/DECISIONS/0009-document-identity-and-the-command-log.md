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

---

## Decision, 2026-08-19 — the bus captures prior state, in a step of its own

This fills a **silence**, and says so rather than dressing itself as a
clarification of something already written. §3 fixes the *shape* of prior state
and §4 fixes who takes a *checkpoint*. Neither says who captures the **inverse**,
and `rotatePages` is the command §3 was derived from — so the question decides
itself the moment the handler is written, in whichever direction the author was
not thinking about.

**Decision: a separate per-command capture, called by the `CommandBus` before
`apply`, in one code path, never by a handler.** The same discipline §4 already
states for checkpoints, and for the same reason: one writer per concern (B3).

### Rejected: `apply` returns the inverse

This is the shape that looks natural, because the handler is holding the prior
state at exactly the right moment. It is rejected on a mechanical argument
rather than on symmetry.

`Apply<W, K>` for a live-session writer is `(session, command) => Promise<void>`
— §8, landed one commit before this question arose. Returning the inverse
changes that signature, so the seam would be **retrofitted under a feature at a
distance of one commit**. That is the failure this project exists to prevent,
and it does not become acceptable for being caught early; it becomes cheap to
avoid.

It is also wrong on the other side of the seam. A byte-image writer's `apply`
already returns the new image, so this design forces a pair — bytes *and*
possibly an inverse — and the seam then expresses two unrelated concerns in one
return type. §8's whole point is that the seam says how a writer is driven, not
what the log stores.

### Rejected: the handler captures, and hands it to the bus

A second writer of one concern, which is the B3 violation §4 closed for
checkpoints and would reopen here. Worse, its failure is silent: a handler that
captures *after* mutating, or that captures the effective value instead of the
own-state, produces an inverse that is **well-formed and wrong**. It undoes to
something that renders correctly and is not the document that was there — R3's
defect exactly, arriving through a different door.

Capture-before-apply in one code path makes "captured after the mutation"
unrepresentable rather than forbidden (B5).

### What this obliges of a handler written before the bus exists

One thing, and it is the reason to settle this now: **`apply` must not consume
what the inverse will need.** For `rotatePages` that means the prior `/Rotate`
**own-state** — present with a raw value, or absent — is read before anything is
mutated, and that read is reachable by a caller rather than buried inside the
mutation.

Forward normalises to quarter turns; the union already makes an arbitrary angle
unrepresentable on the wire. The inverse restores **verbatim**, so a page that
arrived carrying `45` or `-90` must still be able to come back carrying it, and
the raw value has to survive until the log exists to hold it.

### Not decided here

Where the capture sits on `CommandSpec`, and what a log entry holds. Both need
the log's two-shape union (§4), which is the next unit. Deciding the *writer*
now costs one paragraph; deciding the *type* now would be a guess about a side
that does not exist — the same restraint §5's counter clarification took.

---

## Decision, 2026-08-19 — invertibility is DECLARED per command and DETERMINED per entry

A second silence, in §4 this time, and named as one rather than dressed as a
clarification. §4 fixes the two entry shapes and the spec declares
`invertible: true | false`. Nothing says whether a **declared-invertible command
may produce a terminal entry**.

**It may, and it should.** The declaration is a *capability claim*; the entry
records the *outcome*.

### The case that forces it

`rotatePages` is invertible in general. On a page whose `/Rotate` is a name or a
string — malformed, since the specification says integer — it is not: §3 types
prior state `raw: number`, so there is no honest capture, and a document like
that is one every other reader opens without complaint.

The alternative is refusing the operation, and refusing **loses function over a
byte the user cannot see**, with no route forward. A user who cannot rotate a
page, for a reason invisible in the document and unexplainable in the interface,
is in a dead end.

### It needs no new mechanism, which is the tell that it is right

The bus captures before `apply` (the decision above, one commit old). So: if
capture fails, the bus takes a checkpoint instead and then applies. Nothing is
checkpointed speculatively, and nothing has to predict whether capture will
succeed — the fallback is expressible *because* capture is a separate step that
runs first.

### Rejected, and each rejection is a way of being wrong that renders correctly

- **Coerce the malformed value to a number.** Records an inverse that is
  well-formed and wrong.
- **Treat malformed as absent.** Worse, and the most tempting: undo would then
  `delete` a key that was **present**, leaving a document that is not the one
  that was there. That is R3 through a third door — and like R3 it renders
  identically, which is what makes it dangerous.
- **Widen §3's prior state to carry arbitrary PDF objects.** Not rejected on
  principle: typing prior state as `number` *is* a quantisation, and §3's whole
  finding was that quantising prior state is the defect. It is rejected on
  **cost** — an inverse holding engine object structure couples the log to one
  engine's object model, across the very seam §8 exists to keep it away from.
  §4 already supplies the answer for an inverse that cannot be expressed, and
  using the seam that exists beats widening the one that works.

### The fork this leaves, named now so it is a decision then

The malformed case is *scalar but wrongly typed*. A different case is coming and
it is not the same: **an inheritable key whose prior value is legitimately not
scalar.** §3 says its finding "generalises past rotation: every attribute-writing
command over an inheritable key needs prior own-state" — and `/Resources`,
`/MediaBox` and `/CropBox` are dictionaries and arrays.

For those the choice is real: another terminal entry (cheap, and it costs
granular undo on an ordinary operation), or a structural prior state (expressive,
and it is the coupling rejected above). **Not decided here.** Recorded so that
the first command over a non-scalar inheritable key *meets* a decision instead of
*making* one, which is how this project acquires an exception nobody argued for.

### What does not change

`invertible: false` still forces a terminal entry, always — §4's "a
non-invertible command without a checkpoint is unrepresentable" is untouched.
The mapping loosens in one direction only, and the bus is what enforces it.

### What B must therefore build (done — see the composition decision below)

The capture step returns prior state **or a signal that it could not be taken**,
and the terminal branch is constructed by this case. That matters for more than
tidiness: §4's terminal variant would otherwise land with nothing constructing
it, which is an unexercised branch — the vacuous shape in its purest form. A
malformed `/Rotate` fixture is a genuine constructor rather than one invented to
exercise the branch, so it ships proven instead of merely present.

---

## Decision, 2026-08-19 — one composition point, and the log lives on the record

The third silence, and the last one before the IPC boundary — which is exactly
why it is filled now. §7 fixes the lane, §4 fixes the log, §6 fixes routing.
**Nothing says who assembles them**, and the assembly is
`handler → DocumentService.run → CommandBus.execute`.

If every handler assembles that itself, a handler that forgets the lane is a
race, and there is now **a second place where a feature is wired** — the thing
the command registry exists to forbid. So: **one composition point, thin, owning
the ordering and re-implementing neither side.** It lands with its first caller
rather than ahead of one, because a composition point with nothing to compose is
a shape nobody has tested.

### Where it lives, and this is a constraint rather than a convenience

**Under `apps/desktop/src`**, and a file there that imports no Electron is still
transport-free — the repository map's rule is that `apps/desktop` is the *only*
package that **may** import Electron, not that everything in it must.

The reason is a trigger, not tidiness. `kernel-error-path-sanitisation` in
`docs/security/engine-advisories.json` scans **`apps/*/src/**`** and fires the
day a handler there names `DocumentService`. Put the handlers anywhere else —
the kernel, a new package, because they happen to be transport-free — and the
trigger watches a path the work never touches and **stays green through the
entire unit it was armed for**. That is the shape this project has now corrected
four times: a search reporting the reassuring answer because it was pointed
somewhere the subject was not.

So: handlers under `apps/desktop/src`, or the glob widens **in the same commit**
that decides otherwise, with the reason recorded. Deciding the location and
leaving the glob to be noticed later is the one option that is not available.

And when it fires, the trigger's own text says what it does and does not mean: it
catches *"a handler reached `DocumentService`"*, not *"and its errors were
sanitised"*. Satisfying it means the handler returns the §9 failure type. It does
not mean making the line go away.

### Where the log lives, and why the question dissolves

Settling composition surfaces a question that looks like a preference and is not:
is the bus per document or per application?

`CommandBus` held its log as an instance field. **Per application is therefore
one log across every open document**, and undo on one document walks another's
entries. That is not a trade-off to weigh; it is the cross-document corruption
the per-document store rule makes unrepresentable *by shape*, reintroduced one
layer down. Ruled out — and written here because "one bus per application" is
otherwise the tidy default somebody reaches for.

**Per document is right, and it inherits a question already answered once.** A
per-document bus has to live somewhere, and a `Map<DocId, bus>` is get-or-create:
it mints a bus for a closed `DocId` and runs it against a torn-down document.
That is the exact hazard that put the lane **on the record** rather than in a map
— §7's clarification, *"lane lookup must be get-or-miss, never get-or-create"*.

**So take the log off the bus and the question stops existing.** `CommandBus`
becomes **stateless** — writers and the routing table, one instance,
application-wide — and the log becomes per-document state carried on the record
beside the lane, reached through `DocumentContext` under the same capability that
already guards the version counter.

Four things follow, and the fourth is the one worth having:

- no map, so no get-or-create and no resurrection;
- the log's lifetime is the record's, dropped on close **by construction** rather
  than by discipline;
- `DocumentService` owns per-document state, which it already does, without
  owning dispatch — so B3 holds and this is **not** the merge of the two that was
  rejected;
- the per-document/per-application question **stops existing** instead of being
  decided, which is a different and better outcome than choosing correctly.

The cost is one wider reach on `execute`, `undo` and `redo`: they take the log
from the context they already receive. What it buys is that a whole class of
lifetime bug has nowhere to live — the same trade putting the lane on the record
made, which paid there.

### The capability, stated accurately

The token guarding the counter is extended to the log, because B3 is about *one
component permitted to write* and that component is the same one. It is renamed
to say what it identifies — the bus — rather than one of the properties it
carries.

And what it buys is worth stating precisely rather than generously: **a brand
does not make forgery impossible.** A cast produces one, here as for every brand
in this kernel. What it makes impossible is writing **by accident**, and what it
makes visible is any production code that tries — a cast is a diff nobody reads
past. That is the whole difference between a property with one writer and a
property with a convention.

Proving it needs **both** directions. The reject case alone — a lane entry cannot
call it — is satisfied by a method nobody can call at all, and *narrowed to one
writer* and *removed* are different claims.

`markSaved` still keeps **no** token. Its writer of record is the save pipeline,
which does not exist, and a token with no minter is a narrowing that reads as a
decision and behaves as a deletion. It waits for the pipeline that will mint it.

---

## Decision, 2026-08-19 — §9 is a TYPE, not a sanitiser: two error objects, not one

§9 said errors crossing to the renderer are path-sanitised. It did not say
**how**, and the how decides whether the guarantee is a filter that must be right
every time or a shape that cannot express the failure. This fills that silence
before the first handler, because every handler written against the current error
type is a call site that has to change afterwards.

### What is actually there, measured

`toStructuredError` copies `name`, copies `message`, copies `stack`, and
**recurses into `cause` with itself**. Nothing is stripped. `wrapHandler`
converts a throw in exactly one place — structurally what §9 asks for — and its
comment says preserving name, stack and cause is the reason it exists.

The concrete leak, run rather than reasoned. `readFileIdentity` narrows absence
to `ENOENT`/`ENOTDIR` and rethrows every other errno, which is correct. A
rethrown `EPERM` looks like this:

```
code:    EPERM
message: EPERM: operation not permitted, stat 'C:\pagefile.sys'
stack:   carries the same absolute path
```

Both `message` and `stack` carry it. **Two corrections to how this was first
described, both worth recording**: the raw `fs` error also has a `.path`
property, and that channel is **already closed** — `toStructuredError` copies
four named fields and `.path` is not one, so nobody should "fix" this by adding a
spread. And the kernel does **not** currently build `{ cause: error }` chains;
all four such sites are in `boundary.ts` and `result.ts`. So today's leak is
top-level rather than through a chain. The *class* stands unchanged, because the
boundary itself builds chains and the recursion is what carries a sanitiser's
blind spot down them.

### The trap this decision exists to disarm

The mechanism **looks finished**. One conversion point, a stated reason, tests
around it. The `kernel-error-path-sanitisation` trigger will fire the day a
handler names `DocumentService`, a developer will find a one-place error boundary
already built, and conclude the second half is done.

That trigger's own text says it catches *"a handler reached DocumentService"*,
not *"and its errors were sanitised"*. This is what that limitation looks like
when it bites.

### The collision, and why the answer is two objects

`wrapHandler` exists to **preserve** diagnostics — a rejection across Electron's
bridge loses name, stack and cause, and losing them makes a bug much harder to
walk back. §9 exists to **strip** them. Both are right, on their own side of the
boundary, which is the tell that one object is being asked to be two.

**Decision: they are two objects.**

- **`StructuredError` keeps everything and stops crossing.** It is the main-side
  diagnostic record, logged in full where the path is already known and carries
  no disclosure.
- **The renderer-facing failure is a closed union of codes with typed fields.**
  No `message`, no `stack`, no `cause`.

### Why a type and not a sanitiser (B5, and it is the whole point)

Any `message: string` can carry a path, so sanitising it is a filter that must be
right on every message ever written — the runtime check B5 says to prefer a type
over. A discriminated code with typed fields **cannot express a path at all**.

`stack` is worse than `message` and gets no field. It carries the absolute paths
of *source files* as well as of the target, which no sanitiser pattern-matching
document paths would catch. **A field that does not exist cannot leak**, and
diagnostics belong on the side that already knows the path.

Typed fields carry what the renderer legitimately needs — a `DocId`, a count, an
enum member. They cannot carry a path because a path in a renderer-facing type is
already a compile error (invariant L2), so this inherits that guarantee rather
than restating it.

**Text is looked up, not sent.** The renderer maps a code to an i18n key. That
also closes a second hole for free: a boundary that cannot carry a string cannot
carry an unlocalised one (B9).

**Codes are declared per channel**, beside `params` and `result`, so a handler
returning an undeclared code does not compile and the renderer knows exactly
which failures a channel can produce — the same mapped-type mechanism as
`Handlers` and `CommandSpecs`, for the third time.

**An unexpected throw is a code too** — `internal`, plus an opaque incident id
that joins it to the full diagnostic in the main-side log. Not free text, and not
silence.

### The control this owes, and the shape it must have

The `FEATURES.md` row already owes a control that asserts a path **does** appear
when the mapping is removed. It must assert on **`message`, `stack`, and a nested
`cause` separately**: a sanitiser that misses one of the three passes a test that
checks the other two, and the nested case is the one a top-level fix leaves open.

The fixture reproduces the measured shape above — `EPERM: operation not
permitted, stat '<absolute path>'` with a matching stack — rather than inventing
an error, and constructs it directly so it holds on every platform CI runs.

### Not decided here

Whether `Result`'s error position becomes generic over the channel's code union
or the codes ride inside a single failure type. That is an implementation shape
with no consequence for the guarantee, and choosing it before writing the first
handler would be guessing at a call site that does not exist.

---

## Decision, 2026-08-19 — an incident id belongs to the failure that WITHHELD something

The §9 decision above fixed what a failure looks like on the wire — `{ code,
incident }` — and did not say **who mints the id**. Writing the first handler is
what asked the question, which is the sequence working rather than a gap in it:
the shape was decided against the leak it prevents, and the minting is only
visible from a call site.

### Measured, before deciding

`wrapHandler` hands a handler exactly one thing: its validated params. The
`IncidentLog` is constructed inside `wrapHandlers` and never leaves it. So a
handler returning a **declared** failure — `document-not-open`, `document-busy` —
has no source for the `incident` the type demands.

The only examples in the tree are test fixtures writing `incident: 'i0'` and
`incident: 'x'` by hand. That is not a gap in the tests. It is the type being
satisfiable only by invention, and the fixtures are where invention shows up
first.

### Both ways of supplying one are worse than not having one

**A fabricated id points at no log line.** The renderer shows it, a user reports
it, and whoever searches the log finds nothing. An id that cannot be looked up is
worse than no id, because it consumes the one action a user can take.

**A second log collides.** A handler that kept its own `IncidentLog` to get a
real id would mint `i1` while the boundary's log also mints `i1` — the counter is
per log and starts at zero in both. `boundary.ts` already says why one log per
registry is the point: *"so ids are unique across its channels and a report
naming i7 identifies one line rather than one per channel."* Two logs is that
sentence failing, with no symptom until someone reads a report.

### The decision

**The wire failure becomes a two-shape union.** A declared code travels alone; a
diagnostic that was withheld travels with the id of the entry it was withheld
into:

```ts
export type Failure<C extends string = string> =
  | { readonly code: C }
  | { readonly code: 'internal'; readonly incident: string };
```

An `incident` accompanies **exactly** the failures that withheld something, and
that is now a property of the type rather than a convention. A declared failure
hides nothing — the code is the whole of what happened — so there is nothing for
an id to point at.

Two things fall out, and the second is the one worth having:

- **A handler cannot produce `internal`.** `channel.ts` already asserted this in
  prose — *"A handler does not produce it — the boundary does"* — while the type
  put `internal` in the handler's own return union and then demanded an id the
  handler could not obtain. The rule and the type disagreed, and the type was the
  one being compiled.
- **The unlookupable id becomes unrepresentable** rather than discouraged. That
  is B5 in the small: the failing state is not checked for, it cannot be written.

### Rejected, and each is a way of looking finished

**`incident?: string`, optional.** Permits both wrong states it was meant to
prevent: a declared failure carrying an id that points nowhere, and an `internal`
carrying none. An optional field says the question was not settled.

**The boundary mints an id for declared failures too**, recording a diagnostic
like *"handler reported document-busy"*. Uniform wire shape, real lookups, and
wrong for a reason that only shows up in operation: a document closed while a
command was in flight is an **ordinary outcome**, not an incident. A log that
records every one of them is a log a real incident hides in — the same reason
`unverifiable` is counted apart from `verified` in the advisory register rather
than folded in to make one tidy number.

**Leave it, and let the first handler pass `incident: 'unused'`.** This is the
one that would actually have happened, because it compiles. Recorded so it is
visibly a rejected option rather than a path nobody noticed.

### What this does not change

The guarantee, and the mechanism behind it. No `message`, no `stack`, no `cause`
crosses; `failureSchema` stays `.strict()` so a drifted main build is rejected
rather than ignored; the diagnostic still goes to a sink the composer supplies.
This narrows what may cross — it does not widen it — so every control written for
§9 still holds, and the `.strict()` schema becomes a union of two strict shapes
rather than one.

---

## Correction, 2026-08-19 — `dev:ino` equality is NOT evidence that the file is the one we opened

The save-time write-target check reported **`sole-writer` for a file that had
been deleted and recreated at the same path**. Measured, on an ubuntu CI runner,
by the check's own test; `windows-latest` passed the same case.

`sole-writer` is the one verdict that permits a write. So the check that exists
to stand between a save and *"overwriting a file that is no longer the one that
was opened"* said yes to exactly that.

### The mechanism

`replacementVerdict` compared `dev` and `ino` and nothing else. **An inode number
is a slot, and slots are handed back out.** `unlink` followed by `create` in the
same directory can land the new file on the freed inode, and then the pair
matches for two different files. Nothing about that is exotic — it is ordinary
allocator behaviour on ext4 and on tmpfs, which is what a CI runner's `$TMPDIR`
usually is.

The asymmetry is the whole correction, and the original code had only half of it:

- `dev:ino` **differing** is conclusive evidence of replacement.
- `dev:ino` **matching** is *necessary* evidence of sameness and never
  *sufficient*.

`FileIdentity`'s own comments were already right about this — `size` and
`modifiedMs` are marked *"corroboration only. Never evidence of sameness on its
own."* What was missing is that corroboration is precisely what a **matching**
index needs, because the matching direction is the one that can be wrong.

### Windows is not the counter-example it looks like

Measured here: 40 rounds of `unlink` + `create` with directory churn between
them, on NTFS — **0 reuse**. That is not immunity and must not be recorded as
one. An NTFS file reference is an MFT record number plus a sequence number that
increments when the record is reused, so reuse yields a *different* 64-bit id;
the sequence field is 16 bits and wraps. **That mechanism is a hypothesis about
why the measurement came out as it did, not something this project has
verified** — the measurement is the fact, the explanation is not.

### `birthtime` is the field a reasonable person reaches for, and on NTFS it lies

Measured on the same volume, across a genuine delete-and-recreate:

| field | at open | after replacement |
|---|---|---|
| `ino` | 27866022694471064 | 28147497671181720 — moved |
| `ctimeMs` | …525475.335 | …525483.62 — moved |
| `birthtimeMs` | …525475.335 | **…525475.335 — unchanged** |

That is NTFS **file tunneling**: recreating a file with the same name in the same
directory within a short window restores the original creation time. So the one
field whose name promises "when this file came into being" reports the *previous*
file's answer, for exactly the delete-and-recreate pattern this check exists to
catch. Recorded because it is the obvious fix and it is worse than the defect.

### The decision: `sole-writer` now requires a corroborator, and `ctime` is it

`ctime` is the inode's change time. It is set at creation and moves on any change
to the inode — so a **reused** inode always carries a fresh one, which is what
makes it unable to miss the case above. Measured stable across a read, so the
ordinary open-then-save flow does not trip it.

- `dev:ino` differ → **`replaced`**, unchanged.
- `dev:ino` match and `ctime` unchanged → **`sole-writer`**.
- `dev:ino` match and `ctime` moved → **`unverifiable`**.

The third case is the correction, and it deliberately reuses a verdict that
already exists and already refuses the write. `unverifiable` means *"the check
ran and could not settle whether the file was replaced"*, which is exactly true
here: `ctime` cannot tell *"a different file on a reused inode"* from *"the same
file, edited in place by another application"*. Both are states where writing
discards something the user has not seen.

**This only ever narrows what may be reported as safe.** No verdict gains
permission it did not have, no caller meets a variant it did not already handle,
and every existing control still holds.

### Rejected

**Report `replaced` for the moved-`ctime` case.** It would be a false statement
in a message a person reads: an in-place edit is not a replacement, and a check
that says so teaches its users to disbelieve it.

**Use `birthtime` as the corroborator.** Measured above to be wrong in the exact
pattern that matters.

**Hold an open handle from open to save and compare that.** It is the one answer
that settles the question completely, and it is a different decision with its own
consequences for handle lifetime — which this project has already settled once,
deliberately, in the other direction. Not reopened here as a side effect of a
verdict correction.

### What is still not closed

`ctime` moving is not proof of replacement, so a document edited in place by
another application now blocks the save with `unverifiable` rather than telling
the user what happened. That is the conservative direction and it is the right
one at this stage — but the save pipeline, when it exists, will want to
distinguish *"someone else wrote to your file"* from *"we cannot tell"*, and that
needs evidence this check does not have. Named so it is a decision then rather
than an omission now.

## Addition, 2026-09-01 — §4's checkpoint budget is enforced during a session, and what that cost

The principle was settled on 2026-08-31 and only a size was open. The size turned
out not to be a new number, and the rest of this section is what building it
found.

### N is 1, and it is not a schedule

§4 says checkpoints occur *"every N commands"* and no N was ever chosen.
Enforcement runs after **every** `record`, because that is the only moment the log
grows: a period would be a second number to justify, and any period above one is
an interval in which the ceiling is exceeded by design.

Asserted as a **call** rather than as a state. Three commands under an ample
ceiling leave a log that is byte-for-byte identical whether retention ran three
times or not at all, so the state cannot separate them.

### The size is §9.17's ceiling, not a figure of its own

`DocumentService` computes the target as whatever `documentBytesCeiling` has left
once every other document's image and log are accounted for. The bus decides
*when* and never *how much*, so no second policy for one concern appears — the
same rule that keeps `budget.ts` deriving both of its constants from one line.

### Dropping a checkpoint takes the entries before it

A terminal entry is terminal for not being invertible, so undo cannot step over
one without its checkpoint. Leaving the earlier entries in place would leave
`canUndo` true for a history nothing can walk, which is worse than a short one.

### The redo tail goes first, and that half is UNREACHABLE today

A redo entry is work the user has stepped back from; an applied entry is the path
back to where they are. So the tail is shed first.

**No code in this repository can produce the state that ordering handles.** A
checkpoint reaches the tail only by undoing a terminal entry, and `CommandBus.undo`
throws `CheckpointRestoreNotBuiltError` for exactly that — invariant 18 clause
(ii) is deferred. The branch is kept rather than deleted, for JJJ-1's reason: the
fact it encodes is true, and deleting it would produce the wrong order the day
clause (ii) lands, in a file nobody would be reading. A case pins **why** it is
unreachable, so clause (ii) arrives on a red assertion.

**What is reachable is the guard beside it, and the first draft got it wrong.**
An invertible entry retains no document-scaled bytes, so a loop keyed on
`retainedBytes() > target` alone empties a checkpoint-free tail entirely,
destroys redo, and is still over the target. Pure loss for no gain. The tail is
now shed only while it holds a checkpoint.

### The user is told through a NEW dialog, and `dialog.command-problem` was wrong

The 2026-08-31 note named `dialog.command-problem` as the surface, having checked
that the id exists. Checked again against what it *is*: it is titled *"That could
not be done"* and its props are a discriminated union of **failure codes**. This
fires on a command that succeeded, so reusing it would report a failure at the
moment the operation worked — worse than the silence it replaces — and would
have added a non-failure member to a union whose readability is that every member
is one.

`dialog.history-trimmed` is its own declaration. Its schema requires a
**positive** count, so a modal telling the user that nothing happened is
unrepresentable rather than forbidden by a rule at the call site — the same trade
`dialog.save-problem` makes by refusing `saved`.

**A toast would be the better carrier and does not exist** (D12, unstarted).
Between a modal and nothing, invariant 18 chooses the modal. If it turns out to
fire often, the answer is the toast and not a suppression rule.

### Rejected: carrying the trim as an optional field

`historyDropped` is required on `document.execute`'s result and `0` is the
ordinary answer. An optional field is one a renderer satisfies by not reading it,
and the obligation it carries — *the user must be told* — is exactly the kind
that gets skipped by a caller writing `if (trimmed)`.
