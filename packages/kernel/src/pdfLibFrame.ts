import { type Degrees, PDFArray, PDFName, PDFNull, PDFNumber, type PDFObject, type PDFPage, degrees } from '@cantoo/pdf-lib';
import { type PageTransform, pageTransform, snapRotation, toPdf, viewportPoint } from '@monstera/shared';

import { type BoxValue, displayedBox } from './pageBoxes.js';

/**
 * A pdf-lib page as the reader sees it (CR-COR-01).
 *
 * ## What `getSize()` is not
 *
 * pdf-lib's `getSize()` is the `/MediaBox`'s extent with its origin dropped, and `drawText` and raw operators write in
 * user space with no turn. So a header placed from `getSize()` assumes a page at rotation 0 whose box starts at 0,0 —
 * invariant L3's assumption, arriving through a library call instead of a subtraction. On a scan carrying `/Rotate 90`
 * the "header" ran down a side edge; on a box from `[-9 -9 621 801]` a background left a 9-point band; under a crop
 * box inset by 50 a footer sat in the margin nobody sees.
 *
 * ## The frame is the engine's, through the two rules that already exist
 *
 * Which region a page displays is `pageBoxes.ts`' `displayedBox`, given the page through the shape it reads; which
 * quarter turn it displays at is `snapRotation`, the engine's own snap; and a point measured on the displayed page goes
 * to user space through `toPdf`. This module holds no rule of its own about boxes or turns, only the adapter, so the
 * pdf-lib commands and the MuPDF ones cannot disagree about where the page is.
 */

/** The displayed page at one point per unit: its size, its turn, and the way back to user space. */
export type PageFrame = PageTransform;

/**
 * The frame a page displays in, or a named refusal for a page that displays nothing — the refusal every writer here
 * gives (`pageCrop.ts`, `pageAnnotations.ts`), since there is no frame to place anything in.
 */
export function pageFrame(page: PDFPage, index: number): PageFrame {
  const frame = frameOfPage(page);
  if (frame === null) {
    throw new RangeError(
      `page ${String(index)} displays no region — it has no /MediaBox of four numbers, or its /CropBox and /MediaBox ` +
        'do not overlap — so there is no frame to place anything in',
    );
  }
  return frame;
}

/**
 * {@link pageFrame}, answering `null` for a page that displays nothing. For a caller that only READS a page's shape —
 * a table of contents sized like its neighbour — where a neighbour with no frame is a reason to use a default, not to
 * refuse the person's command.
 */
export function frameOfPage(page: PDFPage): PageFrame | null {
  const box = displayedBox({ getInheritable: (key) => boxValue(page, key) });
  return box === null ? null : pageTransform(box, snapRotation(page.getRotation().angle), 1);
}

/**
 * Where to draw words that read upright to the reader, from a point on the displayed page: `x` from its left edge and
 * `fromTop` from its top, as the reader measures. `turn` is a further turn in the reader's view, counter-clockwise, as
 * a watermark's slant is given.
 *
 * pdf-lib turns text counter-clockwise in user space, and the page is shown turned clockwise by its `/Rotate`, so the
 * page's own turn added to `turn` is what reads as `turn` on screen.
 */
export function upright(
  frame: PageFrame,
  x: number,
  fromTop: number,
  turn = 0,
): { readonly x: number; readonly y: number; readonly rotate: Degrees } {
  const at = toPdf(viewportPoint(x, fromTop), frame);
  return { x: at.x, y: at.y, rotate: degrees(frame.rotation + turn) };
}

/** One inheritable box of a pdf-lib page, in the shape `displayedBox` reads. */
function boxValue(page: PDFPage, key: 'MediaBox' | 'CropBox'): BoxValue {
  const value = resolved(page, page.node.getInheritableAttribute(PDFName.of(key)));
  const array = value instanceof PDFArray ? value : undefined;
  return {
    // `PDFNull` IS THE ONE INSTANCE pdf-lib exports, not a class, so it is compared by identity.
    isNull: () => value === undefined || value === PDFNull,
    isArray: () => array !== undefined,
    length: array?.size() ?? 0,
    get: (index) => {
      const entry = array === undefined ? undefined : resolved(page, array.get(index));
      return {
        isNumber: () => entry instanceof PDFNumber,
        asNumber: () => (entry instanceof PDFNumber ? entry.asNumber() : Number.NaN),
      };
    },
  };
}

/** An object with its indirect reference followed, as a box may be stored behind one. */
function resolved(page: PDFPage, object: PDFObject | undefined): PDFObject | undefined {
  return object === undefined ? undefined : page.doc.context.lookup(object);
}
