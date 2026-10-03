import { type SignatureOutline, outlineOpCodes } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { drawSignature, signatureBox } from './signatureDrawing.js';

/**
 * The one module that draws a signature's mark (ADR-0133). The writers' halves — that pdf-lib and MuPDF each render
 * what it draws, upright on a turned page — are `documentSign.test.ts`' and `placedSignature.test.ts`'; these cases are
 * the drawing's own arithmetic, read off the stream it answers.
 */

/**
 * A line box twice as wide as it is tall, holding a straight base and one quadratic back to its start: the curve is
 * where a cubic built wrongly from a quadratic shows, and the box's shape is where one scale per axis would.
 */
const BOWL: SignatureOutline = { ops: outlineOpCodes('MLQZ'), points: [0, 500, 1000, 500, 500, 0, 0, 500], frame: [0, 0, 1000, 500] };

function outlined(outline: SignatureOutline): Parameters<typeof drawSignature>[0] {
  return { kind: 'outlined', text: 'Ada', font: 'great-vibes', outline };
}

describe('a TYPED name, as the outline the renderer made of it (ADR-0150)', () => {
  it('fills a PATH and names no font: no text object, no font resource', () => {
    const drawing = drawSignature(outlined(BOWL), 200, 100);
    expect(drawing.picture).toBeUndefined();
    expect(drawing.content).not.toMatch(/\b(BT|ET|Tf|Tj|TJ)\b/u);
    expect(drawing.content.split('\n').slice(-2)).toStrictEqual(['f', 'Q']);
  });

  it('draws a quadratic as the cubic that IS the same curve, fitted with one scale and turned y-up', () => {
    // 1000 × 500 into 200 × 100 at 0.9: one scale of 0.18, 10 in from the sides and 5 up from the bottom. The grid's
    // y = 500 is the BOTTOM of the line box, so it lands 5 up; the quadratic's control at y = 0 is its top.
    const lines = drawSignature(outlined(BOWL), 200, 100).content.split('\n');
    expect(lines).toContain('10.0000 5.0000 m');
    expect(lines).toContain('190.0000 5.0000 l');
    // THE CUBIC'S CONTROLS sit two thirds of the way from each end to the quadratic's one control (500, 0): (666.67,
    // 166.67) and (333.33, 166.67) on the grid, (130, 65) and (70, 65) in the form.
    expect(lines).toContain('130.0000 65.0000 70.0000 65.0000 10.0000 5.0000 c');
    // CONTROL: the cubic a careless conversion writes — the quadratic's control used twice — is a different curve.
    expect(lines).not.toContain('100.0000 95.0000 100.0000 95.0000 10.0000 5.0000 c');
    expect(lines).toContain('h');
  });

  it('fits the line box AND the ink, so a swash past the advance is not cut', () => {
    // A stroke reaching half the advance again past the line box's right edge.
    const swash: SignatureOutline = { ops: outlineOpCodes('MLLZ'), points: [0, 500, 1000, 500, 1500, 250], frame: [0, 0, 1000, 500] };
    const xs = [...drawSignature(outlined(swash), 200, 100).content.matchAll(/^(-?[\d.]+) (-?[\d.]+) [ml]$/gmu)].map(
      (match) => Number(match[1]),
    );
    expect(Math.max(...xs)).toBeLessThanOrEqual(190);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
  });

  it('keeps the line box’s height when the ink is shorter, so a name without descenders is not drawn taller', () => {
    // INK IN THE TOP HALF OF THE LINE BOX ONLY: fitted to the ink, it would fill the box's height; fitted to the line
    // box, it stays the top half of it.
    const short: SignatureOutline = { ops: outlineOpCodes('MLLZ'), points: [0, 0, 1000, 0, 500, 250], frame: [0, 0, 1000, 500] };
    const ys = [...drawSignature(outlined(short), 200, 100).content.matchAll(/^(-?[\d.]+) (-?[\d.]+) [ml]$/gmu)].map(
      (match) => Number(match[2]),
    );
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(45, 3);
  });
});

describe('a DRAWN mark', () => {
  /** Every `x y m` and `x y l` point of the stream. */
  function points(content: string): { readonly x: number; readonly y: number }[] {
    return [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]$/gmu)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }));
  }

  it('fits its INK into the box and turns the pad’s y-down into the form’s y-up', () => {
    const drawing = drawSignature(
      {
        kind: 'drawn',
        strokes: [
          [
            [0.2, 0.1],
            [0.4, 0.1],
          ],
          [
            [0.3, 0.3],
            [0.3, 0.3],
          ],
        ],
      },
      200,
      100,
    );
    expect(drawing.picture).toBeUndefined();
    const [first, second, dot] = points(drawing.content);
    // THE LINE IS ABOVE THE DOT in the form, because it was above it on the pad: a drawing that kept y down would put
    // it below.
    expect(first?.y).toBeGreaterThan(dot?.y ?? Infinity);
    expect(second?.y).toBe(first?.y);
    // FITTED, NOT COPIED: the ink spans most of the box's tighter axis, wherever on the pad it was drawn.
    const xs = points(drawing.content).map((point) => point.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
  });
});

describe('a PICTURE mark', () => {
  it('names Im0 and scales it to fit without distortion, centred', () => {
    const drawing = drawSignature({ kind: 'picture', width: 40, height: 20 }, 200, 50);
    expect(drawing.picture).toStrictEqual({ name: 'Im0' });
    const match = /([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/u.exec(drawing.content);
    const [wide, tall, left, bottom] = (match?.slice(1) ?? []).map(Number);
    // Two to one, as the picture is: the height bounds it (50 × 0.9 = 45 tall, 90 wide), centred in 200 × 50.
    expect(wide).toBeCloseTo(90, 3);
    expect(tall).toBeCloseTo(45, 3);
    expect(left).toBeCloseTo(55, 3);
    expect(bottom).toBeCloseTo(2.5, 3);
  });
});

describe('signatureBox', () => {
  it('orders the rectangle, and swaps what is seen on a quarter turn', () => {
    const flat = signatureBox({ x0: 300, y0: 180, x1: 100, y1: 100 }, 0);
    expect(flat.rect).toStrictEqual([100, 100, 300, 180]);
    expect([flat.seenWide, flat.seenTall]).toStrictEqual([200, 80]);
    const turned = signatureBox({ x0: 100, y0: 100, x1: 300, y1: 180 }, 90);
    expect([turned.seenWide, turned.seenTall]).toStrictEqual([80, 200]);
    expect(turned.matrix).toStrictEqual([0, 1, -1, 0, 0, 0]);
    // SNAPPED through the shared function: -270 is a quarter turn clockwise.
    expect(signatureBox({ x0: 0, y0: 0, x1: 10, y1: 20 }, -270).matrix).toStrictEqual([0, 1, -1, 0, 0, 0]);
  });

  it('refuses a rectangle with no area', () => {
    expect(() => signatureBox({ x0: 100, y0: 100, x1: 100, y1: 180 }, 0)).toThrow(RangeError);
  });
});
