// @ts-check
import { describe, expect, it } from 'vitest';

import { blockPressPoint, tabMarks } from './textWalkSteps.mjs';

/**
 * Item 68's shape: a locator looked up again at each call, whose list changes between the scroll and the measure. The
 * element taken first is in view at y 530; the one the list holds by the measure is page 1's, scrolled to y −110.
 */
function changingList() {
  const box = (/** @type {number} */ y) => ({ x: 760, y, width: 76, height: 20 });
  const shown = { scrollIntoViewIfNeeded: async () => undefined, boundingBox: async () => box(520) };
  const above = { scrollIntoViewIfNeeded: async () => undefined, boundingBox: async () => box(-120) };
  let lookups = 0;
  return {
    /** The element at the locator's place now: the first lookup finds page 2's, every later one page 1's. */
    elementHandle: async () => {
      lookups += 1;
      return lookups === 1 ? shown : above;
    },
    /** How the helper used to measure: through the locator, looked up again. */
    boundingBox: async () => {
      lookups += 1;
      return above.boundingBox();
    },
  };
}

describe('blockPressPoint', () => {
  const window = { width: 1400, height: 900 };
  it('scrolls, measures and presses the one element it took, while the list changes under the locator', async () => {
    expect(await blockPressPoint(changingList(), 'middle', window)).toEqual({ x: 798, y: 530 });
  });
  it('CONTROL: measured through the locator again, the same list gives the point above the window', async () => {
    const list = changingList();
    await list.elementHandle();
    const box = await list.boundingBox();
    expect(box.y + box.height / 2).toBe(-110);
  });
  it('refuses a point outside the window rather than pressing it', async () => {
    const list = changingList();
    await list.elementHandle();
    await expect(blockPressPoint(list, 'middle', window)).rejects.toThrow('-110, is outside the window');
  });
  it('refuses a block with no element', async () => {
    await expect(blockPressPoint({ elementHandle: async () => null }, 'middle', window)).rejects.toThrow('no outline on the page');
  });
});

/**
 * The walks' tab counter reads a mark by its decoded value, so each writer's spelling of one tab counts once.
 *
 * The PDFium writer's spelling is built with the byte itself (code point 9), which is what its mark API wrote into the
 * text-regression walk's saved file on 2026-10-16; never typed as an escape, so this file means the byte it says.
 */
const TAB = String.fromCodePoint(9);
const MUPDF = '/Span <</ActualText <FEFF0009>>> BDC 1 0 0 1 87 100 Tm <20> Tj EMC';
const PDFIUM = `/Span <</ActualText(${TAB})>> BDC\nq 0 0 0 rg 0 0 0 RG`;

describe('tabMarks', () => {
  it('counts the MuPDF writer’s hex spelling and the PDFium writer’s literal one, once each', () => {
    expect(tabMarks(MUPDF)).toBe(1);
    expect(tabMarks(PDFIUM)).toBe(1);
    expect(tabMarks(`${MUPDF}\n${PDFIUM}`)).toBe(2);
  });

  it('reads an escaped tab in a literal as a tab too', () => {
    expect(tabMarks('/ActualText (\\t) BDC')).toBe(1);
  });

  it('CONTROL: a mark saying other text is not a tab, and the old one-spelling count misses PDFium’s tab', () => {
    expect(tabMarks('/ActualText (fi) BDC /ActualText <FEFF0041> BDC')).toBe(0);
    const oneSpelling = (/** @type {string} */ content) => (content.match(/\/ActualText <FEFF0009>/gu) ?? []).length;
    expect(oneSpelling(PDFIUM)).toBe(0);
  });

  it('refuses a mark whose value it cannot read, rather than counting no tab', () => {
    expect(() => tabMarks('/ActualText /NotAString BDC')).toThrow(/cannot read/u);
  });
});
