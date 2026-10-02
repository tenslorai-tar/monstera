import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { type CompareBox, type ComparePage, comparePair, pairWordBoxes } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import { readPageText } from './pageText.js';
import { textLayerOf } from './textLayer.js';
import { MAX_PAGE_WORD_BOXES, MAX_TEXT_LAYER_LINE, MAX_TEXT_LAYER_LINES } from '@monstera/contract';

import { ENGINE_WORD_BOXES_LINES_MAX, ENGINE_WORD_BOXES_MAX, ENGINE_WORD_LINE_MAX } from './host/engineChannels.js';
import { readPageWordBoxes, wordBoxesOf } from './wordBoxes.js';

/**
 * ADR-0137: a word's box is the engine's. The proof is a face where the old estimate is VISIBLY off — Helvetica, ten
 * narrow `i` then ten wide `M`, where a word's share of the line's characters puts the second word tens of points left
 * of where it is printed — measured against the font's own advance widths, which pdf-lib reads from the AFM and MuPDF
 * does not, so the expectation is independent of the engine under test.
 */

const SIZE = 20;
const LEFT = 50;
const NARROW = 'iiiiiiiiii';

async function page(second: string): Promise<{ bytes: Uint8Array; secondStart: number; secondEnd: number }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([500, 200]);
  sheet.drawText(`${NARROW} ${second}`, { x: LEFT, y: 100, size: SIZE, font });
  return {
    bytes: await document.save({ useObjectStreams: false }),
    secondStart: LEFT + font.widthOfTextAtSize(`${NARROW} `, SIZE),
    secondEnd: LEFT + font.widthOfTextAtSize(`${NARROW} ${second}`, SIZE),
  };
}

/** One page as Side by Side builds it: the text layer's lines, paired with the engine's boxes by the shared rule. */
async function comparable(bytes: Uint8Array, withWords: boolean): Promise<ComparePage> {
  const session = await mupdfWriter.open(bytes);
  try {
    const [text] = (await readPageText(session, [0])).pages;
    if (text === undefined) throw new Error('the fixture read no page');
    const layer = textLayerOf(text, 2048, 1024);
    const boxes = await readPageWordBoxes(session, 0);
    return {
      size: { width: 500, height: 200 },
      annotations: [],
      raster: undefined,
      lines: withWords ? pairWordBoxes(layer.lines, boxes.lines) : layer.lines,
    };
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('readPageWordBoxes', () => {
  it('boxes each word where the FONT prints it, within a point — two tokens on the one line', async () => {
    const { bytes, secondStart, secondEnd } = await page('MMMMMMMMMM');
    const session = await mupdfWriter.open(bytes);
    try {
      const read = await readPageWordBoxes(session, 0);
      expect(read.truncated).toBe(false);
      expect(read.lines.map((line) => [line.text, line.boxes.length / 4])).toStrictEqual([[`${NARROW} MMMMMMMMMM`, 2]]);
      const [, , , , x0, , x1] = read.lines[0]?.boxes ?? [];
      expect(Math.abs((x0 ?? 0) - secondStart)).toBeLessThan(1);
      expect(Math.abs((x1 ?? 0) - secondEnd)).toBeLessThan(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a changed word is MARKED where it is printed — and CONTROL: the estimate, on the same pages, misses it by tens of points', async () => {
    const left = await page('MMMMMMMMMM');
    const right = await page('WWWWWWWWWW');
    const marked = (changes: ReturnType<typeof comparePair>): CompareBox | undefined =>
      changes.find((change) => change.kind === 'text')?.right[0];

    const exact = marked(comparePair(await comparable(left.bytes, true), await comparable(right.bytes, true)));
    expect(Math.abs((exact?.x0 ?? 0) - right.secondStart)).toBeLessThan(1);
    expect(Math.abs((exact?.x1 ?? 0) - right.secondEnd)).toBeLessThan(1);

    // THE SAME PAIR WITHOUT THE ENGINE'S BOXES is the defect this replaced: the word is boxed by its share of 21
    // characters, and ten narrow letters are a fraction of ten wide ones' width.
    const estimated = marked(comparePair(await comparable(left.bytes, false), await comparable(right.bytes, false)));
    expect(Math.abs((estimated?.x0 ?? 0) - right.secondStart)).toBeGreaterThan(20);
  });
});

describe('wordBoxesOf', () => {
  const quad = (x0: number, x1: number): [number, number, number, number, number, number, number, number] => [
    x0, 0, x1, 0, x0, 10, x1, 10,
  ];
  const line = (text: string, from: number) => ({
    bbox: [from, 0, from + text.length * 10, 10] as [number, number, number, number],
    // ONE CODE UNIT EACH, as the engine's walk hands characters (`fromCharCode`): these fixtures are ASCII.
    characters: Array.from({ length: text.length }, (_, at) => ({
      text: text.charAt(at),
      quad: quad(from + at * 10, from + at * 10 + 8),
    })),
  });
  const box = { x0: 0, y0: 0, x1: 50, y1: 10 };

  it('a token is the UNION of its characters, and whitespace is no token', () => {
    expect(wordBoxesOf([line('ab cd', 0)])).toStrictEqual({
      lines: [{ text: 'ab cd', box, boxes: [0, 0, 18, 10, 30, 0, 48, 10] }],
      truncated: false,
    });
  });

  it('past the bound a line keeps its text and gives no boxes, and the answer says so — CONTROL: at the bound, all boxed', () => {
    const two = [line('ab cd', 0), line('ef gh', 0)];
    expect(wordBoxesOf(two, 3)).toStrictEqual({
      lines: [
        { text: 'ab cd', box, boxes: [0, 0, 18, 10, 30, 0, 48, 10] },
        { text: 'ef gh', box, boxes: [] },
      ],
      truncated: true,
    });
    expect(wordBoxesOf(two, 4).truncated).toBe(false);
  });

  it('the host’s literal bounds ARE the text layer’s, so a cut walked line is the text layer’s cut line', () => {
    expect(ENGINE_WORD_LINE_MAX).toBe(MAX_TEXT_LAYER_LINE);
    expect(ENGINE_WORD_BOXES_MAX).toBe(MAX_PAGE_WORD_BOXES);
    expect(ENGINE_WORD_BOXES_LINES_MAX).toBe(4 * MAX_TEXT_LAYER_LINES);
    const long = line('x'.repeat(ENGINE_WORD_LINE_MAX + 5), 0);
    expect(wordBoxesOf([long]).lines[0]?.text).toHaveLength(MAX_TEXT_LAYER_LINE);
  });
});
