// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type RenderResult, render as renderBare } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AnnotationLayer, labelPlace } from './AnnotationLayer.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import type { PageAnnotation } from './usePageAnnotations.js';

/** The catalogue around the layer, as the application mounts it: a mark's label is a message. */
function Wrapped({ children }: { readonly children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(element: ReactElement): RenderResult {
  return renderBare(element, { wrapper: Wrapped });
}

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

/** The placed box of one drawn annotation, in the layer's own pixels, as the four numbers the layer wrote. */
function placed(item: Element | null): readonly string[] {
  const style = (item as HTMLElement | null)?.style;
  return [style?.insetInlineStart, style?.insetBlockStart, style?.inlineSize, style?.blockSize].map(String);
}

describe('AnnotationLayer', () => {
  it('draws a Redact mark as a PENDING mark over the region it covers, in the layer’s own pixels', () => {
    const { container } = render(<AnnotationLayer annotations={[REDACT]} geometry={GEOMETRY} page={3} />);
    const item = container.querySelector('[data-annotation-index="2"]');
    expect(item?.querySelector('.m-redact-mark')).not.toBeNull();
    expect(placed(item)).toStrictEqual(['20px', '20px', '80px', '80px']);
  });

  it('LABELS the mark *Marked for redaction*, so a mark cannot be read as a finished redaction', () => {
    // THE OWNER'S ITEM N1. The words are the catalogue's, through the renderer — a label nobody can read would be
    // the solid box this replaced with a caption nobody sees.
    const { container } = render(<AnnotationLayer annotations={[REDACT]} geometry={GEOMETRY} page={3} />);
    const label = container.querySelector('[data-annotation-index="2"] [data-annotation-label]');
    expect(label?.textContent).toBe('Marked for redaction');
  });

  it('CONTROL: a kind the page raster already draws gets nothing, at the same rectangle', () => {
    // WITHOUT THIS the cases above pass for a layer that draws every annotation — which would paint a
    // redaction mark over every square a person drew. The kind is what decides, so it is the only thing
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

  it('is hidden from assistive technology, label and all', () => {
    const { container } = render(<AnnotationLayer annotations={[REDACT]} geometry={GEOMETRY} page={3} />);
    expect(container.querySelector('[data-annotation-layer]')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('labelPlace', () => {
  const LABEL = { width: 110, height: 15 };

  it('puts the label ON a mark it fits', () => {
    expect(labelPlace({ top: 200, width: 300, height: 40 }, LABEL)).toBe('inside');
  });

  it('draws NO label on a mark too narrow for it — one marked word — rather than over the words beside it', () => {
    expect(labelPlace({ top: 200, width: 60, height: 40 }, LABEL)).toBe('none');
  });

  it('draws NO label on a mark too short for it — one marked line — rather than over the line above', () => {
    expect(labelPlace({ top: 200, width: 300, height: 12 }, LABEL)).toBe('none');
  });

  it('fits EXACTLY at its own size, the boundary', () => {
    expect(labelPlace({ top: 0, width: 110, height: 15 }, LABEL)).toBe('inside');
    expect(labelPlace({ top: 0, width: 109.5, height: 15 }, LABEL)).toBe('none');
  });
});
