import { describe, expect, it } from 'vitest';

import { networkOcrFrame } from './networkOcrFrame.js';

/** The frame of a network OCR read, and whether its writing was drawn around (CCCCCCCC-3, AAAAAAAA-2). */
describe('networkOcrFrame', () => {
  it('a WHOLE PAGE is framed by its own size, is not drawn, and is the only scope that asks for the size', async () => {
    let asked = 0;
    const frame = await networkOcrFrame({ page: 2, wholePage: true }, () => {
      asked += 1;
      return Promise.resolve({ width: 612, height: 792 });
    });
    expect(frame).toStrictEqual({ rect: undefined, widthPoints: 612, heightPoints: 792, drawn: false });
    expect(asked).toBe(1);
  });

  it('CONTROL: a drawn REGION is framed by itself and is drawn, without asking the page its size', async () => {
    let asked = 0;
    const frame = await networkOcrFrame({ page: 0, region: [300, 500, 100, 400] }, () => {
      asked += 1;
      return Promise.resolve({ width: 612, height: 792 });
    });
    expect(frame).toStrictEqual({ rect: { x0: 300, y0: 500, x1: 100, y1: 400 }, widthPoints: 200, heightPoints: 100, drawn: true });
    expect(asked).toBe(0);
  });
});
