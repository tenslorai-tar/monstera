// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId } from '@monstera/shared';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentTabs } from './DocumentTabs.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';

const FIRST = asDocId('00000000-0000-4000-8000-00000000000a');
const SECOND = asDocId('00000000-0000-4000-8000-00000000000b');

const TABS = [
  { docId: FIRST, name: 'annual.pdf' },
  { docId: SECOND, name: 'notes.pdf' },
];

const NOTHING = {
  onSelect: (): void => undefined,
  onClose: (): void => undefined,
  onOpen: (): void => undefined,
};

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** The one element a selector must find, or a named failure. */
function only<T extends Element>(container: HTMLElement, selector: string, kind: new () => T): T {
  const found = container.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`the strip renders ${selector}`);
  return found;
}

describe('DocumentTabs', () => {
  it('renders one tab per document and marks the ACTIVE one', () => {
    // TWO TABS AND THE SECOND SELECTED. A fixture with one tab cannot tell a
    // strip that marks the active document from one that marks every tab, and
    // selecting the FIRST cannot tell it from one that marks index 0.
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={TABS} activeId={SECOND} />
      </Wrapped>,
    );

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('false');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.m-tab-current')?.getAttribute('data-tab')).toBe(SECOND);
  });

  it('SELECTS BY DOCUMENT ID, not by position', () => {
    // The separating assertion. An id and an index agree on the first tab for
    // ever, and they stop agreeing the moment a tab before it closes — at
    // which point an index-dispatching strip switches to a different document
    // than the one under the pointer, silently.
    const selected = vi.fn();
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={TABS} activeId={FIRST} onSelect={selected} />
      </Wrapped>,
    );

    only(container, `[data-tab-select="${SECOND}"]`, HTMLButtonElement).click();

    expect(selected).toHaveBeenCalledWith(SECOND);
  });

  it('offers a close control on EVERY tab, named with the file it closes', () => {
    // Two things at once, and both are a11y rather than decoration: a strip of
    // identical "Close" buttons is a strip a screen-reader user cannot
    // navigate, and hiding the control on the last tab would make the only
    // open document the one that cannot be put down.
    const closed = vi.fn();
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={TABS} activeId={FIRST} onClose={closed} />
      </Wrapped>,
    );

    const control = only(container, `[data-tab-close="${SECOND}"]`, HTMLButtonElement);
    expect(control.getAttribute('aria-label')).toBe('Close notes.pdf');
    control.click();

    expect(closed).toHaveBeenCalledWith(SECOND);
    expect(container.querySelectorAll('[data-tab-close]')).toHaveLength(2);
  });

  it('renders NOTHING with no documents open', () => {
    // The control for every case above: an empty strip over the start screen
    // is a region that describes nothing, and a `tablist` with no tabs is one
    // a screen reader still announces.
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={[]} activeId={undefined} />
      </Wrapped>,
    );

    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
