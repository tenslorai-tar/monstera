// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Loupe } from './Loupe.js';
import type { DocumentView } from './documentView.js';

/** Every rasterisation, as `[pdfjsPage, scale]`. */
const rasterised: [number, number][] = [];

vi.mock('./renderPage.js', () => ({
  renderPage: (_document: unknown, pdfjsPage: number, _canvas: unknown, scale: number) => {
    rasterised.push([pdfjsPage, scale]);
    return Promise.resolve({ width: 600 * scale, height: 800 * scale });
  },
}));

beforeEach(() => {
  rasterised.length = 0;
});

function view(): DocumentView {
  return { document: { numPages: 4 }, close: () => Promise.resolve() } as unknown as DocumentView;
}

describe('Loupe', () => {
  it('RASTERISES AT THE MAGNIFIED SCALE, rather than scaling up the pages bitmap', () => {
    // THE WHOLE POINT. Blowing up the canvas the spine already drew magnifies
    // its pixels, which is what a loupe exists not to do — a reader reaches for
    // one to see detail the page's own resolution does not carry.
    //
    // devicePixelRatio is 1 in happy-dom, so at zoom 1.5 the expected scale is
    // 1 * 1.5 * 2. Asserting the product rather than a literal is what keeps
    // this case meaningful if the magnification changes.
    render(<Loupe view={view()} page={2} zoom={1.5} at={{ x: 10, y: 20 }} />);

    expect(rasterised).toStrictEqual([[3, 3]]);
  });

  it('asks for the page the pointer is over, in PDF.js numbering', () => {
    // Page 2 zero-based is page 3 to PDF.js. A loupe that passed the index
    // would magnify the page after the one under the pointer, which is the
    // off-by-one this build has shipped once.
    render(<Loupe view={view()} page={0} zoom={1} at={{ x: 0, y: 0 }} />);
    expect(rasterised[0]?.[0]).toBe(1);
  });

  it('does NOT re-rasterise when only the pointer moves', () => {
    // Moving the pointer must be a transform, not a render — otherwise the
    // loupe re-draws the page on every mouse event, which is the cost that
    // makes a magnifier unusable rather than merely slow.
    const held = view();
    const { rerender } = render(<Loupe view={held} page={0} zoom={1} at={{ x: 10, y: 10 }} />);
    rerender(<Loupe view={held} page={0} zoom={1} at={{ x: 90, y: 40 }} />);

    expect(rasterised).toHaveLength(1);
  });

  it('re-rasterises when the ZOOM changes, because the magnified page changed', () => {
    // The control for the case above: a component that never re-rendered would
    // satisfy "does not re-rasterise on a move" perfectly, and would show a
    // stale magnification after every zoom step.
    const held = view();
    const { rerender } = render(<Loupe view={held} page={0} zoom={1} at={{ x: 10, y: 10 }} />);
    rerender(<Loupe view={held} page={0} zoom={2} at={{ x: 10, y: 10 }} />);

    expect(rasterised.map(([, scale]) => scale)).toStrictEqual([2, 4]);
  });

  it('draws nothing before the parser is open', () => {
    render(<Loupe view={undefined} page={0} zoom={1} at={{ x: 0, y: 0 }} />);
    expect(rasterised).toStrictEqual([]);
  });

  it('is hidden from assistive technology, because it follows a pointer', () => {
    // It is decoration over the document and cannot be reached by keyboard;
    // announcing it would describe a magnified copy of text the reader is
    // already on.
    const { container } = render(<Loupe view={view()} page={0} zoom={1} at={{ x: 0, y: 0 }} />);
    expect(container.querySelector('.m-loupe')?.getAttribute('aria-hidden')).toBe('true');
  });
});
