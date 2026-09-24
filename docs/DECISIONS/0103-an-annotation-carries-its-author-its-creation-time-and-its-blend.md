# ADR-0103 — An annotation carries its author, its creation time and its blend

- **Status:** Accepted
- **Date:** 2026-09-24
- **Relates:** [ADR-0041](0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md) (the walk),
  [ADR-0043](0043-an-annotation-this-build-wrote-carries-a-private-mark.md) (which rejected `/T` as
  PROVENANCE, not as the author), [ADR-0102](0102-a-selection-survives-a-command-that-keeps-the-walk.md)
  (the Properties tab, which listed these three as not built).
- **Context:** the owner's decision, 2026-09-24: build v5-02's Author, Created and Blend rows. *"Author:
  read and write each annotation's author, with a new setting 'Your name for comments' that defaults to
  the Windows user name. New annotations take it, and the Comments panel shows it too. Created: read the
  creation date, stamp it automatically on new annotations, and show it read-only. Blend: Multiply and
  Normal, default Multiply for highlights, and the result must look the same in other PDF viewers, not
  only in Monstera. Each one needs its pair of tests and must survive save and reopen."*

## What was measured first

`scripts/research/annotationBlend.mjs`, MuPDF 1.28.0 and PDFium 155.0.8044.0, 2026-09-24. One page, a
black box, a yellow highlight at opacity 1 half over the box and half over paper; PDFium rendering with
`FPDF_ANNOT`, without which it draws no annotation at all. The control: the paper under the mark reads
yellow in both engines in every variant, or the script stops.

| variant | MuPDF over the box | PDFium over the box |
|---|---|---|
| no annotation (control) | black | black |
| a highlight, `update()` as MuPDF writes it | black | black |
| its appearance's ExtGState set to `/Normal` | yellow | yellow |
| its appearance's ExtGState set to `/Multiply` | black | black |
| `/Normal` by hand, then `update()` again | black | black |
| the dictionary's `/BM /Normal`, then `update()` | black | black |
| a filled yellow RECTANGLE, as MuPDF draws it | yellow | yellow |
| the same rectangle, `/MonsteraBlend gs` (`/BM /Multiply` only) prepended | black | black |

So: MuPDF's highlight appearance carries `/BM /Multiply` in its own ExtGState and writes no `/BM` on the
annotation. **Two independent rasterisers draw what the appearance says** and agree on both modes. And
**`update()` regenerates the appearance and discards a blend written into it**, while ignoring the
dictionary's `/BM`. A rectangle's appearance at opacity 1 has **no ExtGState at all**, so a blend set
on "the appearance's ExtGStates" would change nothing there; one prepended ExtGState carrying only
`/BM` makes both engines draw it in that mode.

`setAuthor` and `setCreationDate` write `/T (Priya Raman)` and `/CreationDate (D:20260924093800Z)`; both
survive a save and a reopen and read back through the getters, and neither — nor `update()` — writes a
modification date `/M`.

## Decision 1 — the time and the name travel in the command

The commands that create an annotation — `addAnnotation`, `placeImage`, `replyToAnnotation`, the three
sites that call `markAuthored` — gain a required `stamp: { author, created }`. The renderer fills it at
dispatch: `created` is the moment, as an ISO 8601 instant; `author` is the person's name for comments.

A clock read inside the kernel would put time into an effect `commandDeclarations.ts` declares
`reproducible` — *"a version that starts stamping a date turns the case red"* — and re-applying the
command from the log would write a different date. In the payload, the date is part of the intent, the
same bytes come out every time, and the declaration stays true.

## Decision 2 — the name for comments is a setting whose empty value means the Windows user name

`editing.author-name`, a string, empty by default. Empty means *my Windows user name*, which `main`
answers on `app.info` (`os.userInfo().username`); the renderer holds no other route to it. A typed name
wins. So a fresh install signs comments with the Windows name, as the owner asked, and a person who
never types one keeps following their account rather than a copy taken on the day of install.

That name goes into every document the person annotates and shares — which is what an author is, and
what every other editor writes. It is said in the setting's description.

## Decision 3 — an existing mark's author is changed by its own command

`setAnnotationAuthor { page, index, author, version }`: singular for `editAnnotationText`'s reason (one
field, one mark), invertible for the same reason (the prior is one string), and a member of
`KEEPS_THE_ANNOTATION_WALK`, whose kernel case is keyed by the set's type and so arrives owed.

The creation time is shown and never written after creation: a *created* date a person can edit is not
one.

## Decision 4 — the blend is written where viewers read it, and every redraw keeps it

`styleAnnotation` gains an optional `blend: 'multiply' | 'normal'`. The kernel writes it where both
kinds of reader look: the annotation dictionary's `/BM` (PDF 2.0, Table 166 — a viewer that draws the
annotation itself), and the appearance streams (every viewer that draws the appearance, which the table
above shows two independent engines doing identically). In each appearance stream it sets `/BM` on
**every existing ExtGState** — the highlight's `/H` comes after anything prepended and would otherwise
override it — and **prepends one ExtGState carrying only `/BM`**, for an appearance that has none.

Because `update()` discards the second, **every redraw in the kernel goes through one function** that
calls `update()` and then re-applies the dictionary's `/BM` to the new appearance. Nine call sites across
three kernel modules redraw today (2026-09-24, a search for `.update()` in non-test kernel source); all
of them take it. A mark whose dictionary carries no `/BM` is left exactly as MuPDF drew it, so every
foreign mark and every mark made before this decision is untouched.

The walk reports the blend **the appearance carries** — `multiply` when an ExtGState of the normal
appearance says so, `normal` otherwise — what a viewer will draw, not the dictionary's claim.

New highlights stay Multiply, which is MuPDF's own; every other kind stays as the format draws it.
The blend is not one of the authoring settings: it differs by kind, and a single remembered blend would
turn a person's next rectangle into a multiply because they last changed a highlight.

## What this does not do

- Exchange (XFDF/FDF/JSON import and export) does not carry the three yet; it keeps what it carries.
- A mark this build made before this decision has no author and no creation date, and nothing invents
  them.

## Rejected alternatives

**Stamp the date in the kernel.** The reproducibility declaration's own trigger.

**Write `/BM` on the dictionary alone.** With an appearance present, measured: neither engine draws it,
and MuPDF's own redraw ignores it.

**Write the blend into the appearance alone.** Correct for every viewer that draws appearances, and
lost at the next `update()` — measured — and absent for a PDF 2.0 viewer that draws the annotation
itself.

**Copy the Windows user name into the setting on first run.** It would stop following the account, and
a person who never opened Settings would carry a copy nobody chose.

**Edit the author through `editAnnotationText`.** One field per command is the reason both are singular;
a payload carrying either would be two commands wearing one kind.
