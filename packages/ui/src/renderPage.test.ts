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

/**
 * The visible box every fake page reports, unless a case asks for another.
 *
 * A NON-ZERO ORIGIN, deliberately: `[0, 0, w, h]` is what a page whose crop box
 * is its media box reports, and it is also what an implementation that made the
 * box up from the viewport would report. This one could not have been derived
 * from anything else in the fixture.
 */
const VIEW: readonly [number, number, number, number] = [12, 24, 312, 424];

/** A document whose page reports a viewport and records the canvas it was given. */
function documentWithViewport(
  width: number,
  height: number,
  view: readonly number[] = VIEW,
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
    view,
    getViewport: (options: Record<string, unknown>) => {
      asked.push(options);
      // THE VIEWPORT REPORTS ITS OWN ROTATION, which is what PDF.js does and
      // what makes `rotation` in the result different from the parameter: with
      // no parameter the viewport carries the page's own `/Rotate`, and that is
      // the number an overlay has to use. The fake answers 270 for the
      // no-parameter case so the two can be told apart.
      return { width, height, rotation: options['rotation'] ?? 270 };
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
/**
 * A canvas whose 2d context is a stub.
 *
 * `context` lets a case supply the one method it observes — `drawImage` for the
 * second-engine path. An empty object is right for every PDF.js case, where the
 * context is handed to a fake `render` that never touches it.
 */
function canvasWithContext(context: Partial<CanvasRenderingContext2D> = {}): HTMLCanvasElement {
  const canvas = window.document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
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

    expect(raster.width).toBe(301);
    expect(raster.height).toBe(401);
  });

  it('CONTROL: a whole-number viewport is not rounded up past itself', async () => {
    // Without this, the case above passes for an implementation that adds one to
    // everything — `ceil` and `+1` agree on every fractional input, and the two
    // are only separable on an exact one.
    const { document } = documentWithViewport(300, 400);
    const canvas = canvasWithContext();

    const raster = await renderPage(document, 1, canvas, 1);

    expect(raster.width).toBe(300);
    expect(raster.height).toBe(400);
  });

  it("reports the page's own visible box, which the overlay's frame comes from", async () => {
    // `page.view` is PDF.js' answer to *what region does this page display*,
    // with `/MediaBox`, `/CropBox` and their intersection already applied
    // (B3a). It comes out of here because this function has just parsed the
    // page — a caller asking again would be asking a question it was standing
    // next to, and would get the page as it is NOW rather than as this bitmap
    // was drawn.
    const { document } = documentWithViewport(300, 400);

    const raster = await renderPage(document, 1, canvasWithContext(), 1);

    expect(raster.crop).toStrictEqual([12, 24, 312, 424]);
  });

  it('reports a short or malformed view box as zeroes rather than throwing', async () => {
    // `page.view` is typed `number[]`, so a parser answering with fewer than
    // four is expressible. Zeroes give a degenerate box, which `pageTransform`
    // turns into a zero-sized viewport and the kernel refuses — a throw here
    // would take the PAGE down instead, and a page that will not draw is worse
    // than one that cannot be annotated.
    const { document } = documentWithViewport(300, 400, [5]);

    const raster = await renderPage(document, 1, canvasWithContext(), 1);

    expect(raster.crop).toStrictEqual([5, 0, 0, 0]);
  });

  it("reports the VIEWPORT's rotation, not the caller's, so a page with no model is right", async () => {
    // THE SEPARATOR. When the caller passes nothing, PDF.js falls back to the
    // page's own `/Rotate` — so an implementation reporting the parameter would
    // answer `undefined` or `0` for a page that is on its side, and an overlay
    // would place every rectangle a quarter turn out. The fake's viewport
    // answers 270 when asked for no rotation, which nothing else in this call
    // could have produced.
    const { document } = documentWithViewport(300, 400);

    const raster = await renderPage(document, 1, canvasWithContext(), 1);

    expect(raster.rotation).toBe(270);
  });

  it('CONTROL: and it is the caller\'s rotation when the caller gave one', async () => {
    // Without this, the case above passes for an implementation that always
    // reports 270, or one that ignores the parameter entirely.
    const { document } = documentWithViewport(300, 400);

    const raster = await renderPage(document, 1, canvasWithContext(), 1, 90);

    expect(raster.rotation).toBe(90);
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

  it('lets the SECOND ENGINE draw, and does not also run PDF.js', async () => {
    // §6.1's setting, and the assertion is the CALL THAT WAS NOT MADE. A build
    // that drew the raster and then let PDF.js paint over it produces the same
    // end state in happy-dom — nothing draws there — and the same one in
    // Chromium for a page the two engines agree on. `sizeAtRender` is empty only
    // if PDF.js was never asked.
    const { document, sizeAtRender } = documentWithViewport(300, 400);
    const drawn: { image: unknown; x: number; y: number }[] = [];
    const closed: number[] = [];
    const canvas = canvasWithContext({
      drawImage: (image: unknown, x: number, y: number) => {
        drawn.push({ image, x, y });
      },
    });
    const bitmap = { close: () => closed.push(1) } as unknown as ImageBitmap;
    const asked: { page: number; width: number; height: number }[] = [];

    const result = await renderPage(document, 1, canvas, 1, 0, (page, width, height) => {
      asked.push({ page, width, height });
      return Promise.resolve(bitmap);
    });

    expect(sizeAtRender).toStrictEqual([]);
    // THE RASTER WAS ASKED FOR AT THE CANVAS'S OWN SIZE, which is the whole of
    // the alignment: a raster at any other size would be resampled, and E1's
    // *pixel-exact at every zoom* would fail through the path meant to sharpen.
    expect(asked).toStrictEqual([{ page: 1, width: 300, height: 400 }]);
    expect(drawn).toStrictEqual([{ image: bitmap, x: 0, y: 0 }]);
    // AND IT WAS RELEASED. An `ImageBitmap` holds its pixels until `close`, and
    // one per page per scroll position is a leak §9.17's renderer budget would
    // meet before anybody noticed.
    expect(closed).toStrictEqual([1]);
    // THE CROP AND ROTATION STILL COME FROM PDF.JS, which is what keeps every
    // overlay correct whichever engine drew: they are the page's own frame, and
    // the second engine answers pixels rather than geometry.
    expect(result.crop).toStrictEqual(VIEW);
    expect(result.rotation).toBe(0);
  });

  it('FALLS BACK to PDF.js when the second engine answers nothing', async () => {
    // THE LOAD-BEARING HALF. The setting can be on while the engine is not
    // reachable — no `pdfium.dll`, a page too large at this zoom, a refusal —
    // and every one of those must leave a drawn page rather than a blank one.
    const { document, sizeAtRender } = documentWithViewport(300, 400);
    let asked = 0;

    await renderPage(document, 1, canvasWithContext(), 1, 0, () => {
      asked += 1;
      return Promise.resolve(null);
    });

    expect(asked).toBe(1);
    // PDF.JS DREW, at the size the canvas had been given. Without this the case
    // passes for a build that fell back by drawing nothing at all.
    expect(sizeAtRender).toStrictEqual([{ width: 300, height: 400 }]);
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
