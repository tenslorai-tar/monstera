// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { render as renderBare, act } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageList } from './PageList.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import type { DocumentView } from './documentView.js';
import type { ZoomMode } from './zoom.js';

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

/**
 * The catalogue, because the scroller resolves a name for itself.
 *
 * It takes one only in a split view — the sole scroller on screen is the
 * document surface and needs no name — but the hook is called either way, and
 * `useLingui` throws without a provider. That is `Button`'s trade rather than
 * this file's: a `MessageKey` resolved through the hook re-renders on a locale
 * change, where the module-level resolver would not.
 */
function Messages({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

/**
 * Explicit scales, so a case that is not about fitting says so.
 *
 * The fit modes are exercised in `zoom.test.ts`, against the arithmetic, where
 * a case can state a box instead of arranging for one to be laid out.
 */
const SCALE_1: ZoomMode = { kind: 'scale', scale: 1 };
const SCALE_2: ZoomMode = { kind: 'scale', scale: 2 };

/** Every rasterisation, as `[pdfjsPage, scale]`. */
const rasterised: [number, number][] = [];

/**
 * MOCKED, because happy-dom implements no 2d context.
 *
 * The real `renderPage` refuses before it draws, so a page never reports a size
 * and every slot stays unstyled — which makes the zoom cases assert about an
 * empty string. Mocking it also puts the number these cases are about in reach:
 * **the scale handed to the rasteriser** is E1's whole claim, and it is not
 * observable from a canvas that cannot be drawn into.
 *
 * The size returned is the viewport at that scale, so a page drawn at 2x has
 * twice the bitmap — which is what makes the CSS ratio meaningful.
 */
vi.mock('./renderPage.js', () => ({
  renderPage: (_document: unknown, pdfjsPage: number, _canvas: unknown, scale: number) => {
    rasterised.push([pdfjsPage, scale]);
    return Promise.resolve({ width: 100 * scale, height: 200 * scale });
  },
}));

/** Every observer built during a case, with the callback it was given. */
let observers: { callback: IntersectionObserverCallback; observed: Element[] }[] = [];

beforeEach(() => {
  observers = [];
  rasterised.length = 0;
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
  // A SECOND BROWSER API HAPPY-DOM DOES NOT FIRE, and a missing one would make
  // the component throw at mount rather than fail a case — which reads as a
  // broken test file rather than as a scroller that cannot measure itself.
  // Nothing here reports a size: every case in this file uses an explicit
  // scale, so the viewport stays unmeasured and `resolveZoom` answers from the
  // mode alone. The fit arithmetic is `zoom.test.ts`'s subject.
  const resize: { ResizeObserver: typeof ResizeObserver } = globalThis;
  resize.ResizeObserver = class {
    observe(): void {
      // Deliberately silent; see above.
    }
    unobserve(): void {
      // Not called by this component, which disconnects instead.
    }
    disconnect(): void {
      // Recorded by absence, as with the intersection observer below.
    }
  };

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
function viewDrawing(): DocumentView {
  return {
    document: { numPages: 5 },
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

/**
 * Makes every slot record the page it was scrolled to.
 *
 * ## PER ELEMENT, not on the prototype, and the receiver comes for free
 *
 * happy-dom implements no scrolling, so the method has to be supplied either
 * way. Patching each slot lets the recorder close over the page it belongs to,
 * which means **the assertion is which page was scrolled to** rather than that
 * something was — and scrolling to *an* element proves nothing.
 *
 * It also avoids a recorder that reads its own `this`: a function with a `this`
 * parameter assigned to a DOM method is a scoping hazard the lint rules refuse,
 * and here there is nothing to gain by arguing with them.
 */
function recordScrolls(container: HTMLElement): number[] {
  const scrolled: number[] = [];
  for (const slot of container.querySelectorAll('.m-page-slot')) {
    const page = Number(slot instanceof HTMLElement ? (slot.dataset['page'] ?? '-1') : '-1');
    const target: { scrollIntoView?: () => void } = slot;
    target.scrollIntoView = (): void => {
      scrolled.push(page);
    };
  }
  return scrolled;
}

/**
 * The CSS width the drawn page is SHOWN at.
 *
 * Throws rather than asserting non-null: a case that finds no canvas has not
 * observed a stretch of zero, it has failed to reach the state it is about, and
 * `undefined.style` would blame the wrong line.
 */
function shownWidth(container: HTMLElement): string {
  const canvas = container.querySelector<HTMLElement>('canvas.m-page');
  if (canvas === null) throw new Error('no page was drawn');
  return canvas.style.width;
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
        mode={SCALE_1}
        onZoom={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
      />,
    );
    await settle();

    // FIVE SLOTS AND NO PARSER. The scrollbar describes the document from the
    // first frame rather than growing as pages arrive, which is the property
    // that makes a long document usable while it opens.
    expect(container.querySelectorAll('.m-page-slot')).toHaveLength(5);
  });

  it('draws only the pages reported visible, not every page', async () => {
    const { client } = clientAnswering();
    const { container } = render(
      <PageList
        client={client}
        view={viewDrawing()}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
        mode={SCALE_1}
        onZoom={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
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
    expect(rasterised).toStrictEqual([[1, 1]]);
    expect(container.querySelectorAll('canvas.m-page')).toHaveLength(1);
  });

  it('draws a page when it comes into view, and RELEASES it when it leaves', async () => {
    const { client } = clientAnswering();
    const { container } = render(
      <PageList
        client={client}
        view={viewDrawing()}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
        mode={SCALE_1}
        onZoom={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
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
        view={viewDrawing()}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
        mode={SCALE_1}
        onZoom={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
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

  it('SCROLLS TO a requested page, and reports the request consumed', async () => {
    // The UI half of the navigation pair. `navigationCommands.test.ts` proves
    // which page each command asks for; this proves the ask reaches the slot
    // for that page.
    //
    // MOUNTED WITH NO REQUEST FIRST, which does two things at once: it gives
    // the recorder real slots to attach to, and it makes the scroll observably
    // a consequence of the REQUEST rather than of mounting. The control below
    // is what that buys.
    const { client } = clientAnswering();
    const wentTo = vi.fn();
    const props = {
      client,
      view: viewDrawing(),
      pageCount: 5,
      docId: DOC,
      version: VERSION,
      onCurrentPage: vi.fn(),
      mode: SCALE_1,
      onZoom: vi.fn(),
      onShownZoom: vi.fn(),
      onWentTo: wentTo,
      loupe: false,
      rulers: false,
      showGrid: false,
      unit: 'in' as const,
    };
    const { container, rerender } = render(<PageList {...props} goTo={undefined} />);
    await settle();

    const scrolled = recordScrolls(container);
    expect(scrolled).toStrictEqual([]);

    await act(async () => {
      rerender(<PageList {...props} goTo={3} />);
      await Promise.resolve();
    });

    // PAGE 3, not merely something. A component that scrolled to the first slot
    // would satisfy "it scrolled" and be wrong about the only thing that
    // matters.
    expect(scrolled).toStrictEqual([3]);
    // CONSUMED, so the next unrelated render does not scroll again. A case that
    // only checked the scroll would pass for a component that re-fired the
    // request for ever.
    expect(wentTo).toHaveBeenCalledTimes(1);
  });

  describe('two-tier zoom', () => {
    /**
     * The first tier: the bitmap is stretched, the page is NOT redrawn.
     *
     * E1 permits a stale bitmap *only transiently* during a gesture, so the two
     * halves are one property — it must stretch, and it must not rasterise. A
     * case asserting only the CSS size would pass for a viewer that redrew on
     * every step, which is the cost the stretch exists to avoid.
     */
    it('stretches immediately and does NOT re-rasterise', async () => {
      const { client } = clientAnswering();
      // ONE VIEW OBJECT ACROSS BOTH RENDERS. A fresh one each time changes the
      // prop's identity and re-runs the draw effect, which would make this case
      // report a re-rasterisation the component did not choose. `App` holds the
      // view in state, so a stable identity is what it actually passes.
      const view = viewDrawing();
      const { container, rerender } = render(
        <PageList
          client={client}
          view={view}
          pageCount={5}
          docId={DOC}
          version={VERSION}
          onCurrentPage={vi.fn()}
          mode={SCALE_1}
          onZoom={vi.fn()}
          onShownZoom={vi.fn()}
          goTo={undefined}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={false}
          showGrid={false}
          unit="in"
        />,
      );
      await settle();
      expect(rasterised).toHaveLength(1);

      const before = shownWidth(container);

      await act(async () => {
        rerender(
          <PageList
            client={client}
            view={view}
            pageCount={5}
            docId={DOC}
            version={VERSION}
            onCurrentPage={vi.fn()}
            mode={SCALE_2}
            onZoom={vi.fn()}
            onShownZoom={vi.fn()}
            goTo={undefined}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false}
            unit="in"
          />,
        );
        await Promise.resolve();
      });

      const after = shownWidth(container);
      // TWICE THE CSS SIZE, SAME NUMBER OF RASTERISATIONS. The stub renders a
      // 100x200 viewport at scale 1, so the page shows 100px at zoom 1 and
      // 200px at zoom 2 — from the bitmap that already existed.
      expect(before).toBe('100px');
      expect(after).toBe('200px');
      expect(rasterised).toHaveLength(1);
    });

    it('re-rasterises once the zoom has settled, at devicePixelRatio x zoom', async () => {
      vi.useFakeTimers();
      try {
            const { client } = clientAnswering();
        const view = viewDrawing();
        const { rerender } = render(
          <PageList
            client={client}
            view={view}
            pageCount={5}
            docId={DOC}
            version={VERSION}
            onCurrentPage={vi.fn()}
            mode={SCALE_1}
            onZoom={vi.fn()}
            onShownZoom={vi.fn()}
            goTo={undefined}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false}
            unit="in"
          />,
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        rerender(
          <PageList
            client={client}
            view={view}
            pageCount={5}
            docId={DOC}
            version={VERSION}
            onCurrentPage={vi.fn()}
            mode={SCALE_2}
            onZoom={vi.fn()}
            onShownZoom={vi.fn()}
            goTo={undefined}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false}
            unit="in"
          />,
        );

        // BEFORE THE INTERVAL: still the stretched bitmap.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(140);
        });
        expect(rasterised).toHaveLength(1);

        // AFTER IT: drawn again. The two assertions either side of 150 ms are
        // what make this a debounce rather than "it eventually redraws".
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20);
        });
        expect(rasterised).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('reports the topmost visible page as the current one', async () => {
    const current = vi.fn();
    const { client } = clientAnswering();
    render(
      <PageList
        client={client}
        view={viewDrawing()}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={current}
        mode={SCALE_1}
        onZoom={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
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
