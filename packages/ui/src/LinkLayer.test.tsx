// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { HOVER_ADDRESS_MAX, LinkLayer, hoverAddress } from './LinkLayer.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import type { PageLinkOnPage } from './usePageLinks.js';

/**
 * The links drawn on a page (ADR-0167 Decision 1): where each sits, what it is called, and what a press hands on.
 *
 * The UI half of the feature's pair. `followLink.test.ts` holds what the route does with a link handed on, and the
 * kernel and `main` halves hold that the place names one link and that only `main` opens it.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const INTERNAL: PageLinkOnPage = { kind: 'internal', page: 4, bounds: { x0: 10, y0: 20, x1: 110, y1: 40 }, outline: 'thin' };
const EXTERNAL: PageLinkOnPage = {
  kind: 'external',
  uri: 'https://example.org/thing',
  bounds: { x0: 50, y0: 100, x1: 150, y1: 120 },
  outline: 'thin',
};

function draw(
  links: readonly PageLinkOnPage[],
  options: { readonly outlined?: boolean; readonly rotation?: number; readonly onFollow?: () => void } = {},
): ReturnType<typeof render> {
  return render(
    <Wrapped>
      <LinkLayer
        page={3}
        links={links}
        geometry={{ crop: [0, 0, 300, 400], rotation: options.rotation ?? 0, zoom: 2 }}
        outlined={options.outlined ?? false}
        onFollow={options.onFollow ?? vi.fn()}
      />
    </Wrapped>,
  );
}

function linkAt(container: HTMLElement, index: number): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-page-link="${String(index)}"]`);
}

describe('LinkLayer', () => {
  it('draws each link OVER ITS RECTANGLE, at the zoom on show', () => {
    const { container } = draw([INTERNAL]);
    const style = linkAt(container, 0)?.style;
    // 10..110 by 20..40 at zoom 2. A layer that forgot the zoom would put a link over the wrong words at every zoom
    // but 100%.
    expect([style?.left, style?.top, style?.width, style?.height]).toStrictEqual(['20px', '40px', '200px', '40px']);
  });

  it('CONTROL: a TURNED page places the box where an unturned one does, since the engine reports it turned', () => {
    // The engine's display space is the page as turned. A layer that took the box as PDF points and turned it would
    // put a link on a turned page across the wrong words, and this is the case that names the difference.
    const { container } = draw([INTERNAL], { rotation: 90 });
    const style = linkAt(container, 0)?.style;
    expect([style?.left, style?.top, style?.width, style?.height]).toStrictEqual(['20px', '40px', '200px', '40px']);
  });

  it('CONTROL: a box reported with its corners the other way round still has its size', () => {
    const reversed: PageLinkOnPage = { ...INTERNAL, bounds: { x0: 110, y0: 40, x1: 10, y1: 20 } };
    const style = linkAt(draw([reversed]).container, 0)?.style;
    expect([style?.left, style?.top, style?.width, style?.height]).toStrictEqual(['20px', '40px', '200px', '40px']);
  });

  it('names each link with where it goes: a page one-based, an address as it reads', () => {
    const { container } = draw([INTERNAL, EXTERNAL]);
    // LABELLED 5 FOR PAGE 4: a person reads one-based numbers and the contract carries zero-based ones.
    expect(linkAt(container, 0)?.getAttribute('aria-label')).toBe('Go to page 5');
    expect(linkAt(container, 1)?.getAttribute('aria-label')).toBe('Open https://example.org/thing');
  });

  it('a press hands on the link by ITS OWN page and place, and nothing else', () => {
    const follow = vi.fn();
    const { container } = draw([INTERNAL, EXTERNAL], { onFollow: follow });
    linkAt(container, 1)?.click();
    // A layer handing every press the first link's place would follow the wrong link on any page with two.
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith({ page: 3, index: 1, link: EXTERNAL });
  });

  it('is outlined only when asked, and draws nothing over a page with no links', () => {
    const reading = draw([INTERNAL]);
    expect(reading.container.querySelector('.m-link-layer--outlined')).toBeNull();
    expect(reading.container.querySelector('.m-link-layer')).not.toBeNull();
    reading.unmount();

    const commenting = draw([INTERNAL], { outlined: true });
    expect(commenting.container.querySelector('.m-link-layer--outlined')).not.toBeNull();
    commenting.unmount();

    expect(draw([]).container.querySelector('.m-link-layer')).toBeNull();
  });
});

describe('hoverAddress', () => {
  it('says an address whole up to the bound, and cuts only its END past it', () => {
    const exact = `https://example.org/${'a'.repeat(HOVER_ADDRESS_MAX - 20)}`;
    expect(exact).toHaveLength(HOVER_ADDRESS_MAX);
    expect(hoverAddress(exact)).toBe(exact);

    const long = `${exact}b`;
    const said = hoverAddress(long);
    expect(said).toHaveLength(HOVER_ADDRESS_MAX);
    // The scheme and host are what a person decides on, so the cut keeps the start.
    expect(said.startsWith('https://example.org/')).toBe(true);
    expect(said.endsWith('…')).toBe(true);
  });

  it('CONTROL: never splits a character, whether a surrogate pair or a joined emoji', () => {
    // A FAMILY is five code points and eight UTF-16 units joined into one character. A cut on units leaves half a
    // surrogate; a cut on code points leaves a family short of a member, or a joiner dangling.
    // Built from its code points: a zero-width joiner carried literally is invisible in a diff (`guardFiles.mjs`).
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const long = `https://example.org/${family.repeat(HOVER_ADDRESS_MAX)}`;
    const said = hoverAddress(long);
    expect(said).toBe(`https://example.org/${family.repeat(HOVER_ADDRESS_MAX - 21)}…`);
  });
});
