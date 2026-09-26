// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { PageScopeChoice } from './PageScopeChoice.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('PageScopeChoice — the pages a page dialog acts on (ADR-0104)', () => {
  it('COUNTS the pages it was opened for, and says "This page" for one', () => {
    render(<PageScopeChoice className="x" pages={[0, 3, 4]} every={false} onChange={() => undefined} />, { wrapper: Wrapped });
    expect(screen.getByRole('button', { name: 'These 3 pages' })).toBeDefined();
    cleanup();

    // CONTROL: one page reads as the words the seven dialogs used before, so nothing changes where nothing is ticked.
    render(<PageScopeChoice className="x" pages={[2]} every={false} onChange={() => undefined} />, { wrapper: Wrapped });
    expect(screen.getByRole('button', { name: 'This page' })).toBeDefined();
  });

  it('EXPOSES the choice as a pressed state in a named group, not as a style alone', () => {
    render(<PageScopeChoice className="x" pages={[1, 2]} every onChange={() => undefined} />, { wrapper: Wrapped });
    expect(screen.getByRole('group', { name: 'Pages' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'All pages' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'These 2 pages' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the OTHER choice, and nothing for the one already held', () => {
    const chosen: boolean[] = [];
    render(
      <PageScopeChoice
        className="x"
        pages={[1, 2]}
        every
        onChange={(every) => {
          chosen.push(every);
        }}
      />,
      { wrapper: Wrapped },
    );
    fireEvent.click(screen.getByRole('button', { name: 'All pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'These 2 pages' }));
    expect(chosen).toStrictEqual([false]);
  });
});
