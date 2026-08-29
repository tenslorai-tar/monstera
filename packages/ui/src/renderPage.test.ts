// @vitest-environment happy-dom
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';

import { renderPage } from './renderPage.js';

/**
 * `renderPage` makes two decisions and neither is visible in its output.
 *
 * The end state — a canvas of the right size — is what a correct order and a
 * wrong one both produce when nothing is actually drawn, which is the case in
 * happy-dom. So these assert **when** the canvas was sized, not what it ended
 * up as. The pixels are `proof:rendererpolicy`'s job, against real Chromium.
 */

/** A document whose page reports a viewport and records the canvas it was given. */
function documentWithViewport(
  width: number,
  height: number,
): {
  readonly document: PDFDocumentProxy;
  /** The canvas dimensions at the moment `render` was called. */
  readonly sizeAtRender: { width: number; height: number }[];
} {
  const sizeAtRender: { width: number; height: number }[] = [];
  const page = {
    getViewport: () => ({ width, height }),
    render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
      sizeAtRender.push({ width: canvas.width, height: canvas.height });
      return { promise: Promise.resolve() };
    },
  };
  const document = {
    getPage: () => Promise.resolve(page),
  } as unknown as PDFDocumentProxy;
  return { document, sizeAtRender };
}

/**
 * A canvas whose 2d context exists.
 *
 * happy-dom implements no canvas, so `getContext('2d')` is `null` there and the
 * real guard fires before anything is sized — which is correct behaviour and
 * makes the positive cases below unreachable without this. The stub is empty on
 * purpose: nothing here draws, and a context that pretended to would be
 * modelling a renderer this file does not test.
 */
function canvasWithContext(): HTMLCanvasElement {
  const canvas = window.document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({} as unknown as CanvasRenderingContext2D);
  return canvas;
}

describe('renderPage', () => {
  it('sizes the canvas BEFORE drawing, because sizing it after would clear it', async () => {
    // Setting `width` or `height` on a canvas resets its drawing surface, so a
    // correct render followed by a resize is a blank page — which looks exactly
    // like a parse that produced nothing. The order is the whole decision, and
    // the finished dimensions are the same either way.
    const { document, sizeAtRender } = documentWithViewport(300.2, 400.8);
    const canvas = canvasWithContext();

    await renderPage(document, 1, canvas, 1);

    expect(sizeAtRender).toStrictEqual([{ width: 301, height: 401 }]);
  });

  it('rounds the viewport UP, so a fractional page is never cropped', async () => {
    // `Math.ceil`, not `Math.round`: half a device pixel short is a visibly
    // clipped edge, and half a pixel spare is invisible.
    const { document } = documentWithViewport(300.2, 400.8);
    const canvas = canvasWithContext();

    const raster = await renderPage(document, 1, canvas, 1);

    expect(raster).toStrictEqual({ width: 301, height: 401 });
  });

  it('CONTROL: a whole-number viewport is not rounded up past itself', async () => {
    // Without this, the case above passes for an implementation that adds one to
    // everything — `ceil` and `+1` agree on every fractional input, and the two
    // are only separable on an exact one.
    const { document } = documentWithViewport(300, 400);
    const canvas = canvasWithContext();

    const raster = await renderPage(document, 1, canvas, 1);

    expect(raster).toStrictEqual({ width: 300, height: 400 });
  });

  it('refuses a canvas with no 2d context rather than drawing nowhere', async () => {
    const { document, sizeAtRender } = documentWithViewport(300, 400);
    const canvas = window.document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    await expect(renderPage(document, 1, canvas, 1)).rejects.toThrow(/2d context/u);
    // ASSERT THE CALL THAT WAS NOT MADE. A throw that happened after handing the
    // page to PDF.js would leave a render running against a canvas nobody can
    // draw on, and the rejection alone cannot tell the two apart.
    expect(sizeAtRender).toStrictEqual([]);
  });
});
