import { describe, expect, it } from 'vitest';

import { occurrenceAt } from './pdfiumReplaceAt.js';

/**
 * Which object one occurrence names, and what it becomes (ADR-0156 Decision 4). The PDFium half — that the object is
 * written and the page regenerated — is `proof:pdfiumcommand`'s, which runs where PDFium does.
 */

/** A run as PDFium answers one: its object, its string, its bounds in PDF user space. */
function run(index: number, text: string, left: number, bottom: number, right = left + 100, top = bottom + 12) {
  return { index, text, left, right, bottom, top };
}

const RUNS = [run(0, 'The quick brwon fox', 72, 700), run(1, 'jumps over the brwon dog', 72, 680)];

describe('occurrenceAt', () => {
  it('names the ONE object holding the word at the point, and splices only that word', () => {
    expect(occurrenceAt(RUNS, { find: 'brwon', replace: 'brown', at: { x: 120, y: 686 } })).toStrictEqual({
      index: 1,
      before: 'jumps over the brwon dog',
      after: 'jumps over the brown dog',
    });
  });

  it('CONTROL: the same word at the OTHER line’s point names the other object — the point decides, not the order', () => {
    expect(occurrenceAt(RUNS, { find: 'brwon', replace: 'brown', at: { x: 120, y: 706 } })?.index).toBe(0);
  });

  it('refuses a point no object holds, and an object at the point that does not hold the word', () => {
    // A WORD ONE OBJECT ALONE HOLDS, so the point is the only thing that can refuse it: with `brwon`, which both hold,
    // a missing bounds check left two objects and the two-object refusal answered for it.
    expect(occurrenceAt(RUNS, { find: 'quick', replace: 'slow', at: { x: 400, y: 706 } })).toBeUndefined();
    expect(occurrenceAt(RUNS, { find: 'quick', replace: 'slow', at: { x: 120, y: 686 } })).toBeUndefined();
  });

  it('names the one of two overlapping objects that HOLDS the word, rather than refusing the pair', () => {
    // THE WORD DECIDES WHICH OBJECT AT THE POINT: without it in the filter both objects are at the point, and a word
    // only one of them holds is refused as two.
    const overlapping = [run(8, 'the cat', 72, 700), run(9, 'recieve it', 72, 700)];
    expect(occurrenceAt(overlapping, { find: 'recieve', replace: 'receive', at: { x: 100, y: 706 } })?.index).toBe(9);
  });

  it('refuses an object holding the word TWICE: the point is inside the object, not inside a character', () => {
    const twice = [run(4, 'teh cat and teh hat', 72, 700)];
    expect(occurrenceAt(twice, { find: 'teh', replace: 'the', at: { x: 120, y: 706 } })).toBeUndefined();
  });

  it('refuses two overlapping objects at the point that both hold the word', () => {
    const stacked = [run(2, 'recieve', 72, 700), run(3, 'recieve it', 72, 700)];
    expect(occurrenceAt(stacked, { find: 'recieve', replace: 'receive', at: { x: 100, y: 706 } })).toBeUndefined();
  });

  it('matches the WHOLE word EXACTLY as written: not inside a longer word, and not in another case', () => {
    const inside = [run(5, 'unrecieved', 72, 700)];
    expect(occurrenceAt(inside, { find: 'recieve', replace: 'receive', at: { x: 120, y: 706 } })).toBeUndefined();
    const capital = [run(6, 'Recieve this', 72, 700)];
    expect(occurrenceAt(capital, { find: 'recieve', replace: 'receive', at: { x: 120, y: 706 } })).toBeUndefined();
    expect(occurrenceAt(capital, { find: 'Recieve', replace: 'Receive', at: { x: 120, y: 706 } })?.after).toBe(
      'Receive this',
    );
  });

  it('takes a point on a ROTATED page’s bounds, whichever corner PDFium answers first', () => {
    // A run whose left is greater than its right, as a page turned half a turn answers: the bounds are a box either way.
    const turned = [{ index: 7, text: 'adress here', left: 300, right: 200, bottom: 400, top: 388 }];
    expect(occurrenceAt(turned, { find: 'adress', replace: 'address', at: { x: 250, y: 394 } })?.index).toBe(7);
  });
});
