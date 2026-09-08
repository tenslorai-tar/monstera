// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import {
  type ContractClient,
  MAX_TEXT_LAYER_LINES,
  channels,
  createClient,
} from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { render as renderBare, act } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageList } from './PageList.js';
import { FIRST_PAGE } from './pageNumbering.js';
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
    return Promise.resolve({
      width: 100 * scale,
      height: 200 * scale,
      // THE CROP AND THE ROTATION, which this mock did not return until
      // 2026-09-08 — `RasterisedPage` declares both and `vi.mock`'s factory is
      // untyped, so a stub narrower than the interface compiled. Nothing read
      // them: the two overlays that do are mounted only while a drawing tool is
      // active, and no case here activates one. The text layer is mounted
      // whenever a page has been measured, and it threw on the first run.
      //
      // The page is 100 x 200 CSS pixels at scale 1, so its box in PDF units is
      // the same numbers — which is what makes the two conversions compose to
      // the identity here and lets a placement case assert the box it sent.
      crop: [0, 0, 100, 200] as const,
      rotation: 0,
    });
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

/**
 * The scroller's two reads, answered.
 *
 * `document.pageTextLayer` is here because the scroller asks for the selectable
 * text of every visible page — and a stub that threw on it would make every
 * case in this file a test of an unhandled rejection. `textAsked` records what
 * it was asked for, which is what the wired pair's UI half asserts: that the
 * layer is driven by the channel rather than by anything this component made up.
 *
 * The lines are canned and their boxes are the identity in display space, so a
 * case can assert placement against numbers it chose.
 */
function clientAnswering(
  lines: readonly { text: string; box: { x0: number; y0: number; x1: number; y1: number } }[] = [],
): { client: ContractClient; asked: unknown[]; textAsked: unknown[] } {
  const asked: unknown[] = [];
  const textAsked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id === 'document.pageTextLayer') {
      textAsked.push(params);
      return Promise.resolve(ok({ version: VERSION, lines, truncated: false }));
    }
    if (id !== 'document.viewModel') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    const pages = (params as { pages: readonly number[] }).pages;
    return Promise.resolve(
      ok({ version: VERSION, pageCount: 5, rotations: pages.map(() => 0) }),
    );
  });
  return { client, asked, textAsked };
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
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

  /**
   * The text layer, and this is the UI half of §10.4's wired pair.
   *
   * The kernel half is `textLayer.test.ts` — that the flattening is right and
   * bounded. Neither alone counts: a kernel proof alone is a channel nobody
   * calls, and a rendered layer alone could be a component drawing whatever it
   * invented. What these assert is that the lines on screen came from
   * `document.pageTextLayer`, and were placed with the boxes it sent.
   */
  const LINES = [
    { text: 'the first line', box: { x0: 10, y0: 20, x1: 110, y1: 32 } },
    { text: 'the second line', box: { x0: 10, y0: 40, x1: 90, y1: 52 } },
  ];

  it('asks the CHANNEL for each visible page’s text, rather than inventing it', async () => {
    const { client, textAsked } = clientAnswering(LINES);
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
      />,
    );
    await settle();

    // ONE PAGE, AND IT IS THE VISIBLE ONE, zero-based as every page index
    // crossing the contract is. A layer that fetched the whole document would
    // ask for five — the same defect lazy rasterisation exists to prevent, and
    // the payload here is larger than a bitmap request.
    expect(textAsked).toStrictEqual([
      { docId: DOC, page: 0, limit: MAX_TEXT_LAYER_LINES },
    ]);
  });

  it('renders one selectable element per line, carrying the channel’s text', async () => {
    const { client } = clientAnswering(LINES);
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
      />,
    );
    await settle();

    const rendered = [...container.querySelectorAll('.m-text-line')].map((el) => el.textContent);
    // THE TEXT ITSELF, not a count. A count passes for a layer that rendered
    // two empty elements, which is what a component drawing its own idea of the
    // page would produce — and an empty selectable layer copies nothing while
    // looking exactly like a working one.
    expect(rendered).toStrictEqual(['the first line', 'the second line']);
  });

  it('places a line at the box the channel sent, converted through the page', async () => {
    const { client } = clientAnswering(LINES);
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
      />,
    );
    await settle();

    const first = container.querySelector('.m-text-line');
    if (!(first instanceof HTMLElement)) throw new Error('a line was rendered');
    // AT SCALE 1 AND ROTATION 0 the two conversions compose to the identity, so
    // the box the channel sent is the box on screen — which is what makes this
    // assertable against numbers the test chose rather than against whatever the
    // component computed. The rotated case is the kernel's, in `pageText.test.ts`,
    // where a real engine is available to disagree.
    expect({
      left: first.style.left,
      top: first.style.top,
      width: first.style.width,
      height: first.style.height,
    }).toStrictEqual({ left: '10px', top: '20px', width: '100px', height: '12px' });
  });

  it('mounts NO layer for a page with no text, rather than an empty one', async () => {
    const { client } = clientAnswering([]);
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
      />,
    );
    await settle();

    // An empty layer would still accept pointer events, so it would swallow
    // drags meant for the page while offering nothing to select. *Absent* is
    // checkable in a way *inert* is not.
    expect(container.querySelectorAll('.m-text-layer')).toHaveLength(0);
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
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
      startAt: FIRST_PAGE.kernel,
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
      search: undefined,
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
        startAt={FIRST_PAGE.kernel}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={false}
          showGrid={false}
          unit="in"
          search={undefined}
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
        startAt={FIRST_PAGE.kernel}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false}
            unit="in"
            search={undefined}
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
        startAt={FIRST_PAGE.kernel}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false}
            unit="in"
            search={undefined}
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
        startAt={FIRST_PAGE.kernel}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false}
            unit="in"
            search={undefined}
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
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
        search={undefined}
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
