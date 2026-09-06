# ADR-0041 — An annotation is named by its place in a walk, and the walk's version

**Date:** 2026-09-06
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §6's annotation geometry
paragraph.** The amendment lands in the same commit as this ADR, and that commit
carries no code — which is what B4 asks for: the architecture changes before the
feature, in a commit of its own. ADR-0040 split the two; splitting them here
would produce two commits neither of which stands alone, since the amendment is
three sentences whose entire justification is this file. **Nothing is built on
it yet** — see *What this does not do*.

---

## The problem, in one sentence

Four D3 rows — eraser, select, `addAnnotation`'s inverse, and a jump that lands
on the annotation rather than its page — need to say *that one*, and
`document.annotations` deliberately answers with page, kind and contents and **no
identity at all**, so nothing in this build can name an annotation that already
exists.

## Why this is a B4 and `addAnnotation` was not

`addAnnotation` registered into a seam that described it: a command kind, a
draft in the payload, an apply that writes. Every command in the table so far is
**self-contained** — it carries the whole of its intent, and applying it twice to
the same document is either the same result or a second annotation, but never
the *wrong* one.

Naming an existing object is a different shape. The intent is only meaningful
against a particular state of the document, and nothing in the contract can
express that: `grep -n docVersionSchema packages/contract/src/commands.ts`
returns **nothing**, so no command payload has ever carried a version. A command
that means one thing at version 5 and something else at version 6 cannot be
built by choosing arguments to a schema where the concept does not exist.
Bending it in place — sending the index and hoping — is what B4 exists to stop,
and its failure mode is the worst kind: the eraser deletes an annotation, the
document is well-formed, and the wrong mark is gone.

## Decision 1 — the name is a position in the ENGINE'S WALK, not an `/Annots` index

An annotation is named by `{ page, index }`, where `index` is its position in the
walk `readAnnotations` performs — `document.loadPage(page).getAnnotations()` —
and **not** its position in the page's `/Annots` array.

Those are different, measured 2026-09-06 on a one-page document carrying a text
field and three squares:

| walk | count | contents |
|---|---|---|
| MuPDF `getAnnotations()` | **3** | `Square`, `Square`, `Square` |
| the page's `/Annots`, read with pdf-lib | **4** | `/Widget`, `/Square`, `/Square`, `/Square` |

MuPDF filters widgets out of `getAnnotations()`. So on any document with form
fields — Stage 4's entire subject — an `/Annots` index and a walk index differ,
and they differ by a number that depends on where the fields are. A handle
minted from one and resolved by the other is off by the field count above it,
silently, on exactly the documents a form-filling application opens.

**So one function owns both directions.** The same walk that mints a handle is
the walk that resolves it, in `pageAnnotations.ts`, and no other module derives a
position from `/Annots`. This is B3a on a rule MuPDF already owns: *which objects
on this page are annotations* is its answer, not ours, and a second opinion about
it is a defect however carefully it is written.

Two consequences worth stating rather than discovering:

- **The list is already engine-filtered, and the closed union's `other` member
  does not catch what is filtered.** `document.annotations` describes itself as
  *every annotation in the document*; a `/Widget` is an annotation in the file
  and is not in the answer. That is the behaviour we want — a comments panel
  listing form fields would be wrong, and D5 owns them — but it is MuPDF's
  choice rather than ours, and the `?? 'other'` fallback was written to be the
  thing that catches an unanticipated subtype. The subtype it would most
  obviously catch never reaches it.
- **A handle is not durable and is not meant to be.** It is not written to the
  file, it survives no save, and it means nothing in another session. It is a
  way of pointing at a row in an answer that was just given.

## Decision 2 — a command naming an annotation carries the version it was composed against

The payload carries the `DocVersion` the walk was read at, and the command is
**refused** if the document has moved since.

This is ADR-0031's rule on a different noun. That one refuses a byte range
requested against a stale version, because *a stale offset answered from new
bytes builds a document out of two of them*. A stale index answered from a new
walk deletes an annotation out of two of them — the same failure, with the
evidence destroyed rather than assembled.

The refusal is what makes the position safe to use. Within one version the walk
is a total order over a fixed set, so an index is unambiguous; across versions it
is not an identity at all, and nothing in this decision pretends otherwise. **The
version is the half that makes the index mean something**, which is why they are
one payload and not two fields that happen to travel together.

**The check does not belong in the renderer.** The renderer knows its own
version and could compare — `AnnotationsPanel` already refuses to render a list
whose version is not the current one — but a guard in the caller is a convention,
and B5 asks for the illegal state to be unrepresentable or, failing that, caught
where it cannot be skipped. The kernel holds the authoritative version; the check
goes there, and a renderer that forgets its own discipline gets a refusal instead
of a wrong deletion.

## Decision 3 — the axis is DECLARED, beside `sources` and `reads`

A command declares whether it names existing state, the way it already declares
whether it names a second document (`sources`) and whether it needs a value read
through another engine (`reads`). ADR-0040's Decision 4 argued this for the
session parameter and the argument is unchanged: a field defaulted to *no* is a
choice nobody makes and nobody reads, and a table whose point is that each axis
is answered once per command is a table where the twelve `'none'`s are the
evidence that the question was asked.

It also gives the refusal one owner. The bus resolves sources into a map before
the apply sees them; it holds the version too, and a declared axis is what lets
it compare without every apply re-deriving the rule.

## What this does NOT do

- **It does not make an annotation addressable across a save.** `/NM` is
  rejected below, and nothing here writes an identity into the file. Reopening a
  document invalidates every handle, correctly.
- **It does not build the jump to an annotation.** That needs a position jump in
  the viewer, which **no panel has**: `jumpTo` takes a page number in the
  outline, the thumbnails, the destinations panel, the links panel and the find
  bar. The destinations reader does not even carry a `/XYZ` point. So the owed
  clause on the annotations-panel row is blocked on a viewer capability shared
  with destinations, and not on this ADR — which is what the handoff said, and it
  was wrong.
- **It does not settle the `srcRef` marking scheme.** A handle says *which one*;
  the scheme says *may I rewrite it*. The eraser is the first caller of both,
  and they are separate questions — the D3 row carries the second.
- **It builds nothing.** The amendment is its own commit and the feature follows.

## Rejected alternatives

### `/NM`, the format's own annotation name

PDF 32000 §12.5.2 defines `/NM` as a text string uniquely identifying an
annotation among those on its page, which is exactly the question. It was
rejected on the one that matters: **we may not write it onto a foreign
annotation.** The `srcRef` invariant forbids rewriting annotations this build did
not author, and an eraser whose whole purpose includes deleting a mark somebody
else made would have to mint a name on the object it is not allowed to touch.

Using `/NM` where it exists and a position where it does not is worse than
either: two identity schemes for one question, chosen per object, which is the
second opinion B3a is about. It also inherits the format's own weakness — `/NM`
is optional, and a hostile document may repeat one across a page.

### Content addressing — name the annotation by its rectangle and kind

Attractive, and closer than it looks: staleness produces *no match* rather than a
wrong match, and no version travels. Rejected for what it costs at the edges. Two
identical marks stacked on a page — which is what happens when somebody
double-draws — become **unerasable**, because the match is ambiguous and the only
honest response to an ambiguous match is to refuse. An eraser that cannot delete
a duplicate is failing at the case duplicates most need it for, and *refuse* is
not a state the person can act on.

It also makes the rect the identity, so nothing may ever adjust an annotation's
geometry without re-deriving every outstanding name — which is the select tool's
entire job.

### A handle table in main — mint an opaque token per read

B5's shape: a token that cannot be forged and cannot be arithmetic'd. Rejected as
Decision 2 with bookkeeping. The table still has to be invalidated on every
version bump, so the version is still doing the work; and between them the
renderer may never spend a token, so main accumulates per-read state whose
lifetime nobody owns. The refusal is the same refusal, arrived at through a map
that can leak.

### Send the index and check nothing

The default if this ADR is not written, and the reason it is. A stale index is
in range, names a real annotation, and deletes it. The document is well-formed
afterwards, no check fails, and the only evidence is that the wrong mark is gone
— which the person notices later, if at all, and cannot undo past.

---

## Correction, 2026-09-06 — the read half IS built, and this said otherwise for one commit

*Nothing is built on it yet* in the status block, and *It builds nothing* under
**What this does not do**, were true when written and false one commit later.
`5a5c87b` added `index` to every entry of `document.annotations` and to the
engine channel beneath it, and corrected neither sentence.

ADR-0040's own build commit corrected all three of its documents *in* the commit
that falsified them, and its message says so. This is the same shape one ADR
along, caught one commit late — by asking what the last commit had made untrue,
which is not a check and cannot be. Both sentences still parse, both still read
as candour, and an ADR is precisely where someone goes to find out whether a
thing is built.

**What is built: the mint.** `readAnnotations` numbers each annotation by its
position in the walk, per page, and that number crosses the boundary.

**What is not: any consumer.** No command names an annotation, so Decision 2's
version refusal has no caller and Decision 3's declared axis does not exist. The
only readers of the index today are its own cases.

**Decision 3 is the next unit and it is not a registration.** The bus holds the
version and the `apply` does not, so the refusal lives where sources are
resolved, and every declaration answers the axis — twelve of them `'none'`,
which is the table's point. Putting the check in `documentCommands.ts` instead
would be the per-command `if` the axis exists to prevent, and the second command
to name an annotation would write its own. Expect ADR-0040's correction to
repeat: an axis of this shape **binds in one direction only**, because a
function that ignores an argument is assignable to a signature that passes it.
