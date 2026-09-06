import type { RenderableCommand } from '@monstera/contract';
import { asDocVersion, viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotationSpace.js';
import type { AnnotationSnapshot, ErasableAnnotation } from './eraserTool.js';
import { ERASER_TOOL_ID, eraserTool } from './eraserTool.js';

/**
 * The eraser's controller, driven without a DOM.
 *
 * `pointTools.test.ts`' shape, and the difference is the subject: this is the
 * first tool whose command names something already in the document, so what has
 * to be asserted is **which** annotation it named — and, twice over, which one
 * it did not.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The sibling files' fixture and its reason: a non-zero crop origin and a
  // zoom that is not 1, so a controller passing pixels straight through fails
  // rather than coincides. The visible box therefore starts at (50, 400) in PDF
  // space and one CSS pixel is half a point.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

const VERSION = asDocVersion(7);

/** An annotation covering PDF x 60–100, y 350–390 — screen (20,20) to (100,100). */
const NEAR: ErasableAnnotation = {
  page: 3,
  index: 1,
  rect: { x0: 60, y0: 350, x1: 100, y1: 390 },
};

/** One covering PDF x 160–200, which is nowhere near the clicks below. */
const FAR: ErasableAnnotation = {
  page: 3,
  index: 2,
  rect: { x0: 160, y0: 150, x1: 200, y1: 190 },
};

function erasing(snapshot: AnnotationSnapshot | undefined): {
  readonly click: (
    at: readonly [number, number],
    page?: number,
  ) => Promise<RenderableCommand | undefined>;
  readonly reads: number[];
} {
  const reads: number[] = [];
  const tool = eraserTool({
    annotations: () => {
      reads.push(reads.length);
      return Promise.resolve(snapshot);
    },
  });
  return {
    click: async (at, page = 3): Promise<RenderableCommand | undefined> => {
      const { controller } = tool;
      const started = controller.begin(viewportPoint(at[0], at[1]));
      return controller.commit(started, page, overlayTransform(PAGE));
    },
    reads,
  };
}

describe('eraserTool', () => {
  it('names the annotation under the click, with the version the read carried', async () => {
    const { click } = erasing({ version: VERSION, annotations: [FAR, NEAR] });

    // (40, 40) on screen is (70, 380) in PDF space, which is inside NEAR.
    expect(await click([40, 40])).toStrictEqual({
      kind: 'removeAnnotation',
      page: 3,
      // ONE INDEX IN A LIST. The payload is plural for the select tool; an
      // eraser click is one mark, and this asserts the list rather than a
      // number so a tool that started sending several would be red here.
      indices: [1],
      version: VERSION,
    });
  });

  it('takes the VERSION from the answer, so a stale handle can exist at all', async () => {
    // THE HALF THAT LOOKS LIKE BOOKKEEPING AND IS THE MECHANISM. A handle whose
    // version came from the application's current state would agree with the
    // document by construction, and ADR-0041's refusal would be unreachable —
    // a guard that cannot fire, wearing the shape of one that can. Asserted
    // against a version the caller never supplies from anywhere else.
    const { click } = erasing({ version: asDocVersion(41), annotations: [NEAR] });
    const command = await click([40, 40]);
    expect(command).toMatchObject({ version: 41 });
  });

  it('erases NOTHING when the click is on blank paper', async () => {
    // The platform's existing outcome for *there is nothing to send*, and the
    // control for every case above: a tool that erased the first annotation it
    // was told about would pass all of them.
    const { click } = erasing({ version: VERSION, annotations: [FAR, NEAR] });
    expect(await click([400, 400])).toBeUndefined();
  });

  it('ignores an annotation on ANOTHER page whose rectangle would match', async () => {
    // The read is whole-document, so the page filter is this tool's and not the
    // channel's. Without it the eraser would delete a mark on page 2 that
    // happens to sit where the person clicked on page 3 — a well-formed
    // document with the wrong annotation gone, which is the failure ADR-0041
    // exists to make impossible and this restores if it is skipped.
    const { click } = erasing({
      version: VERSION,
      annotations: [{ ...NEAR, page: 2 }],
    });
    expect(await click([40, 40])).toBeUndefined();
  });

  it('takes the TOPMOST of two that overlap, which is the last in the walk', async () => {
    // Annotations paint in `/Annots` order, so the last one containing the
    // point is the one the person can see. The fixture stacks two on the same
    // rectangle: a tool taking the first would delete the mark UNDER the one
    // that was clicked, and nothing about the document afterwards would look
    // wrong.
    const { click } = erasing({
      version: VERSION,
      annotations: [
        { ...NEAR, index: 4 },
        { ...NEAR, index: 5 },
      ],
    });
    expect(await click([40, 40])).toMatchObject({ indices: [5] });
  });

  it('sends nothing when there is no document, or the read was refused', async () => {
    const { click } = erasing(undefined);
    expect(await click([40, 40])).toBeUndefined();
  });

  it('skips an annotation whose page displays no region', async () => {
    // `rect: null` is a real answer from a hostile document, and *no place* is
    // not *the whole page*. A tool treating null as a match would erase a mark
    // wherever the person clicked.
    const { click } = erasing({
      version: VERSION,
      annotations: [{ page: 3, index: 0, rect: null }],
    });
    expect(await click([40, 40])).toBeUndefined();
  });

  it('reads the document ONCE, at the pointer-up', async () => {
    // Not per pointer move. The tool previews nothing precisely so that it does
    // not need the list while the pointer is travelling, and a preview added
    // later without noticing would be a channel round trip per frame.
    const { click, reads } = erasing({ version: VERSION, annotations: [NEAR] });
    await click([40, 40]);
    expect(reads).toHaveLength(1);
  });

  it('previews nothing', () => {
    const tool = eraserTool({ annotations: () => Promise.resolve(undefined) });
    const started = tool.controller.begin(viewportPoint(10, 10));
    expect(tool.controller.preview(started)).toBeUndefined();
  });

  it('ends its gesture at the release, like the eight drag tools', () => {
    // It spreads `pointerPath`, so `complete` is the platform's default. Stated
    // as a case because the alternative is invisible: a tool that answered
    // `false` here would keep the gesture alive and erase again on the next
    // click without one being started.
    const tool = eraserTool({ annotations: () => Promise.resolve(undefined) });
    expect(tool.controller.complete(tool.controller.begin(viewportPoint(10, 10)))).toBe(true);
  });

  it('claims the id its command selects', () => {
    expect(eraserTool({ annotations: () => Promise.resolve(undefined) }).id).toBe(ERASER_TOOL_ID);
  });
});
