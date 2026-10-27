import { describe, expect, it } from 'vitest';

import { ENGINE_ANSWER_FILE_MAX_BYTES } from '@monstera/contract/host';

import { ANSWER_ENVELOPE_ROOM, fittedList, itemsThatFit } from './answerFit.js';
import { ENGINE_TEXT_OBJECTS_MAX, pdfiumChannels } from './pdfiumChannels.js';
import { boundedToAnswer } from './pdfiumHandlers.js';

/**
 * A list answer is fitted to the file-answer ceiling by its bytes as well as by its count (`answerFit.ts`), so a page of
 * real runs past one answer is answered with the part that fits and `truncated`, never refused as `answer-too-large`.
 *
 * The runs are shaped as PDFium's reader answers them, on a page as dense as textWalk's L6 (39,201 runs, 2026-10-16).
 */
function run(at: number): object {
  return {
    index: at,
    last: at,
    text: `run ${String(at)} of the dense page`,
    bottom: 700 - at / 100,
    top: 712 - at / 100,
    left: 72.125,
    right: 180.5,
    style: {
      size: 12,
      colour: { r: 0, g: 0, b: 0 },
      font: 'ABCDEF+Helvetica',
      serif: false,
      mono: false,
      italic: false,
      bold: false,
      orientation: 'upright',
      baseline: 702 - at / 100,
    },
  };
}

const L6_RUNS = 39_201;
const answerBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('itemsThatFit', () => {
  it('answers a list that fits whole, unchanged and not truncated', () => {
    const runs = Array.from({ length: 50 }, (_, at) => run(at));
    expect(itemsThatFit(runs, 1000)).toStrictEqual({ kept: runs, truncated: false });
  });

  it('cuts by COUNT where small items reach the count first', () => {
    const items = Array.from({ length: 30 }, (_, at) => at);
    expect(itemsThatFit(items, 10)).toStrictEqual({ kept: items.slice(0, 10), truncated: true });
  });

  it('cuts by BYTES where real items reach the ceiling first, keeping as many as fit', () => {
    const runs = Array.from({ length: 2000 }, (_, at) => run(at));
    const ceiling = 64 * 1024;
    const { kept, truncated } = itemsThatFit(runs, ENGINE_TEXT_OBJECTS_MAX, ceiling);
    expect(truncated).toBe(true);
    expect(answerBytes(kept)).toBeLessThanOrEqual(ceiling - ANSWER_ENVELOPE_ROOM);
    // AS MANY AS FIT: one more would not.
    expect(answerBytes(runs.slice(0, kept.length + 1))).toBeGreaterThan(ceiling - ANSWER_ENVELOPE_ROOM);
  });

  it('a reader’s list stays truncated where its walk stopped, even when it fits', () => {
    expect(fittedList({ items: [1, 2, 3], truncated: true })).toStrictEqual({ kept: [1, 2, 3], truncated: true });
    expect(fittedList({ items: [1, 2, 3], truncated: false })).toStrictEqual({ kept: [1, 2, 3], truncated: false });
  });
});

describe('the dense page’s text runs, at the product ceiling', () => {
  const runs = Array.from({ length: L6_RUNS }, (_, at) => run(at));

  it('fit one answer and say so, and the answer is one the channel accepts', () => {
    const { kept, truncated } = boundedToAnswer(runs);
    // THE PAGE'S BOX TOO, as the host answers it: what the envelope's room is there for.
    const answer = { runs: kept, truncated, unaddressable: 0, box: { x0: 0, y0: 0, x1: 612.0000305175781, y1: 791.9999694824219 } };
    expect(truncated).toBe(true);
    expect(answerBytes(answer)).toBeLessThanOrEqual(ENGINE_ANSWER_FILE_MAX_BYTES);
    expect(pdfiumChannels['engine/text-runs'].result.safeParse(JSON.parse(JSON.stringify(answer))).success).toBe(true);
  });

  it('CONTROL: cut by the count bound alone, the same page is over the ceiling, which is the refusal L6 met', () => {
    const answer = { runs: runs.slice(0, ENGINE_TEXT_OBJECTS_MAX), truncated: true, unaddressable: 0, box: null };
    expect(answerBytes(answer)).toBeGreaterThan(ENGINE_ANSWER_FILE_MAX_BYTES);
  });
});
