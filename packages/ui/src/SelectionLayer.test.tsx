// @vitest-environment happy-dom
import { asDocVersion } from '@monstera/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AnnotationSelection } from './annotations/selectTool.js';
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
      // Carried by the selection for the comment styles panel; this layer draws
      // the box and reads nothing of it.
      style: { colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
    },
  ],
};

describe('SelectionLayer', () => {
  it('draws the selected box in the overlay’s own pixels', () => {
    const { container } = render(
      <SelectionLayer geometry={GEOMETRY} page={3} selection={SELECTION} />,
    );
    const box = container.querySelector('[data-selection-index="1"]');
    // (60, 390) is the visible box's corner plus (10, 10) in PDF units, which
    // at zoom 2 is (20, 20) on screen; the box is 40 by 40 points, so 80 by 80.
    expect(box?.getAttribute('x')).toBe('20');
    expect(box?.getAttribute('y')).toBe('20');
    expect(box?.getAttribute('width')).toBe('80');
    expect(box?.getAttribute('height')).toBe('80');
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
});
