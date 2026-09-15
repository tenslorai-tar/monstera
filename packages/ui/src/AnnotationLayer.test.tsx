// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnnotationLayer } from './AnnotationLayer.js';
import type { PageAnnotation } from './usePageAnnotations.js';

/**
 * The layer that draws existing annotations over their page.
 *
 * `SelectionLayer.test`'s fixture on purpose: a non-zero crop origin and a zoom that is not 1, so a
 * layer passing PDF numbers straight through fails rather than coincides. (60, 390) is the box's
 * visible corner plus (10, 10) in PDF units, which at zoom 2 is (20, 20) on screen; the box is 40 by
 * 40 points, so 80 by 80.
 */

const GEOMETRY = {
  crop: [50, 100, 250, 400] as readonly [number, number, number, number],
  rotation: 0 as const,
  zoom: 2,
};

const RECT = { x0: 60, y0: 350, x1: 100, y1: 390 };

const REDACT: PageAnnotation = { index: 2, kind: 'redact', rect: RECT };

describe('AnnotationLayer', () => {
  it('draws a Redact mark as a SOLID preview over the region it covers, in the layer’s own pixels', () => {
    const { container } = render(<AnnotationLayer annotations={[REDACT]} geometry={GEOMETRY} page={3} />);
    const preview = container.querySelector('[data-annotation-index="2"] .m-redact-preview');
    expect(preview).not.toBeNull();
    expect(
      ['x', 'y', 'width', 'height'].map((attribute) => preview?.getAttribute(attribute)),
    ).toStrictEqual(['20', '20', '80', '80']);
  });

  it('CONTROL: a kind the page raster already draws gets nothing, at the same rectangle', () => {
    // WITHOUT THIS the case above passes for a layer that draws every annotation — which would paint a
    // black box over every square a person drew. The kind is what decides, so it is the only thing
    // this fixture changes.
    const { container } = render(
      <AnnotationLayer annotations={[{ ...REDACT, kind: 'square' }]} geometry={GEOMETRY} page={3} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('draws only the kinds with a renderer when a page carries both', () => {
    const { container } = render(
      <AnnotationLayer
        annotations={[{ index: 0, kind: 'square', rect: RECT }, REDACT]}
        geometry={GEOMETRY}
        page={3}
      />,
    );
    expect(
      [...container.querySelectorAll('[data-annotation-kind]')].map((node) => node.getAttribute('data-annotation-kind')),
    ).toStrictEqual(['redact']);
  });

  it('draws nothing at all for a page with no marks, or a mark with no region', () => {
    // NOTHING RATHER THAN AN EMPTY SURFACE, `SelectionLayer`'s rule: an element over the page that
    // draws nothing is a thing that can go wrong silently.
    expect(render(<AnnotationLayer annotations={[]} geometry={GEOMETRY} page={3} />).container.firstChild).toBeNull();
    expect(
      render(<AnnotationLayer annotations={[{ ...REDACT, rect: null }]} geometry={GEOMETRY} page={3} />).container
        .firstChild,
    ).toBeNull();
    expect(
      render(<AnnotationLayer annotations={undefined} geometry={GEOMETRY} page={3} />).container.firstChild,
    ).toBeNull();
  });

  it('is hidden from assistive technology', () => {
    const { container } = render(<AnnotationLayer annotations={[REDACT]} geometry={GEOMETRY} page={3} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
