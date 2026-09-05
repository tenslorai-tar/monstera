import type { Box } from '@monstera/shared';
import type { PDFObject } from 'mupdf';

/**
 * What box a page **displays** — one answer, with callers (B3a).
 *
 * ## Why this is a module rather than two private helpers
 *
 * *Which region of this page does a reader see* is a question the PDF
 * specification answers and MuPDF implements, and it was being answered here
 * twice: once inside `pageCrop.ts`, which insets it, and again — about to be —
 * by the annotation writer, which has to place a rectangle inside it. Two hand
 * -written answers to a question an authority owns is the shape B3a spends its
 * time on, and the reason it is dangerous is visible in the correction below:
 * the existing one agreed with MuPDF on every ordinary document.
 *
 * ## THE CLIP IS THE CORRECTION, and it was found by measurement
 *
 * PDF 32000-1 §14.11.2: the crop box *"shall be... clipped to the media box"*.
 * `pageCrop.ts`' `displayedBox` returned the crop box as written, with no clip,
 * and that is invisible on every document whose crop box sits inside its media
 * box — which is every well-formed one.
 *
 * Measured 2026-09-05 against MuPDF 1.28.0's own `PDFPage.getTransform()`, on a
 * page with `/MediaBox [0 0 200 300]`:
 *
 * | `/CropBox` | MuPDF's box | unclipped | agree |
 * |---|---|---|---|
 * | absent | `[0 0 200 300]` | same | yes |
 * | `[50 100 150 250]` | `[50 100 150 250]` | same | yes |
 * | `[150 250 50 100]` (reversed) | `[50 100 150 250]` | same | yes |
 * | `[-20 -30 400 500]` | `[0 0 200 300]` | `[-20 -30 400 500]` | **no** |
 * | `[-20 -30 100 150]` | `[0 0 100 150]` | `[-20 -30 100 150]` | **no** |
 *
 * The last two are twenty and thirty units out, which for an annotation is a
 * rectangle in the wrong place and for a crop is an inset taken from a margin
 * the reader cannot see.
 *
 * ## An EMPTY intersection is `null`, and this build does not follow MuPDF there
 *
 * Measured in the same run: given a crop box disjoint from the media box, or a
 * degenerate one, MuPDF discards both and answers with `[0 0 612 792]` — US
 * Letter. That is a rasteriser's fallback, and it is the right thing for a
 * rasteriser: something has to be drawn.
 *
 * It is the wrong thing for a **writer**, because it invents a coordinate frame
 * the document does not have and then places content in it. `null` here means
 * *this page displays nothing*, and each caller refuses in its own words — which
 * is `pageCrop.ts`' own rule about clamping, applied one level up: the honest
 * answer to an impossible request says so rather than picking a number.
 *
 * PDF.js's fallback for the same page is its **media** box, so a viewer and this
 * writer would disagree about where the user was pointing. Refusing is what
 * makes that disagreement unrepresentable rather than caught.
 */

/**
 * The four numbers of a box object, or `null` if it is not one.
 *
 * A malformed box is `null` rather than a throw: what that means is the
 * caller's decision — `pageCrop.ts` turns it into a capture refusal, which is
 * *this document cannot have its prior state recorded* rather than *this
 * command is illegal*.
 */
export function boxOf(object: PDFObject): readonly number[] | null {
  if (!object.isArray() || object.length !== 4) return null;
  const numbers: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const entry = object.get(index);
    if (!entry.isNumber()) return null;
    numbers.push(entry.asNumber());
  }
  return numbers;
}

/**
 * A box's four numbers as corners, ordered.
 *
 * The format specifies a rectangle *"by any two diagonally opposite corners"*,
 * so `[0 792 612 0]` is a legal spelling of a Letter page. Reading the numbers
 * positionally inverts every box written that way, and the page still renders,
 * which is the failure that does not announce itself.
 */
function ordered(box: readonly number[]): Box {
  const [a = 0, b = 0, c = 0, d = 0] = box;
  return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
}

/**
 * The region this page displays: its `/CropBox` clipped to its `/MediaBox`, or
 * the media box where there is no crop box.
 *
 * `null` when either box is missing or malformed, or when the two do not
 * overlap — see the note above on why that is not MuPDF's answer.
 *
 * `getInheritable` for both, because either may come from an ancestor `/Pages`
 * node: what a reader sees is what the page **resolves to**, not what the leaf
 * happens to declare. Own-state is the inverse's business (ADR-0009 §3) and is
 * read with `get` at the one place that needs it.
 */
export function displayedBox(object: PDFObject): Box | null {
  const media = boxOf(object.getInheritable('MediaBox'));
  if (media === null) return null;
  const mediaBox = ordered(media);

  const crop = object.getInheritable('CropBox');
  if (crop.isNull()) return mediaBox;

  const cropNumbers = boxOf(crop);
  // A MALFORMED CROP BOX IS THE MEDIA BOX, which is what a viewer must do: a
  // page whose crop box is a name rather than an array is still a page, and
  // refusing to place anything on it would be stricter than every reader the
  // document has already been through.
  if (cropNumbers === null) return mediaBox;
  const cropBox = ordered(cropNumbers);

  const clipped: Box = {
    x0: Math.max(cropBox.x0, mediaBox.x0),
    y0: Math.max(cropBox.y0, mediaBox.y0),
    x1: Math.min(cropBox.x1, mediaBox.x1),
    y1: Math.min(cropBox.y1, mediaBox.y1),
  };
  if (clipped.x1 <= clipped.x0 || clipped.y1 <= clipped.y0) return null;
  return clipped;
}
