import { BUILT_IN_STAMPS, BUILT_IN_STAMP_NAME } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotations/annotationSpace.js';
import { type LookPaint, RUBBER_STAMP, rubberStamp, signatureLook } from './markLook.js';

/**
 * A built-in stamp's held look is MuPDF's rubber stamp (`pdf_write_stamp_appearance_rubber`, 1.28.0): fitted, worded and
 * sized by the engine's rule, so the look that stands in for the mark is the mark.
 */

const PAINT: LookPaint = { colour: [0.8, 0.1, 0.1], opacity: 1 };

describe('signatureLook', () => {
  it('draws drawn ink by the writers’ fit, the pad’s top-left landing top-left on the page', () => {
    // A 100 by 50 point box at zoom 1, the pad's ink a diagonal from its top-left (0, 0) to its bottom-right (1, 1).
    // The writers' fit (`strokesFit`): pen max(1, 50 × 0.03) = 1.5; scale min((90 − 1.5) / 1, (45 − 1.5) / 1) = 43.5;
    // origin ((100 − 43.5) / 2, (50 − 43.5) / 2) = (28.25, 3.25), y up. On screen, y down, the top-left point is at
    // (28.25, 50 − 46.75) = (28.25, 3.25) and the bottom-right at (71.75, 46.75).
    const at = signatureLook({ kind: 'drawn', strokes: [[[0, 0], [1, 1]]] }, { x0: 0, y0: 792, x1: 100, y1: 742 });
    const look = at?.(overlayTransform({ crop: [0, 0, 612, 792], rotation: 0, zoom: 1 }));
    expect(look?.parts).toStrictEqual([
      { part: 'strokes', box: { x: 0, y: 0, width: 100, height: 50 }, d: 'M28.25,3.25 L71.75,46.75', viewBox: '0 0 100 50', paint: { colour: [0, 0, 0], opacity: 1 }, pen: 1.5 },
    ]);
  });

  it('CONTROL: a mark whose ink the renderer does not hold — a picture, a kept one by id — has no look', () => {
    expect(signatureLook({ kind: 'image' }, { x0: 0, y0: 0, x1: 10, y1: 10 })).toBeUndefined();
  });
});

describe('rubberStamp', () => {
  it('fits the 190 by 50 box into the rectangle as the engine does: a 240 by 60 box comes back 228 by 60, centred', () => {
    // THE ENGINE'S OWN ANSWER, measured on MuPDF 1.28.0 (`pageAnnotations.ts`, the stamp kind): 228 by 60 in 240 by 60.
    const { box } = rubberStamp('Approved', { x: 10, y: 20, width: 240, height: 60 }, PAINT);
    expect(box).toStrictEqual({ x: 16, y: 20, width: 228, height: 60 });
    // AND THE OTHER WAY: a box taller than the stamp keeps the width and is centred down it.
    expect(rubberStamp('Approved', { x: 0, y: 0, width: 190, height: 150 }, PAINT).box).toStrictEqual({ x: 0, y: 50, width: 190, height: 50 });
  });

  it('sets each built-in stamp’s word at the size and baseline MuPDF sets for its name', () => {
    expect(BUILT_IN_STAMPS.map((stamp) => {
      const { word, size, baseline } = rubberStamp(BUILT_IN_STAMP_NAME[stamp], { x: 0, y: 0, ...RUBBER_STAMP }, PAINT);
      return [stamp, word, size, baseline];
    })).toStrictEqual([
      ['approved', 'APPROVED', 30, 13],
      ['not-approved', 'NOT APPROVED', 20, 17],
      ['draft', 'DRAFT', 30, 13],
      ['final', 'FINAL', 30, 13],
      ['confidential', 'CONFIDENTIAL', 20, 17],
      // A NAME MUPDF DOES NOT KNOW is drawn as written, at 20 on 17: these three are spelt as their words for that reason.
      ['for-review', 'FOR REVIEW', 20, 17],
      ['void', 'VOID', 20, 17],
      ['copy', 'COPY', 20, 17],
    ]);
  });
});
