// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { Splitter, type FixedPane } from './Splitter.js';

/**
 * What a component test CAN see of a splitter, and what it cannot.
 *
 * happy-dom lays nothing out, so every element measures 0 and the machine resolves no pixel size
 * (`parsePanelSize` returns nothing for a zero root). A resize cannot be observed here, and a case
 * pretending otherwise would pass for a splitter that never moves. The drag, the keyboard step and
 * a width surviving a reload belong to the rendered cases against the production build.
 *
 * What is here needs no layout: the handles a person operates, named, oriented and between the
 * right panes, and that nothing is written when no resize has happened.
 */

const RESIZE_START = messageKey('test.splitter.resize-start');
const RESIZE_END = messageKey('test.splitter.resize-end');

beforeAll(() => {
  activateCatalogue('en', { [RESIZE_START]: 'Resize the start pane', [RESIZE_END]: 'Resize the end pane' });
});

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function fixed(content: string, label: FixedPane['label'], onWidthChange = (): void => undefined): FixedPane {
  return { content: <p>{content}</p>, label, width: 224, minWidth: 192, maxWidth: 480, onWidthChange };
}

/** Whether `a` comes before `b` in document order. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('Splitter', () => {
  it('START + MIDDLE: one separator, named, horizontal, focusable, between the two panes', () => {
    render(
      <Wrapped>
        <Splitter start={fixed('start pane', RESIZE_START)} middle={<p>middle pane</p>} />
      </Wrapped>,
    );

    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const handle = screen.getByRole('separator', { name: 'Resize the start pane' });
    // HORIZONTAL is what keeps the injected cursor inside ADR-0066's three hashes.
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('tabindex')).toBe('0');
    expect(precedes(screen.getByText('start pane'), handle)).toBe(true);
    expect(precedes(handle, screen.getByText('middle pane'))).toBe(true);
  });

  it('START + MIDDLE + END: two separators, each named by its OWN fixed pane, in order', () => {
    render(
      <Wrapped>
        <Splitter
          start={fixed('start pane', RESIZE_START)}
          middle={<p>middle pane</p>}
          end={fixed('end pane', RESIZE_END)}
        />
      </Wrapped>,
    );

    expect(screen.getAllByRole('separator')).toHaveLength(2);
    const startHandle = screen.getByRole('separator', { name: 'Resize the start pane' });
    const endHandle = screen.getByRole('separator', { name: 'Resize the end pane' });
    // A handle named after the wrong pane is one a screen reader describes as resizing the other
    // side — the order below and the names above are asserted together for that reason.
    const order = [
      screen.getByText('start pane'),
      startHandle,
      screen.getByText('middle pane'),
      endHandle,
      screen.getByText('end pane'),
    ];
    order.slice(1).forEach((node, index) => {
      const before = order[index];
      expect(before === undefined ? false : precedes(before, node)).toBe(true);
    });
  });

  it('MIDDLE + END: the handle is the end pane\'s, before it', () => {
    render(
      <Wrapped>
        <Splitter middle={<p>middle pane</p>} end={fixed('end pane', RESIZE_END)} />
      </Wrapped>,
    );

    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const handle = screen.getByRole('separator', { name: 'Resize the end pane' });
    expect(precedes(screen.getByText('middle pane'), handle)).toBe(true);
    expect(precedes(handle, screen.getByText('end pane'))).toBe(true);
  });

  it('writes NOTHING when no resize has happened', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(
      <Wrapped>
        <Splitter
          start={fixed('start pane', RESIZE_START, onStart)}
          middle={<p>middle pane</p>}
          end={fixed('end pane', RESIZE_END, onEnd)}
        />
      </Wrapped>,
    );
    // A mount that reported a width would write the stored value back on every launch — or, with no
    // layout, write a width of nothing.
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
