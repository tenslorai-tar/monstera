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

**Neither mechanism alone is sufficient**, and that is the finding:

- `realpath.native` fails the UNC-versus-local case and cannot fold hard links.
- `dev:ino` folds both, but **requires the file to exist** — which the Save As /
  ENOENT resolution above explicitly does not — and its stability on a **real
  remote SMB share is unmeasured**. The share tested here is loopback to the
  same NTFS volume, so a matching file index proves less than it appears to.

### What is still unmeasured, stated rather than inferred

**A genuine mapped network drive was not tested.** `net use` could not reach a
share on this machine (`\\localhost\C$` resolves from Node but refuses a
mapping), so the `Z:` → `\\server\share` fold is **inferred from its two
neighbours, not measured.** The inference is that a mapped drive resolves to its
UNC target — which would unify it with the UNC form and leave both distinct from
any local form. **Do not build on that inference.** It is exactly the shape of
unmeasured row the three measured ones exist to shame, and it needs a machine
with a real share.

### Consequence

`DocumentService` must not be written around identity-by-`realpath.native`. The
resolution is deferred to the component's own design rather than guessed at
here, and it is a **blocking input to that work**, not a refinement of it. The
candidates are a composite (`dev:ino` when the file exists, `realpath.native`
when it does not, with the transition on first save handled explicitly), or
`dev:ino` with a measured fallback for filesystems that do not supply a stable
index. Both need the remote-share measurement before either can be chosen.

**Hard links are an accepted limitation only if stated as one.** If identity ends
up keyed on `realpath.native` for any case, two hard links to one file are two
documents in that case, and that is a data-loss shape rather than a curiosity.
