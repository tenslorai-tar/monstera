import { BUILT_IN_STAMPS, BUILT_IN_STAMP_NAME } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { type LookPaint, RUBBER_STAMP, rubberStamp } from './markLook.js';

/**
 * A built-in stamp's held look is MuPDF's rubber stamp (`pdf_write_stamp_appearance_rubber`, 1.28.0): fitted, worded and
 * sized by the engine's rule, so the look that stands in for the mark is the mark.
 */

const PAINT: LookPaint = { colour: [0.8, 0.1, 0.1], opacity: 1 };

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
