// @ts-check
import { describe, expect, it } from 'vitest';

import { tabMarks } from './textWalkSteps.mjs';

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
