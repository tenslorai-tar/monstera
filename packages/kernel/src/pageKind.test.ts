import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { SCAN_TEXT_SHARE, pageKindOf } from './pageKind.js';
import type { PageText, TextBlock, TextLine } from './textStructure.js';

/**
 * The owner's rule for a scan (2026-10-07): a page is a picture when its text covers little of it, so a photograph that
 * gained a few INVISIBLE words from one box recognition is still offered OCR. Pages are built by hand so each case states
 * the two areas it compares.
 */

const FONT = { name: 'Helvetica', family: 'sans-serif', bold: false, italic: false } as const;

function line(text: string, width: number, height: number): TextLine {
  return {
    text,
    box: { topLeft: viewportPoint(0, 0), bottomRight: viewportPoint(width, height) },
    origin: viewportPoint(0, height),
    size: 12,
    font: FONT,
  };
}

function page(lines: readonly TextLine[], images: number, imageArea?: number): PageText {
  const blocks: TextBlock[] =
    lines.length === 0 ? [] : [{ lines, box: { topLeft: viewportPoint(0, 0), bottomRight: viewportPoint(1, 1) } }];
  return { blocks, images, ...(imageArea === undefined ? {} : { imageArea }) };
}

// A LETTER PAGE'S PHOTOGRAPH, in points: 612 by 792.
const PHOTO = 612 * 792;

describe('pageKindOf', () => {
  it('a photograph with a FEW INVISIBLE WORDS is still image-only, so OCR is offered again (the owner’s recording of 2026-10-06)', () => {
    // THREE WORDS from one box recognition: about 120 by 14 points, under a thousandth of the picture.
    expect(pageKindOf(page([line('Date: 12 Oct', 120, 14)], 1, PHOTO))).toBe('image-only');
  });

  it('CONTROL: a page of paragraphs over a small logo is TEXT, because its words are most of what is on it', () => {
    const paragraphs = Array.from({ length: 40 }, (_unused, at) => line(`Line ${String(at)} of a paragraph`, 480, 14));
    // 40 lines of 480 by 14 is 268,800 points, over half of a 150 by 90 logo's 13,500 many times over.
    expect(pageKindOf(page(paragraphs, 1, 150 * 90))).toBe('text');
  });

  it('the threshold is a SHARE of the pictures’ area, and both sides of it are pinned', () => {
    const area = 100_000;
    const justUnder = line('x', Math.floor(area * SCAN_TEXT_SHARE) - 100, 1);
    const justOver = line('x', Math.ceil(area * SCAN_TEXT_SHARE) + 100, 1);
    expect(pageKindOf(page([justUnder], 1, area))).toBe('image-only');
    expect(pageKindOf(page([justOver], 1, area))).toBe('text');
  });

  it('a page with NO text keeps its two answers: a picture, or blank — and a page with text and no picture is text', () => {
    expect(pageKindOf(page([], 1, PHOTO))).toBe('image-only');
    expect(pageKindOf(page([], 0))).toBe('empty');
    expect(pageKindOf(page([line('Hello', 40, 14)], 0))).toBe('text');
  });

  it('a page built WITHOUT picture areas is decided by whether it has text at all, as it was', () => {
    // NO `imageArea`: nothing to compare with, so one word is text — the fixtures written before the rule read as they did.
    expect(pageKindOf(page([line('Hello', 40, 14)], 1))).toBe('text');
  });

  it('whitespace is not text, whatever the picture', () => {
    expect(pageKindOf(page([line('   ', 400, 14)], 1, PHOTO))).toBe('image-only');
    expect(pageKindOf(page([line('   ', 400, 14)], 0))).toBe('empty');
  });
});
