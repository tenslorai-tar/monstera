# ADR-0064 — A page imported as a layer is MuPDF's, because the layer is

- **Status:** Accepted
- **Date:** 2026-09-14
- **Amends:** `docs/ARCHITECTURE.md` §3, adding one row to the writer-of-record
  matrix. No existing row changes.
- **Context:** D9's *Import page as OCG layer* (`BUILD-PROMPT.md`:496) places a page
  from another document onto a page of this one, as an optional-content group a
  person can show and hide. The founding record says nothing more than those words.

## The gap

The operation straddles two rows that have different writers:

- **Drawing onto pages** — watermark, headers, Bates — is `@cantoo/pdf-lib`'s
  (§3, *Content composition*).
- **`/OCProperties`** is written by `packages/kernel/src/layers.ts` and by nothing
  else. That module says so as a B3a rule: a layer's visibility lives in the
  document's default configuration, MuPDF's own layer API was measured not to
  survive save, and the object tree is the one carrier.

Built on the first row, the import would add a group to `/OCProperties` from
pdf-lib. That is a **second writer** of the structure the second row assigns to
one module, arriving through a feature that reads as *drawing*. So this is a B4:
the matrix has no row that says which writer owns it, and either existing row
taken alone is wrong.

## Decision — MuPDF, in the layers module's writer

*A page from another open document, placed onto a page as an optional-content
layer*: **MuPDF**, through the same object-tree writer `layers.ts` uses. The new
group joins `/OCProperties` there and nowhere else.

The mechanics, as the probe measured them. Each step reuses a rule this build
already owns, never a second opinion:

1. **The source is named by `DocId` and must be open** (ADR-0040). It reaches the
   bus as a resolved session, exactly as `mergeDocument` and `replacePage` do.
2. **The source page's inheritables are pushed down first.** These are
   `/Resources`, `/MediaBox`, `/CropBox` and `/Rotate`, and it is the same step
   `pageExtract.ts` and `pageOrder.ts` take for the same reason. A leaf inheriting
   its `/MediaBox` would otherwise copy without one.
3. **One graft map for the command** (`pageMerge.ts`' rule), so resources the
   source shares are copied once.
4. **The source's content becomes a Form XObject carrying `/OC`**, with the
   page's box as `/BBox` and its grafted `/Resources`. The target page draws it
   through its own `/XObject` resources and one appended content stream,
   `q /Name Do Q`. The target's existing content is not rewritten.
5. **The group is appended to `/OCProperties/OCGs` and to `/D/Order`**, creating
   `/OCProperties` when the document has none. It is visible by default. Hiding it
   is the existing `setLayerVisibility` command, so the Layers panel needs no new
   control.

## Measured, 2026-09-14 (`MuPDF 1.28.0`, the npm build the kernel loads)

This was a scratch probe on two documents generated in the probe (B10), with the
source leaf inheriting its `/MediaBox` from `/Pages`:

| | |
|---|---|
| after save and reopen, `countLayers` | **1**, named as written |
| `/OCProperties/OCGs` | exactly the new group |
| render with the layer ON | differs from the untouched target |
| render with `/D /OFF` naming the group, saved and reopened | **identical** to the untouched target (same PNG SHA-256) |

It cost one false start, recorded because it will recur in the kernel:
`PDFObject.readStream` has to be called on the **indirect reference**. Called on
`.resolve()`'s result it throws `object is not a stream`, because the resolved
value is the stream's dictionary and no longer names the object.

## Read by the renderer, 2026-09-14 (`pdfjs-dist` 6.2.108, `@napi-rs/canvas` 1.0.8)

The same three files MuPDF saved above, read by PDF.js, which is the application's
renderer and a parser independent of MuPDF. Each page was rendered at scale 1 and
sampled at the source's square and at the target's own:

| | target | layer ON | layer OFF |
|---|---|---|---|
| groups PDF.js lists | none | *Imported page 1*, visible | *Imported page 1*, **not** visible |
| pixel at the source's square | white `[255,255,255]` | **`[255,128,128]`**, the source's half-transparent red | **white** |
| CONTROL: the target's blue square | `[0,0,255]` | `[0,0,255]` | `[0,0,255]` |

So all three items this ADR would otherwise owe are read:

1. **ON draws the SOURCE's content**, at its place, not merely *something
   different*.
2. **PDF.js hides it** when `/D /OFF` names the group.
3. **A second reader agrees with MuPDF** about the saved structure.

**An instrument defect on the way, recorded because the feature's test will meet
it.** `OptionalContentConfig.isVisible` takes a marked-content descriptor,
`{ type: 'OCG', id }`. Passed the group object its own iterator yields, it
logged `Unknown group type undefined` and answered **visible** for a group the
same render had hidden. The reassuring answer came from a wrong argument, and
the pixel sample is what exposed it. The group's own `visible` agrees with the
corrected call in both files.

## Still owed, by the feature and not by this ADR

- **Survives the application's save path**, not only MuPDF's `saveToBuffer` in a
  probe: the command goes through the bus, and the wired pair covers
  `document.save` and a reopen.
- **Undo removes the layer entirely**: the Form XObject, its `/XObject` entry, the
  drawing stream and the group in `/OCGs` and `/D/Order`. The inverse restores
  the captured prior state, never a recomputation.

## Rejected

- **pdf-lib, as for other drawing onto pages.** It makes `/OCProperties` two
  writers. See *The gap*.
- **Wrapping the drawing in marked content (`/OC /Name BDC … EMC`).** Equally valid
  in the specification. It needs a `/Properties` resource and a content-stream edit
  where a Form XObject's `/OC` needs neither, and nothing measured favours it.
- **MuPDF's `setLayerVisible` for the default state.** Measured on 2026-09-03 not
  to survive save; `layers.ts`' header has the reading.
- **Flattening the page into the target's own content.** A person could not hide
  it, and the row's whole point is the layer.

## Consequences

- `docs/ARCHITECTURE.md` §3 gains the row. The amendment log gets a line.
- `docs/DECISIONS/README.md` gains the index row.
- **The feature commit** adds:
  - the command, with a `source` `DocId` (ADR-0040);
  - its writer, beside `layers.ts`, so `/OCProperties` stays one module's;
  - its capture and inverse;
  - the UI control, with the wired pair and a control case;
  - the two items still owed, read before the row is counted done: the application's
    save path with a reopen, and undo removing all five structures.

## Correction, 2026-09-14 — what happens to annotations, which this ADR did not say

This ADR decided where the source page's **content** goes and said nothing about its
**annotations**. The omission was found by `annotationSurvival.test.ts`, which requires
every command that copies out of another document to state what happens to annotations,
not by review of this ADR.

The answer, now asserted there and read back with pdf-lib:

- **The target page's own annotations stay where they were.** The import edits the page's
  `/Resources` and `/Contents` and never its `/Annots`. The case places the layer on the
  very page carrying a mark.
- **The source page's annotations do not come.** An annotation is an object in a page's
  `/Annots`, and the layer is content inside a Form XObject, which has no such key.
  Grafting them onto the target page would put them outside the layer, where hiding the
  layer would not hide them. The case first shows the source page carries the mark, so the
  absence is *not brought*, not *nothing to bring*.

This is a limit of the decision as taken, not a defect in it. A layer that also carried
the source's annotations would need them flattened into the Form XObject's content, which
is a different command.
