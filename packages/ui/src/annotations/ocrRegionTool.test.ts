import type { OcrLanguage, RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotationSpace.js';
import { MINIMUM_REGION, OCR_REGION_TOOL_ID, ocrRegionTool } from './ocrRegionTool.js';

/**
 * The OCR region tool, driven without a DOM.
 *
 * ## What is asserted here IS the returned command, unlike its two neighbours
 *
 * `snapshotTool.test.ts` and `placeImageTool.test.ts` both read a callback,
 * because their tools answer `undefined` and a case reading the return value
 * would pass for a tool that did nothing. This tool answers a
 * `RenderableCommand`, so the command *is* the observable — and the refusal
 * cases are the ones that need care here for the same reason those files'
 * success cases did: `undefined` is both the correct answer to a four-pixel
 * slip and what a tool with no `commit` at all returns. Hence the control two
 * cases down, which is the half that separates a working minimum from a
 * minimum written the wrong way round.
 *
 * The kernel half of the pair is `proof:ocrrecognise`' region block — a region
 * reads only what is inside it, with a whole-page control proving the region is
 * what excluded the rest. Neither half counts alone, and the number that
 * crosses between them is the PDF-user-space rectangle this file asserts:
 * `ocrRecognise.ts` converts it into the raster's own pixels, which is the
 * second frame and lives in the one module holding both.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The fixture every file in this directory shares: a non-zero origin and a
  // zoom that is not 1, so a tool passing pixels through would fail rather than
  // coincide.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/**
 * The language every case below drags in.
 *
 * **NOT `'eng'`, deliberately.** `OCR_LANGUAGE_SETTING`'s fallback is `'eng'`,
 * so a tool that ignored the dep and named the default would satisfy a case
 * written with it — the fixture would contain none of the thing the defect keys
 * on. German is a value only a read of the dep can produce.
 */
const LANGUAGE: OcrLanguage = 'deu';

/** The command one drag answered, or `undefined` if it answered none. */
function dragged(
  from: readonly [number, number],
  to: readonly [number, number],
  language: () => OcrLanguage = () => LANGUAGE,
): RenderableCommand | undefined {
  const { controller } = ocrRegionTool({ language });
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  // The cast every file in this directory makes: `commit` may answer a promise
  // for the two tools that ask a person something, and this one never does.
  return controller.commit(moved, 3, overlayTransform(PAGE)) as RenderableCommand | undefined;
}

describe('the OCR region tool', () => {
  it('dispatches ocrPage for the region it was dragged over, converted by the one adapter', () => {
    // (20, 20) at zoom 2 on a page whose visible box starts at (50, 400) is
    // (60, 390) — the conversion every file in this directory asserts, and the
    // reason a region recognised over a place and a rectangle drawn over it
    // carry the same numbers.
    expect(dragged([20, 20], [120, 80])).toStrictEqual({
      kind: 'ocrPage',
      page: 3,
      language: LANGUAGE,
      region: { x0: 60, y0: 390, x1: 110, y1: 360 },
    });
  });

  it('reads the language at COMMIT, not when the tool was composed', () => {
    // The dep is a function for exactly this: the registry is built once, and a
    // reader who changes the language in the OCR dialog must not reopen the
    // document for the tool to agree. A tool that captured the value would pass
    // the case above and fail this one.
    let language: OcrLanguage = 'eng';
    const tool = ocrRegionTool({ language: () => language });
    const drag = (): RenderableCommand | undefined => {
      const started = tool.controller.begin(viewportPoint(20, 20));
      const moved = tool.controller.update(started, viewportPoint(120, 80));
      return tool.controller.commit(moved, 3, overlayTransform(PAGE)) as
        | RenderableCommand
        | undefined;
    };
    expect(drag()).toMatchObject({ language: 'eng' });
    language = 'deu';
    expect(drag()).toMatchObject({ language: 'deu' });
  });

  it('refuses a drag that did not travel in BOTH axes', () => {
    // A region flat in one direction has no area and the kernel refuses it with
    // a RangeError — so refusing here is what keeps a slip from spending
    // seconds of recognition on nothing and then writing an empty layer. A line
    // tool's single-axis minimum would send both of these.
    expect(dragged([20, 20], [120, 20 + MINIMUM_REGION - 1])).toBeUndefined();
    expect(dragged([20, 20], [20 + MINIMUM_REGION - 1, 120])).toBeUndefined();
  });

  it('CONTROL: a drag just past the minimum in both axes IS dispatched', () => {
    // The partner the refusals need, and it is load-bearing twice over here:
    // a minimum written the wrong way round refuses every drag, and so does a
    // `commit` that was never implemented — both read as the two cases above
    // passing.
    expect(dragged([20, 20], [20 + MINIMUM_REGION + 1, 20 + MINIMUM_REGION + 1])).toMatchObject({
      kind: 'ocrPage',
    });
  });

  it('sends an UNORDERED region, because the kernel normalises', () => {
    // The rule is stated once, where the rectangle is normalised, and a tool
    // that ordered here would be a second place it lives — agreeing today and
    // diverging the first time either changes.
    expect(dragged([120, 80], [20, 20])).toMatchObject({
      region: { x0: 110, y0: 360, x1: 60, y1: 390 },
    });
  });

  it('previews the region as a rectangle', () => {
    const { controller } = ocrRegionTool({ language: () => LANGUAGE });
    const started = controller.begin(viewportPoint(120, 80));
    const moved = controller.update(started, viewportPoint(20, 20));
    // DRAGGED UP AND LEFT, so the preview's own normalisation is what is being
    // read: a rectangle with a negative width draws nothing in SVG, and this is
    // the one place the reader sees what will be recognised before it costs
    // anything.
    expect(controller.preview(moved)).toStrictEqual({
      shape: 'rect',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
    });
  });

  it('previews NOTHING for a drag it would refuse', () => {
    // The preview and the commit share `regionOf`, which is what makes the
    // refusal visible before the pointer is released rather than a drag that
    // silently does nothing.
    const { controller } = ocrRegionTool({ language: () => LANGUAGE });
    const started = controller.begin(viewportPoint(20, 20));
    const moved = controller.update(started, viewportPoint(120, 20 + MINIMUM_REGION - 1));
    expect(controller.preview(moved)).toBeUndefined();
  });

  it('claims the id its command selects', () => {
    expect(ocrRegionTool({ language: () => LANGUAGE }).id).toBe(OCR_REGION_TOOL_ID);
  });
});
