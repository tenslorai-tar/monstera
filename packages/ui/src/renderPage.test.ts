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
  /** Every options object `getViewport` was handed, in order. */
  readonly asked: Record<string, unknown>[];
} {
  const sizeAtRender: { width: number; height: number }[] = [];
  const asked: Record<string, unknown>[] = [];
  const page = {
    getViewport: (options: Record<string, unknown>) => {
      asked.push(options);
      return { width, height };
    },
    render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
      sizeAtRender.push({ width: canvas.width, height: canvas.height });
      return { promise: Promise.resolve() };
    },
  };
  const document = {
    getPage: () => Promise.resolve(page),
  } as unknown as PDFDocumentProxy;
  return { document, sizeAtRender, asked };
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

  it('passes the view model rotation to the viewport, so the KERNEL decides which way up', async () => {
    // The bytes this parser reads are the ones the document was opened with
    // (OOOOO-1), so the page's own `/Rotate` is stale the moment anything
    // rotates it. This is the only line by which the kernel's answer reaches
    // the pixels.
    const { document, asked } = documentWithViewport(300, 400);

    await renderPage(document, 1, canvasWithContext(), 1, 90);

    expect(asked).toStrictEqual([{ scale: 1, rotation: 90 }]);
  });

  it('OMITS rotation when the caller has none, rather than sending zero', async () => {
    // The two are a quarter turn apart on any document that arrives already
    // turned: PDF.js falls back to the page's own `/Rotate` when the key is
    // absent, and flattens the page when it is present and zero. A caller with
    // no model knows LESS about the document, not that it is upright — and the
    // wrong one of these is invisible on every fixture whose pages start at 0,
    // which is every fixture anyone reaches for first.
    const { document, asked } = documentWithViewport(300, 400);

    await renderPage(document, 1, canvasWithContext(), 1);

    expect(asked).toStrictEqual([{ scale: 1 }]);
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
