// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Thumbnails } from './Thumbnails.js';
import type { DocumentView } from './documentView.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

/**
 * The thumbnail strip.
 *
 * ## The observer is stubbed, and everything is reported visible
 *
 * happy-dom fires no intersections, so nothing would ever be drawn and every
 * case would assert about an empty strip. `useVisiblePages` seeds the first
 * page visible, which is what these cases rely on — the lazy behaviour itself
 * belongs to `PageList.test.tsx`, which drives the same hook through a
 * controllable double, and duplicating it here would be a second set of
 * assertions about one mechanism.
 */

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
  const target: { IntersectionObserver: typeof IntersectionObserver } = globalThis;
  target.IntersectionObserver = class {
    observe(): void {
      // Never fires; the hook's seed is what makes the first page draw.
    }
    unobserve(): void {
      // Unused here.
    }
    disconnect(): void {
      // Unused here.
    }
  } as unknown as typeof IntersectionObserver;
});

function view(): DocumentView {
  return { document: { numPages: 4 }, close: () => Promise.resolve() } as unknown as DocumentView;
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe('Thumbnails', () => {
  it('renders a control per page, named by the number a person reads', () => {
    const { container } = render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(4);
    // PDF.JS'S NUMBERING, which is what a reader sees. Asserting the converted
    // label is what catches an off-by-one that a count alone would miss, and
    // this build has shipped that off-by-one once.
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toStrictEqual([
      'Page 1',
      'Page 2',
      'Page 3',
      'Page 4',
    ]);
  });

  it('CLICKING JUMPS, with the zero-based index the kernel counts in', () => {
    // The whole reason a thumbnail is a button: a strip that only displayed
    // would be the display-only defect. And the number matters — the label
    // says "Page 3" and the jump says 2, which is the correspondence
    // `pageNumbering.ts` owns.
    const jump = vi.fn();
    const { container } = render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={0} onJump={jump} />
      </Wrapped>,
    );

    container.querySelectorAll('button')[2]?.click();
    expect(jump).toHaveBeenCalledWith(2);
  });

  it('marks the page the reader is on, and marks only that one', () => {
    const { container } = render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={2} onJump={vi.fn()} />
      </Wrapped>,
    );

    const marked = [...container.querySelectorAll('button')].filter(
      (button) => button.getAttribute('aria-current') === 'true',
    );
    // ONE, not "at least one": a strip that marked everything is as useless as
    // one that marked nothing, and only a count separates them.
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute('aria-label')).toBe('Page 3');
  });

  it('draws only what is visible, and at a scale that fits the column', () => {
    render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );

    // ONE PAGE, not four. A strip that rasterised its whole document at open is
    // the cost lazy rendering exists to prevent, and with four pages the
    // difference is visible in this list.
    expect(rasterised.map(([page]) => page)).toStrictEqual([1]);
    // Scale 1 first, because the page's own size is what the fitting scale is
    // computed from — a strip that assumed a size would be wrong for every
    // document that is not the one it was written against.
    expect(rasterised[0]?.[1]).toBe(1);
  });

  it('draws NOTHING before the parser is open', () => {
    // The control for the case above: `[1]` is only meaningful if a strip with
    // no view produces `[]` rather than the same list for a different reason.
    render(
      <Wrapped>
        <Thumbnails view={undefined} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );

    expect(rasterised).toStrictEqual([]);
  });
});
