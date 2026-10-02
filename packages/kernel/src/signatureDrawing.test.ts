import { Encodings, Font } from '@pdf-lib/standard-fonts';
import { describe, expect, it } from 'vitest';

import { SignatureAppearanceRefusedError } from './signingRefusals.js';
import { drawSignature, signatureBox } from './signatureDrawing.js';

/**
 * The one module that draws a signature's mark (ADR-0133). The writers' halves — that pdf-lib and MuPDF each render
 * what it draws, upright on a turned page — are `documentSign.test.ts`' and `placedSignature.test.ts`'; these cases are
 * the drawing's own arithmetic, read off the stream it answers.
 */

/** The `x y Td` a typed drawing positions its line with. */
function lineStart(content: string): { readonly x: number; readonly y: number } {
  const match = /(-?[\d.]+) (-?[\d.]+) Td/u.exec(content);
  if (match === null) throw new Error(`no Td in the stream:\n${content}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** The size the `/F0 n Tf` sets. */
function fontSize(content: string): number {
  const match = /\/F0 ([\d.]+) Tf/u.exec(content);
  if (match === null) throw new Error(`no Tf in the stream:\n${content}`);
  return Number(match[1]);
}

describe('a TYPED mark', () => {
  it('names a base-14 Type 1 font as F0 and shows the text in its WinAnsi codes', async () => {
    const drawing = await drawSignature({ kind: 'typed', text: 'Ada', font: 'times-italic' }, 200, 80);
    expect(drawing.font).toStrictEqual({ name: 'F0', baseFont: 'Times-Italic' });
    expect(drawing.picture).toBeUndefined();
    // A, d, a in WinAnsi: 41 64 61.
    expect(drawing.content).toContain('<416461> Tj');
  });

  it('CENTRES on the advances it draws, WITHOUT kerning — `Tj` applies none', async () => {
    // "AV" is the pair the kerning table moves most in Helvetica (A V -70 per mille), so it is the input on which a
    // width that added kerning and one that did not differ by the most: a fixture without a kerned pair would be
    // centred identically either way and separate nothing.
    const width = 400;
    const drawing = await drawSignature({ kind: 'typed', text: 'AV', font: 'helvetica' }, width, 100);
    const font = Font.load('Helvetica');
    const advance = ['A', 'V'].reduce((sum, letter) => {
      const glyph = Encodings.WinAnsi.encodeUnicodeCodePoint(letter.codePointAt(0) ?? 0);
      return sum + (font.getWidthOfGlyph(glyph.name) ?? 0);
    }, 0);
    const kern = font.getXAxisKerningForPair('A', 'V') ?? 0;
    expect(kern, 'the fixture pair is kerned, or this case separates nothing').toBeLessThan(0);

    const size = fontSize(drawing.content);
    const drawn = (advance / 1000) * size;
    expect(lineStart(drawing.content).x).toBeCloseTo((width - drawn) / 2, 3);
    // CONTROL: centring on the kerned width would start the line this much further right.
    const kerned = ((advance + kern) / 1000) * size;
    expect(Math.abs((width - kerned) / 2 - lineStart(drawing.content).x)).toBeGreaterThan(1);
  });

  it('REFUSES a character WinAnsi cannot encode, by name, rather than drawing something else', async () => {
    const refused = drawSignature({ kind: 'typed', text: 'Ada ✓', font: 'courier' }, 200, 80);
    await expect(refused).rejects.toBeInstanceOf(SignatureAppearanceRefusedError);
    await expect(refused).rejects.toMatchObject({ reason: 'unencodable-text' });
  });

  it('fits the narrower axis: a long name in a short box is sized by the width', async () => {
    const narrow = await drawSignature({ kind: 'typed', text: 'Bartholomew Featherstonehaugh', font: 'helvetica' }, 120, 80);
    const roomy = await drawSignature({ kind: 'typed', text: 'Bartholomew Featherstonehaugh', font: 'helvetica' }, 480, 80);
    expect(fontSize(narrow.content)).toBeLessThan(fontSize(roomy.content));
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

  it('fits its INK into the box and turns the pad’s y-down into the form’s y-up', async () => {
    const drawing = await drawSignature(
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
    expect(drawing.font).toBeUndefined();
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
  it('names Im0 and scales it to fit without distortion, centred', async () => {
    const drawing = await drawSignature({ kind: 'picture', width: 40, height: 20 }, 200, 50);
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
