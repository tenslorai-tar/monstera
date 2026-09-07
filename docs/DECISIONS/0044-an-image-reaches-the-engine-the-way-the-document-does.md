# ADR-0044 — An image reaches the engine the way the document does

**Date:** 2026-09-07
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §5 and §8's seam**, and
unblocks the two `docs/FEATURES.md` rows — place image (128) and stamps (124) —
that were stopped at a B4 on 2026-09-07. The architecture amendment is a
separate commit (B4); this ADR is the reasoning behind it. §3's matrix is
**not** amended, and the whole first half of this document is why.

---

## The problem, in one sentence

Place image and stamps are one object — a `/Stamp` whose appearance stream draws
an image XObject — so move, resize and delete already exist; what does not exist
is any way for the image to reach the writer, because §3 routes annotations to
MuPDF and MuPDF is behind a pipe.

## The block was recorded as a SIZE, and that was the second reason

`docs/FEATURES.md` row 128 says *"what blocks it is a number"* —
`ENGINE_HOST_FRAME_MAX_BYTES` at 256 KiB against `MAX_IMAGE_BYTES` at 64 MiB,
256× over. That is true and it is not the binding constraint.

**Measured 2026-09-07, `scripts/research/pdfLibStampAnnotation.mjs` reading 6:**
the engine host's wire is **JSON** — `host/client.ts:176` frames
`JSON.stringify({ id, channel, params })` and `host/runtime.ts:357` parses it —
and a `Uint8Array` does not survive it. It arrives as an object of numeric keys,
so `MAX_IMAGE_BYTES`' own refinement, `value instanceof Uint8Array`, refines it
away at the far end. The reading is `survivesAsBytes: false`, at an encoding
cost of **8.4×**.

Two consequences, and the second is the one that decides an alternative below:

- there is no MuPDF-routed command carrying bytes today, so nothing was ever
  relying on this working;
- **raising the frame maximum would not help at all.** At 8.4× inflation a
  30 KiB image already spends 252 KiB of a 256 KiB frame, and the value that
  arrives is still not the type the schema demands. The size is a wall behind a
  wall.

Row 128's body is corrected in the amendment commit, a FEATURES row being a live
specification rather than a record.

## What was verified, and what is assumed

Everything in the next two sections is a reading from
`scripts/research/pdfLibStampAnnotation.mjs`, run 2026-09-07 on this machine
against MuPDF 1.28.0 and `@cantoo/pdf-lib`. The script carries two positive
controls and refuses to report without them — a document with no annotation must
read back as none, and an unmarked stamp must read back as foreign — because
every reading in it is a search over a document and every broken search prints
the same *found nothing*. The mark reader's reassuring answer is `true`, so its
control is on `false`.

**Assumed, and named as such:** that a document a user stamps repeatedly is
shaped more like `perf-dense-127k.pdf` than like `perf-image-200mb.pdf` *often
enough to matter*. No corpus reading supports that; what supports the decision
is that the cost below is unbounded in the wrong variable, not that it is
typical.

---

## Decision 1 — MuPDF stays the writer of record. §3 is not amended

`docs/ARCHITECTURE.md:384` reads, in full:

> | Annotations (all types), appearance streams | **MuPDF** | MuPDF |

**"(all types)" forecloses the split**, and the appearance stream — the exact
object an image stamp needs — is named in the same row. Routing this one write
to `@cantoo/pdf-lib` would put a second writer on a concern the matrix assigns
whole, which is the B3 violation §3's own preamble describes the consequences of
two paragraphs above the table.

It would also be a writer of record chosen by **pipe width**. Rule 0's banned
reflexes do not list that one only because nobody had reached for it yet; it is
the same move as widening a type to make an error disappear, one layer up.

The capability was never in doubt and is not the reason: `addImage` answers an
indirect object and `setAppearance` takes it, measured 2026-09-07 with the file
read back by pdf-lib, which is how row 128 came to be written.

## Decision 2 — the seam gains an `asset` axis, declared per command

`commandDeclarations.ts` already carries two axes of this exact shape —
`sources: 'none' | 'one'` and `reads: 'none' | 'outline'`
([ADR-0040](0040-a-command-names-a-second-document-by-docid.md)) — and both
exist so that a requirement of the *apply* is declared rather than inferred from
a payload that happens to carry something. A third joins them:

> **`asset: 'none' | 'image'`.** A command declaring `'image'` carries exactly
> one field of bytes, and that field travels out of band.

Declared, and not a generic rule about oversized fields, for the reason
`ENGINE_HOST_FRAME_MAX_BYTES`' own header gives about generous maxima: *"A
generous maximum is one that quietly accommodates the payload nobody decided to
send."* A spill mechanism keyed on size is that sentence with a file behind it.
A declaration is a thing a reader can count.

## Decision 3 — the asset travels the door the document already came through

`engine/open` hands the host **`snapshotDirectory`** — *"the directory main
granted this session READ on"* — and a name inside it. The document, the largest
object in this system, has never crossed the pipe; it is written by main into a
directory the host may read, and the host opens it by name.

**An image is smaller than the document by construction.** So:

- main writes the asset into the session's `snapshotDirectory`, under a name it
  chooses, exactly as it writes the canonical bytes;
- `engine/apply` carries `asset?: outputNameSchema` beside the command, and the
  command's own image field is **absent from the wire form**;
- the host handler reads the file, reconstitutes the full command, and calls the
  same `apply` every local caller calls;
- main deletes the asset when the call returns.

Three properties worth stating because they were not designed in, they fell out:

1. **The direction is the safe one.** The host holds READ on that directory and
   MODIFY only on the output directory, so an asset gives the hostile side no
   capability it did not have. Nothing about this lets the host plant one.
2. **The apply signature is unmoved**, and so is every kernel test that calls it
   with bytes. The transformation is a transport concern and stays in the two
   modules that are already the transport.
3. **The command in the log still holds the image**, which is
   `insertImagePage`'s existing shape, so undo, redo and `reproducible` are
   unaffected and no new question is asked of the log.

**The wire form is DERIVED from the declarations, never written twice.**
`mupdfCommandSchema` and its wire counterpart differ in exactly the fields the
`asset` axis names, and one function produces the second from the first. Two
hand-kept schemas for one command is the second opinion B3a names, and it would
be a second opinion about *what a command is*, which is the worst subject
available for one.

---

## Rejected alternatives

### Route the write to `@cantoo/pdf-lib` — measured, and it works

The strongest alternative, and the one with a shipped precedent:
`insertImagePage` declares `writer: 'pdf-lib'` and carries the 64 MiB bound
today, because a byte-image writer runs in main and its input crosses nothing
([ADR-0039](0039-a-byte-image-writer-round-trips-the-live-session.md)). It is
rejected on cost and on Decision 1, **not on capability**, and the readings are
recorded here because a rejected alternative that was never executed is an
opinion:

| reading | result |
|---|---|
| pdf-lib writes a `/Stamp` whose `/AP` `/N` draws an embedded image | yes, 1299 bytes |
| MuPDF's annotation walk sees it — the walk that **filters widgets** (ADR-0041) | `Stamp`, rect, `7x3` image reached down `/AP` `/N` `/Resources` `/XObject` |
| MuPDF's `setRect` moves it **without regenerating the appearance** | rect moved, `7x3` image still there |
| MuPDF deletes it | walk returns empty |
| the `/Monstera_Authored` mark pdf-lib wrote, read by MuPDF (ADR-0043) | `true`; an unmarked stamp reads foreign |

Five for five. The third is the one that could have failed silently — a
regenerated `/AP` is a stamp that moves and turns blank, and no assertion about
the rect would see it.

**What loses it is the cost, and the cost is keyed on the wrong variable.** A
byte-image command is a whole-document pdf-lib load and save. Measured
2026-09-07 on this machine:

| fixture | MB | indirect objects | load | save | total |
|---|---|---|---|---|---|
| `perf-baseline.pdf` | 0.1 | 5 | 0.01s · 0.00s | 0.01s · 0.00s | ~0.01s |
| `perf-image-200mb.pdf` | 199.4 | 122 | 0.03s · 0.04s | 0.54s · 0.60s | **0.57s · 0.64s** |
| `perf-dense-127k.pdf` | 25.1 | 127,082 | 19.31s · 19.85s | 178.01s · 204.91s | **197.3s · 224.8s** |

Two runs each, both printed, because the first run gave one number per fixture
and one sample is a value rather than a rule. They spread by 14% on the dense
fixture and settle nothing about why; what they agree on is the shape.

**Around 200 seconds for one placement**, on a file an eighth the size of the
one that costs 0.6s. The cost tracks object count, not bytes, and no
interpolation between two points is offered here — three fixtures is not a
model, and the load/save split is printed because a single figure would have
carried the wrong independent variable underneath it.

Every byte-image row shipped so far is a **document-level operation a user
invokes once**: a watermark, headers and footers, a background, a table of
contents, Bates numbers, an inserted image page. Placing a stamp is not. It is a
gesture, repeated, and the fixture set those rows were built against contains
nothing that would have shown this.

**That is a finding about the shipped rows and not only about this one**, it is
recorded as such, and it is deliberately not acted on here: nothing in this
range changes those rows, and folding a second subject into a B4 is how an
amendment stops being reviewable.

### Chunk the intent across frames

Refused by the constant's own header before this row existed, and quoted rather
than paraphrased because the sentence is the argument:

> *"Splitting the intent across frames is the fallback if a set representation
> cannot be made to work, and it is the expensive one: reassembly, ordering and
> partial-state handling, added at a boundary whose counterparty is hostile by
> invariant 25's own premise — the worst place in this system to grow protocol."*

### Raise `ENGINE_HOST_FRAME_MAX_BYTES`

Not a trade — a non-solution. The wire has no byte type, so the value still does
not arrive as the type the schema demands however large the frame is. It would
also spend the property the constant exists for, stated in its own header: *"A
frame this size cannot be a document by accident."*

### Re-encode the payload, per the constant's own first rule

The header says **payload shape first, chunking second**, and *"prove the limit
has to exist before designing around it"*. Asked and answered: the bound it
analyses is an encoding artefact of writing a page selection as decimal indices,
and a bitmap removes it. An image has no such reading. Its bytes are the
payload, so there is no shape to change — which is what sends this to the
out-of-band route rather than past the rule.

### Resample the image to the placed rectangle so it fits

Tempting, because a stamp at 200×100pt does not need 64 MiB. Rejected twice
over: it silently degrades data the user supplied, and it makes one field's
bound a function of another field's value, which is a bound nobody can state.
And the two rows are not the same feature about this — a *stamp* is a mark and a
resample might be right for it; *place image* is the user's photograph, and
quietly resampling that is a decision made on their behalf without telling them.

### Draw the image into the page's content stream instead

Recorded in row 128 before this ADR and kept here so it is not re-derived: it
renders identically and is **unselectable, unmovable and undeletable**. The
whole reason the object is an annotation is that the row asks for move, resize
and delete.

### A generic spill: any oversized field goes to a file

The version of Decision 2 with no declaration. Rejected as above — it is exactly
the generous maximum the frame constant's header warns about, and it makes
*which payloads leave the wire* a property of the data rather than of the design.

---

## Consequences, including the unpleasant ones

- **A second file exists in the granted directory for the duration of one
  call.** Main writes it and main deletes it; a crash between the two leaves it,
  and the contained directory's existing lifecycle is what collects it. That
  lifecycle is inherited rather than extended, and the first thing to check when
  building this is that it actually covers a file main wrote after open.
- **The command log can hold image bytes.** Already true via
  `insertImagePage`, and the checkpoint budget is the only thing bounding it.
  This adds a second command of that shape rather than a new hazard.
- **Two schemas exist for one command**, derived rather than written. If the
  derivation is ever hand-maintained it becomes the B3a defect this ADR names,
  and the check for that is that the wire form has no author.
- **The host reads a file it did not open the document from.** The path stays
  inside the directory it was granted, which is the property to assert rather
  than to state — a name and a directory join to a path, and a name is the half
  arriving from elsewhere.
- **Built-in stamp artwork is untouched and stays blocked.** A shipped stamp is
  artwork, B10 bans committing binaries, and neither honest route — drawing it
  from primitives at apply time, or generating it with a provenance story — has
  been designed. Row 124 keeps that half of its block and loses the other half.
- **The 197.3s reading stands against the byte-image rows** and belongs to
  whoever next opens one.

---

## Addendum, 2026-09-07 — that reading has been sized, and all six rows pay it

Appended rather than folded into the text above: what this ADR decided is
unchanged, and this records what became of the finding it deliberately did not
act on.

`scripts/perf/byteImageCost.mjs` ran every pdf-lib-routed command against both
perf fixtures, twice. **All six are affected**, and the figures are worse than
the load-and-save reading above because these do work as well as round-trip:

| command | `perf-image-200mb.pdf` | `perf-dense-127k.pdf` |
|---|---|---|
| `watermarkPages` | 1.72s / 1.39s | 240.30s / 246.94s |
| `headerFooterPages` | 1.11s / 1.15s | 225.19s / 255.82s |
| `batesNumberPages` | 1.19s / 1.39s | 309.88s / 320.19s |
| `setPageBackground` | 0.85s / 0.73s | 276.23s / 264.53s |
| `insertImagePage` | 0.73s / 0.70s | 263.51s / 247.00s |
| `generateToc` | 1.46s / 0.69s | 260.42s / 231.34s |

199.4 MB and 122 objects against 25.1 MB and 127,082. The smaller document costs
between 170x and 330x more, which is this ADR's *cost tracks object count, not
bytes* holding across every command rather than only across a load and a save.

The instrument carries a **regression bound of 480s** — a fact-keeper, not a
budget. **Nothing here decides whether the six can leave the byte-image path**,
and this ADR's own §*Rejected alternatives* is why that is not the obvious move:
ADR-0039 exists because MuPDF's writer cannot draw what these rows draw. That
decision needs its own ADR and its own measurement of what a structural route
would have to reimplement.

`docs/JOURNAL.md`'s entry of the same date carries the run conditions, the
spread, and the trigger for re-measuring.

---

## Addendum, 2026-09-07 — the cost was measured on one of pdf-lib's two saves

**Nothing above is withdrawn.** Decision 1 stands, the rejection of a pdf-lib
route for `placeImage` stands, and every figure recorded here was correctly
read. What is corrected is the **premise those figures were taken under**: the
word *incremental* appears nowhere in this ADR or in ADR-0039, and
`@cantoo/pdf-lib` 2.8.3 has always had a second save. Every reading above is
`load` followed by `save`, and `save` is the whole-file serialise.

Measured on the same fixture, same machine, `scripts/research/incrementalSaveCost.mjs`:

| shape of the change | `load` + `save` | `load` + `commit` |
|---|---|---|
| nothing at all | 269.95s | **26.58s** |
| one form field created | 305.57s | **37.78s** |
| text drawn on all forty pages | 282.89s | **80.56s** |

**The 21s load is the floor and does not move**, so what came down is the
serialise: 248–284s to 5.3s for a small change set. Part of it reappears in the
mutation — a document loaded `forIncrementalUpdate` records changes as they are
made, 0.03s to 11.76s for one field — which is why the totals above are the
honest column rather than the save column.

Two things this addendum deliberately does **not** do:

- It does not move any of the six rows. That decision needs its own ADR, for
  the reason already written above: ADR-0039 exists because MuPDF's writer
  cannot draw what these rows draw, and *cheaper* is not *correct*. The costs
  that come with the route — a second load shape, and an output that grows
  rather than shrinks — are in the JOURNAL entry.
- It does not withdraw the sentence this ADR's rejection turns on — *every
  byte-image row shipped so far is a document-level operation invoked once
  where a stamp is a repeated gesture*. That is an argument about **shape**,
  and a shape argument does not expire because a number improved. What the
  number changes is its weight: a repeated gesture costing 320s on an
  object-dense document is disqualifying, and one costing 38s there and 0.39s
  on an ordinary one is a trade somebody can take.

**`saveIncremental` is not the callable API and that is worth carrying
forward.** Its buffer is the appendix alone — the header is skipped when a
snapshot is present — so MuPDF opens the result with *"cannot find version
marker"* and reports no page 1. `commit()` concatenates it onto the original
bytes and answers a whole document. A route that returned the first would be
the fastest and most broken result available.
