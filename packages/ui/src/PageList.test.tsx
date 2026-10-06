// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import {
  type ContractClient,
  MAX_TEXT_LAYER_LINES,
  channels,
  createClient,
} from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { render as renderBare, act, fireEvent } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageList } from './PageList.js';
import { FIRST_PAGE } from './pageNumbering.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import type { DocumentView } from './documentView.js';
import type { PageLayout } from './settings/viewing.js';
import { type ZoomMode, resolveZoom } from './zoom.js';

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
/** The rotation each rasterisation was handed, in the same order. */
const drawnAt: (number | undefined)[] = [];

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
vi.mock('./renderPage.js', async (importOriginal) => ({
  // THE REAL MODULE UNDER THE STUB, so `RenderCancelledError` is the class callers test against.
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  renderPage: (
    _document: unknown,
    pdfjsPage: number,
    _canvas: unknown,
    scale: number,
    rotation: number | undefined,
  ) => {
    rasterised.push([pdfjsPage, scale]);
    drawnAt.push(rotation);
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
  // A TILED PAGE IS MEASURED, NOT DRAWN: the same viewport as above, with nothing rasterised.
  pageGeometry: (_document: unknown, _pdfjsPage: number, scale: number) =>
    Promise.resolve({ width: 100 * scale, height: 200 * scale, crop: [0, 0, 100, 200] as const, rotation: 0 }),
  // A TILE'S DRAW, which happy-dom cannot perform; nothing here asserts a tile's pixels.
  renderRegion: () => Promise.resolve(),
}));

/**
 * How many times a list's BODY has run. `PageList` calls `useVisiblePages` once per render, so counting the calls
 * through the real hook counts the list's renders — and only the list's: a child that renders on its own state, as
 * the rulers' spans do on a scroll, is not one.
 */
const listRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./useVisiblePages.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useVisiblePages.js')>();
  return {
    ...actual,
    useVisiblePages: (...args: Parameters<typeof actual.useVisiblePages>): ReturnType<typeof actual.useVisiblePages> => {
      listRenders.count += 1;
      return actual.useVisiblePages(...args);
    },
  };
});

/** Every observer built during a case, with the callback it was given. */
let observers: { callback: IntersectionObserverCallback; observed: Element[] }[] = [];

beforeEach(() => {
  observers = [];
  rasterised.length = 0;
  drawnAt.length = 0;
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
  kind: 'text' | 'image-only' | 'empty' = 'text',
): { client: ContractClient; asked: unknown[]; textAsked: unknown[] } {
  const asked: unknown[] = [];
  const textAsked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id === 'document.pageTextLayer') {
      textAsked.push(params);
      return Promise.resolve(ok({ version: VERSION, lines, truncated: false, kind }));
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
      />,
    );
    await settle();

    // FIVE SLOTS AND NO PARSER. The scrollbar describes the document from the
    // first frame rather than growing as pages arrive, which is the property
    // that makes a long document usable while it opens.
    expect(container.querySelectorAll('.m-page-slot')).toHaveLength(5);
  });

  it('the HAND drags the pages: a press and a move set the scroll from where the press started', async () => {
    const { client } = clientAnswering();
    const drawList = (panning: boolean): ReturnType<typeof render> =>
      render(
        <PageList
          client={client}
          view={undefined}
          pageCount={5}
          docId={DOC}
          version={VERSION}
          onCurrentPage={vi.fn()}
          mode={SCALE_1}
          onZoomStep={vi.fn()}
          onShownZoom={vi.fn()}
          goTo={undefined}
          startAt={FIRST_PAGE.kernel}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={false}
          showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
          unit="in"
          search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
          secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
          menuAt={undefined}
          panning={panning}
        />,
      );
    // happy-dom has no pointer capture; the drag's arithmetic is what this case is about.
    HTMLElement.prototype.setPointerCapture = (): void => undefined;

    const { container, unmount } = drawList(true);
    await settle();
    const list = container.querySelector<HTMLElement>('.m-page-list');
    if (list === null) throw new Error('no page list rendered');
    expect(list.classList.contains('m-page-list--panning')).toBe(true);
    list.scrollTop = 300;
    list.scrollLeft = 40;
    fireEvent.pointerDown(list, { button: 0, clientX: 200, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(list, { clientX: 180, clientY: 380, pointerId: 1 });
    // DRAGGING UP BY 120 REVEALS WHAT IS BELOW: the scroll moves the other way from the pointer.
    expect(list.scrollTop).toBe(420);
    expect(list.scrollLeft).toBe(60);
    fireEvent.pointerUp(list, { pointerId: 1 });
    fireEvent.pointerMove(list, { clientX: 0, clientY: 0, pointerId: 1 });
    // RELEASED: a move after the press ends scrolls nothing.
    expect(list.scrollTop).toBe(420);
    unmount();

    // CONTROL: without the hand, the same press and move scroll nothing and mark no mode.
    const plain = drawList(false);
    await settle();
    const still = plain.container.querySelector<HTMLElement>('.m-page-list');
    if (still === null) throw new Error('no page list rendered');
    expect(still.classList.contains('m-page-list--panning')).toBe(false);
    still.scrollTop = 300;
    fireEvent.pointerDown(still, { button: 0, clientX: 200, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(still, { clientX: 180, clientY: 380, pointerId: 1 });
    expect(still.scrollTop).toBe(300);
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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

  it('PAGE SHARPNESS multiplies the DRAWING scale and never the shown size (E1’s explicit renderQuality)', async () => {
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined}
        tileAbove={2}
        quality={2}
        pageBadges={false}
        smoothScroll={false} layout="continuous"
        menuAt={undefined}
      />,
    );
    await settle();

    // TWICE THE PIXELS, at zoom 1 on a density of 1 — the factor and nothing else.
    expect(rasterised).toStrictEqual([[1, 2]]);
    // THE SAME SIZE ON SCREEN: the mock's page is 100 CSS pixels wide at zoom 1, whatever it was drawn at. A slot that
    // took the bitmap's width would show the page twice as large.
    const canvas = container.querySelector<HTMLCanvasElement>('canvas.m-page');
    expect(canvas?.style.width).toBe('100px');
  });

  it('PAGE NUMBERS ON PAGES: each slot carries its page’s place, 1-based as the status bar counts, and none when off', async () => {
    const drawnWith = async (pageBadges: boolean): Promise<HTMLElement> => {
      const { client } = clientAnswering();
      const { container, unmount } = render(
        <PageList
          client={client}
          view={viewDrawing()}
          pageCount={5}
          docId={DOC}
          version={VERSION}
          onCurrentPage={vi.fn()}
          mode={SCALE_1}
          onZoomStep={vi.fn()}
          onShownZoom={vi.fn()}
          goTo={undefined}
          startAt={FIRST_PAGE.kernel}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={false}
          showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
          unit="in"
          search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
          secondRasteriser={undefined}
          tileAbove={2}
          quality={1}
          pageBadges={pageBadges}
          smoothScroll={false} layout="continuous"
          menuAt={undefined}
        />,
      );
      await settle();
      const copy = container.cloneNode(true) as HTMLElement;
      unmount();
      return copy;
    };

    const on = await drawnWith(true);
    const badges = [...on.querySelectorAll('[data-page-badge]')];
    // EVERY SLOT, drawn or not — the number is the page's place, not a property of its bitmap.
    expect(badges.map((badge) => badge.textContent)).toStrictEqual(['1', '2', '3', '4', '5']);
    expect(badges.every((badge) => badge.getAttribute('aria-hidden') === 'true')).toBe(true);
    // CONTROL: off draws none.
    expect((await drawnWith(false)).querySelector('[data-page-badge]')).toBeNull();
  });

  it('PAGE SHARPNESS counts toward the TILE THRESHOLD, which bounds the canvas, not the zoom', async () => {
    const drawnWith = async (quality: number): Promise<HTMLElement> => {
      const { client } = clientAnswering();
      const { container, unmount } = render(
        <PageList
          client={client}
          view={viewDrawing()}
          pageCount={5}
          docId={DOC}
          version={VERSION}
          onCurrentPage={vi.fn()}
          mode={SCALE_1}
          onZoomStep={vi.fn()}
          onShownZoom={vi.fn()}
          goTo={undefined}
          startAt={FIRST_PAGE.kernel}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={false}
          showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
          unit="in"
          search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
          secondRasteriser={undefined}
          tileAbove={1.5}
          quality={quality}
          pageBadges={false}
          smoothScroll={false} layout="continuous"
          menuAt={undefined}
        />,
      );
      await settle();
      const copy = container.cloneNode(true) as HTMLElement;
      unmount();
      return copy;
    };

    // ZOOM 1 × SHARPNESS 2 is above 1.5: the page is measured, not drawn whole, and its slot holds the tiles.
    rasterised.length = 0;
    const sharp = await drawnWith(2);
    expect(sharp.querySelector('[data-page-tiles="0"]')).not.toBeNull();
    expect(sharp.querySelector('canvas.m-page')).toBeNull();
    expect(rasterised).toStrictEqual([]);
    // CONTROL: the same zoom at sharpness 1 is below 1.5, and draws the whole page — so the case above is the factor.
    const exact = await drawnWith(1);
    expect(exact.querySelector('canvas.m-page')).not.toBeNull();
    expect(exact.querySelector('[data-page-tiles]')).toBeNull();
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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

  /**
   * D6 row 1's UI half. The kernel half is `textLayer.test.ts`' pair of cases.
   *
   * What this asserts is that the note is driven by the CHANNEL's attribution
   * and not by the absence of lines, which is the thing a component could
   * plausibly decide for itself — and would then get wrong on the blank page,
   * offering an explanation for something that needs none.
   */
  it('says why a picture-only page has nothing to select', async () => {
    const { client } = clientAnswering([], 'image-only');
    const { container } = render(
      <PageList
        client={client}
        view={viewDrawing()}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
        mode={SCALE_1}
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
      />,
    );
    await settle();

    expect(container.querySelector('[data-page-note="0"]')?.textContent).toContain('picture');
  });

  it('CONTROL: a page with no text and no picture is left alone', async () => {
    // THE CASE THAT SEPARATES THE RULE FROM "there are no lines". Both pages
    // render an empty layer; only one of them is a page a reader is wondering
    // about. A note here would be an explanation of a blank page, which is the
    // wired-tools defect wearing a sentence.
    const { client } = clientAnswering([], 'empty');
    const { container } = render(
      <PageList
        client={client}
        view={viewDrawing()}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
        mode={SCALE_1}
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
      />,
    );
    await settle();

    expect(container.querySelector('[data-page-note="0"]')).toBeNull();
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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

  it('RE-READS the rotation when the version moves, so a rotate after opening is drawn', async () => {
    // A map that marks a page ANSWERED and is never cleared draws the rotation
    // a page had before the last command. The version is what says the model
    // moved, so a new version must re-ask for the pages on screen.
    let answering = VERSION;
    const turns = new Map([[1, 0], [2, 90]]);
    const asked: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      if (id === 'document.pageTextLayer') {
        return Promise.resolve(ok({ version: answering, lines: [], truncated: false, kind: 'text' as const }));
      }
      if (id !== 'document.viewModel') throw new Error(`unexpected channel ${id}`);
      asked.push(params);
      const pages = (params as { pages: readonly number[] }).pages;
      return Promise.resolve(
        ok({ version: answering, pageCount: 5, rotations: pages.map(() => turns.get(answering) ?? 0) }),
      );
    });
    const props = {
      client,
      pageCount: 5,
      docId: DOC,
      onCurrentPage: vi.fn(),
      mode: SCALE_1,
      onZoomStep: vi.fn(),
      onShownZoom: vi.fn(),
      goTo: undefined,
      startAt: FIRST_PAGE.kernel,
      onWentTo: vi.fn(),
      loupe: false,
      rulers: false,
      showGrid: false, onFollowLink: undefined, linksOutlined: false, onFillField: undefined,
      unit: 'in' as const,
      search: undefined, differences: undefined, spotlights: undefined, writing: undefined,
      secondRasteriser: undefined,
      tileAbove: 2,
      quality: 1,
      pageBadges: false,
      smoothScroll: false,
      layout: 'continuous' as const,
      menuAt: undefined,
    };
    const { rerender } = render(<PageList {...props} view={viewDrawing()} version={VERSION} />);
    await settle();
    expect(drawnAt.at(-1)).toBe(0);

    answering = asDocVersion(2);
    rerender(<PageList {...props} view={viewDrawing()} version={answering} />);
    await settle();

    expect(asked).toStrictEqual([
      { docId: DOC, pages: [0] },
      { docId: DOC, pages: [0] },
    ]);
    expect(drawnAt.at(-1)).toBe(90);
  });

  it('mounted MID-DOCUMENT, the pages above take the measured size too — so nothing grows above the reader', async () => {
    // A scroller mounting at page 3 draws page 3 first; the pages above had no estimate and sat
    // at the slot's minimum, then grew as they drew and pushed the revealed page down a page
    // (measured live 2026-09-18). The control is the slot BELOW, which always had its estimate.
    const { client } = clientAnswering();
    const { container } = render(
      <PageList
        startAt={2}
        client={client}
        view={viewDrawing()}
        pageCount={5}
        docId={DOC}
        version={VERSION}
        onCurrentPage={vi.fn()}
        mode={SCALE_1}
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
      />,
    );
    await settle();

    const heights = [...container.querySelectorAll<HTMLElement>('.m-page-slot')].map((slot) => slot.style.height);
    // PAGE 3 WAS DRAWN AND MEASURED, so it has a height of its own.
    expect(heights[2]).not.toBe('');
    // CONTROL: the page below takes page 3's estimate, as it always did.
    expect(heights[3]).toBe(heights[2]);
    // AND THE PAGES ABOVE DO NOW, which is the change.
    expect(heights[0]).toBe(heights[2]);
    expect(heights[1]).toBe(heights[2]);
  });

  it('reveals the page it MOUNTED at once a page is measured, even after `startAt` has moved', async () => {
    // THE INTERLEAVING THE LIVE APP HAS: the caller passes the reader's current page, and the new
    // scroller's own observer reports page 1 before the starting page is measured — so the prop
    // arrives as 0 on the next render. Read live, the reveal saw 0 and did nothing (traced
    // 2026-09-18). The recorder is attached BEFORE the measurement, so it sees the reveal itself.
    const { client } = clientAnswering();
    const props = {
      client,
      view: viewDrawing(),
      pageCount: 5,
      docId: DOC,
      version: VERSION,
      onCurrentPage: vi.fn(),
      mode: SCALE_1,
      onZoomStep: vi.fn(),
      onShownZoom: vi.fn(),
      goTo: undefined,
      onWentTo: vi.fn(),
      loupe: false,
      rulers: false,
      showGrid: false, onFollowLink: undefined, linksOutlined: false, onFillField: undefined,
      unit: 'in' as const,
      search: undefined, differences: undefined, spotlights: undefined, writing: undefined,
      secondRasteriser: undefined,
      tileAbove: 2,
      quality: 1,
      pageBadges: false,
      smoothScroll: false,
      layout: 'continuous' as const,
      menuAt: undefined,
    };
    const { container, rerender } = render(<PageList {...props} startAt={2} />);
    const scrolled = recordScrolls(container);
    rerender(<PageList {...props} startAt={0} />);
    await settle();

    expect(scrolled).toStrictEqual([2]);
  });

  it('a request PAST THE END lands on the last page — the reader deleted the page they were on', async () => {
    // App re-requests the reader's page after every edit, so deleting the page a reader is on
    // asks for one past the end. The top of the document is not where they were; the new last
    // page is. The case below is the control that an in-range request is not moved.
    const { client } = clientAnswering();
    const props = {
      startAt: FIRST_PAGE.kernel,
      client,
      view: viewDrawing(),
      pageCount: 5,
      docId: DOC,
      version: VERSION,
      onCurrentPage: vi.fn(),
      mode: SCALE_1,
      onZoomStep: vi.fn(),
      onShownZoom: vi.fn(),
      onWentTo: vi.fn(),
      loupe: false,
      rulers: false,
      showGrid: false, onFollowLink: undefined, linksOutlined: false, onFillField: undefined,
      unit: 'in' as const,
      search: undefined, differences: undefined, spotlights: undefined, writing: undefined,
      secondRasteriser: undefined,
      tileAbove: 2,
      quality: 1,
      pageBadges: false,
      smoothScroll: false,
      layout: 'continuous' as const,
      menuAt: undefined,
    };
    const { container, rerender } = render(<PageList {...props} goTo={undefined} />);
    await settle();
    const scrolled = recordScrolls(container);

    await act(async () => {
      rerender(<PageList {...props} goTo={5} />);
      await Promise.resolve();
    });

    expect(scrolled).toStrictEqual([4]);
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
      onZoomStep: vi.fn(),
      onShownZoom: vi.fn(),
      onWentTo: wentTo,
      loupe: false,
      rulers: false,
      showGrid: false, onFollowLink: undefined, linksOutlined: false, onFillField: undefined,
      unit: 'in' as const,
      search: undefined, differences: undefined, spotlights: undefined, writing: undefined,
      secondRasteriser: undefined,
      tileAbove: 2,
      quality: 1,
      pageBadges: false,
      smoothScroll: false,
      layout: 'continuous' as const,
      menuAt: undefined,
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

  it('SMOOTH SCROLLING glides to a requested page — and never while motion is reduced', async () => {
    /** The behaviour each go-to asked `scrollIntoView` for, given the setting and the root's motion. */
    const behaviourFor = async (smoothScroll: boolean, motion: 'full' | 'reduced'): Promise<unknown> => {
      document.documentElement.dataset['motion'] = motion;
      const { client } = clientAnswering();
      const props = {
        startAt: FIRST_PAGE.kernel,
        client,
        view: viewDrawing(),
        pageCount: 5,
        docId: DOC,
        version: VERSION,
        onCurrentPage: vi.fn(),
        mode: SCALE_1,
        onZoomStep: vi.fn(),
        onShownZoom: vi.fn(),
        onWentTo: vi.fn(),
        loupe: false,
        rulers: false,
        showGrid: false, onFollowLink: undefined, linksOutlined: false, onFillField: undefined,
        unit: 'in' as const,
        search: undefined, differences: undefined, spotlights: undefined, writing: undefined,
        secondRasteriser: undefined,
        tileAbove: 2,
        quality: 1,
        pageBadges: false,
        smoothScroll,
        layout: 'continuous' as const,
        menuAt: undefined,
      };
      const { container, rerender, unmount } = render(<PageList {...props} goTo={undefined} />);
      await settle();
      const asked: unknown[] = [];
      for (const slot of container.querySelectorAll<HTMLElement>('.m-page-slot')) {
        slot.scrollIntoView = (options?: boolean | ScrollIntoViewOptions): void => {
          asked.push(typeof options === 'object' ? options.behavior : options);
        };
      }
      await act(async () => {
        rerender(<PageList {...props} goTo={2} />);
        await Promise.resolve();
      });
      unmount();
      return asked[0];
    };

    expect(await behaviourFor(true, 'full')).toBe('smooth');
    // REDUCED MOTION WINS over the reader's choice, which is the platform's or the reader's own request for stillness.
    expect(await behaviourFor(true, 'reduced')).toBe('auto');
    // CONTROL: the setting off jumps whatever the motion — so the first line is the setting's doing.
    expect(await behaviourFor(false, 'full')).toBe('auto');
    delete document.documentElement.dataset['motion'];
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
          onZoomStep={vi.fn()}
          onShownZoom={vi.fn()}
          goTo={undefined}
        startAt={FIRST_PAGE.kernel}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={false}
          showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
          unit="in"
          search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
            onZoomStep={vi.fn()}
            onShownZoom={vi.fn()}
            goTo={undefined}
        startAt={FIRST_PAGE.kernel}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
            unit="in"
            search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
            onZoomStep={vi.fn()}
            onShownZoom={vi.fn()}
            goTo={undefined}
        startAt={FIRST_PAGE.kernel}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
            unit="in"
            search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
            onZoomStep={vi.fn()}
            onShownZoom={vi.fn()}
            goTo={undefined}
        startAt={FIRST_PAGE.kernel}
            onWentTo={vi.fn()}
            loupe={false}
            rulers={false}
            showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
            unit="in"
            search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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
        onZoomStep={vi.fn()}
        onShownZoom={vi.fn()}
        goTo={undefined}
        startAt={FIRST_PAGE.kernel}
        onWentTo={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
        unit="in"
        search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
        secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
        menuAt={undefined}
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

  describe('PAGE LAYOUT (viewing.page-layout)', () => {
    /** The props every layout case shares, at five pages and scale 1. */
    const layoutProps = (layout: PageLayout, extra: { onWentTo?: () => void; onShownZoom?: (z: number) => void; mode?: ZoomMode } = {}) => ({
      startAt: FIRST_PAGE.kernel,
      client: clientAnswering().client,
      view: viewDrawing(),
      pageCount: 5,
      docId: DOC,
      version: VERSION,
      onCurrentPage: vi.fn(),
      mode: extra.mode ?? SCALE_1,
      onZoomStep: vi.fn(),
      onShownZoom: extra.onShownZoom ?? vi.fn(),
      onWentTo: extra.onWentTo ?? vi.fn(),
      loupe: false,
      rulers: false,
      showGrid: false, onFollowLink: undefined, linksOutlined: false, onFillField: undefined,
      unit: 'in' as const,
      search: undefined, differences: undefined, spotlights: undefined, writing: undefined,
      secondRasteriser: undefined,
      tileAbove: 2,
      quality: 1,
      pageBadges: false,
      smoothScroll: false,
      layout,
      menuAt: undefined,
    });
    /** The pages whose slots are in the layout — not hidden. */
    const shownPages = (container: HTMLElement): number[] =>
      [...container.querySelectorAll<HTMLElement>('.m-page-slot')]
        .filter((slot) => !slot.hidden)
        .map((slot) => Number(slot.dataset['page']));
    const scrollerOf = (container: HTMLElement): HTMLElement => {
      const scroller = container.querySelector<HTMLElement>('.m-page-list');
      if (scroller === null) throw new Error('no scroller');
      return scroller;
    };

    it('SINGLE PAGE shows one page, and a request chooses which — CONTROL: continuous shows every page', async () => {
      const wentTo = vi.fn();
      const props = layoutProps('single', { onWentTo: wentTo });
      const { container, rerender } = render(<PageList {...props} goTo={undefined} />);
      await settle();
      expect(shownPages(container)).toStrictEqual([0]);

      await act(async () => {
        rerender(<PageList {...props} goTo={3} />);
        await Promise.resolve();
      });
      expect(shownPages(container)).toStrictEqual([3]);
      // CONSUMED, as a continuous request is.
      expect(wentTo).toHaveBeenCalledTimes(1);

      const continuous = render(<PageList {...layoutProps('continuous')} goTo={undefined} />);
      await settle();
      expect(shownPages(continuous.container)).toStrictEqual([0, 1, 2, 3, 4]);
    });

    it('SINGLE PAGE keeps the page the reader was on when the layout is chosen, not the first', async () => {
      const props = layoutProps('continuous');
      const { container, rerender } = render(<PageList {...props} goTo={undefined} />);
      await settle();
      await act(async () => {
        report([
          { page: 0, visible: false },
          { page: 2, visible: true },
          { page: 3, visible: true },
        ]);
        await Promise.resolve();
      });
      await act(async () => {
        rerender(<PageList {...props} layout="single" goTo={undefined} />);
        await Promise.resolve();
      });
      expect(shownPages(container)).toStrictEqual([2]);
    });

    it('SINGLE PAGE turns with a wheel past the page’s edge, once per gesture — CONTROL: continuous never turns', async () => {
      // happy-dom lays nothing out, so every scroll position is 0 of 0: the page is at its top AND its end, which is a
      // page shorter than the pane — where a wheel either way is past an edge.
      const { container } = render(<PageList {...layoutProps('single')} goTo={undefined} />);
      await settle();
      const scroller = scrollerOf(container);

      fireEvent.wheel(scroller, { deltaY: 100 });
      expect(shownPages(container)).toStrictEqual([1]);
      // THE SAME GESTURE'S NEXT EVENT does not turn again.
      fireEvent.wheel(scroller, { deltaY: 100 });
      expect(shownPages(container)).toStrictEqual([1]);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
      });
      fireEvent.wheel(scroller, { deltaY: -100 });
      expect(shownPages(container)).toStrictEqual([0]);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
      });
      // AND NOT BEFORE THE FIRST PAGE.
      fireEvent.wheel(scroller, { deltaY: -100 });
      expect(shownPages(container)).toStrictEqual([0]);

      const continuous = render(<PageList {...layoutProps('continuous')} goTo={undefined} />);
      await settle();
      fireEvent.wheel(scrollerOf(continuous.container), { deltaY: 100 });
      expect(shownPages(continuous.container)).toStrictEqual([0, 1, 2, 3, 4]);
    });

    describe('AUTOSCROLL (view.autoscroll at viewing.autoscroll-speed)', () => {
      /** Frames are run by hand, at times the case chooses, so the distance is the pace's and nothing else's. */
      let frames: FrameRequestCallback[] = [];
      beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
        vi.stubGlobal('cancelAnimationFrame', () => undefined);
      });
      afterEach(() => {
        vi.unstubAllGlobals();
      });
      const runFrame = (at: number): void => {
        const next = frames.shift();
        if (next === undefined) throw new Error('no frame was asked for');
        act(() => {
          next(at);
        });
      };
      /** A scroller `height` tall over content `total` tall — happy-dom lays nothing out. */
      const sized = (scroller: HTMLElement, height: number, total: number): void => {
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: height });
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: total });
      };
      const mount = async (
        layout: PageLayout,
        onEnd: () => void,
        // NO DEFAULT: an explicit `undefined` would take it, and the idle control below would run at 60.
        pace: number | undefined,
      ): Promise<{ scroller: HTMLElement; container: HTMLElement; rerender: (pace: number | undefined) => void }> => {
        const props = layoutProps(layout);
        const { container, rerender } = render(
          <PageList {...props} goTo={undefined} autoscroll={undefined} onAutoscrollEnd={onEnd} />,
        );
        await settle();
        const scroller = scrollerOf(container);
        sized(scroller, 500, 5000);
        const again = (next: number | undefined): void => {
          rerender(<PageList {...props} goTo={undefined} autoscroll={next} onAutoscrollEnd={onEnd} />);
        };
        // THIS MOUNT'S FRAMES ONLY: an earlier list in the same case is still mounted and still asking.
        frames = [];
        act(() => {
          again(pace);
        });
        return { scroller, container, rerender: again };
      };

      it('moves the pace times the time, carrying the fraction — CONTROL: not running, nothing moves', async () => {
        const end = vi.fn();
        const { scroller } = await mount('continuous', end, 60);
        runFrame(1000);
        runFrame(1500);
        // 60 px a second for half a second.
        expect(scroller.scrollTop).toBe(30);
        runFrame(1525);
        runFrame(1550);
        // 1.5 px a frame: one pixel, then the carried half and the next 1.5 make two. A scroller that dropped the
        // remainder after a move would be at 32 — with 0.6 px frames it was not separable, since a remainder kept
        // only below one pixel and one dropped only above it agree there (a mutation run found that).
        expect(scroller.scrollTop).toBe(33);
        expect(end).not.toHaveBeenCalled();

        const idle = await mount('continuous', vi.fn(), undefined);
        expect(frames).toHaveLength(0);
        expect(idle.scroller.scrollTop).toBe(0);
      });

      it('stops on Esc, a press and a wheel in the pane, and at the end of the last page', async () => {
        for (const stop of [
          () => fireEvent.keyDown(window, { key: 'Escape' }),
          (scroller: HTMLElement) => fireEvent.pointerDown(scroller),
          (scroller: HTMLElement) => fireEvent.wheel(scroller, { deltaY: 10 }),
        ]) {
          const end = vi.fn();
          const { scroller } = await mount('continuous', end, 60);
          stop(scroller);
          expect(end).toHaveBeenCalledTimes(1);
        }
        // CONTROL: another key is not Esc.
        const kept = vi.fn();
        await mount('continuous', kept, 60);
        fireEvent.keyDown(window, { key: 'a' });
        expect(kept).not.toHaveBeenCalled();

        const atEnd = vi.fn();
        const { scroller } = await mount('continuous', atEnd, 60);
        scroller.scrollTop = 4500;
        runFrame(0);
        expect(atEnd).toHaveBeenCalledTimes(1);
      });

      it('the Escape that stops it is SPENT, so the document’s shortcuts do not also act on it (CR-COR-11)', async () => {
        // IN FOCUS MODE the document's Escape is `view.leave-focus`: one press would stop the scroll and leave Focus.
        const heard: string[] = [];
        const listen = (event: KeyboardEvent): void => {
          heard.push(event.key);
        };
        document.addEventListener('keydown', listen);
        try {
          const end = vi.fn();
          await mount('continuous', end, 60);
          fireEvent.keyDown(document.body, { key: 'Escape' });
          expect(end).toHaveBeenCalledTimes(1);
          expect(heard).toStrictEqual([]);
          // CONTROL: a key the scroll does not use reaches the document while it runs.
          await mount('continuous', vi.fn(), 60);
          fireEvent.keyDown(document.body, { key: 'a' });
          expect(heard).toStrictEqual(['a']);
        } finally {
          document.removeEventListener('keydown', listen);
        }
      });

      it('in SINGLE PAGE the end of a page turns to the next, and it carries on', async () => {
        const end = vi.fn();
        const { scroller, container } = await mount('single', end, 60);
        scroller.scrollTop = 4500;
        runFrame(0);
        expect(shownPages(container)).toStrictEqual([1]);
        expect(scroller.scrollTop).toBe(0);
        expect(end).not.toHaveBeenCalled();
      });
    });

    it('FACING PAGES lays out in pairs and FITS A SPREAD — CONTROL: continuous fits one page', async () => {
      // NARROW ENOUGH THAT NEITHER FIT CLAMPS: at 848 wide both reached the 400% maximum and agreed, which the last
      // line below caught — the spread's 1.5 and the single page's 3 are both inside the range.
      const PANE = { width: 332, height: 600 };
      /** The scale a fit-width resolves to, with a pane that reports its size. */
      const fitFor = async (layout: PageLayout): Promise<{ scale: number | undefined; facing: boolean }> => {
        const resize: { ResizeObserver: typeof ResizeObserver } = globalThis;
        resize.ResizeObserver = class {
          constructor(private readonly callback: ResizeObserverCallback) {}
          observe(element: Element): void {
            this.callback(
              [{ target: element, contentRect: PANE } as unknown as ResizeObserverEntry],
              this,
            );
          }
          unobserve(): void {
            // Not called.
          }
          disconnect(): void {
            // Nothing to release.
          }
        };
        const shown = vi.fn();
        const { container, unmount } = render(
          <PageList {...layoutProps(layout, { onShownZoom: shown, mode: { kind: 'fit-width' } })} goTo={undefined} />,
        );
        await settle();
        const facing = scrollerOf(container).classList.contains('m-page-list--facing');
        const last = shown.mock.calls.at(-1)?.[0] as number | undefined;
        unmount();
        return { scale: last, facing };
      };

      // THE PAGE IS 100 × 200 at scale 1 (the mock above): a spread is 200 wide, and happy-dom resolves no stylesheet,
      // so the gap read from it is 0 — the arithmetic is the spread's, which is what separates the two layouts.
      const facing = await fitFor('facing');
      expect(facing.facing).toBe(true);
      expect(facing.scale).toBe(resolveZoom({ kind: 'fit-width' }, PANE, { width: 200, height: 200 }));
      const continuous = await fitFor('continuous');
      expect(continuous.facing).toBe(false);
      expect(continuous.scale).toBe(resolveZoom({ kind: 'fit-width' }, PANE, { width: 100, height: 200 }));
      expect(facing.scale).not.toBe(continuous.scale);
    });
  });

  it('draws the GRID inside every page, with the ruler’s spacing on the list (Part A3) — CONTROL: none while it is off', async () => {
    const { client } = clientAnswering();
    const drawn = (showGrid: boolean): HTMLElement => {
      const { container } = render(
        <PageList
          client={client}
          view={undefined}
          pageCount={3}
          docId={DOC}
          version={VERSION}
          onCurrentPage={vi.fn()}
          mode={SCALE_1}
          onZoomStep={vi.fn()}
          onShownZoom={vi.fn()}
          goTo={undefined}
          startAt={FIRST_PAGE.kernel}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={false}
          showGrid={showGrid} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
          unit="in"
          search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
          secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
          menuAt={undefined}
        />,
      );
      return container;
    };
    const on = drawn(true);
    await settle();
    const grids = [...on.querySelectorAll<HTMLElement>('.m-paper-grid')];
    // ONE PER PAGE, each inside its own slot, so its origin is that page's corner — and hidden from assistive
    // technology, since it says nothing about the document.
    expect(grids.map((grid) => grid.closest('.m-page-slot')?.getAttribute('data-page'))).toStrictEqual(['0', '1', '2']);
    expect(grids.every((grid) => grid.getAttribute('aria-hidden') === 'true')).toBe(true);
    // THE SPACING IS THE RULER'S: an inch at scale 1, a point to a pixel, is 72 px.
    expect(on.querySelector<HTMLElement>('.m-page-list')?.style.getPropertyValue('--m-grid')).toBe('72px');
    // CONTROL: off, no page carries one.
    expect(drawn(false).querySelectorAll('.m-paper-grid')).toHaveLength(0);
  });

  it('a SCROLL does not render the list: the rulers measure it on their own (row 303)', async () => {
    // EVERY SLOT A REAL BOX, stacked 300 px apart: happy-dom answers zero for every box, and a measure that finds no
    // page with a height sets nothing — so with zero boxes the old code also rendered nothing on a scroll, and this
    // case would pass against the defect it exists to catch.
    const boxes = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const page = Number(this.dataset['page'] ?? '-1');
      const top = page >= 0 ? page * 300 - (this.closest('.m-page-list')?.scrollTop ?? 0) : 0;
      return { x: 0, y: top, left: 0, top, right: 200, bottom: top + 280, width: 200, height: page >= 0 ? 280 : 600, toJSON: () => ({}) };
    });
    try {
      const { client } = clientAnswering();
      // THE LIST'S OWN RENDERS are the observable (`listRenders`): the cost measured was every slot rendering again on
      // every scroll event, and a slot renders when the list does.
      const { container } = render(
        <PageList
          client={client}
          view={undefined}
          pageCount={5}
          docId={DOC}
          version={VERSION}
          onCurrentPage={vi.fn()}
          mode={SCALE_1}
          onZoomStep={vi.fn()}
          onShownZoom={vi.fn()}
          goTo={undefined}
          startAt={FIRST_PAGE.kernel}
          onWentTo={vi.fn()}
          loupe={false}
          rulers={true}
          showGrid={true} onFollowLink={undefined} linksOutlined={false} onFillField={undefined}
          unit="in"
          search={undefined} differences={undefined} spotlights={undefined} writing={undefined}
          secondRasteriser={undefined} tileAbove={2} quality={1} pageBadges={false} smoothScroll={false} layout="continuous"
          menuAt={undefined}
        />,
      );
      await settle();
      const scroller = container.querySelector<HTMLElement>('.m-page-list');
      if (scroller === null) throw new Error('no scroller');
      const before = listRenders.count;
      // THE PREMISE: the count sees this list — its mount at least.
      expect(before).toBeGreaterThan(0);
      // THE FIRST PAGE PARTLY ON SCREEN at every one, so the ruler draws its run: a page wholly above is drawn by none.
      for (const top of [40, 80, 120]) {
        scroller.scrollTop = top;
        fireEvent.scroll(scroller);
      }
      await settle();

      // THE DECISION: nothing in the list rendered again.
      expect(listRenders.count).toBe(before);
      // AND THE SCROLL WAS READ: the vertical ruler's first page starts where that page now is, which a listener that
      // never ran would leave where the first frame put it (or draw nothing).
      const firstRun = (): string | undefined =>
        container.querySelector<HTMLElement>('.m-ruler-v .m-ruler-run')?.style.insetBlockStart;
      expect(firstRun()).toBe('-120px');
      scroller.scrollTop = 30;
      fireEvent.scroll(scroller);
      await settle();
      expect(firstRun()).toBe('-30px');
      expect(listRenders.count).toBe(before);
    } finally {
      boxes.mockRestore();
    }
  });
});
