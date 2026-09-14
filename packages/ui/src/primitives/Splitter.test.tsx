// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, PANEL_RESIZE } from '../messages/en.js';
import { Splitter } from './Splitter.js';

/**
 * What a component test CAN see of a splitter, and what it cannot.
 *
 * happy-dom lays nothing out, so every element measures 0 and the machine resolves no pixel size
 * (`parsePanelSize` returns nothing for a zero root). A resize cannot be observed here, and a case
 * pretending otherwise would pass for a splitter that never moves. The drag, the keyboard step and
 * the width surviving a reload belong to the rendered test against the production build.
 *
 * What is here is the part that does not need layout: the handle a person operates, named and
 * oriented, the two panes, and that nothing is written when no resize has happened.
 */

beforeAll(() => {
  activateCatalogue('en', EN);
});

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe('Splitter', () => {
  it('renders ONE separator named by its label, horizontal, between the two panes', () => {
    render(
      <Wrapped>
        <Splitter
          label={PANEL_RESIZE}
          width={224}
          minWidth={192}
          maxWidth={480}
          onWidthChange={() => undefined}
          start={<p>start pane</p>}
          end={<p>end pane</p>}
        />
      </Wrapped>,
    );

    const handles = screen.getAllByRole('separator');
    expect(handles).toHaveLength(1);
    const handle = screen.getByRole('separator', { name: 'Resize the document panel' });
    // HORIZONTAL is what keeps the injected cursor inside ADR-0066's three hashes.
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    // Keyboard-operable: the machine's own step is the keyboard resize.
    expect(handle.getAttribute('tabindex')).toBe('0');

    const start = screen.getByText('start pane');
    const end = screen.getByText('end pane');
    // In DOCUMENT order, start then the handle then end: a handle after both panes would resize
    // nothing a person can see.
    expect(start.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('writes NOTHING when no resize has happened', () => {
    const onWidthChange = vi.fn();
    render(
      <Wrapped>
        <Splitter
          label={PANEL_RESIZE}
          width={224}
          minWidth={192}
          maxWidth={480}
          onWidthChange={onWidthChange}
          start={<p>start pane</p>}
          end={<p>end pane</p>}
        />
      </Wrapped>,
    );
    // A mount that reported a width would write the stored value back on every launch — or, with
    // no layout, write a width of nothing.
    expect(onWidthChange).not.toHaveBeenCalled();
  });
});
