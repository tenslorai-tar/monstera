# ADR-0210 — The editable PowerPoint export is built from two host reads and a slide model

- **Status:** Accepted 2026-10-08 (the owner's answers of the same day, below)
- **Date:** 2026-10-08
- **Builds:** [ADR-0196](0196-powerpoint-export-may-be-editable-from-the-pages-own-text-images-and-shapes.md), which proposed it.
- **Amends:** [ADR-0072](0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)'s PowerPoint row, *one slide per
  page and each slide IS the page*, and its sentence that the text is part of the picture. That stays true of **Exact look**.
- **Touches the seam (B4):** `packages/kernel/src/host/pdfiumChannels.ts` gains one channel and one flag, so this record comes
  first and the build follows in separate commits.

## The owner's answers (2026-10-08), which this record turns into decisions

1. One deck size from the first chosen page (1 to 56 inches); later pages are scaled to fit and centred, every object by the
   same factor.
2. A scanned page is recognised by `recogniseScope`, unchanged, Tesseract only, and the recognised text is left in the open
   document, undoable, as the existing recognise-on-export behaviour does; the result message says so. A page that cannot be
   recognised falls back to Exact look.
3. The channel's answer lists the pages that fell back, by number, and the result message shows them.
4. One text box per **paragraph** (`groupIntoBlocks`), the original line breaks kept as explicit breaks, autofit off. Where the
   grouping is unsure, one box per line for that region.
5. A complex object is a picture of itself, cut from a render with no text in it. A word is never drawn twice.
6. A plain JPEG is embedded as it is; every other image is a PNG from PDFium's decoded bitmap, within a pixel budget.
7. Text inside forms is reached with composed matrices; a page that still cannot be counted falls back to Exact look.
8. A new PowerPoint dialog body, Editable by default, the choice not stored.
9. One ADR, first, in its own commit; everything else in new modules.

## Decisions

### 1. Two host reads, both on the existing PDFium host

The slide needs what the host's `engine/text-runs` and `engine/page-objects` do not say: the picture bytes, the path
segments, the page's frame, and a render without text. Both new things are registered in the PDFium host's routing table.

- **`engine/page-content`** is one read of one page: the page's frame (crop box and rotation, so `PageTransform` can place
  every object), its text runs (`engine/text-runs`' run and a render-mode flag, read from that channel's own schema), its
  images' headers, its paths and its opaque places. It is a `fileAnswered` channel (ADR-0125), so the metadata crosses in the
  answer file the contract already provides and is validated against the channel's schema like every other answer. **The
  images' bytes are not in it**: they are written to the output name `into` as `engine/render-page`'s raster is (a page's
  pictures are megabytes, past the answer file's 8 MiB ceiling), and the answer says how many bytes were written and where
  each image lies. The first draft of this record had one custom file of metadata and pictures with a parser of its own;
  two existing mechanisms do the same job and a third would be a second opinion about how a host answer crosses (B3a).
- **`engine/render-page` gains `withoutText: boolean`** (default false, so every existing caller is unchanged): the page is
  rendered with its text objects removed from the in-memory page. The host holds no document between calls (ADR-0047), so
  nothing persists.

**Forms are flattened, not walked a second time.** Both reads call `promoteFormObjects` first on the host's in-memory page.
That is the walk with composed matrices that the editor already trusts (it was measured to land text where it was, and to
leave no text in a form at any depth). Text inside a form therefore reads as ordinary page text, `unaddressable` is zero, and
this ADR owns no second opinion about form matrices (B3a). A page whose `unaddressable` is still non-zero is not written
editable (Decision 8).

**The pictures cross a trust boundary and are taken as one.** The host is hostile by invariant 25's premise. Every list is
bounded in the channel's schema (`PAGE_CONTENT_*_MAX`), the blob is taken at exactly the count the host announced
(`takeAnnounced`), and `assemblePageContent` checks before it slices that every image's offset and length lie inside what
was written, that a bitmap is exactly width times height times four, and that a JPEG begins as one. A refusal is a page
written as Exact look.

### 2. The slide model, in one pure module

`slideModel.ts` turns the page's content into slide objects in points on the slide: text boxes, pictures, shapes and cut
pictures, in the page's drawing order. It takes one `PageTransform` per page and one fit factor per deck; it contains no XML
and no native call, so it is tested in milliseconds. `presentationDocument.ts` writes whichever slide kind it is given.
The writer never decides what a page contained.

### 3. Text

- Paragraphs come from `groupIntoBlocks`. A block becomes one text box if its lines align: all left edges equal (left), or all
  right edges equal (right), or all centres equal (centre), within a quarter of the line height. Otherwise the block is
  written as one box **per line**. Columns are separated before this by `groupIntoBlocks` itself (a gap wider than the line
  height splits a line; a block needs horizontal overlap), and the proof asserts that no box spans two columns.
- The box has wrap off and autofit off, zero insets, and its lines separated by `<a:br/>`. The line pitch is the page's own,
  stated as exact point spacing, so a line does not drift when PowerPoint's idea of a font's leading differs.
- Each run carries font name, size, colour, bold and italic. A subset prefix (`ABCDEF+`) is removed; a name that PowerPoint
  cannot be assumed to have is written with the nearest generic family (serif, monospace, else sans) as its fallback.
- **Right-to-left** is read from the characters (Hebrew, Arabic, Syriac, Thaana ranges), because the page states no direction.
  A line whose strong characters are right-to-left is written `rtl="1"`, right-aligned, and its words keep reading order.

### 4. Pictures

A picture is placed at the image's matrix: position, size, rotation and mirror (`a:xfrm rot` and `flipV`). An image
whose matrix has a shear, which PowerPoint cannot express, is a cut picture (Decision 6). A plain JPEG (the image's only
filter is DCT over device grey or RGB) is embedded as its own bytes; anything else is PDFium's decoded bitmap as PNG.
**An image with a mask is not embedded**: the decoded bitmap carries no mask and the rendering that applies it has a fixed
size, so the host probes the rendering and an image with a transparent pixel in its middle is a cut picture, which has the
page's own appearance. An image past 16 megapixels (ADR-0072's slide budget), clipped narrower than itself, or past the
128 MiB byte budget is a cut picture too; the host never decodes it into the answer.

### 5. Shapes

A path is a **shape** when it has no clip, a solid fill or a solid stroke (or both), and at most 256 segments:
an axis-aligned closed rectangle is `rect`; a single line is `line`; any other is `custGeom` with `moveTo`, `lnTo`,
`cubicBezTo` and `close`. Alpha, cap and join are written. A filled path of more than one subpath is a cut picture, because
DrawingML does not say which fill rule holds the holes. Anything else (a clip narrower than the path, a dash, a pattern, a
shading, a path beyond the 256-segment or 20,000-segment bound) is a **cut picture**. A clip that is one rectangle
containing the object is not narrower than it: producers wrap a whole page in one, and counting it would cut every shape.

### 6. A cut picture

The rectangle of that object's bounds is cut from the page rendered with no text (Decision 1) at 150 dpi inside the pixel
budget, and placed at the object's place. Text is not in the render, so the text boxes over it do not draw a word twice. What
lies under the object in that rectangle (another picture, a fill) is part of the cut: stated, not hidden.

### 7. A scanned page

The UI command runs `recogniseScope(deps, docId, scanPages, languages)` for the chosen pages that have no text, then asks
main to export. The scan is not removed: the page render is the slide's bottom picture and the recognised text boxes sit over
it with no fill. Recognition writes the text layer into the open document, undoably, page by page (ADR-0118 states the same
for recognise on export), and the result message says so. With no model on the machine, those pages fall back to Exact look.

### 8. Fallback is per page and named

A page is written as Exact look, and listed by its number in the answer, when: it has pictures and no text and recognition
did not give it any; the read was refused or failed validation; `unaddressable` is non-zero after flattening; the text or
another list was truncated; or any painted run is not upright (rotated or skewed text, which a level box would misplace). The
deck is still one file; Editable pages and Exact look pages sit side by side. `fellBack: number[]` (one-based, as a person
counts) is a field of `document.exportPowerPoint`'s `copied` answer only. Exact look has no fallback because it is the
fallback.

### 9. The dialog and the contract

`document.exportPowerPoint` gains `mode: 'editable' | 'exact'`, **required** (an optional field is the omitted default that
silently picks today's behaviour for a caller that forgot, which is the "convenience" ADR-0069 names). A new
`PowerPointBody` carries the choice and the existing page-range control; the shared `ExportPagesBody` is not changed. The
choice is not stored.

## What this will not do (stated so nobody expects more)

- Fonts are named, not embedded; PowerPoint substitutes where the machine lacks one, so a line can wrap differently, which
  wrap-off prevents inside a box but not across a substituted font's width.
- Reading order is the page's, not a reflowed layout.
- Not to the pixel. **Exact look** is the guarantee.
- Annotations are not slide objects in Editable; they are in Exact look. (A page's annotations are a separate layer and a
  separate decision.)

## Rejected alternatives

- **Walking forms in the new read.** A second matrix composition beside `promoteFormObjects`, which the editor already proves.
- **Answering pictures on the pipe.** A page of pictures is past every frame bound.
- **Rendering the cut picture with text and hiding the text boxes' words.** Draws every word twice, or loses the editable text.
- **An optional `mode`.** See Decision 9.
- **Changing `ExportPagesBody`.** It serves two other exports.
