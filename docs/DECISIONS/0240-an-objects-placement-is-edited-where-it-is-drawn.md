# ADR-0240 — An object's placement is edited where it is drawn

- **Status:** Accepted
- **Date:** 2026-10-14
- **Extends:** ADR-0176 (a Type 3 page's text edited in its own content stream by MuPDF) to moving and resizing what a
  page DRAWS: a picture, a form and a shape. ADR-0176 Decision 3's numbering, owned by `textOperators.ts`, gains the
  drawn kinds. `placePageObject` stays PDFium's command for a text object.
- **Decided by:** the owner's cloud run 4, Part 4 item E1: *"Moving or resizing ANY object fails because of a font. A
  picture (resized, or moved), a logo shape (resized) and a text run (moved) all ended in 'This page uses a font
  Monstera can't rewrite yet, so nothing was changed. Reference read-back 0'. A move or resize of one object must change
  only that object's placement (its matrix or path), never rewrite the page's text."*

## The mechanism, measured

`placePageObject` calls `FPDFPageObj_Transform` on the object and then `FPDFPage_GenerateContent`, which writes the
page's whole content stream again from PDFium's objects: every text object on the page is re-serialised, not only the
one that moved. A font PDFium cannot write back (a Type 3 font, ADR-0176's finding) then loses text, and the read-back
that guards every PDFium edit (ADR-0169 Decision 2) refuses the save.

Measured 2026-10-14 in this container (PDFium 155.0.8044.0 Linux, Chromium 151.0.7922.34): a magazine-style page printed
by Chromium's own PDF writer (Skia) — a synthetic-bold heading, which Skia writes as Type 3, body text, two photos and an
SVG logo path. Moving the first photo by (20, −10) through `placePageObject`:

> `EditRefusedError: page 0 was edited with 85 text objects and saved with 68 (step read-back, FPDF_GetLastError 0)`

That is the owner's *Reference read-back 0*, reproduced: the move touched no text, and seventeen text objects were lost
by the regeneration.

## The numbering, measured

`scripts/research/drawnObjectCorrespondence.mjs` lists PDFium's objects on a page and the kernel's numbering of the
same content (`drawnObjects` beside `showOperators`), and compares the kind sequence and each drawn object's box. Its
control is an image placed by `40 0 0 30 200 300 cm`, whose box is known by construction.

| page | PDFium's objects | sequence agrees | boxes |
|---|---|---|---|
| hard shapes: a fill, a stroke, a clip that paints nothing, text, an image XObject, a form XObject, an inline image, a path that clips and fills, a shading | 8 | yes | images and fills exact; a stroked path's PDFium box is wider by the stroke |
| `chromium-type3.pdf` (the committed fixture) | 60 text | yes | none drawn |
| the magazine page above | 88: a path, 85 text, two images | yes | the logo path and both photos exact |

So PDFium's k-th path, image, form or shading object is the page's k-th instruction of that kind outside every form,
where a path is everything from its first segment to the paint that ends it, and `n` (a clip that paints nothing)
makes no object.

## Decision

1. **A picture, a form or a shape is moved and resized by MuPDF, in the page's own content stream.** The instructions
   that draw it are wrapped in `q M cm … Q`, where `M` is the placement change expressed in the space the object is
   drawn in (`M = CTM × T × CTM⁻¹`, `T` the page-space move and scale about the box's bottom-left corner, the anchor
   `placeObject` already uses). Every other byte of the page is copied as it is, so no text is written again and no
   font is asked anything.
2. **The numbering has one owner.** `textOperators.ts`' one pass over the content gains `drawnObjects`: each painted
   path, image `Do`, inline image, form `Do` and `sh`, with its kind, its ordinal among that kind, its byte span and the
   CTM it is drawn under. The command names the object by kind and ordinal, which the renderer reads off the PDFium
   listing it already holds, and carries the box that listing gave, against which the found object is checked: an image
   or a path that does not land on the listed box (beyond a stroke's width) is refused, not moved, because it would be a
   different object.
3. **A path that also sets the clip is not wrapped.** `W` before its paint makes the clip outlive the path, and `Q`
   would end it early for everything drawn after. It keeps PDFium's route.
4. **A text object keeps PDFium's route**, and its refusal says what it is in plain words: *This text is set in a font
   Monstera can't rewrite yet, so it was not moved. Pictures and shapes on this page can still be moved and resized.* —
   no reference line, since nothing about the person's action is unknown.
5. **Undo is the checkpoint**, as for `editTextOperators`: the whole-document copy restores the page's content.
6. **One stream after the edit**, ADR-0176's rule: the joined content becomes the page's one `/Contents` stream.

## Rejected

- **Regenerating only the object's own stream in PDFium.** PDFium regenerates per stream, and a printed page's text and
  pictures share one stream; splitting the page's content first would be the same rewrite one step earlier.
- **A new MuPDF lister of objects.** The renderer already names objects by PDFium's walk; a second walk would be a
  second opinion about what object *k* is (B3a). The drawn numbering is measured against PDFium's instead.
- **Wrapping a text object in `q cm Q`.** Not allowed inside `BT … ET`, and splitting a text object to make room changes
  how the rest of it is positioned.

## Consequences

- Moving or resizing a picture, a form or a shape no longer depends on the page's fonts.
- A placement that cannot be found where the listing put it is refused in words, never applied to something else.
- The command lane's walk is kept: a wrapped object is still one object of the same kind at the same place in PDFium's
  walk, so `KEEPS_THE_OBJECT_WALK` takes the new command beside `placePageObject`.

## Addendum, 2026-10-14: what building it measured

- **PDFium regenerates per content stream, and that is why E1 needs one stream to show.** `proof:drawnobjects` first
  put the photo in a stream of its own beside the print's: PDFium's route then moved it and kept every text object,
  because only the stream holding the moved object is written again. A Chromium print (and the owner's pages) hold
  text and pictures in ONE stream, which is the shape the proof now builds, and there the same move loses the Type 3
  text. The Rejected entry's first point stands for that shape; a page whose pictures sit in streams of their own was
  never affected.
- **Decision 4's sentence as shipped** ends with *so nothing was changed*, the rule every edit refusal follows
  (`problemMessages.test.tsx`): *This text is set in a font Monstera can't rewrite yet. Pictures and shapes on this page
  can be moved and resized, but this text can't, so nothing was changed.* The step is `moved-text`, added to
  `EDIT_STEPS`, and only a TEXT object's read-back refusal becomes it; a picture moved through PDFium's route keeps
  `read-back`.

## Addendum, 2026-10-14: a picture moves with the window it shows through (the owner's E3)

**The mechanism.** A magazine's photo is placed larger than it shows and clipped to a window: `q x y w h re W n q … cm
/Im Do Q Q`. `FPDFPageObj_GetBounds` answers the placement as if unclipped, so the listing outlined a box up to 180 px
off the picture and past the page edge; and Decision 1 wrapped only the `Do`, so a move would have slid the photo under
a window that stays.

1. **The listing carries what shows.** PDFium's walk answers each object's `shown` box, its bounds intersected with
   every path of `FPDFPageObj_GetClipPath`, where that narrows it. The renderer draws, picks and resizes by it, cut
   again to the page's crop, and still names the object by the engine's box, which Decision 2's check and the scale's
   anchor read. The renderer's move is computed so the shown corner lands on the target with the scale taken about the
   engine's corner, which is how both engines apply it.
2. **A placement wraps the window with its object** where the window holds nothing else: no other drawn object and no
   text between the window's path and the `Q` that ends it. The outermost such window is taken, so nested windows move
   together. That span is balanced in `q` and `Q` by construction, and `M` is taken in the CTM at the window's path, so
   the object still lands under `ctm·P`. The read-back also requires every window it was carried with to be placed by
   `P`, and every other window unchanged.
3. **A window that holds anything else stays where it is.** Moving it would move what else it holds, which is the
   thing Decision 1 exists to prevent; the photo in it moves and shows through the window where it now falls.
