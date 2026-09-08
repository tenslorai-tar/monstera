import { describe, expect, it } from 'vitest';

import { textLayerOf } from './textLayer.js';
import type { PageText } from './textStructure.js';
import { parsePageText } from './textStructure.js';

/**
 * A page whose lines and their lengths are chosen here.
 *
 * Built through `parsePageText` from MuPDF's own shape rather than by writing a
 * `PageText` literal: the branded corners cannot be spelt by hand without a
 * cast, and a cast is where the type stops carrying the property. The nesting
 * is the one `textStructure.test.ts` records as measured — text blocks live
 * under a `structure` block's `contents`.
 */
function pageOf(texts: readonly string[]): PageText {
  return parsePageText(
    JSON.stringify({
      blocks: [
        {
          type: 'structure',
          contents: texts.map((text, index) => ({
            type: 'text',
            bbox: { x: 10, y: 20 + index * 15, w: 100, h: 12 },
            lines: [
              {
                bbox: { x: 10, y: 20 + index * 15, w: 100, h: 12 },
                font: { size: 12 },
                x: 10,
                y: 30 + index * 15,
                text,
              },
            ],
          })),
        },
      ],
    }),
  );
}

describe('textLayerOf', () => {
  it('answers every line in reading order when both bounds are generous', () => {
    const layer = textLayerOf(pageOf(['alpha', 'bravo', 'charlie']), 10, 100);
    expect(layer.lines.map((line) => line.text)).toStrictEqual(['alpha', 'bravo', 'charlie']);
    expect(layer.truncated).toBe(false);
  });

  it('carries the DISPLAY-space box, which is what the renderer converts', () => {
    const [line] = textLayerOf(pageOf(['alpha']), 10, 100).lines;
    // The numbers the fixture put in MuPDF's `bbox`, as x/y/w/h turned into two
    // corners. Asserted rather than assumed because a layer that reported the
    // ORIGIN instead would place every line on its baseline, which looks nearly
    // right and is wrong by the font's ascent on every page.
    expect(line?.box).toStrictEqual({ x0: 10, y0: 20, x1: 110, y1: 32 });
  });

  it('stops at the line limit and says the page was cut', () => {
    const layer = textLayerOf(pageOf(['a', 'b', 'c', 'd']), 2, 100);
    expect(layer.lines.map((line) => line.text)).toStrictEqual(['a', 'b']);
    expect(layer.truncated).toBe(true);
  });

  it('a page holding exactly the limit is NOT truncated', () => {
    // The off-by-one that makes the flag dishonest in the reassuring direction:
    // `lines.length === limit` cannot tell a full page from a cut one, and a
    // caller reading only the length would call every full page partial.
    const layer = textLayerOf(pageOf(['a', 'b']), 2, 100);
    expect(layer.lines).toHaveLength(2);
    expect(layer.truncated).toBe(false);
  });

  it('clips a line past the length cap and says so, rather than shipping it short', () => {
    const layer = textLayerOf(pageOf(['abcdefghij']), 10, 4);
    expect(layer.lines[0]?.text).toBe('abcd');
    expect(layer.truncated).toBe(true);
  });

  it('CONTROL: the same flag covers BOTH bounds, so neither can pass unreported', () => {
    // Without this the two limits could have had separate flags and a consumer
    // could handle one. A copy that succeeds and is missing characters nobody
    // can see is the export-escaping defect one layer over.
    const byLines = textLayerOf(pageOf(['a', 'b', 'c']), 1, 100);
    const byLength = textLayerOf(pageOf(['abcdef']), 10, 2);
    const neither = textLayerOf(pageOf(['abc']), 10, 100);
    expect([byLines.truncated, byLength.truncated, neither.truncated]).toStrictEqual([
      true,
      true,
      false,
    ]);
  });

  it('a line exactly at the cap is not reported as clipped', () => {
    const layer = textLayerOf(pageOf(['abcd']), 10, 4);
    expect(layer.lines[0]?.text).toBe('abcd');
    expect(layer.truncated).toBe(false);
  });

  it('REFUSES a limit of zero rather than answering with an empty page', () => {
    // An empty layer is what a page with no text looks like, so a caller that
    // asked for none would be told the page is blank.
    expect(() => textLayerOf(pageOf(['a']), 0, 100)).toThrow(RangeError);
  });

  it('REFUSES a length cap of zero for the same reason', () => {
    expect(() => textLayerOf(pageOf(['a']), 10, 0)).toThrow(RangeError);
  });

  it('reads a genuinely empty page as an empty layer that is not truncated', () => {
    expect(textLayerOf({ blocks: [] }, 10, 100)).toStrictEqual({ lines: [], truncated: false });
  });
});
