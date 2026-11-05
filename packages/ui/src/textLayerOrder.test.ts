import { describe, expect, it } from 'vitest';

import type { TextLayerLine } from './TextLayer.js';
import { layoutOrder } from './textLayerOrder.js';

const line = (x0: number, y0: number, width: number, height = 14): TextLayerLine => ({ text: 'x'.repeat(5), box: { x0, y0, x1: x0 + width, y1: y0 + height } });

describe('layoutOrder', () => {
  // THE BOXES THE ENGINE GAVE ON THE PAGE THAT FOUND THIS (measured 2026-11-05), in the order it gave them.
  const form: readonly TextLayerLine[] = [
    line(50, 52, 110),
    line(50, 81, 326),
    line(136, 152, 56),
    line(177, 192, 15),
    line(149, 232, 43),
    line(148, 272, 44),
    line(168, 312, 24),
    line(135, 352, 56),
    line(227, 232, 26),
    line(302, 232, 40),
    line(157, 432, 34),
    line(50, 67, 487),
  ];

  it('puts a line the engine read last back between the lines it lies between', () => {
    const order = layoutOrder(form);
    expect(order.slice(0, 3)).toStrictEqual([0, 11, 1]);
  });

  it('moves nothing else, and loses nothing', () => {
    const order = layoutOrder(form);
    // THE LABELS TO THE RIGHT OF A ROW keep the engine's order: they overlap neither of the rows around them.
    expect(order.slice(3)).toStrictEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...order].sort((a, b) => a - b)).toStrictEqual(form.map((_, index) => index));
  });

  it('CONTROL: two columns keep column order, each reading down its own', () => {
    const columns = [line(50, 100, 200), line(50, 120, 200), line(50, 140, 200), line(300, 100, 200), line(300, 120, 200), line(300, 140, 200)];
    expect(layoutOrder(columns)).toStrictEqual([0, 1, 2, 3, 4, 5]);
  });

  it('CONTROL: a page read straight down is the engine’s order', () => {
    const page = [line(50, 100, 400), line(50, 120, 400), line(50, 140, 400)];
    expect(layoutOrder(page)).toStrictEqual([0, 1, 2]);
  });

  it('CONTROL: a line going back up with no room between the lines around it stays where it was', () => {
    // TWO LINES ON TOP OF EACH OTHER, as a shadow or a bold drawn twice makes: nothing fits between them.
    const page = [line(50, 100, 400), line(50, 104, 400), line(50, 102, 400)];
    expect(layoutOrder(page)).toStrictEqual([0, 1, 2]);
  });

  it('leaves a line that is not upright where it was', () => {
    const turned: TextLayerLine = { text: 'xxxxx', box: { x0: 60, y0: 112, x1: 80, y1: 128 }, letters: { origin: { x: 60, y: 128 }, direction: { x: 0, y: -1 }, size: 10, advances: [100] } };
    expect(layoutOrder([line(50, 100, 400), line(50, 140, 400), turned])).toStrictEqual([0, 1, 2]);
    // CONTROL: the same box upright is moved, so the case above is about the turn.
    const upright: TextLayerLine = { ...turned, letters: { origin: { x: 60, y: 128 }, direction: { x: 1, y: 0 }, size: 10, advances: [100] } };
    expect(layoutOrder([line(50, 100, 400), line(50, 140, 400), upright])).toStrictEqual([0, 2, 1]);
  });
});
