import { describe, expect, it } from 'vitest';

import { type FaceStyle, type TextFaces, boundedFaceName, faceOfObject, namedByDescriptor } from './textFaceRanges.js';

/** A web-made page's fonts as the descriptors name them: a bold serif lead-in, then the regular face. */
const FACES: TextFaces = {
  fonts: [
    { face: 'SourceSerif4Variable-Bold', weight: 700 },
    { face: 'SourceSerif4Variable', weight: 400 },
  ],
  ranges: [
    { first: 0, last: 12, font: 0 },
    { first: 13, last: 40, font: 1 },
  ],
  truncated: false,
};

/** A page that draws only text: its k-th page object is its k-th text object. */
const TEXT_ONLY = Array.from({ length: 100 }, (_, at) => at);

/** A run as PDFium reads it on such a page: no name, not serif, not bold. */
const unnamed = (index: number): { readonly index: number; readonly style: FaceStyle } => ({
  index,
  style: { font: '', serif: false, mono: false, bold: false, italic: false },
});

describe('a Type 3 run named by its descriptor (ADR-0256)', () => {
  it('the BOLD LEAD-IN takes its face, serif and bold, from the descriptor PDFium could not read', () => {
    expect(namedByDescriptor(unnamed(0), FACES, TEXT_ONLY).style).toStrictEqual({
      font: 'SourceSerif4Variable-Bold',
      serif: true,
      mono: false,
      bold: true,
      italic: false,
    });
  });

  it('the regular rest is serif and not bold', () => {
    expect(namedByDescriptor(unnamed(20), FACES, TEXT_ONLY).style).toMatchObject({ font: 'SourceSerif4Variable', serif: true, bold: false });
  });

  it('CONTROL: a run PDFium NAMED keeps its own word, even where the descriptor read names another', () => {
    const named = { index: 0, style: { font: 'Arial-BoldMT', serif: false, mono: false, bold: true, italic: false } };
    expect(namedByDescriptor(named, FACES, TEXT_ONLY)).toBe(named);
  });

  it('CONTROL: an object no range names stays as PDFium read it', () => {
    const run = unnamed(99);
    expect(namedByDescriptor(run, FACES, TEXT_ONLY)).toBe(run);
    expect(faceOfObject(FACES, 99)).toBeUndefined();
  });

  it('a face name past the bound is cut at a whole character', () => {
    expect(boundedFaceName('a'.repeat(126) + '😀')).toBe('a'.repeat(126));
  });
});

/**
 * The page measured 2026-11-01 with PDFium 155 and MuPDF: a filled rectangle, then one line in each of two Type 3
 * fonts. PDFium's objects are the rectangle (0) and the two lines (1, 2), so its text objects are `[1, 2]`; MuPDF's
 * ranges number the lines as text objects 0 and 1. Read by page index, the first line took the second font's face and
 * the second took none.
 */
describe('a run is found by PDFium’s own list of its text objects, not by its page index', () => {
  const TWO_FONTS: TextFaces = {
    fonts: [
      { face: 'AlphaSans', weight: null },
      { face: 'BetaSerif-Bold', weight: null },
    ],
    ranges: [
      { first: 0, last: 0, font: 0 },
      { first: 1, last: 1, font: 1 },
    ],
    truncated: false,
  };
  const AFTER_A_RECTANGLE = [1, 2];

  it('a page that draws something first names each line with its own font', () => {
    expect([1, 2].map((index) => namedByDescriptor(unnamed(index), TWO_FONTS, AFTER_A_RECTANGLE).style.font)).toStrictEqual([
      'AlphaSans',
      'BetaSerif-Bold',
    ]);
  });

  it('CONTROL: the same lines with nothing before them are named the same', () => {
    expect([0, 1].map((index) => namedByDescriptor(unnamed(index), TWO_FONTS, [0, 1]).style.font)).toStrictEqual(['AlphaSans', 'BetaSerif-Bold']);
  });

  it('a run whose object is not one of the text objects is left as PDFium read it', () => {
    const rectangle = unnamed(0);
    expect(namedByDescriptor(rectangle, TWO_FONTS, AFTER_A_RECTANGLE)).toBe(rectangle);
  });
});
