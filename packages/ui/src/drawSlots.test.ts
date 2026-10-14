import { describe, expect, it } from 'vitest';

import { MAX_DRAWS, drawSlotsInUse, withDrawSlot } from './drawSlots.js';

/** A draw that ends when the case says so, and says when it started. */
function heldDraw(): { readonly run: () => Promise<string>; readonly end: () => void; started: boolean } {
  let end = (): void => undefined;
  const handle = {
    started: false,
    end: () => {
      end();
    },
    run: () => {
      handle.started = true;
      return new Promise<string>((resolve) => {
        end = () => {
          resolve('drawn');
        };
      });
    },
  };
  return handle;
}

describe('page draws run at most MAX_DRAWS at once (run 4 item 13d)', () => {
  it('a draw past the cap waits, starts when one ends, and every slot is given back', async () => {
    const draws = Array.from({ length: MAX_DRAWS + 1 }, heldDraw);
    const answers = draws.map((draw) => withDrawSlot(new AbortController().signal, draw.run));
    await Promise.resolve();
    expect(draws.map((draw) => draw.started)).toStrictEqual([...Array.from({ length: MAX_DRAWS }, () => true), false]);
    expect(drawSlotsInUse()).toStrictEqual({ running: MAX_DRAWS, waiting: 1 });
    draws[0]?.end();
    await answers[0];
    await Promise.resolve();
    expect(draws.at(-1)?.started).toBe(true);
    for (const draw of draws) draw.end();
    expect(await Promise.all(answers)).toStrictEqual(draws.map(() => 'drawn'));
    expect(drawSlotsInUse()).toStrictEqual({ running: 0, waiting: 0 });
  });

  it('a draw superseded while it waits never runs, answers null, and holds no slot', async () => {
    const draws = Array.from({ length: MAX_DRAWS }, heldDraw);
    const answers = draws.map((draw) => withDrawSlot(new AbortController().signal, draw.run));
    const superseded = new AbortController();
    const late = heldDraw();
    const answer = withDrawSlot(superseded.signal, late.run);
    superseded.abort();
    expect(await answer).toBeNull();
    for (const draw of draws) draw.end();
    await Promise.all(answers);
    expect(late.started).toBe(false);
    expect(drawSlotsInUse()).toStrictEqual({ running: 0, waiting: 0 });
  });

  it('CONTROL: a draw that throws gives its slot back, so the next one runs', async () => {
    const failing = withDrawSlot(new AbortController().signal, () => Promise.reject(new Error('the page would not draw')));
    await expect(failing).rejects.toThrow('the page would not draw');
    expect(drawSlotsInUse()).toStrictEqual({ running: 0, waiting: 0 });
  });
});
