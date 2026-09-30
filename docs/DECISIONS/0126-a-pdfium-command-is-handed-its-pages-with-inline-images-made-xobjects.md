# ADR-0126 — A PDFium command is handed its pages with inline images made XObjects

**Status:** Accepted 2026-09-30 (B4, amends `docs/ARCHITECTURE.md` §4's byte-image paragraphs). The owner's decision
B of 2026-09-30.

## Context

An edit through PDFium ends in `FPDFPage_GenerateContent`, which writes the page's content stream afresh from
PDFium's page objects. `CPDF_PageContentGenerator::ProcessImage`, read 2026-09-30 from PDFium's main branch, begins:

```cpp
RetainPtr<CPDF_Image> pImage = pImageObj->GetImage();
if (pImage->IsInline()) {
  return;
}
```

So an inline image, written in the content stream as `BI … ID … EI`, is not written back, and the saved page
loses it. Measured by `scripts/research/pdfiumImageKeep.mjs`. A page of one text line and one red picture was
edited, saved and reopened with the picture drawn five ways. An image XObject, a soft-masked one, a stencil mask
and one inside a form survived. The inline one was white.

The owner's decision: **never refuse Edit text on a page**; make the edit keep the picture, with a control that
fails when it is dropped, and check every other command that regenerates a page's content.

## What was measured before deciding

- **PDFium's public API has no inline flag.** `fpdf_edit.h` at 155.0.8044.0 has none. `LoadJpegFileInline` means
  *load the file now*, not `BI … EI`.
- **Refilling the image does not clear it.** `scripts/research/pdfiumInlineConvert.mjs` put an inline RGB raster,
  an inline stencil drawn in the fill colour and an inline JPEG over a blue square. It tried `SetBitmap` of
  `GetBitmap`, `SetBitmap` of `GetRenderedBitmap`, and `LoadJpegFileInline` of the raw JPEG. Every conversion lost
  the picture exactly as no conversion did. All three calls refill the same `CPDF_Image`, whose inline flag stays.
- **A new image object would drop the clip.** A new object built from the picture can be inserted at the old
  one's index, but PDFium offers no call that sets an arbitrary clip path on it. A picture clipped to a shape
  would then draw past its edges.
- **MuPDF reads inline images as its interpreter does.** `parse_inline_image` in `pdf-interpret.c` reads the
  dictionary, the whitespace after `ID`, the data (`pdf_load_inline_image`) and the `EI`. `pdf_add_image` writes
  an `fz_image` as an XObject, keeping its compressed data and its mask and decode flags.

## Decision

1. **Before a PDFium command's `apply` or `invert`, the MuPDF host rewrites each inline image on the pages the
   command regenerates.** Each `BI … EI` span in the decoded content stream becomes `/Name Do`, where `Name` is a
   new entry in that stream's own resources pointing at the image written by `pdf_add_image`. Everything else in
   the stream is copied byte for byte. The replacement stands where the picture stood, so its clip, colour and
   drawing order are the stream's own and cannot be lost.
2. **Form XObjects drawn on those pages are rewritten too**, because `promoteFormObjects` moves a form's content
   onto the page, where the same generator would drop it. Each form is visited once.
3. **Stateless, on the session's granted area.** The channel is `engine/keep-inline-images`: the image named by
   `from` in the session's snapshot directory, written to `into` in its output directory. It holds nothing
   between calls and touches no live session. When no page holds an inline image, it writes nothing, and PDFium is
   handed the image it would have had. The bytes are saved incrementally, because PDFium rewrites the whole file
   next.
4. **Which pages a command regenerates has one statement**, `pagesRegeneratedBy(command)`. It gives the command's
   `page`, or every page for `replaceAllText`, the one document-wide PDFium command.
5. **An inline image this cannot rewrite is counted and left.** The known case is a `BI` whose `EI` is not in the
   same stream. The command still runs, never refused, and the count goes to the diagnostics log.

## Rejected

- **Refusing Edit text on a page with an inline image.** The owner ruled it out.
- **A new PDFium image object built from the picture.** It drops the clip, and a stencil's fill colour would be
  baked into pixels.
- **Converting at open.** It changes a person's file before they have asked for anything.
- **Converting in the live MuPDF session.** It changes the bytes main would save with no command recorded. If
  PDFium then refused, the change would outlive the command it was made for.
- **A second PDF parser in TypeScript.** Where the PDF grammar decides, MuPDF's lexer and inline-image reader are
  the authority, and a second one would agree with them until an unusual stream (B3a).

## Consequences

- Every PDFium command pays one MuPDF open and one scan of its pages' content streams. It writes and re-reads the
  file only when there is something to keep.
- Pages whose inline images were rewritten are saved with XObjects instead. They draw the same, the stream is
  larger by a name per picture, and the image data is the same bytes.
- The loss is class-wide in PDFium's generator, so every regenerating command takes this step. MuPDF's own
  rewrites (redaction, sanitize) keep inline images and are not affected.
