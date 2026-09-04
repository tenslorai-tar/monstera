# ADR-0040 — A command names a second document by `DocId`, and that document is open

**Date:** 2026-09-04
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §2 and §8's seam.** The
architecture amendment is a separate commit (B4); this ADR is the reasoning
behind it. **Nothing is built on it yet** — see *What this does not do*.

---

## The problem, in one sentence

`docs/ARCHITECTURE.md:372` assigns *"Page tree ops: delete/insert/extract/**merge**/split/crop/resize"*
to MuPDF, so **merge PDFs**, **insert from PDF** and **replace page** are
specified work — and `Apply<W, K>` takes exactly one session, so there is no way
for a command to say *and this page comes from that document*.

## Why this is a B4 and the last two were not

The byte-image writer (ADR-0039) and the destination path both registered into
seams that already described them: the seam declared two writer shapes, and the
picker had a sibling with a working pattern. This one does not. `Apply`'s
signature has one session in it, and a second document cannot be expressed by
any choice of arguments to a function that takes one. Bending it in place — a
session that is secretly a pair, a command payload carrying bytes — is what B4
exists to stop.

## Decision 1 — the second document is named by a `DocId`

A command's payload carries the **id of another open document**. Not a path, not
bytes, not a handle minted for the occasion.

`WriterSession` is already a per-document map and `EngineSessionSource.sessions`
already resolves one, so *the sessions of document X* is a question this build
answers. What is new is a command naming two documents rather than one.

**The renderer already holds the ids it would name.** A `DocId` is what it gets
from `document.open`, what its tabs are keyed by, and what every other channel
takes — so a merge is *these two tabs*, expressed in the vocabulary the renderer
already has, with nothing new crossing the boundary.

## Decision 2 — the source document must be OPEN

There is no transient, hidden open. A command that needs a second document names
one the user has open, and a file that is not open is opened first — through
`document.open`, as a tab, exactly as any other document.

This is the decision with a visible consequence and it is taken deliberately:
*Insert from PDF* becomes **pick a file, it opens, then insert from it**, where
some applications hide the intermediate document. That is a real cost in clicks
and it buys the thing this build spends its structure on — **one way to open a
document.** `DocumentService.open` is where identity is read, where the
merge-only dedup rule runs, where the `FileHandle` is minted, where the canonical
image is held against a ceiling, and where the engine session is granted its
contained directory. A second opening path would have to answer all of that
again, and B3a's whole record is that the second answer agrees with the first
until it does not.

It also makes the hazard visible rather than silent: a source document open in a
tab is one the user can see, close, and be warned about — where a hidden handle
on a file is a lock nothing on screen explains.

## Decision 3 — the sources reach the bus as a resolved map, not a lookup

`CommandBus.execute` gains a parameter carrying the sessions of the documents
the command names, resolved by its caller:

```
execute(sessions, context, command, bytes, sources: ReadonlyMap<DocId, SessionsByWriter>)
```

**The bus does not gain a document index.** It has never been able to find a
document — `documentCommands.ts` resolves sessions and hands them over, which is
what keeps the bus a router rather than a second `DocumentService`. A lookup
function here would be that index arriving through a callback.

An id the map does not carry is `MissingWriterSessionError`'s sibling and is
refused by name, for the same reason: a command naming a document that closed
between dispatch and execution is an ordinary race, not a defect.

## Decision 4 — the second session is declared, so a one-document command's signature does not move

A new axis on the declaration, beside the writer and the two ADR-0009 §3a axes:

```
sources: 'none' | 'one'
```

and `Apply` is conditional on it exactly as it is already conditional on the
writer's shape. `rotatePages` declares `sources: 'none'` and its `apply` keeps
the signature it has today; `insertFromPdf` declares `'one'` and its `apply`
takes a second session it cannot be called without.

**Declared rather than inferred from the payload.** A command whose params
happen to contain a `DocId` is not the same statement as a command that needs a
second session, and inferring one from the other is the *partial reimplementation
of a rule something else owns* that B3a is about — the payload is the contract's,
the session requirement is the seam's.

`'none' | 'one'` and not a count. Nothing in D2 merges three documents at once,
and a list would make *how many* a runtime question at every call site for a
capability nothing asks for. The day a command needs two sources this widens,
and the widening is a compile error at every `apply` — which is the direction
that fails safe.

## What this does NOT do

- **It does not decide the save semantics of a merge.** Whether merging into
  document A leaves A dirty at its own path, or produces an untitled document, is
  a question for the row that builds it. Both are expressible here.
- **It does not touch undo.** A cross-document command is non-invertible for
  `deletePages`' reason — the prior state is the whole page tree of the target —
  so it records a checkpoint of the **target**, which is what the existing
  terminal path already does. The source is not modified and needs no entry.
- **It does not generalise the engine host.** Both sessions are MuPDF sessions in
  the same host, so `engine/apply` gains a second session token and no new
  process shape.
- **Nothing is built on it.** This commit is the amendment; the three rows it
  unblocks are separate units, and ADR-0026's lesson is that a declaration
  shipped ahead of its implementation must say so.

## Rejected alternatives

**The source's bytes travel in the command.** Invariant L11 by inspection: a
payload that scales with a document. It is also the shape that makes a merge of
a 200 MB file a 200 MB IPC message.

**The command carries a path.** Invariant L2 — a path in a renderer-facing type
is a compile error — and it would put a second document-opening path beside
`DocumentService.open`, which is Decision 2's whole argument.

**A `SourceHandle`: a transient session opened for the command and dropped
after.** The most tempting, because it removes the extra tab. Rejected because
it is a second way to open a document that must re-answer identity, dedup, the
byte ceiling and the contained directory — and because its failure mode is
invisible: a transient open that leaks holds a lock on a user's file with
nothing on screen to explain it.

**A pair session — `Apply` keeps one parameter whose type becomes
`{ target, source }`.** This is bending the seam in place, and it changes every
existing command's signature to express something only three of them need.

**Inferring the second session from a `DocId` in the payload.** See Decision 4:
two different statements, one of them the contract's and one the seam's.

**Doing it in the renderer** — read both documents' pages through existing
channels and send a new document's worth of bytes back. Every byte of two
documents crosses twice, PDF.js becomes a source of truth (§3.2 forbids it), and
the result is assembled by the one component that is not allowed to hold document
state.
