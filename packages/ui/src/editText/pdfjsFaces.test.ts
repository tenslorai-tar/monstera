import { describe, expect, it } from 'vitest';

import type { TextBlock } from '../textBlock.js';
import { runFamiliesOf } from './pdfjsFaces.js';

const STYLE = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false, font: 'ABCDEF+Arial' };
const line = (y0: number, index: number, text: string): TextBlock['lines'][number] => ({
  runs: [{ index, text, style: STYLE }],
  box: { x0: 72, y0, x1: 300, y1: y0 + 12 },
  soft: false,
  baseline: y0 + 3,
});
/** Two lines in two subsets that share one name, which only where their words stand tells apart. */
const BLOCK: TextBlock = {
  box: { x0: 72, y0: 670, x1: 300, y1: 700 },
  lines: [line(688, 1, 'first line'), line(670, 5, 'second line')],
  style: STYLE,
  shape: { align: 'left', firstIndent: 0 },
};

describe('the face PDF.js loaded for each run of a block', () => {
  it('is matched by where the words stand, so two subsets of one name keep their own faces', () => {
    const shown = [
      // LISTED SECOND LINE FIRST: a match by name or by order would give both runs this face.
      { x: 72, y: 673, text: 'second line', family: 'g_d0_f2' },
      { x: 72, y: 691, text: 'first line', family: 'g_d0_f1' },
    ];
    expect([...runFamiliesOf(BLOCK, shown)]).toStrictEqual([
      [1, 'g_d0_f1'],
      [5, 'g_d0_f2'],
    ]);
  });

  it('gives no face where PDF.js loaded none, or where no item on the line holds the run’s words', () => {
    const shown = [
      { x: 72, y: 691, text: 'first line', family: undefined },
      // CONTROL: the right words on another line are not this run's.
      { x: 72, y: 600, text: 'second line', family: 'g_d0_f2' },
    ];
    expect(runFamiliesOf(BLOCK, shown).size).toBe(0);
  });

  describe('a block in a frame, whose lines are in the frame and PDF.js’s items on the page', () => {
    // MEASURED 2026-11-06 on a corpus page under /Rotate 180 whose text is turned too: a line's box from -533.2 across and -130.17
    // up, and PDF.js's item for it at (534, 128).
    const line = { ...BLOCK.lines[0], box: { x0: -533.2, y0: -130.17, x1: -84.05, y1: -120.59 } } as TextBlock['lines'][number];
    const turned: TextBlock = { ...BLOCK, lines: [line], frame: [-1, 0, 0, -1] };
    const item = { x: 534, y: 128, text: 'first line', family: 'g_d0_f2' };

    it('finds the run its item stands on', () => {
      expect(runFamiliesOf(turned, [item]).get(1)).toBe('g_d0_f2');
    });

    it('CONTROL: the same block with no frame does not, so the frame is what found it', () => {
      expect(runFamiliesOf({ ...BLOCK, lines: [line] }, [item]).size).toBe(0);
    });
  });

  it('matches across the spaces PDFium infers and PDF.js does not', () => {
    expect(runFamiliesOf(BLOCK, [{ x: 140, y: 691, text: 'line', family: 'g_d0_f1' }]).get(1)).toBe('g_d0_f1');
  });
});
