import { describe, expect, it } from 'vitest';

import { findInPages, lineOf } from './textSearch.js';
import { type PageText, parsePageText } from './textStructure.js';

/** A page built the way MuPDF returns one, so the search meets the real shape. */
function pageOf(...blocks: readonly (readonly string[])[]): PageText {
  return parsePageText(
    JSON.stringify({
      blocks: blocks.map((lines, block) => ({
        type: 'text',
        bbox: { x: 72, y: block * 40, w: 300, h: 32 },
        lines: lines.map((text, index) => ({
          x: 72,
          y: block * 40 + index * 16 + 13,
          font: { size: 12 },
          bbox: { x: 72, y: block * 40 + index * 16, w: 300, h: 16 },
          text,
        })),
      })),
    }),
  );
}

describe('findInPages', () => {
  it('finds a match and locates it by page, line and offset', () => {
    const pages = [pageOf(['the quick brown fox']), pageOf(['jumps over the lazy dog'])];

    expect(findInPages(pages, 'lazy')).toStrictEqual([
      { page: 1, line: 0, offset: 15, text: 'jumps over the lazy dog' },
    ]);
  });

  it('is case-insensitive by default and exact when asked', () => {
    const pages = [pageOf(['PDF and pdf'])];

    expect(findInPages(pages, 'pdf')).toHaveLength(2);
    expect(findInPages(pages, 'pdf', { caseSensitive: true })).toStrictEqual([
      { page: 0, line: 0, offset: 8, text: 'PDF and pdf' },
    ]);
  });

  it('finds OVERLAPPING occurrences, because they are occurrences', () => {
    // Advancing by the needle's length would report one match here, and a
    // reader stepping through results would never be offered offset 1.
    expect(findInPages([pageOf(['aaa'])], 'aa')).toHaveLength(2);
  });

  it('follows the READING ORDER the substrate produced, not the page layout', () => {
    // The two-column case, in the form ADR-0034 measured: `SEGMENT` puts a whole
    // column in one block. A search that walked blocks in bbox order, or sorted
    // by y, would return these the other way round — and would be the block
    // clusterer this substrate exists not to re-implement, arriving as a sort.
    const twoColumns = pageOf(['left0', 'left1'], ['right0', 'right1']);

    expect(findInPages([twoColumns], 'left').map((match) => match.line)).toStrictEqual([0, 1]);
    expect(findInPages([twoColumns], '0').map((match) => match.line)).toStrictEqual([0, 2]);
  });

  it('CONTROL: a page whose text it cannot reach yields nothing, not a crash', () => {
    // Zero matches is the reassuring answer for a search, so the case that
    // matters is the one asserting a REAL page finds something — above — and
    // this one only pins that an empty page is a legal input.
    expect(findInPages([parsePageText('{"blocks":[]}')], 'anything')).toStrictEqual([]);
  });

  it('REFUSES an empty query rather than returning everything or nothing', () => {
    expect(() => findInPages([pageOf(['text'])], '')).toThrow(/empty query/u);
  });

  describe('the limit', () => {
    it('stops at the bound', () => {
      expect(findInPages([pageOf(['a a a a'])], 'a', { limit: 2 })).toHaveLength(2);
    });

    it('is absent by default, so exhaustion and truncation stay distinguishable', () => {
      // With a default cap, "no more matches" and "the cap was reached" would be
      // the same observation for every caller that did not set one.
      expect(findInPages([pageOf(['a a a a'])], 'a')).toHaveLength(4);
    });
  });

  it('hands back the line a match sits in, with its Fitz-space box', () => {
    const pages = [pageOf(['left0', 'left1'], ['right0'])];
    const [, second] = findInPages(pages, 'left');
    if (second === undefined) throw new Error('two matches were found above');

    const line = lineOf(pages, second);
    expect(line?.text).toBe('left1');
    // The box is what a highlight converts through `PageTransform`, which is
    // why search needs no second engine call to draw a result.
    expect(line?.box.topLeft.y).toBe(16);
  });
});
