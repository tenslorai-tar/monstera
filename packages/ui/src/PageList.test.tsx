// @vitest-environment happy-dom
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageList } from './PageList.js';
import type { DocumentView } from './documentView.js';

/**
 * The scroller, driven through a stubbed `IntersectionObserver`.
 *
 * ## Why the observer is a double here, and what that costs
 *
 * happy-dom exposes the constructor and never calls back: it has no layout, so
 * nothing is ever visible and every case would assert about a list that drew
 * nothing. Stubbing it lets a case say *page 4 came into view* and watch what
 * follows, which is the whole behaviour.
 *
 * **What that cannot say** is that the real browser reports the right elements
 * as visible, or that the margin covers what a scroll reaches. Those are
 * properties of a layout engine and belong to `proof:canvaspixels`' territory —
 * a real Chromium — which this file does not stand in for. What it holds is
 * the logic between *told a page is visible* and *the page is drawn*, which is
 * where the state machine lives.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000ff');
const VERSION = asDocVersion(1);

/** Every observer built during a case, with the callback it was given. */
let observers: { callback: IntersectionObserverCallback; observed: Element[] }[] = [];

beforeEach(() => {
  observers = [];
  // A browser API happy-dom exposes and never fires. Typed through the global's
  // own declaration rather than `any`, so a signature this stub gets wrong is a
  // compile error here instead of a case that passes against a double the real
  // component could not use.
  //
  // The full `IntersectionObserver` interface carries `root`, `rootMargin`,
  // `scrollMargin`, `thresholds` and `takeRecords`, none of which this component
  // reads. The double implements what is used and the cast says so in one place
  // rather than each member being optional — which would let the component start
  // reading one and this stub keep passing.
  const target: { IntersectionObserver: typeof IntersectionObserver } = globalThis;
  target.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ callback, observed: [] });
    }
    observe(element: Element): void {
      observers[observers.length - 1]?.observed.push(element);
    }
    unobserve(): void {
      // Nothing here reads the unobserved set; `disconnect` is what a case cares
      // about and it is the one the component calls on teardown.
    }
    disconnect(): void {
      // Recorded by absence: a leaked observer keeps firing into an unmounted
      // tree, which React reports as a state update on an unmounted component.
    }
  } as unknown as typeof IntersectionObserver;
});

/** Tells the newest observer that these pages entered or left. */
function report(entries: readonly { page: number; visible: boolean }[]): void {
  const live = observers[observers.length - 1];
  if (live === undefined) throw new Error('no observer was constructed');
  const targets = entries.map(({ page, visible }) => {
    const element = live.observed.find(
      (candidate) => candidate instanceof HTMLElement && candidate.dataset['page'] === String(page),
    );
    if (element === undefined) throw new Error(`page ${String(page)} has no observed slot`);
    return { target: element, isIntersecting: visible } as unknown as IntersectionObserverEntry;
  });
  live.callback(targets, {} as unknown as IntersectionObserver);
}

/**
 * A view whose parser records which pages were ASKED FOR.
 *
 * **`getPage` and not `render`**, and the distinction is happy-dom's rather than
 * a preference: its canvas has no 2d context, so `renderPage` throws before it
 * reaches `render` and a case counting draws counts zero however correct the
 * component is. `getPage` is the first thing a draw does and the last one this
 * environment can observe.
 *
 * The pixels are `proof:canvaspixels`' claim, in real Chromium. What is asserted
 * here is *which pages this component decided to draw*, which is the decision
 * under test.
 */
function viewDrawing(asked: (pdfjsPage: number) => void): DocumentView {
  return {
    document: {
      numPages: 5,
      getPage: (pageNumber: number) => {
        asked(pageNumber);
        return Promise.resolve({
          getViewport: () => ({ width: 100, height: 200 }),
          render: () => ({ promise: Promise.resolve() }),
          pageNumber,
        });
      },
    },
    close: () => Promise.resolve(),
  } as unknown as DocumentView;
}

function clientAnswering(): { client: ContractClient; asked: unknown[] } {
  const asked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.viewModel') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    const pages = (params as { pages: readonly number[] }).pages;
    return Promise.resolve(
      ok({ version: VERSION, pageCount: 5, rotations: pages.map(() => 0) }),
    );
  });
  return { client, asked };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PageList', () => {
  it('renders a slot for every page before anything is drawn', async () => {
    const { client } = clientAnswering();
    const { container } = render(
      <PageList
        client={client}
        view={undefined}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
      />,
    );
    await settle();

    // FIVE SLOTS AND NO PARSER. The scrollbar describes the document from the
    // first frame rather than growing as pages arrive, which is the property
    // that makes a long document usable while it opens.
    expect(container.querySelectorAll('.m-page-slot')).toHaveLength(5);
  });

  it('draws only the pages reported visible, not every page', async () => {
    const drawn = vi.fn();
    const { client } = clientAnswering();
    const { container } = render(
      <PageList
        client={client}
        view={viewDrawing(drawn)}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
      />,
    );
    await settle();

    // The first page is seeded visible, so exactly one page is asked for before
    // anything scrolls. A list that rasterised its whole document would ask for
    // five, which is the defect lazy rendering exists to prevent.
    //
    // PDF.js NUMBERS FROM 1, so the first page is `1`. Asserting the converted
    // number is what catches an off-by-one that a count alone would miss — and
    // this build has shipped that off-by-one once.
    expect(drawn.mock.calls).toStrictEqual([[1]]);
    expect(container.querySelectorAll('canvas.m-page')).toHaveLength(1);
  });

  it('draws a page when it comes into view, and RELEASES it when it leaves', async () => {
    const drawn = vi.fn();
    const { client } = clientAnswering();
    const { container } = render(
      <PageList
        client={client}
        view={viewDrawing(drawn)}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
      />,
    );
    await settle();

    await act(async () => {
      report([{ page: 3, visible: true }]);
      await Promise.resolve();
    });
    await settle();
    expect(container.querySelectorAll('canvas.m-page')).toHaveLength(2);

    // THE RELEASE IS THE MEMORY STORY, and it is what separates this from a
    // viewer that holds every page the reader has passed. The canvas is
    // unmounted rather than cleared: clearing keeps the element and its backing
    // store, which is the bitmap.
    await act(async () => {
      report([{ page: 3, visible: false }]);
      await Promise.resolve();
    });
    await settle();
    expect(container.querySelectorAll('canvas.m-page')).toHaveLength(1);
  });

  it('asks the view model for the pages it is ABOUT TO DRAW, never all of them', async () => {
    const { client, asked } = clientAnswering();
    render(
      <PageList
        client={client}
        view={viewDrawing(vi.fn())}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
      />,
    );
    await settle();

    // L11: one rotation per page scales with the document, so a read of the
    // whole vector is a document-sized payload on the path a renderer takes
    // after every command. The first read names the seeded page and nothing
    // else.
    expect(asked).toStrictEqual([{ docId: DOC, pages: [0] }]);

    await act(async () => {
      report([{ page: 2, visible: true }]);
      await Promise.resolve();
    });
    await settle();

    // AND THE SECOND READ NAMES ONLY THE NEW PAGE. A component that re-read
    // every visible page on each change would grow its payload with the scroll
    // position, which is L11's defect arriving gradually.
    expect(asked).toStrictEqual([
      { docId: DOC, pages: [0] },
      { docId: DOC, pages: [2] },
    ]);
  });

  it('reports the topmost visible page as the current one', async () => {
    const current = vi.fn();
    const { client } = clientAnswering();
    render(
      <PageList
        client={client}
        view={viewDrawing(vi.fn())}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={current}
      />,
    );
    await settle();
    expect(current).toHaveBeenLastCalledWith(0);

    await act(async () => {
      report([
        { page: 0, visible: false },
        { page: 2, visible: true },
        { page: 3, visible: true },
      ]);
      await Promise.resolve();
    });
    await settle();

    // TOPMOST, not last-reported: entries arrive in whatever order the browser
    // batched them, and a component that took the last would report the page a
    // reader is scrolling towards rather than the one they are on.
    expect(current).toHaveBeenLastCalledWith(2);
  });
});
