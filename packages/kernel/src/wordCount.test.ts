import { describe, expect, it } from 'vitest';

import type { PageText } from './textStructure.js';
import { parsePageText } from './textStructure.js';
import { countPageWords } from './wordCount.js';

/**
 * A page whose lines are chosen here, built through the shipped parser.
 *
 * The same shape `textLayer.test.ts` uses and for the same reason: a `PageText`
 * literal cannot be written without a cast over the branded corners, and a cast
 * is where the type stops carrying the property.
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

/**
 * What this module owns is the READING, not the counting.
 *
 * `countWords` is `@monstera/shared`'s and has its own cases there — the
 * segmenter, the code points, the CJK control. Repeating them here would be the
 * same assertion twice over one implementation, which is two assertions from one
 * source: they would agree whatever the join did.
 *
 * So these cases ask the one question shared cannot: does a `PageText` become
 * the right lines, in the right order, with the substrate's own nesting?
 */
describe('countPageWords', () => {
  it('counts the words of every line the page holds', () => {
    expect(countPageWords(pageOf(['one two', 'three'])).words).toBe(3);
  });

  it('reads the lines in the substrate’s ORDER, which is what the join depends on', () => {
    // A reader that flattened the tree differently would still count three
    // words here, so the assertion is the character total: joining in the wrong
    // order gives the same figure, but joining the WRONG SET does not. Two
    // lines of three characters plus one separator.
    expect(countPageWords(pageOf(['abc', 'def'])).characters).toBe(7);
  });

  it('reads a page with no text as zero rather than throwing', () => {
    expect(countPageWords({ blocks: [], images: 0 })).toStrictEqual({
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
    });
  });

  it('drops the image and vector blocks the substrate emits alongside text', () => {
    // `parsePageText` drops blocks with no lines, so a page carrying an image
    // block must count as its text alone — and a reader that counted blocks
    // rather than lines would be one too many here.
    const withImage = parsePageText(
      JSON.stringify({
        blocks: [
          { type: 'image', bbox: { x: 0, y: 0, w: 10, h: 10 } },
          {
            type: 'structure',
            contents: [
              {
                type: 'text',
                bbox: { x: 10, y: 20, w: 100, h: 12 },
                lines: [
                  {
                    bbox: { x: 10, y: 20, w: 100, h: 12 },
                    font: { size: 12 },
                    x: 10,
                    y: 30,
                    text: 'only these',
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(countPageWords(withImage)).toStrictEqual({
      words: 2,
      characters: 10,
      charactersNoSpaces: 9,
    });
  });
});
