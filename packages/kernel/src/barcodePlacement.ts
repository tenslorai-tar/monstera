import type { AnnotationRect } from '@monstera/contract';

/**
 * Where a barcode goes inside the box a person dragged: as large as fits, in the symbol's own
 * proportions, centred.
 *
 * The place-image command fills its rectangle, which is right for a picture a person sized and
 * wrong for a symbol — a QR code squeezed on one axis has modules of two sizes, and a reader
 * decodes a grid it assumes is square. So the box is narrowed here, in the same PDF user space
 * the command's rectangle is in, and the image is then drawn into a box of its own shape.
 *
 * On a rotated page the fit is still right: the stamp is drawn in user space and turns with the
 * page, so the proportions it keeps are the ones it is drawn in.
 *
 * Kept out of `barcodeWriter.ts` so `main` can take it from the barrel without loading the
 * writer's WASM.
 */
export function barcodeRect(box: AnnotationRect, width: number, height: number): AnnotationRect {
  const left = Math.min(box.x0, box.x1);
  const bottom = Math.min(box.y0, box.y1);
  const boxWidth = Math.abs(box.x1 - box.x0);
  const boxHeight = Math.abs(box.y1 - box.y0);
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  const x0 = left + (boxWidth - drawnWidth) / 2;
  const y0 = bottom + (boxHeight - drawnHeight) / 2;
  return { x0, y0, x1: x0 + drawnWidth, y1: y0 + drawnHeight };
}
