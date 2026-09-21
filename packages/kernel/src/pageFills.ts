import type { StrokeState } from 'mupdf';
import * as mupdf from 'mupdf';

import type { PageFill } from './cellFills.js';
import type { MupdfSession } from './engineSeam.js';
import { ENGINE_PAGE_FILLS_MAX } from './host/engineChannels.js';
import { withDocument } from './mupdfWriter.js';

/**
 * A page's filled shapes, read through the engine — the drawing half of a table cell's background
 * (`cellFills.ts` holds the join and the reason). Behind `/engine`, for `readPageLinks`' reason:
 * drawing a page parses it, which is the engine host's work (invariant 20).
 *
 * Gray, RGB and CMYK are converted to RGB; a fill in any other space (Lab, Indexed, Separation)
 * is skipped rather than guessed at. Alpha is composited over white, which is what a reader sees
 * on a white page.
 */

/**
 * NO stroke state: a fill's box is its path's own bounds. A zero-width stroke is NOT that —
 * MuPDF bounds a zero-width stroke as a one-unit hairline, and every box came back half a point
 * too large on each side (measured 2026-09-21, `pageFills.test`). `Path.getBounds` accepts
 * `null` in MuPDF's own implementation (`mupdf.js`: `if (strokeState !== null) checkType(…)`, then
 * `strokeState?.pointer`, so `fz_bound_path` receives NULL — its fill bound); only its type
 * declaration is narrower, and the implementation is the authority here.
 */
const FILL_BOUND = null as unknown as StrokeState;

/** A colour as RGB in 0..1, or `null` for a colour space this does not convert. */
function rgbOf(space: mupdf.ColorSpace, colour: readonly number[], alpha: number): [number, number, number] | null {
  let rgb: [number, number, number];
  const [a = 0, b = 0, c = 0, d = 0] = colour;
  if (space.isGray()) rgb = [a, a, a];
  else if (space.isRGB()) rgb = [a, b, c];
  else if (space.isCMYK()) rgb = [(1 - a) * (1 - d), (1 - b) * (1 - d), (1 - c) * (1 - d)];
  else return null;
  const over = Math.min(1, Math.max(0, alpha));
  return rgb.map((channel) => 1 - over * (1 - Math.min(1, Math.max(0, channel)))) as [number, number, number];
}

/**
 * Every filled shape one page draws, in the order drawn, in display space, at most
 * {@link ENGINE_PAGE_FILLS_MAX} — the reader stops there rather than exceed what the channel carries.
 */
export function readPageFills(session: MupdfSession, page: number): Promise<readonly PageFill[]> {
  return withDocument(session, (document) => {
    const pageCount = document.countPages();
    if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
      throw new RangeError(
        `Page ${String(page)} is outside this document, which has ${String(pageCount)} ` +
          'page(s). Page indices are zero-based.',
      );
    }
    const fills: PageFill[] = [];
    const loaded = document.loadPage(page);
    const device = new mupdf.Device({
      fillPath: (path, _evenOdd, ctm, space, colour, alpha) => {
        if (fills.length >= ENGINE_PAGE_FILLS_MAX) return;
        const rgb = rgbOf(space, Array.from(colour), alpha);
        if (rgb === null) return;
        const [x0, y0, x1, y1] = path.getBounds(FILL_BOUND, ctm);
        if (![x0, y0, x1, y1].every(Number.isFinite)) return;
        fills.push({ box: { x0, y0, x1, y1 }, rgb });
      },
    });
    try {
      loaded.run(device, mupdf.Matrix.identity);
    } finally {
      device.close();
    }
    return fills;
  });
}
