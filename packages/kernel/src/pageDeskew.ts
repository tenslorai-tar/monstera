import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import { COORDINATE_DECIMALS, SCALE_DECIMALS, contentNumber } from './contentNumbers.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { displayedBox } from './pageBoxes.js';
import {
  type PriorContents,
  contentsAreWrappable,
  contentsPrior,
  restoreWrappedContents,
  wrapContents,
} from './pageContentWrap.js';
import { pagesOf } from './pageScope.js';
import { type PageSkew, deskewRotation, measurePageSkew } from './pageSkew.js';

/**
 * Deskew — turning a crooked page back to level.
 *
 * ## The command carries NO angle, and that is the load-bearing decision
 *
 * The obvious shape is `deskewPages({ pages, degrees })`, with a detector
 * somewhere else handing the number in. It is the wrong shape here for two
 * reasons, and the second is the one that decided it:
 *
 * 1. *straighten this page* is one action to a person. A command taking an
 *    angle is **rotate by an arbitrary amount**, which is a different feature
 *    wearing this row's name, and the row is deskew.
 * 2. **the conversion between the measurement's frame and the transform's would
 *    then live at a call site.** The measurement is taken in a raster, which is
 *    y-down; a content stream is PDF user space, which is y-up. Putting the two
 *    in one module makes the conversion one named function with a round trip
 *    over it (`pageSkew.ts`), and a wrong sign a red test rather than a page
 *    turned twice as far the wrong way.
 *
 * So the measurement happens inside the apply, against the page the command is
 * about to write. That is `generateToc`'s shape — `reapply-intent`, reading the
 * document at apply time — and it keeps the raster inside the process that holds
 * the parse, which is §9.17's gate satisfied by construction rather than by a
 * bound.
 *
 * ## What it costs, measured
 *
 * One page is rasterised at `pageSkew.ts`' `SKEW_DPI` and swept. The figure is in
 * `docs/FEATURES.md`' deskew row with the run that produced it; a document-wide
 * deskew is that cost per page, which is why the row says so rather than the
 * schema pretending the operation is free.
 *
 * ## It is the same write as a resize, and the shape has one owner
 *
 * `pageContentWrap.ts` holds the `/Contents` wrap, its refusal and its inverse.
 * This command differs from `resizePages` in exactly two ways: the matrix is a
 * rotation about the displayed box's centre rather than a scale, and **the boxes
 * are not touched**. A deskew does not change what size the sheet is.
 *
 * ## The corners go outside the box, and that is what deskewing is
 *
 * Rotating a page's content about its centre pushes the corners past the sheet
 * and leaves four triangles of paper showing. Every deskew does this; the
 * alternative — growing the sheet to contain the rotated content — changes the
 * page's size to correct its angle, which is two operations and the user asked
 * for one. `resizePages` is there for the other one.
 */

/** One page's prior own-state, in the order the command named its pages. */
export interface PriorPageDeskew {
  readonly page: number;
  readonly contents: PriorContents;
}

/** The page object, refusing an index this document does not have. */
function pageObject(document: PDFDocument, page: number, total: number): PDFObject {
  if (!Number.isInteger(page) || page < 0 || page >= total) {
    throw new RangeError(
      `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  return document.loadPage(page).getObject();
}

/**
 * The operators that rotate a page's content about the centre of the region it
 * displays.
 *
 * A PDF matrix `[a b c d e f]` maps `(x, y)` to `(ax + cy + e, bx + dy + f)`, so
 * a counter-clockwise turn of θ about `(cx, cy)` is
 * `[cos θ, sin θ, −sin θ, cos θ, …]` with the translation carrying the
 * centre back:
 *
 * ```
 * e = cx − cx·cos θ + cy·sin θ
 * f = cy − cx·sin θ − cy·cos θ
 * ```
 *
 * **The centre is the DISPLAYED box's**, not the media box's, for the reason
 * `pageResize.ts` reads the same box: a page whose crop box hides a margin is
 * turned about what the reader is looking at. A rotation about the wrong centre
 * is a rotation plus a translation, and the translation is what slides the text
 * off the edge.
 */
function rotationOperators(degrees: number, centreX: number, centreY: number): string {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const a = contentNumber(cos, SCALE_DECIMALS);
  const b = contentNumber(sin, SCALE_DECIMALS);
  const c = contentNumber(-sin, SCALE_DECIMALS);
  const e = contentNumber(centreX - centreX * cos + centreY * sin, COORDINATE_DECIMALS);
  const f = contentNumber(centreY - centreX * sin - centreY * cos, COORDINATE_DECIMALS);
  return `q\n${a} ${b} ${c} ${a} ${e} ${f} cm\n`;
}

/**
 * Reads each named page's `/Contents` shape, before anything is written.
 *
 * **No box is captured**, because none is written. The prior state of a deskewed
 * page is where its own streams sit in the array the wrap built, and nothing
 * else changed.
 */
export function captureDeskewPages(
  session: MupdfSession,
  command: CommandOfKind<'deskewPages'>,
): Promise<CaptureResult<readonly PriorPageDeskew[]>> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    const entries = pagesOf(command.pages, total).map((page) => ({
      page,
      contents: pageObject(document, page, total).get('Contents'),
    }));

    const malformed = entries.find(({ contents }) => !contentsAreWrappable(contents));
    if (malformed !== undefined) {
      return {
        captured: false,
        reason:
          `page ${String(malformed.page)} carries a /Contents that is neither a stream nor an ` +
          `array of them, so the shape its inverse would restore cannot be recorded`,
      };
    }

    return {
      captured: true,
      prior: entries.map(({ page, contents }) => ({ page, contents: contentsPrior(contents) })),
    };
  });
}

/**
 * Restores each page's `/Contents` shape.
 *
 * The two transform streams are left in the file, unreferenced — ordinary PDF
 * garbage, collected by the next full save. Deleting objects the document may
 * have grafted elsewhere in the meantime is a write this command has no
 * authority to make.
 */
export const invertDeskewPages: Invert<'mupdf', 'deskewPages'> = (
  session: MupdfSession,
  inverse: readonly PriorPageDeskew[],
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const restorations = inverse.map((entry) => ({
      object: pageObject(document, entry.page, total),
      entry,
    }));
    for (const { object, entry } of restorations) {
      restoreWrappedContents(document, object, entry.page, entry.contents);
    }
  });

/**
 * What one page's deskew is, once it has been measured.
 *
 * Resolved for every page before the first write, for `applyResizePages`'
 * reason: a document with three of ten pages straightened is one the user did
 * not ask for and cannot see the shape of.
 */
interface Deskew {
  readonly page: number;
  readonly skew: PageSkew;
}

/**
 * Straightens each named page.
 *
 * **A page that reads level is not written to**, and that is where the absence
 * of a threshold lives: the sweep's argmax is 0.0° for a page with no line
 * structure, so a photograph, a blank sheet and an already-level page all take
 * no transform without anybody choosing an angle at which a page counts as
 * crooked. It also keeps the inverse honest — a page the apply did not wrap is a
 * page whose recorded shape is the shape it still has.
 */
export const applyDeskewPages: Apply<'mupdf', 'deskewPages'> = async (
  session: MupdfSession,
  command: CommandOfKind<'deskewPages'>,
): Promise<void> => {
  const pages = await withDocument(session, (document) =>
    pagesOf(command.pages, document.countPages()),
  );
  // MEASURED BEFORE ANY WRITE, and through the session rather than inside the
  // write below: `measurePageSkew` rasterises, and a rasterise that ran against
  // a document three pages into being rewritten would be measuring a page this
  // command had already turned.
  const deskews: Deskew[] = [];
  for (const page of pages) {
    deskews.push({ page, skew: await measurePageSkew(session, page) });
  }

  return withDocument(session, (document) => {
    const total = document.countPages();
    for (const { page, skew } of deskews) {
      const rotation = deskewRotation(skew);
      if (rotation === 0) continue;
      const object = pageObject(document, page, total);
      const box = displayedBox(object);
      if (box === null) {
        throw new RangeError(
          `page ${String(page)} displays no region to turn about — it has no /MediaBox of four ` +
            `numbers, or its /CropBox and /MediaBox do not overlap`,
        );
      }
      wrapContents(
        document,
        object,
        rotationOperators(rotation, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2),
      );
    }
  });
};
