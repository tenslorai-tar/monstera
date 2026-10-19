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

/** A run as PDFium reads it on such a page: no name, not serif, not bold. */
const unnamed = (index: number): { readonly index: number; readonly style: FaceStyle } => ({
  index,
  style: { font: '', serif: false, mono: false, bold: false, italic: false },
});

describe('a Type 3 run named by its descriptor (ADR-0256)', () => {
  it('the BOLD LEAD-IN takes its face, serif and bold, from the descriptor PDFium could not read', () => {
    expect(namedByDescriptor(unnamed(0), FACES).style).toStrictEqual({
      font: 'SourceSerif4Variable-Bold',
      serif: true,
      mono: false,
      bold: true,
      italic: false,
    });
  });

  it('the regular rest is serif and not bold', () => {
    expect(namedByDescriptor(unnamed(20), FACES).style).toMatchObject({ font: 'SourceSerif4Variable', serif: true, bold: false });
  });

  it('CONTROL: a run PDFium NAMED keeps its own word, even where the descriptor read names another', () => {
    const named = { index: 0, style: { font: 'Arial-BoldMT', serif: false, mono: false, bold: true, italic: false } };
    expect(namedByDescriptor(named, FACES)).toBe(named);
  });

  it('CONTROL: an object no range names stays as PDFium read it', () => {
    const run = unnamed(99);
    expect(namedByDescriptor(run, FACES)).toBe(run);
    expect(faceOfObject(FACES, 99)).toBeUndefined();
  });

  it('a face name past the bound is cut at a whole character', () => {
    expect(boundedFaceName('a'.repeat(126) + '😀')).toBe('a'.repeat(126));
  });
});
