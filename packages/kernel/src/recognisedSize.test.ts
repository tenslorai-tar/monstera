import { describe, expect, it } from 'vitest';

import { fallsBelow, typeSizeOfWords } from './recognisedSize.js';

/**
 * A line of 10.5-point words as a recogniser boxes them: each from its lowest ink to its highest, in Helvetica's
 * proportions (capitals and ascenders 0.72, x-height 0.52, descenders 0.21). The guide's scan of 2026-11-19 has these
 * shapes: its box heights ran 4.7 to 10.1 points on one line.
 */
function boxed(text: string, size = 10.5): { readonly text: string; readonly height: number } {
  const top = /[A-Z0-9bdfhiklt]/u.test(text) ? 0.72 : 0.52;
  return { text, height: (top + (fallsBelow(text) ? 0.21 : 0)) * size };
}

describe('typeSizeOfWords', () => {
  const line = ['The', 'figures', 'on', 'this', 'page', 'compare', 'the', 'year', 'with', 'are', 'one'].map((word) => boxed(word));

  it('reads one size for a line whose boxes are a dozen heights', () => {
    expect(new Set(line.map((word) => word.height.toFixed(2))).size).toBeGreaterThan(2);
    expect(typeSizeOfWords(line)).toBeCloseTo(10.5, 6);
  });

  it('CONTROL: the boxes themselves, taken as sizes, are not the line’s size', () => {
    // What the layer wrote before 2026-11-19: each word at its box's height. Their median is the x-height words' and
    // ascenders' mix, well short of the type, which is what a reading by box alone answers.
    const heights = line.map((word) => word.height).sort((a, b) => a - b);
    expect(Math.abs((heights[Math.floor(heights.length / 2)] ?? 0) - 10.5)).toBeGreaterThan(2);
  });

  it('takes the median, so a few words of another face’s proportions do not move the line', () => {
    const odd = [...line, { text: 'Q2', height: 20 }, { text: 'over', height: 1 }];
    expect(typeSizeOfWords(odd)).toBeCloseTo(10.5, 6);
  });

  it('answers null for a line of another script, so the caller keeps the boxes it has', () => {
    expect(typeSizeOfWords([{ text: 'مرحبا', height: 9 }, { text: '你好', height: 10 }])).toBeNull();
    expect(typeSizeOfWords([])).toBeNull();
  });

  it('reads a word with a descender from its foot below the baseline', () => {
    expect(fallsBelow('year')).toBe(true);
    expect(fallsBelow('estimated')).toBe(false);
  });
});
