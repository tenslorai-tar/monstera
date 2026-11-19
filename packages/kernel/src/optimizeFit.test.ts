import { describe, expect, it } from 'vitest';

import { stepThatFits } from './optimizeFit.js';

/** A ladder whose copies weigh `sizes`, recording each step it was asked to make. */
function ladder(sizes: readonly number[]): { readonly asked: number[]; readonly sizeAt: (step: number) => Promise<number> } {
  const asked: number[] = [];
  return {
    asked,
    sizeAt: (step) => {
      asked.push(step);
      return Promise.resolve(sizes[step] ?? Number.NaN);
    },
  };
}

describe('stepThatFits (ADR-0298)', () => {
  it('answers the LIGHTEST step that fits, and makes no copy past it', async () => {
    const { asked, sizeAt } = ladder([900, 700, 500, 400, 300]);
    expect(await stepThatFits(5, 600, sizeAt)).toStrictEqual({ step: 2, size: 500, fits: true });
    // THE DECISION, not only its answer: a search that tried every step and kept the lightest fitting one answers the
    // same, and costs two rewrites more.
    expect(asked).toStrictEqual([0, 1, 2]);
  });

  it('CONTROL: a stronger step that fits is not the answer when a lighter one does', async () => {
    const { sizeAt } = ladder([900, 590, 500, 400, 300]);
    expect(await stepThatFits(5, 600, sizeAt)).toStrictEqual({ step: 1, size: 590, fits: true });
  });

  it('answers the step whose copy came out SMALLEST where none fits, never refusing', async () => {
    // A rewriter that keeps a stream only where it is smaller does not shrink by rule at every step.
    const { asked, sizeAt } = ladder([900, 700, 640, 650, 660]);
    expect(await stepThatFits(5, 600, sizeAt)).toStrictEqual({ step: 2, size: 640, fits: false });
    expect(asked).toStrictEqual([0, 1, 2, 3, 4]);
  });

  it('passes on an answer that is not a size, and stops there', async () => {
    const asked: number[] = [];
    const stop = { kind: 'unreadable' as const };
    const answer = await stepThatFits(5, 600, (step) => {
      asked.push(step);
      return Promise.resolve(step === 1 ? stop : 900);
    });
    expect(answer).toBe(stop);
    expect(asked).toStrictEqual([0, 1]);
  });

  it('refuses a ladder with no step', async () => {
    await expect(stepThatFits(0, 600, () => Promise.resolve(1))).rejects.toThrow(RangeError);
  });
});
