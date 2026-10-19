// @vitest-environment happy-dom
import { asDocVersion } from '@monstera/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type AnnotationSelection, CORNER_REACH } from './annotations/selectTool.js';
import { SelectionLayer } from './SelectionLayer.js';

/**
 * The layer that draws a selection.
 *
 * Its whole job is a coordinate conversion and a page filter, so the cases are
 * about those two and about the third thing that is easy to get wrong: drawing
 * nothing at all rather than an empty surface.
 */

const GEOMETRY = {
  // The annotation tools' fixture: a non-zero crop origin and a zoom that is
  // not 1, so a layer passing PDF numbers straight through fails rather than
  // coincides.
  crop: [50, 100, 250, 400] as readonly [number, number, number, number],
  rotation: 0 as const,
  zoom: 2,
};

const SELECTION: AnnotationSelection = {
  page: 3,
  version: asDocVersion(7),
  items: [
    {
      index: 1,
      rect: { x0: 60, y0: 350, x1: 100, y1: 390 },
      // Carried by the selection for the comment styles panel and the *Edit*
      // item; this layer draws the box and reads none of the three.
      style: { colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
      kind: 'square',
      contents: '',
      author: '',
      created: null,
      blend: 'normal',
    },
  ],
};

describe('SelectionLayer', () => {
  it('draws the selected box in the overlay’s own pixels', () => {
    const { container } = render(
      <SelectionLayer geometry={GEOMETRY} page={3} selection={SELECTION} />,
    );
    const box = container.querySelector('[data-selection-index="1"] .m-selection-box');
    // (60, 390) is the visible box's corner plus (10, 10) in PDF units, which
    // at zoom 2 is (20, 20) on screen; the box is 40 by 40 points, so 80 by 80.
    expect(box?.getAttribute('x')).toBe('20');
    expect(box?.getAttribute('y')).toBe('20');
    expect(box?.getAttribute('width')).toBe('80');
    expect(box?.getAttribute('height')).toBe('80');
  });

  it('DRAWS A HANDLE ON EACH CORNER, centred on it and as wide as the select tool’s grab reach (ADR-0133)', () => {
    const { container } = render(<SelectionLayer geometry={GEOMETRY} page={3} selection={SELECTION} />);
    const handles = [...container.querySelectorAll('[data-selection-index="1"] [data-selection-handle=""]')];
    // EACH CENTRE IS A CORNER of the 80 × 80 box at (20, 20), so the handles sit where the tool's reach is measured
    // from. A handle drawn anywhere else would promise a resize the press there does not make.
    const centres = handles.map((handle) => [
      Number(handle.getAttribute('x')) + CORNER_REACH / 2,
      Number(handle.getAttribute('y')) + CORNER_REACH / 2,
    ]);
    expect(centres).toStrictEqual([
      [20, 20],
      [100, 20],
      [20, 100],
      [100, 100],
    ]);
    expect(handles.every((handle) => handle.getAttribute('width') === String(CORNER_REACH))).toBe(true);
  });

  it('a BOX-SHAPED mark also gets a handle at each side’s midpoint, and a line gets none', () => {
    const { container } = render(<SelectionLayer geometry={GEOMETRY} page={3} selection={SELECTION} />);
    const sides = [...container.querySelectorAll('[data-selection-handle]:not([data-selection-handle=""])')].map(
      (handle) => [
        handle.getAttribute('data-selection-handle'),
        Number(handle.getAttribute('x')) + CORNER_REACH / 2,
        Number(handle.getAttribute('y')) + CORNER_REACH / 2,
      ],
    );
    expect(sides).toStrictEqual([
      ['top', 60, 20],
      ['bottom', 60, 100],
      ['left', 20, 60],
      ['right', 100, 60],
    ]);
    const line = { ...SELECTION, items: SELECTION.items.map((item) => ({ ...item, kind: 'line' as const })) };
    const again = render(<SelectionLayer geometry={GEOMETRY} page={3} selection={line} />);
    expect(again.container.querySelectorAll('[data-selection-handle]').length).toBe(4);
  });

  it('draws NOTHING on a page the selection is not on', () => {
    // One layer per page slot and one selection per document, so every slot but
    // its own must render nothing — not an empty surface, which is an element
    // over the page that can go wrong silently.
    const { container } = render(
      <SelectionLayer geometry={GEOMETRY} page={4} selection={SELECTION} />,
    );
    expect(container.querySelector('[data-selection-layer]')).toBeNull();
  });

  it('draws nothing at all with no selection', () => {
    const { container } = render(
      <SelectionLayer geometry={GEOMETRY} page={3} selection={undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('is hidden from assistive technology, because the selection is not the fact', () => {
    // The boxes are an affordance over the page; what is selected is announced
    // by the controls that act on it, and a screen reader meeting eight
    // unlabelled rectangles learns nothing.
    const { container } = render(
      <SelectionLayer geometry={GEOMETRY} page={3} selection={SELECTION} />,
    );
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws a selected line’s handles on its two ENDS, and no box corners (the owner’s O8)', () => {
    const [square] = SELECTION.items;
    if (square === undefined) throw new Error('no item');
    const line: AnnotationSelection = {
      ...SELECTION,
      items: [{ ...square, kind: 'measure-distance', points: [{ x: 60, y: 350 }, { x: 150, y: 351 }] }],
    };
    const { container } = render(<SelectionLayer geometry={GEOMETRY} page={3} selection={line} />);
    const handles = [...container.querySelectorAll('[data-selection-handle]')];
    expect(handles.map((handle) => handle.getAttribute('data-selection-handle'))).toStrictEqual(['point-0', 'point-1']);
    // CENTRED ON THE ENDS, as the select tool grabs them: (60,350) is screen (20,100), (150,351) is (200,98).
    expect(handles.map((handle) => [Number(handle.getAttribute('x')) + CORNER_REACH / 2, Number(handle.getAttribute('y')) + CORNER_REACH / 2])).toStrictEqual([
      [20, 100],
      [200, 98],
    ]);
    // CONTROL: the square in the same fixture keeps its four corners, so the ends replaced them only where there are ends.
    const box = render(<SelectionLayer geometry={GEOMETRY} page={3} selection={SELECTION} />);
    expect(box.container.querySelectorAll('[data-selection-handle=""]')).toHaveLength(4);
  });

  it('LEAVES OUT the mark a drag is reshaping, which the drag draws where it goes — and only that mark (R7)', () => {
    const [square] = SELECTION.items;
    if (square === undefined) throw new Error('no item');
    const two: AnnotationSelection = {
      ...SELECTION,
      items: [
        { ...square, index: 1, kind: 'measure-distance', points: [{ x: 60, y: 350 }, { x: 150, y: 351 }] },
        { ...square, index: 2 },
      ],
    };
    const { container } = render(<SelectionLayer geometry={GEOMETRY} leaving={1} page={3} selection={two} />);
    expect([...container.querySelectorAll('[data-selection-index]')].map((group) => group.getAttribute('data-selection-index'))).toStrictEqual(['2']);
    expect(container.querySelectorAll('[data-selection-handle^="point-"]')).toHaveLength(0);
    // CONTROL: with no drag both are drawn, the line's ends among them.
    const both = render(<SelectionLayer geometry={GEOMETRY} page={3} selection={two} />);
    expect(both.container.querySelectorAll('[data-selection-index]')).toHaveLength(2);
    expect(both.container.querySelectorAll('[data-selection-handle^="point-"]')).toHaveLength(2);
  });

  it('draws a selected LINK where the link layer draws it, with all eight handles (the owner’s O6(c))', () => {
    // The engine's box at scale 1 from the crop's top-left: drawn at (200,20) to (300,60) at zoom 2, as `LinkLayer` places it.
    const link = {
      page: 3,
      version: asDocVersion(8),
      index: 2,
      link: { kind: 'external' as const, uri: 'https://example.org/', bounds: { x0: 100, y0: 10, x1: 150, y1: 30 }, outline: 'thin' as const },
    };
    const { container } = render(<SelectionLayer geometry={GEOMETRY} link={link} page={3} selection={undefined} />);
    const box = container.querySelector('[data-selection-kind="link"] .m-selection-box');
    expect([box?.getAttribute('x'), box?.getAttribute('y'), box?.getAttribute('width'), box?.getAttribute('height')]).toStrictEqual(['200', '20', '100', '40']);
    expect(container.querySelectorAll('[data-selection-kind="link"] [data-selection-handle]')).toHaveLength(8);
    // CONTROL: on another page the same link draws nothing at all.
    const elsewhere = render(<SelectionLayer geometry={GEOMETRY} link={link} page={2} selection={undefined} />);
    expect(elsewhere.container.firstChild).toBeNull();
  });
});
