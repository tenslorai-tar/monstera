import type { MupdfSession } from './engineSeam.js';
import { ColorSpace, DrawDevice, type Image, Matrix, Pixmap, type Rect } from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';
import { ooxmlPackage } from './ooxmlPackage.js';
import { readPageGeometry } from './pageGeometry.js';
import { pageInDocument } from './pageScope.js';
import { MAX_SNAPSHOT_PIXELS } from './pageSnapshot.js';
import { readPageTextJson } from './pageText.js';
import { PICTURE_READ_OPTIONS, type PagePicture, type PrintedBox, parsePageLayout } from './textStructure.js';
import { type WordMode, type WordPage, wordDocumentParts } from './wordDocument.js';

/**
 * The Word export as the MuPDF host composes it
 * ([ADR-0072](../../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)'s
 * amendment of 2026-10-01): each page read as every other consumer reads it, each
 * picture drawn as MuPDF's interpreter draws it, and the package streamed.
 *
 * @returns the `.docx` package, a chunk at a time, one page's text and one page's
 *   pictures held at once; and how many pictures it carries, once the chunks are consumed
 */
export function composeWordDocument(
  session: MupdfSession,
  mode: WordMode,
): { readonly chunks: AsyncIterable<Uint8Array>; readonly pictures: () => number } {
  let drawn = 0;
  const chunks = ooxmlPackage(
    wordDocumentParts(mode, wordPages(session), async (page, pictures) => {
      const pngs = await drawPagePictures(session, page, pictures);
      drawn += pngs.length;
      return pngs;
    }),
  );
  return { chunks, pictures: () => drawn };
}

async function* wordPages(session: MupdfSession): AsyncIterable<WordPage> {
  const { pageCount } = await readPageGeometry(session, []);
  for (let index = 0; index < pageCount; index += 1) {
    // THE SHARED READ, parsed by the one reader: the words and the pictures' places
    // are exactly what search, the text layer and the text export see.
    const { text, pictures } = parsePageLayout(await readPageTextJson(session, index, 'substrate'));
    const [size] = (await readPageGeometry(session, [index])).sizes;
    if (size === undefined) throw new Error(`the geometry read named no size for page ${String(index + 1)}`);
    yield { index, text, size, pictures };
  }
}

/** A box as MuPDF's JSON writer prints it: each figure truncated toward zero, as `(int)` does in `stext-output.c`. */
function printedOf(bbox: Rect): PrintedBox {
  return {
    x: Math.trunc(bbox[0]),
    y: Math.trunc(bbox[1]),
    w: Math.trunc(bbox[2] - bbox[0]),
    h: Math.trunc(bbox[3] - bbox[1]),
  };
}

function samePrinted(one: PrintedBox, two: PrintedBox): boolean {
  return one.x === two.x && one.y === two.y && one.w === two.w && one.h === two.h;
}

/**
 * One page's pictures, drawn, in the order `pictures` names them.
 *
 * **From a second read, matched by box.** The places come from the shared read,
 * where segmentation has put every picture inside a structure block that MuPDF's
 * walk does not enter; this read asks for the pictures alone, so the walk meets
 * each one, and its box truncated as the JSON writer truncates is the key.
 * Two pictures with the same whole-point box are paired in the order each read
 * met them — a stated limit, since no key tells them apart.
 *
 * @throws if a place has no picture behind it in this read — never a gap, since a
 *   package naming a picture it does not carry is one Word reports as damaged
 */
export function drawPagePictures(
  session: MupdfSession,
  page: number,
  pictures: readonly PagePicture[],
): Promise<readonly Uint8Array[]> {
  return withDocument(session, (document) => {
    pageInDocument(page, document.countPages());
    const structured = document.loadPage(page).toStructuredText(PICTURE_READ_OPTIONS);
    const found: { readonly bbox: Rect; readonly transform: Matrix; readonly image: Image; used: boolean }[] = [];
    try {
      structured.walk({
        onImageBlock: (bbox, transform, image) => {
          found.push({ bbox, transform, image, used: false });
        },
      });
      return pictures.map((picture) => {
        const match = found.find((entry) => !entry.used && samePrinted(printedOf(entry.bbox), picture.printed));
        if (match === undefined) {
          throw new Error(
            `page ${String(page + 1)} placed a picture at ${JSON.stringify(picture.printed)} and the picture ` +
              `read found none there (it found ${String(found.length)}).`,
          );
        }
        match.used = true;
        return drawPicture(match.image, match.bbox, match.transform);
      });
    } finally {
      for (const entry of found) entry.image.destroy();
      structured.destroy();
    }
  });
}

/**
 * Draws one picture as it appears on its page, as PNG.
 *
 * **As `pdf_show_image` draws it**: clipped to the image's own mask, filled, the
 * clip popped — so a soft mask arrives as transparency — and through its page
 * transform, so a rotated or mirrored picture arrives turned as the page shows it.
 * Onto a pixmap cleared WITHOUT a value: `fz_clear_pixmap` zeroes alpha, where
 * clearing with a value makes it opaque (measured 2026-10-01; the transparent band
 * came back black).
 *
 * **At the picture's own resolution**, the image's pixels over the area its
 * transform covers, and at most {@link MAX_SNAPSHOT_PIXELS} — the host's bound on
 * one pixmap, which a larger picture is scaled down to rather than refused. The
 * same bound a snapshot and a page image take, not a figure of this export's own.
 *
 * An image with no colour space is a stencil, drawn in the fill colour the page
 * gave it; the structured text keeps no colour, so it is drawn black.
 */
function drawPicture(image: Image, bbox: Rect, transform: Matrix): Uint8Array {
  const width = Math.max(bbox[2] - bbox[0], 1e-3);
  const height = Math.max(bbox[3] - bbox[1], 1e-3);
  const area = Math.abs(transform[0] * transform[3] - transform[1] * transform[2]);
  const own = area > 0 ? Math.sqrt((image.getWidth() * image.getHeight()) / area) : 1;
  const bounded = Math.min(own, Math.sqrt(MAX_SNAPSHOT_PIXELS / (width * height)));
  const pixelsWide = Math.max(1, Math.round(width * bounded));
  const pixelsHigh = Math.max(1, Math.round(height * bounded));

  const ctm = Matrix.concat(
    Matrix.concat(transform, Matrix.translate(-bbox[0], -bbox[1])),
    Matrix.scale(pixelsWide / width, pixelsHigh / height),
  );
  const pixmap = new Pixmap(ColorSpace.DeviceRGB, [0, 0, pixelsWide, pixelsHigh], true);
  const device = new DrawDevice(Matrix.identity, pixmap);
  const colorSpace = image.getColorSpace();
  const mask = image.getMask();
  try {
    pixmap.clear();
    if (colorSpace === null) {
      device.fillImageMask(image, ctm, ColorSpace.DeviceGray, [0], 1);
    } else if (mask !== null) {
      device.clipImageMask(mask, ctm);
      device.fillImage(image, ctm, 1);
      device.popClip();
    } else {
      device.fillImage(image, ctm, 1);
    }
    device.close();
    return pixmap.asPNG();
  } finally {
    mask?.destroy();
    colorSpace?.destroy();
    device.destroy();
    pixmap.destroy();
  }
}
