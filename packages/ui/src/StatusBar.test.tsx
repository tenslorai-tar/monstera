// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { StatusBar } from './StatusBar.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe('StatusBar', () => {
  it('reports the page number a PERSON reads, not the index that crosses the contract', () => {
    // THE SEPARATING CASE for this surface. Page 4 of 10 is index 3, and a
    // status bar that printed the index would be off by one on every document —
    // silently, because "Page 3 of 10" is a perfectly plausible thing to read.
    const { container } = render(
      <Wrapped>
        <StatusBar page={3} pageCount={10} zoom={1} />
      </Wrapped>,
    );

    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 4 of 10');
  });

  it('shows the zoom as a percentage, rounded for display', () => {
    // A fit resolves to something like 1.3361, and 133.61% is not a thing a
    // reader wants. The rounding is here rather than upstream so nothing
    // downstream can pick it up — a stored 134% would be a zoom the renderer
    // then draws at.
    const { container } = render(
      <Wrapped>
        <StatusBar page={0} pageCount={1} zoom={1.3361} />
      </Wrapped>,
    );

    expect(container.querySelector('.m-status-zoom')?.textContent).toBe('134%');
  });

  it('is announced POLITELY, because the page number changes on every scroll', () => {
    // `role="status"` is polite by definition; an assertive region would
    // interrupt a screen-reader user several times a second to tell them
    // something they can ask for. Asserting the role rather than the attribute
    // because the role is what assistive technology reads.
    const { container } = render(
      <Wrapped>
        <StatusBar page={0} pageCount={1} zoom={1} />
      </Wrapped>,
    );

    const bar = container.querySelector('[role="status"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-live')).toBeNull();
  });
});
