// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
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
  return { content: <p>{content}</p>, label, width: 224, minWidth: 192, maxWidth: 1600, maxShare: 35, open: true, onWidthChange };
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

  it('a SHUT side draws neither its content nor its handle, and is still a pane', () => {
    render(
      <Wrapped>
        <Splitter
          start={fixed('start pane', RESIZE_START)}
          middle={<p>middle pane</p>}
          end={{ ...fixed('end pane', RESIZE_END), open: false }}
        />
      </Wrapped>,
    );

    expect(screen.queryByText('end pane')).toBeNull();
    expect(screen.queryByRole('separator', { name: 'Resize the end pane' })).toBeNull();
    // ONE HANDLE, the open side's: a handle beside a shut pane would resize a width nobody can see.
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    // STILL THREE PANES — the property the commit-level case below depends on, asserted where it is set.
    expect(document.querySelectorAll('.m-splitter__pane')).toHaveLength(3);
  });

  it('a side shut leaves the start pane its share IN THE COMMIT THAT SHUTS IT', async () => {
    // FOUND ON CI 35002592538 (ubuntu-latest): the rendered case measured the left pane 81.92 px wider right after
    // the right panel collapsed. The machine re-syncs its size list from a React effect, and a commit that renders a
    // DIFFERENT pane set before that re-sync indexes the old list with the new panes: the surviving shares no longer
    // sum to 100, and every pane widens. happy-dom lays nothing out, so the root's width is stubbed — the machine
    // resolves nothing for a zero root — and the shares are read off the panes' own flex-grow, which is what the
    // browser lays out from.
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement): DOMRect {
        const width = this.classList.contains('m-splitter') ? 1000 : 0;
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) };
      });
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
    // OUTSIDE act(), which flushes every effect before it returns and would hide the very commit under test.
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const row = (endOpen: boolean): ReactElement => (
      <Wrapped>
        <Splitter
          start={{ ...fixed('start pane', RESIZE_START), width: 240 }}
          middle={<p>middle pane</p>}
          end={{ ...fixed('end pane', RESIZE_END), width: 300, open: endOpen }}
        />
      </Wrapped>
    );
    const grows = (): number[] =>
      [...host.querySelectorAll<HTMLElement>('.m-splitter__pane')].map((pane) => Number.parseFloat(pane.style.flexGrow));
    const startShare = (): number => {
      const all = grows();
      return (all[0] ?? Number.NaN) / all.reduce((total, grow) => total + grow, 0);
    };
    try {
      flushSync(() => {
        root.render(row(true));
      });
      // RESOLVED FIRST: the machine starts in a microtask and resolves sizes after it, so wait for the stored 240 px
      // of a 1000 px root to arrive as a 24 share before the change under test.
      await vi.waitFor(() => {
        expect(grows()).toHaveLength(3);
        expect(startShare()).toBeCloseTo(0.24, 3);
      });

      flushSync(() => {
        root.render(row(false));
      });
      // READ IN THE SAME TASK as the commit, which is what a paint or a layout read after it can see.
      expect(startShare(), `pane flex-grow after the end pane shut: ${grows().join(', ')}`).toBeCloseTo(0.24, 3);
    } finally {
      flushSync(() => {
        root.unmount();
      });
      host.remove();
      if (actEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
      else environment.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
      rect.mockRestore();
    }
  });

  it('a side is DRAWN no wider than its share of the row, whatever width was stored (the owner, 2026-09-26)', async () => {
    // A width written on a wide monitor, read in a 1000 px row: 700 px stored, 35% allowed. The control is a stored
    // width inside the share, drawn as stored — a splitter that ignored the share would draw 0.70, and one that
    // always drew the share would draw 0.35 for the control too.
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement): DOMRect {
        const width = this.classList.contains('m-splitter') ? 1000 : 0;
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) };
      });
    const share = async (stored: number): Promise<number> => {
      const view = render(
        <Wrapped>
          <Splitter start={{ ...fixed('start pane', RESIZE_START), width: stored }} middle={<p>middle pane</p>} />
        </Wrapped>,
      );
      let result = Number.NaN;
      await vi.waitFor(() => {
        const grows = [...document.querySelectorAll<HTMLElement>('.m-splitter__pane')].map((pane) =>
          Number.parseFloat(pane.style.flexGrow),
        );
        // RESOLVED, not merely rendered: the machine resolves sizes in a microtask after it starts, and before that
        // every pane reads a zero grow.
        expect(grows).toHaveLength(2);
        expect(grows[0] ?? 0).toBeGreaterThan(0);
        result = (grows[0] ?? Number.NaN) / grows.reduce((total, grow) => total + grow, 0);
      });
      view.unmount();
      return result;
    };
    try {
      expect(await share(700)).toBeCloseTo(0.35, 2);
      expect(await share(240)).toBeCloseTo(0.24, 2);
    } finally {
      rect.mockRestore();
    }
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
