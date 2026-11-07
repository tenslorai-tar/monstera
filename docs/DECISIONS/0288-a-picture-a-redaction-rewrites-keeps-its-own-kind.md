# ADR-0288 — A picture a redaction rewrites keeps its own kind

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decided by:** the owner, 2026-11-06: *a redaction save must not store pictures uncompressed* (real documents went
  from 1.26 MB to 21 MB and from 229 KB to 3 MB, and the live release does the same); *a picture keeps its own kind:
  one that was JPEG goes back to JPEG at high quality, and everything else stays lossless; do not guess from how a
  picture looks; keep masks and transparency.*
- **Amends:** the native shim's ABI ([ADR-0124](0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md)), which
  gains one `mz_` export, and `applyApplyRedactions` (`packages/kernel/src/pageRedact.ts`), whose burn-in calls it in
  place of the binding's `applyRedactions`.

## The problem, in one sentence

MuPDF rebuilds every picture a mark touches from decoded pixels and writes it with no filter, so a JPEG photo comes
back as raw samples, and nothing on the new picture says what it was.

## What was measured, and read

- **Read**, MuPDF 1.28.0 `source/pdf/pdf-clean.c`: the pixels method's image filter (`pdf_redact_image_filter_pixels`)
  decodes the picture, sets the covered pixels to white (0 in a subtractive colour space) and its mask to opaque, and
  returns `fz_new_image_from_pixmap`, a picture with no compressed buffer. `pdf-op-filter.c` then writes it with
  `pdf_add_image` under a NEW resource name, `Im1` and on; a picture wholly inside a mark is dropped and one no mark
  touches is drawn as the same object. Both filter functions are `static`.
- **Measured**, the same day, this container: a page drawing an 800 × 600 JPEG (297,148 bytes) and a 400 × 300 picture
  with a mask, both under a mark, saved after the burn-in as 1,819,204 bytes, the photo as 1,440,000 bytes of raw RGB.
  With `compress` (ADR-0151's save, [`FULL_SAVE_TERMS`](../../packages/kernel/src/saveDepth.ts)) the file was 644,430
  bytes, the photo 639,404 bytes of flate: lossless is two and a half times the JPEG it replaced.
- The page's resource names change and a covered picture may vanish, so neither name nor position in the content
  pairs a replacement with its original from outside the filter. The filter's own callback receives the transform the
  picture is drawn with, the same before and after the burn-in, and the picture itself, whose compressed buffer says
  what it was stored as (`fz_compressed_image_buffer`, `FZ_IMAGE_JPEG`).

## Decisions

1. **One shim export burns a page in: `mz_redact_page`.** It takes the four options `pdf_redact_page` takes and calls
   it, between two passes of MuPDF's public content filter (`pdf_filter_page_contents`, with the redaction's own
   options: `recurse = 0`, `instance_forms = 1`, `ascii = 1`), the shape `mz_cut_line_art` already has:
   - **before**, an image filter that changes nothing notes the transform of every picture the page draws whose stored
     kind is JPEG, and of every other picture;
   - **after**, where a JPEG was noted, an image filter replaces each picture that has no compressed buffer (the burn-in's
     replacement) and is drawn at a transform that only a JPEG was noted at, by the same pixels written as JPEG, its mask
     and its image-mask flag kept.
   The binding's `applyRedactions` is no longer called by the burn-in: one way to burn a page in.
2. **The kind is the original's stored kind, read from its compressed buffer**, never from its pixels. A transform at
   which pictures of two kinds were noted keeps the replacement lossless. Transforms are matched within 1/1000 of a unit,
   since the burn-in writes the page's numbers again as text.
3. **High quality is 90**, MuPDF's own JPEG writer (`fz_new_buffer_from_pixmap_as_jpeg`), and no picture's pixel size
   changes. Everything that is not JPEG stays lossless: written raw by MuPDF and deflated by the full save's `compress`.
   A mask is never JPEG.
4. **What is removed stays removed, and the encoding cannot bring it back.** The encoder's input is MuPDF's pixmap after
   the covered pixels were set to white, so nothing removed reaches it. A JPEG block crossing the mark's edge softens the
   pixels next to it, from pixels outside the mark only. The proof reads four things: the saved picture decoded is blank
   inside the mark; the original picture's bytes are absent from the saved file; masks, thumbnails (`/Thumb`, removed by
   the burn-in already) and alternate versions (`/Alternates`) carry nothing removed; and a picture no mark touches is
   byte for byte the one it was.
5. **No new dependency.** MuPDF's own JPEG writer and filter API.

## Rejected

- **`compress` alone**: measured above, a photo stored at two and a half times its JPEG size.
- **Pairing from outside the filter**, by resource name, by order in the content, or by size: MuPDF renames every
  picture and drops a covered one, so each is a guess where a page draws more than one picture.
- **Copying MuPDF's pixels filter into the shim with JPEG output**: a second implementation of how a redaction blanks a
  picture (B3a), on the path whose failure is a leak.
- **Deciding from the pixels** whether a picture is a photo: the owner's rule.
- **Re-encoding every picture the burn-in touches as JPEG**: a line drawing or a scan with text would become lossy.

## Costs, stated

- A page where a JPEG was noted is filtered twice more than before; a page without one, once more (the noting pass).
  Measured at build: in the note below.

## Note, 2026-11-06 — as built

- **The noting pass is a device, not a filter**, so it rewrites nothing: `pdf_run_page_contents` with a device that
  receives each picture and its transform. The filter's transform is taken through the interpreter's turn of image space
  (`[1 0 0 -1 0 1]`, `pdf-op-run.c` line 918) and the page's own transform before it is compared; measured, a picture
  the filter saw at `[400 0 0 -300 50 342]` was noted at `[400 0 0 300 50 42]`. A page with no JPEG is filtered by the
  burn-in alone, as before.
- **The replacement, read back, is stored raw**: `pdf_add_image` wrote it as an object with no filter, which the second
  pass loads as a picture of type `FZ_IMAGE_RAW`, not as one with no buffer. So the rule is: a raw picture drawn where
  only a JPEG was drawn before the burn-in.
- **The noting run uses the View usage**, so a picture inside optional content hidden for viewing is not noted, and its
  replacement stays lossless: the safe direction.
- **Cost**, this container, a 1,600 × 1,200 JPEG under one mark, three runs each: the burn-in 35 to 45 ms through the
  binding against 108 to 114 ms through `mz_redact_page` (the JPEG decoded and encoded again); the saved file 911,904
  bytes before (with `compress`) against 447,142 after, from 546,040. On the case's own page
  (`redactionPictures.test.ts`) the photo comes back as `/DCTDecode` at 800 × 600; the probe page of the measurement
  above, 1,819,204 bytes raw and 644,430 with `compress`, saved at 288,857.

## Note, 2026-11-07 — a CMYK photo came back RGB, and now keeps its space

Tested on the owner's request, a CMYK JPEG stored as its samples and one stored inverted under `/Decode [1 0 1 0 1 0 1 0]`
(the way a CMYK JPEG from Photoshop is held): both came back as JPEG and drew their colours, but in RGB, three samples a
pixel. MuPDF's own burn-in keeps the picture CMYK (an ICC-based space, four components, raw); the JPEG writer the shim
called, `fz_new_buffer_from_pixmap_as_jpeg`, converts any space but the device grey, RGB and CMYK singletons to RGB
(`jpeg_from_pixmap`, `output-jpeg.c` 1.28.0). That is a change of kind the decision does not allow, and a print workflow
would see it.

The shim now writes through `fz_write_pixmap_as_jpeg`, which takes any grey, RGB or CMYK space as it is; the picture is
given the burn-in pixmap's own space, and its samples are written plain and marked so (`fz_new_image_from_buffer` takes
every JPEG for inverted CMYK, which would have put a `/Decode` turning them over). A pixmap in another space (Lab, a
separation) stays lossless rather than fail the redaction. `redactionPictures.test.ts`: both CMYK photos come back as
JPEG, four samples a pixel, a mean colour difference outside the mark of 1.29 of 255 against the page before, and white
inside; with the samples written inverted the difference is 112.8, so the comparison sees the colours.
