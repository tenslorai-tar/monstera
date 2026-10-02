import { useLingui } from '@lingui/react';
import type { ContractClient, DispatchableCommand } from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';
import type React from 'react';
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AnnotationLayer } from './AnnotationLayer.js';
import { AnnotationOverlay } from './AnnotationOverlay.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import { SelectionLayer } from './SelectionLayer.js';
import { type TextEditing, TextEditPage } from './TextEditLayer.js';
import { TextLayer, type TextLayerLine, readTextSelection } from './TextLayer.js';
import { type DifferenceMark, DifferenceLayer } from './DifferenceLayer.js';

/** No marks on a page, one identity for every page without any. */
const NO_MARKS: readonly DifferenceMark[] = [];
import { type PageAnnotation, usePageAnnotations } from './usePageAnnotations.js';
import { usePageRotations } from './usePageRotations.js';
import { type PageTextAnswer, usePageText } from './usePageText.js';
import { ANNOTATION_SURFACE_LABEL, PAGE_IMAGE_ONLY, PAGE_LIST_LABEL, PAGE_OPENING } from './messages/en.js';
import { Icon } from './primitives/Icon.js';
import type { UiTool } from './registries/tools.js';
import type { DocumentView } from './documentView.js';
import { FIRST_PAGE, pdfjsPageOf } from './pageNumbering.js';
import { holdPage } from './pageResidency.js';
import { motionReduced } from './settings/appearance.js';
import type { PageLayout } from './settings/viewing.js';
import {
  RenderCancelledError,
  type SecondRasteriser,
  pageBoxAtOne,
  pageGeometry,
  renderPage,
  renderRegion,
} from './renderPage.js';
import { type Tile, tilesCovering } from './tiles.js';
import type { SearchHighlight } from './searchHighlight.js';
import { Loupe } from './Loupe.js';
import { Rulers } from './Rulers.js';
import { type RulerSpan, type RulerUnit, gridSpacing } from './rulerGeometry.js';
import { useVisiblePages } from './useVisiblePages.js';
import { type Box, type ZoomDirection, type ZoomMode, resolveZoom } from './zoom.js';

/**
 * Continuous scroll, with each page rasterised only while it is near the
 * viewport.
 *
 * ## Why an IntersectionObserver rather than a scroll handler
 *
 * A scroll handler runs on the main thread at the frequency the user scrolls
 * and then has to work out what is visible from geometry it reads back — which
 * is a layout read per event, in the frame that is already trying to draw. An
 * observer is told by the browser, off that path, and answers the question
 * directly. The row names it for that reason and this does not second-guess it.
 *
 * ## Slots exist before pages do, and that is what makes the scrollbar honest
 *
 * Every page gets an element from the first render, sized before anything is
 * rasterised — so the scrollbar describes the document rather than the part of
 * it that has been drawn, and it does not lurch as pages arrive.
 *
 * **The height is an ESTIMATE until a page has been drawn once, and it is an
 * estimate rather than a measurement on purpose.** Asking PDF.js for every
 * page's viewport up front is `getPage` per page, which parses every page
 * dictionary at open — the cost lazy rendering exists to avoid. So an unvisited
 * slot takes the last known page size, and a drawn one takes its own. Nothing
 * downstream depends on the estimate being right: the slot is corrected the
 * moment its page renders, and the only visible consequence is that a document
 * whose pages differ in size adjusts its scrollbar as those pages are visited.
 *
 * Stated rather than hidden, because it is the one modelled number here.
 *
 * ## RELEASED WHEN IT LEAVES, which is the whole memory story
 *
 * A viewer that rasterises on the way in and never releases holds every page the
 * user has passed — a bitmap per page, at device resolution, for the life of the
 * document. §9.17's renderer budget is *provisional and two-term* precisely
 * because of this cache, and its absolute term is a bitmap-cache cap. What ships
 * here is the discipline that term will measure: a canvas is dropped when its
 * slot leaves the margin, so what is resident tracks the window rather than the
 * history.
 *
 * ## The margin is one viewport, and it is a trade rather than a tuning
 *
 * Rendering exactly what is visible means a page arrives blank and fills in
 * after the scroll stops. One viewport of margin either side renders the page
 * about to be reached before it is reached. Larger margins buy smoother
 * scrolling with more resident bitmaps, which is the axis E1 tier-1's cache cap
 * will decide against a measurement; this is the smallest value that hides the
 * common case.
 */
export interface PageListProps {
  readonly client: ContractClient;
  /**
   * The parser, once it is open. **Slots exist without it.**
   *
   * A viewer that rendered nothing until the parse completed would show an empty
   * surface for as long as a large document takes to open, and would make the
   * scrollbar appear at the end rather than the start. The list is the document's
   * shape, which the view model already answered; the view is what fills it.
   */
  readonly view: DocumentView | undefined;
  /** How many pages the document has, from the view model. */
  readonly pageCount: number;
  readonly docId: DocId;
  readonly version: DocVersion;
  /** Told which page the user is looking at, zero-based. */
  readonly onCurrentPage: (page: number) => void;
  /**
   * Told each drawn page's visible box in PDF user space, `[x0, y0, x1, y1]` — PDF.js' own `page.view`
   * (see `RasterisedPage.crop`). For a caller placing something on a page it did not draw, such as the
   * assistant's *Add as note*, so the box is the one answer this list already has and not a second read.
   */
  readonly onPageBox?: ((page: number, crop: readonly [number, number, number, number]) => void) | undefined;
  /**
   * What the reader asked for — a scale, or a fit.
   *
   * A MODE rather than a number, because a fit has no number until this
   * component has measured its own box and a page's. See `zoom.ts`.
   */
  readonly mode: ZoomMode;
  /** Asks the shell to zoom one step in or out — by the reader's *Zoom step*, which the shell holds (`stepZoom`). */
  readonly onZoomStep: (direction: ZoomDirection) => void;
  /**
   * Reports the scale a fit resolved to.
   *
   * The owner holds the mode and cannot resolve it, so without this the `±`
   * commands would have no number to step from at fit-width — they would step
   * from the last explicit scale, which is not what the reader can see.
   */
  readonly onShownZoom: (shown: number) => void;
  /**
   * A page to reveal, or `undefined` for none outstanding.
   *
   * **A REQUEST, flowing the opposite way from `onCurrentPage`.** Collapsing
   * the two into one number makes a loop: the observer would set the value the
   * scroller reads as an instruction. Two names, one each way, has no loop.
   */
  readonly goTo: number | undefined;
  /**
   * The page this scroller is MOUNTING at, seeded visible.
   *
   * Different from `goTo` in the one way that matters: this is read once, at
   * mount, and a request is honoured whenever it arrives. With tabs a scroller
   * mounts every time a reader returns to a document, and a seed of page 1
   * would report *the reader is on page 1* to that document's own store a
   * moment after it was asked where they were.
   */
  readonly startAt: number;
  /**
   * Says the request has been acted on, so the owner can clear it.
   *
   * Cleared by this component rather than by a timer, so a jump to a page that
   * is already visible is still consumed — otherwise the next unrelated render
   * would scroll again.
   */
  readonly onWentTo: () => void;
  /** Whether the loupe follows the pointer. `viewing.loupe`. */
  readonly loupe: boolean;
  /** Whether the two rulers are drawn. `viewing.rulers`. */
  readonly rulers: boolean;
  /** Whether the grid overlay is drawn. `viewing.grid`. */
  readonly showGrid: boolean;
  /**
   * What both are read in. `viewing.ruler-unit`.
   *
   * ONE unit for both, passed as one prop, because a grid line a reader cannot
   * find on the ruler means nothing.
   */
  readonly unit: RulerUnit;
  /**
   * An accessible name for this viewport, when there is more than one.
   *
   * Absent for the only scroller on screen: that one is the document surface
   * and needs no name distinguishing it from anything. In a split view both
   * panes are scrollable regions, and two unnamed ones are two a screen-reader
   * user cannot tell apart — which is the whole of what the split is for.
   */
  readonly label?: MessageKey;
  /**
   * What a placeholder in {@link label} stands for.
   *
   * A key and its values, never a resolved string, for `Button`'s reason: a
   * caller that formatted the name itself would hold user-facing text and
   * would format it in whatever language it assumed. Compare names its pane
   * with the document in it, which is the first label here to carry one.
   */
  readonly labelValues?: Readonly<Record<string, string | number>> | undefined;
  /**
   * The drawing tool a reader has selected and where its commands go, or
   * `undefined` when nothing is being drawn.
   *
   * **One prop for the pair**, so a tool with nowhere to send its command is
   * unrepresentable rather than avoided by discipline (B5): two optional props
   * have three legal combinations and only two of them mean anything, and the
   * meaningless one is a control that draws a rectangle into nothing.
   *
   * **The tool itself and not its id**, so this component never consults a
   * registry: resolving an id here would make the scroller a second place that
   * knows tools exist, where its whole job is to give each page a surface for
   * whichever one is active.
   *
   * `undefined` mounts no overlay element at all rather than an inert one —
   * `AnnotationOverlay`'s note says why a transparent element over every page
   * is worse than none.
   */
  /**
   * Edit text's mode, or `undefined` when it is off (ADR-0096).
   *
   * A sibling of {@link drawing} rather than a member of it, because the two
   * never hold at once — they share one slot in the application, the tool id —
   * and a surface that is not a gesture has nothing to put in `tool`.
   */
  readonly editing?: TextEditing | undefined;
  /**
   * The HAND tool (§10.3's floating toolbar): a drag on the page area scrolls it, and the pages' own
   * layers stop taking the pointer so a drag never selects text on the way. Another value of the same
   * one slot the drawing tools and Edit text share, so it never holds beside them.
   */
  readonly panning?: boolean;
  readonly drawing?:
    | {
        readonly tool: UiTool;
        /** Sends a gesture's command; resolves whether the version moved (`AnnotationOverlay.onCommand`). */
        readonly onCommand: (command: DispatchableCommand) => Promise<boolean>;
        /**
         * What the select tool has picked, drawn over its own page.
         *
         * **Part of this prop rather than a sibling**, and for the same reason
         * the pair above is one: a selection with no tool active is a state the
         * application does not have — the tool change clears it — so two props
         * would have a fourth combination meaning *boxes on a page nothing can
         * act on*.
         */
        readonly selection?: AnnotationSelection | undefined;
      }
    | undefined;
  /**
   * The search whose matches the text layers should paint, if one has been run.
   *
   * Passed straight through to every slot rather than resolved here: the ranges
   * are DOM nodes and only the layer that rendered them can build one, so this
   * scroller's part is to hand each page the same description. `undefined`
   * paints nothing, which is the state before a search rather than the state of
   * a search that found nothing.
   *
   * **Required, and `| undefined` rather than optional.** Under
   * `exactOptionalPropertyTypes` that makes a caller say `search={undefined}`
   * on purpose instead of leaving the prop off, and the reason is the whole
   * chain this sits in: a highlight crosses four components, and a prop
   * silently dropped at any of them leaves every test green and the feature
   * dead. B5 over another case — the omission is a compile error rather than
   * something a reader has to notice.
   */
  readonly search: SearchHighlight | undefined;
  /**
   * A comparison's marks on each page (Side by Side, ADR-0131), or `undefined` where this list shows no comparison.
   * Required for `search`'s reason: a mark crossing three components and dropped at one leaves every case green.
   */
  readonly differences: ReadonlyMap<number, readonly DifferenceMark[]> | undefined;
  /**
   * §6.1's second engine, or `undefined` where the setting is off.
   *
   * Handed straight to each slot, `search`'s reason: this scroller decides
   * nothing about how a page is drawn, it hands each page the same description
   * of who draws it. Required and `| undefined` rather than optional for the
   * same reason too — a prop silently dropped between here and the canvas would
   * leave every test green and the setting dead.
   */
  readonly secondRasteriser: SecondRasteriser | undefined;
  /**
   * The zoom above which a page is drawn in tiles (E1; `rendering.tile-threshold`), as a scale. Required for
   * `secondRasteriser`'s reason: a threshold dropped between the setting and the slot would draw whole pages at 400%.
   */
  readonly tileAbove: number;
  /**
   * The reader's page-sharpness factor (E1's `renderQuality`; `rendering.quality`), 1 by default. It multiplies the
   * drawing scale and never the shown size, and counts toward the tile threshold, since that bounds the canvas.
   */
  readonly quality: number;
  /** Whether each page carries its number at its foot (`viewing.page-badges`). */
  readonly pageBadges: boolean;
  /** Whether going to a page glides there (`viewing.smooth-scroll`); reduced motion overrides it. */
  readonly smoothScroll: boolean;
  /**
   * How the pages are laid out (`viewing.page-layout`): one column, one page at a time, or facing pairs. Required for
   * `secondRasteriser`'s reason.
   */
  readonly layout: PageLayout;
  /**
   * AUTOSCROLL's pace in CSS pixels a second while it runs (`view.autoscroll`, at `viewing.autoscroll-speed`), or
   * `undefined` while it does not. Only the pane in front is given one.
   */
  readonly autoscroll?: number | undefined;
  /**
   * Told that autoscroll stopped here — Esc, a press or a wheel in this pane, or the last page's end — so the shell's
   * state follows. Stable across renders: the running scroll's effect depends on it.
   */
  readonly onAutoscrollEnd?: (() => void) | undefined;
  /**
   * Wraps one page's slot in the page context menu for THAT page (§7), or `undefined` for a pane
   * with no document commands behind it. Per slot rather than around the scroller, because the
   * reader can see several pages at once: a menu over the whole list would act on the current page
   * whichever page was right-clicked — `SHOWN_PAGE`'s defect, arriving through a gesture. Required
   * and `| undefined` for `secondRasteriser`'s reason.
   */
  readonly pageMenu: ((page: number, slot: ReactElement) => ReactNode) | undefined;
  /**
   * Called when the reader presses in this pane or moves focus into it — *focus follows the
   * pane*. With two panes the owner routes the reports above to the one last used, so the status
   * bar and the navigation commands follow the pane the reader is working in. Absent for a pane
   * that can never be the one reporting.
   */
  readonly onActivate?: (() => void) | undefined;
  /**
   * Told once, when this scroller's first frame is shown: its starting page drawn at the zoom it is shown at (or
   * failed to draw). For the reads that may wait for it — the thumbnail strip's — so the first page is the first thing
   * main's lane works for.
   */
  readonly onFirstFrame?: (() => void) | undefined;
}

/**
 * How long a zoom must settle before the pages are drawn again.
 *
 * **The row's number, not one invented here**: *"instant CSS stretch + 150 ms
 * debounced true re-render"*. It is the interval a gesture is allowed to be
 * cheap for, and E1 permits the stretch only transiently — so the debounce is
 * what guarantees the *transiently*.
 */
const RERENDER_AFTER_MS = 150;

/** How much either side of the viewport counts as *about to be seen*. */
const MARGIN = '100%';

/** How long after one page turn by the wheel, in single page, the next may come (see `onWheel`). */
const TURN_AFTER_MS = 400;

/**
 * A page's bitmap, and the scale it was drawn at.
 *
 * **The scale is what makes the stretch computable.** A page's CSS size at any
 * zoom is `bitmap ÷ drawnAt × (devicePixelRatio × zoom)`, so a bitmap drawn at
 * one zoom can be displayed at another — which is the first tier. Storing only
 * the pixel size would leave the ratio unrecoverable and the stretch would have
 * to guess.
 */
interface Measured {
  readonly width: number;
  readonly height: number;
  /** `devicePixelRatio × zoom` at the moment this bitmap was rasterised. */
  readonly drawnAt: number;
  /**
   * The page's visible box in PDF user space, and the rotation it was drawn at.
   *
   * **Carried with the bitmap rather than fetched**, because the annotation
   * overlay needs the frame the bitmap under it was drawn in, and any other
   * source is a frame that may have moved: a second `getPage` answers about the
   * page as it is now, and this slot may still be showing the previous render
   * while a zoom settles. `renderPage` reports both because it has just parsed
   * the page.
   */
  readonly crop: readonly [number, number, number, number];
  readonly rotation: number;
}

/**
 * Device pixels per CSS pixel, read at the point of use.
 *
 * Not cached: a window moved between a 1× and a 2× display changes it, and a
 * value captured at mount would render every later page at the old density —
 * which is E1's *pixel-exact at every zoom on every display* failing on the one
 * event that makes it interesting.
 */
function devicePixels(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio;
}

export function PageList({
  client,
  view,
  pageCount,
  docId,
  version,
  onCurrentPage,
  onPageBox,
  onFirstFrame,
  mode,
  onZoomStep,
  onShownZoom,
  goTo,
  onWentTo,
  loupe,
  rulers,
  showGrid,
  unit,
  label,
  labelValues,
  startAt,
  drawing,
  editing,
  panning = false,
  search,
  differences,
  secondRasteriser,
  tileAbove,
  quality,
  pageBadges,
  smoothScroll,
  layout,
  autoscroll,
  onAutoscrollEnd,
  pageMenu,
  onActivate,
}: PageListProps): ReactElement {
  const { i18n } = useLingui();
  // WHERE A HAND DRAG STARTED: the pointer and the scroll position at the press, so each move sets
  // the scroll from the start rather than accumulating deltas that drift with rounding.
  const [grab, setGrab] = useState<
    { readonly x: number; readonly y: number; readonly left: number; readonly top: number } | undefined
  >(undefined);
  // THE SHARED MECHANISM, not a copy. The thumbnail sidebar asks the same
  // question of a different container, and a second implementation here would
  // be two opinions about what *near the viewport* means (B3a).
  const { visible, slotRef, slotFor } = useVisiblePages(MARGIN, startAt);
  // THE SHARED READ, which the strip and the loupe take too. Presence means
  // answered for THIS version; see `usePageRotations` for the three states.
  //
  // DECLARED FIRST AMONG THE READS, so its effect asks first: every read of the document waits in main's one lane for
  // it, and this is the one the first page cannot draw without. The text and the marks below wait for the first frame.
  const rotations = usePageRotations(client, docId, version, visible);
  /**
   * WHETHER THE FIRST FRAME HAS BEEN SHOWN: the mount's starting page drawn at the zoom it is shown at, and scrolled to
   * (the owner's rule, *never show an unfinished screen*; the review of 0.1.8.0 saw seconds of empty slots, a flash of
   * page 2's lower half and a blank before page 1). Until then the pages are laid out and drawn out of sight under a
   * loading state, so the first frame anybody sees is the finished page; once shown it stays shown for this mount.
   */
  const [firstFrame, setFirstFrame] = useState(false);
  /**
   * SINGLE PAGE's page on show, with the request and the layout it was last settled against.
   *
   * **Adjusted while rendering, when either moves** — React's own form for state that follows a prop — rather than in
   * an effect, which would paint the old page once first. A request (`goTo`) chooses the page; entering the layout
   * keeps the page the reader was on (the topmost visible, as `onCurrentPage` reports it); a wheel past an edge turns
   * it. Every other page's slot is hidden, so the observer sees only this one and reports it as current.
   */
  const [single, setSingle] = useState<{
    readonly page: number;
    readonly request: number | undefined;
    readonly layout: PageLayout;
  }>({ page: startAt, request: goTo, layout });
  if (single.request !== goTo || single.layout !== layout) {
    const [topmost] = [...visible].sort((a, b) => a - b);
    setSingle({
      page:
        goTo !== undefined && goTo !== single.request
          ? goTo
          : layout === 'single' && single.layout !== 'single' && topmost !== undefined
            ? topmost
            : single.page,
      request: goTo,
      layout,
    });
  }
  // A PAGE PAST THE END MEANS THE LAST PAGE, the request's rule below: a delete can leave the page on show beyond it.
  const onShow = Math.min(single.page, pageCount - 1);
  const lastTurn = useRef(Number.NEGATIVE_INFINITY);
  // THE SELECTABLE TEXT FOR WHAT IS ON SCREEN. Held here rather than lifted to
  // a caller because `visible` is this component's answer and it changes on
  // every scroll — a caller owning the fetch would re-render on scroll to hand
  // back a set the scroller already had.
  //
  // NOT BEFORE THE FIRST FRAME, with the marks below: both are reads in main's one lane, and asked at mount they were
  // queued ahead of the rotation the first page waits for. Neither is drawn before a page is measured anyway.
  const pageText = usePageText(client, docId, version, firstFrame ? visible : NOTHING_VISIBLE);
  // EVERY PAGE'S MARKS, one read per version: the channel is whole-document, so there is nothing
  // to narrow to the visible set, and the layer is mounted only on slots that are measured.
  const pageAnnotations = usePageAnnotations(firstFrame ? client : undefined, docId, version);
  const scroller = useRef<HTMLDivElement | null>(null);
  /** The pane around the scroller, which holds what must not scroll: the rulers and the loupe. */
  const pane = useRef<HTMLDivElement | null>(null);
  /**
   * The scroller's own box, remeasured whenever it changes.
   *
   * **A `ResizeObserver` and not a `resize` listener on the window**: the box
   * that matters is this element's, and it changes for reasons the window does
   * not see — a sidebar opening, a panel resizing, a font loading. A window
   * listener would answer for three of those and miss the rest, which is a fit
   * that is correct until the first time the layout moves without the window.
   *
   * `undefined` until the first observation, which `resolveZoom` treats as *no
   * answer yet* rather than as a box of zero.
   */
  const [viewport, setViewport] = useState<Box | undefined>(undefined);
  /**
   * The gap between two pages side by side, READ from the stylesheet — the token is `app.css`' to set, and a number
   * here would be a second opinion about it. Only facing pages use it: a fit there spans two pages and this.
   */
  const [spreadGap, setSpreadGap] = useState(0);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const seen = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box !== undefined) setViewport({ width: box.width, height: box.height });
      const gap = Number.parseFloat(getComputedStyle(element).columnGap);
      setSpreadGap(Number.isFinite(gap) ? gap : 0);
    });
    seen.observe(element);
    return (): void => {
      seen.disconnect();
    };
  }, []);

  const [sizes, setSizes] = useState<ReadonlyMap<number, Measured>>(new Map());
  // A REF, so `measured` stays stable — see its note — while the parent passes a new callback.
  // Updated after render, never during it.
  const onPageBoxRef = useRef(onPageBox);
  useEffect(() => {
    onPageBoxRef.current = onPageBox;
  }, [onPageBox]);

  /**
   * The page's box at scale 1, which is the other half of a fit.
   *
   * A bitmap divided by the scale it was drawn at IS the page in CSS pixels,
   * which is what `Measured` carries `drawnAt` for — so the fit costs no extra
   * measurement and cannot disagree with what is on screen.
   *
   * **Undefined before anything has drawn**, so a fit has no answer then; that
   * is correct rather than a gap, because there is no page to fit yet.
   *
   * **The FIRST measured page and not the current one**, which is a limitation
   * and is stated: a document whose pages differ in size will fit to the first
   * one visited rather than to the page under the reader. Fixing that means the
   * fit changing as the reader scrolls, which is a design question about
   * whether *fit* follows the page or the document, and is not answered here.
   */
  //
  // **THE STARTING PAGE'S OWN BOX, ASKED BEFORE IT IS DRAWN**, ahead of any measurement. One `getPage` of one page —
  // not the every-page parse the slots' estimate exists to avoid — and what lets the first drawing be at the fit:
  // waiting for a drawing to learn the box drew the first page at 100%, then the fit stretched it and redrew it, which
  // is the jump and the blank the owner saw on first open. Asked once the rotation is answered, so a turned page's box
  // is the turned one.
  const [mountedAt] = useState(startAt);
  const startPage = Math.min(mountedAt, pageCount - 1);
  const startRotation = rotations.get(startPage);
  const startAnswered = rotations.has(startPage);
  const [startBox, setStartBox] = useState<{ readonly key: string; readonly box: Box } | undefined>(undefined);
  // THE BOX COULD NOT BE READ: the first drawing then learns it, as before this read existed, rather than nothing
  // drawing at all — a page whose box PDF.js refuses is one whose drawing will say why on its own canvas.
  const [startBoxRefused, setStartBoxRefused] = useState(false);
  const startKey = `${String(startPage)}@${String(startRotation)}`;
  useEffect(() => {
    if (view === undefined || !startAnswered) return;
    let cancelled = false;
    void pageBoxAtOne(view.document, pdfjsPageOf(startPage), startRotation).then(
      (box) => {
        if (!cancelled) setStartBox({ key: startKey, box });
      },
      () => {
        if (!cancelled) setStartBoxRefused(true);
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [startAnswered, startKey, startPage, startRotation, view]);
  const pageBox = useMemo((): Box | undefined => {
    const [first] = [...sizes.values()];
    const drawn = first === undefined ? undefined : { width: first.width / first.drawnAt, height: first.height / first.drawnAt };
    // THE ASKED BOX WHILE THE DRAWING AGREES WITH IT: a drawing's size is `ceil`ed to whole device pixels, so its box
    // differs from the exact one by under a pixel, and switching to it would move the fit by that much and redraw the
    // page a moment after it was shown. A drawing that differs by more — a page cropped or resized since — wins.
    if (startBox !== undefined) {
      const agrees =
        first === undefined ||
        drawn === undefined ||
        (Math.abs(drawn.width - startBox.box.width) * first.drawnAt <= 1 &&
          Math.abs(drawn.height - startBox.box.height) * first.drawnAt <= 1);
      if (agrees) return startBox.box;
    }
    return drawn;
  }, [sizes, startBox]);
  /** Every slot's size before any page has drawn: the starting page's box, at scale 1, as an unvisited slot takes. */
  const startEstimate = useMemo(
    (): Measured | undefined =>
      startBox === undefined
        ? undefined
        : {
            width: startBox.box.width,
            height: startBox.box.height,
            drawnAt: 1,
            crop: [0, 0, startBox.box.width, startBox.box.height],
            rotation: startRotation ?? 0,
          },
    [startBox, startRotation],
  );

  /**
   * What the reader's mode resolves to, right now.
   *
   * A fit that cannot be answered falls back to **1**, and that fallback is the
   * one place this component draws a zoom nobody asked for. It is bounded to
   * the frames before the first page has been measured — a fit needs a page,
   * and a page has to be drawn once at some scale for there to be one.
   */
  // FACING PAGES FIT A SPREAD, two pages and the gap between them: fitting one page's width would push its partner
  // off the pane. The gap is taken from the pane rather than added to the pages, because it does not scale with them.
  const spread = layout === 'facing';
  /** Fit page in one column: each page takes the whole pane, so no part of another shows (`.m-page-list--fit-page`). */
  const fitOnePage = mode.kind === 'fit-page' && layout === 'continuous';
  const resolved = resolveZoom(
    mode,
    spread && viewport !== undefined ? { width: viewport.width - spreadGap, height: viewport.height } : viewport,
    spread && pageBox !== undefined ? { width: pageBox.width * 2, height: pageBox.height } : pageBox,
  );
  const shown = resolved ?? 1;

  /**
   * The zoom the pages are actually rasterised at, which lags `shown`.
   *
   * **The two tiers are these two numbers.** `shown` moves the moment a reader
   * asks — or the moment a resize changes what a fit means — and the browser
   * stretches the bitmap it already has; `renderZoom` follows once things
   * settle, and the page is redrawn at `devicePixelRatio × renderZoom`, one
   * device pixel per bitmap pixel, which is E1's bar.
   *
   * **A RESIZE FEEDS THE SAME DEBOUNCE**, which is the reason this is derived
   * from `shown` rather than from the mode: dragging a window edge at fit-width
   * produces a continuous stream of new scales, and rasterising each one would
   * redraw every visible page per pixel of drag. The stretch covers the drag
   * and one true render lands when it stops — the same mechanism the ± ladder
   * already used, for free.
   */
  const [renderZoom, setRenderZoom] = useState(shown);
  // BEFORE THE FIRST FRAME THERE IS NOTHING TO STRETCH, so the zoom a page is drawn at follows the one it is shown at at
  // once — adjusted while rendering, React's form for state that follows a value — and the first drawing is at the
  // fit rather than at the fallback and then again 150 ms later.
  if (!firstFrame && renderZoom !== shown) setRenderZoom(shown);

  useEffect(() => {
    if (renderZoom === shown) return;
    const timer = setTimeout(() => {
      setRenderZoom(shown);
    }, RERENDER_AFTER_MS);
    // CLEARED ON EVERY CHANGE, which is what makes this a debounce rather than
    // a throttle: a reader stepping the zoom five times gets one re-render, not
    // five, and the interval restarts from the last step.
    return (): void => {
      clearTimeout(timer);
    };
  }, [renderZoom, shown]);

  // Told upward so the commands can step the ladder from what is on screen. A
  // fit's number lives here and nowhere else, so a `+` pressed at fit-width
  // would otherwise step from a mode that has no number.
  //
  // NOT THE FALLBACK: a fit with no page box yet resolves to nothing, and reporting the 1 drawn in its place put 100% in
  // the status bar for the length of an open, then the fit.
  useEffect(() => {
    if (resolved !== undefined) onShownZoom(resolved);
  }, [onShownZoom, resolved]);

  /**
   * Ctrl+scroll, which is a zoom rather than a scroll.
   *
   * `preventDefault` is what stops the browser's own page zoom, which would
   * scale the whole shell — chrome and all — instead of the document.
   *
   * **React's `onWheel` is passive on the root in some builds**, and a passive
   * listener cannot preventDefault. It is attached here rather than through an
   * explicit non-passive `addEventListener` because the element is not the
   * document root, where that default applies; if a browser is ever observed
   * ignoring it, the fix is an effect with `{ passive: false }` and not a
   * different gesture.
   */
  const grid = showGrid ? gridSpacing(unit, shown) : undefined;

  /**
   * Where the loupe is, and over which page.
   *
   * `undefined` when the pointer is not over a page, which is what makes the
   * loupe disappear over the gutter rather than freezing at the last place it
   * saw — a magnifier stuck over nothing reads as a broken one.
   */
  const [lens, setLens] = useState<
    { page: number; at: { x: number; y: number }; screen: { x: number; y: number } } | undefined
  >(undefined);

  /**
   * Tracks the pointer for the loupe.
   *
   * ## Delegated on the LIST, not attached per slot
   *
   * One listener for a document of any length, and it goes on finding the page
   * as slots mount and unmount underneath it. A handler per slot would be a
   * thousand listeners on a thousand-page document, added and removed as the
   * reader scrolls.
   *
   * The page is read from the slot's own `data-page`, which the visibility hook
   * already writes — so there is one place that says which element is which
   * page, and this is a reader of it rather than a second scheme.
   */
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      // A HAND DRAG IN PROGRESS moves the pane with the pointer: dragging down reveals what is above.
      const box = scroller.current;
      if (grab !== undefined && box !== null) {
        box.scrollLeft = grab.left - (event.clientX - grab.x);
        box.scrollTop = grab.top - (event.clientY - grab.y);
        return;
      }
      if (!loupe) return;
      const target = event.target instanceof HTMLElement ? event.target.closest('[data-page]') : null;
      if (!(target instanceof HTMLElement) || box === null) {
        setLens(undefined);
        return;
      }
      const page = Number(target.dataset['page'] ?? '-1');
      if (!Number.isInteger(page) || page < 0) {
        setLens(undefined);
        return;
      }
      const slot = target.getBoundingClientRect();
      const outer = (pane.current ?? box).getBoundingClientRect();
      setLens({
        page,
        at: { x: event.clientX - slot.left, y: event.clientY - slot.top },
        // Positioned against the PANE, because that is what the loupe is
        // absolutely placed inside — viewport coordinates would put it in the
        // wrong place the moment the window is not at the origin. Not the
        // scroller: an absolute child of a scroll container is laid out in its
        // scrolled content, so the loupe landed `scrollTop` above the pointer.
        screen: { x: event.clientX - outer.left, y: event.clientY - outer.top },
      });
    },
    [grab, loupe],
  );

  const onPointerLeave = useCallback((): void => {
    setLens(undefined);
  }, []);

  /**
   * Takes the reader to a requested page.
   *
   * **`scrollIntoView` on the slot, rather than arithmetic on the offsets.**
   * Slot heights are estimates until a page has been drawn, so a computed
   * offset would be wrong by the accumulated error of every unvisited page
   * above it — and it would go on being wrong as those pages corrected
   * themselves. The element knows where it is.
   *
   * The request is reported as consumed whether or not a slot was found, so it
   * cannot retry on every render for ever.
   *
   * **A PAGE PAST THE END MEANS THE LAST PAGE.** The page a reader was on is
   * re-requested after every edit (App's remount effect), and deleting the page
   * they were on makes it one past the end; landing them on the new last page is
   * where they were, where the top of the document is not.
   */
  useEffect(() => {
    if (goTo === undefined) return;
    const box = scroller.current;
    // SINGLE PAGE: the request already chose the page on show (`single`, adjusted as the request arrived), so going
    // there is starting at its top.
    if (layout === 'single') {
      if (box !== null) box.scrollTop = 0;
    } else {
      // A GLIDE only where the reader chose one AND nothing asked for stillness (`viewing.smooth-scroll`).
      const glide = smoothScroll && !motionReduced(document.documentElement);
      slotFor(Math.min(goTo, pageCount - 1))?.scrollIntoView({ block: 'start', behavior: glide ? 'smooth' : 'auto' });
    }
    onWentTo();
  }, [goTo, layout, onWentTo, pageCount, slotFor, smoothScroll]);

  /**
   * The page this scroller MOUNTS at, revealed once — the scroll half of `startAt`.
   *
   * `startAt` only seeded the page visible, and every remount route had to pair it with a `goTo`
   * from above: a tab brought forward did, the error boundary's retry did, and a new version —
   * every edit since ADR-0084 — did not, so each edit put the reader on page 1 (seen live
   * 2026-09-18). Pairing it from above cannot work for that route at all: the request is issued
   * in the render that moves the version, where the OLD scroller is still mounted and consumes
   * it, and the new one mounts at the top a moment later. The scroller that mounts is the one
   * place that knows it mounted, so it reveals its own starting page, and no route has a half
   * left to forget. (An edit stopped remounting it on 2026-10-01, when `useDocumentView` began
   * keeping the shown view until the next opens; a tab brought forward and the retry still do.)
   *
   * ONCE, by a ref: `slotFor` and `pageCount` may change while this scroller lives, and a reveal
   * that re-fired on them would pull the reader back to where they started.
   *
   * **AND NOT BEFORE A PAGE IS MEASURED.** At mount every slot is at its minimum, so a reveal then
   * scrolls to where page N sits among minimum slots; the first measurement arrives a moment later,
   * every estimate takes it at once (`lastKnownBefore`), and the same scroll offset is inside an
   * earlier page. Traced over the debugging port 2026-09-18: slots `260,260,260,260,260` and
   * `top=568` at the reveal, then `792,…` and the status at page 1 of 5, for a reader on page 3.
   *
   * **ANY page, not the starting one.** The scroller mounts at the top, so its observer reports
   * page 1 and replaces the seeded visible set before the starting page draws — which then never
   * draws, so a reveal waiting for ITS measurement waited for ever (reproduced in Chromium by
   * `pagePosition.pw.ts`: one canvas, every slot sized, and no reveal). The first measurement is
   * the one that sets every estimate, which is all the position needs.
   */
  //
  // **THE MOUNT'S `startAt`, held, because the prop is live.** The caller passes the reader's
  // current page, and the new scroller's own observer reports page 1 before the starting page is
  // measured — so read live, `startAt` had become 0 by the time the reveal could run, and it
  // revealed nothing (traced 2026-09-18: status at page 1 of 4 while page 3 was measuring). The
  // prop's contract was always *read once, at mount*; this is that, spelt so a re-render cannot
  // change it.
  //
  // **OR ONCE THE STARTING PAGE'S OWN BOX IS KNOWN** (`startBox`, below the first-frame note): every slot is then
  // estimated from it, so the position is right before anything has drawn, and the starting page is the first drawn.
  const revealedStart = useRef(false);
  const anyMeasured = sizes.size > 0;
  const sized = anyMeasured || startBox !== undefined;
  useEffect(() => {
    if (revealedStart.current) return;
    if (mountedAt <= 0) {
      revealedStart.current = true;
      return;
    }
    if (!sized) return;
    revealedStart.current = true;
    slotFor(startPage)?.scrollIntoView({ block: 'start' });
  }, [mountedAt, sized, slotFor, startPage]);

  /**
   * THE FIRST FRAME, decided: scrolled to the starting page, and EVERY page in the viewport drawn at the zoom it is shown
   * at — the starting page, and the top of the next where it shows — or failed to draw, which is shown rather than
   * hidden behind a loading state for ever. Pages in the margin below are not waited for: nobody can see them yet.
   * Marked for the performance timeline, so what each step of an open costs can be read on the machine that runs it
   * (`monstera:parsed`, `monstera:rotation`, `monstera:page-box`, `monstera:first-frame`).
   */
  const [failedPages, setFailedPages] = useState<ReadonlySet<number>>(new Set());
  const failed = useCallback((page: number): void => {
    setFailedPages((current) => (current.has(page) ? current : new Set(current).add(page)));
  }, []);
  useEffect(() => {
    // THE REVEAL'S REF, read rather than mirrored in state: the reveal effect above runs first in the same commit, and
    // every later change this waits on — a page measured — runs this again.
    if (firstFrame || !revealedStart.current || resolved === undefined || renderZoom !== shown) return;
    const box = scroller.current?.getBoundingClientRect();
    if (box === undefined) return;
    const scale = devicePixels() * renderZoom * quality;
    const inView = [...visible].filter((page) => {
      const slot = slotFor(page)?.getBoundingClientRect();
      return slot !== undefined && slot.height > 0 && slot.bottom > box.top && slot.top < box.bottom;
    });
    const drawn = (page: number): boolean => {
      const size = sizes.get(page);
      return failedPages.has(page) || (size !== undefined && Math.abs(size.drawnAt - scale) < 1e-9);
    };
    // A SCROLLER WITH NO HEIGHT has no viewport to judge by — laid out nowhere, or not laid out at all — and then the
    // starting page alone is what the first frame waits for, rather than a page set that can never be complete.
    const required = box.height > 0 ? inView : [startPage];
    if (!required.includes(startPage) || !required.every(drawn)) return;
    setFirstFrame(true);
    performance.mark('monstera:first-frame');
    onFirstFrame?.();
  }, [failedPages, firstFrame, onFirstFrame, quality, renderZoom, resolved, shown, sized, sizes, slotFor, startPage, visible]);
  useEffect(() => {
    // MOUNTED, which is the parser open: the list exists only once PDF.js has the document.
    performance.mark('monstera:parsed');
  }, []);
  useEffect(() => {
    if (startAnswered) performance.mark('monstera:rotation');
  }, [startAnswered]);
  useEffect(() => {
    if (startBox !== undefined) performance.mark('monstera:page-box');
  }, [startBox]);

  /**
   * AUTOSCROLL, one frame at a time: the distance is the pace times the time since the last frame, so a slow frame
   * does not slow the reading. Whole pixels move and the remainder is carried, because a scroll position set to a
   * fraction is rounded by the browser and a pace below one pixel a frame would otherwise never move at all.
   *
   * It stops on Esc, a press or a wheel in this pane — the reader taking the page back — and at the end of the last
   * page. In single page the end of a page turns to the next, where it carries on.
   */
  useEffect(() => {
    const box = scroller.current;
    if (autoscroll === undefined || box === null) return;
    let frame = 0;
    let last: number | undefined;
    let carry = 0;
    const stop = (): void => {
      onAutoscrollEnd?.();
    };
    const step = (now: number): void => {
      if (last !== undefined) {
        carry += (autoscroll * (now - last)) / 1000;
        const whole = Math.floor(carry);
        if (whole > 0) {
          box.scrollTop += whole;
          carry -= whole;
        }
      }
      last = now;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) {
        if (layout === 'single' && onShow < pageCount - 1) {
          box.scrollTop = 0;
          setSingle((current) => ({ ...current, page: onShow + 1 }));
          return;
        }
        stop();
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    box.addEventListener('pointerdown', stop);
    box.addEventListener('wheel', stop);
    return (): void => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      box.removeEventListener('pointerdown', stop);
      box.removeEventListener('wheel', stop);
    };
  }, [autoscroll, layout, onAutoscrollEnd, onShow, pageCount]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>): void => {
      if (!event.ctrlKey) {
        // SINGLE PAGE: a wheel that would scroll past the page's end turns to the next, and past its top to the one
        // before, which lands at that page's top.
        const box = scroller.current;
        if (layout !== 'single' || box === null) return;
        const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
        const next =
          event.deltaY > 0 && atEnd ? onShow + 1 : event.deltaY < 0 && box.scrollTop <= 0 ? onShow - 1 : undefined;
        if (next === undefined || next < 0 || next >= pageCount) return;
        // ONE TURN PER GESTURE: a wheel sends a burst of events, and every one after the first arrives at the new
        // page's edge too. The interval is chosen, not measured — long enough to span a notch's burst, short enough
        // that a reader turning deliberately never waits on it.
        if (event.timeStamp - lastTurn.current < TURN_AFTER_MS) return;
        lastTurn.current = event.timeStamp;
        box.scrollTop = 0;
        setSingle((current) => ({ ...current, page: next }));
        return;
      }
      event.preventDefault();
      // DIRECTION ONLY. A wheel's `deltaY` is in units that differ by device
      // and by `deltaMode`, so treating its magnitude as an amount makes a
      // trackpad and a mouse zoom at different rates. The reader's step is the amount.
      onZoomStep(event.deltaY < 0 ? 'in' : 'out');
    },
    [layout, onShow, onZoomStep, pageCount],
  );
  /**
   * What a slot reports after drawing, as ONE stable callback.
   *
   * **A new arrow per slot per render re-rasterises every visible page on every
   * render of this component**, because it is in the slot's effect dependencies.
   * Measured: the page drew twice for one visible page, which is a full
   * re-render of a bitmap for a parent state change that had nothing to do with
   * it — and on a scroller, parent state changes constantly.
   *
   * Takes the page as an argument rather than closing over it, which is what
   * lets it be stable at all.
   */
  const measured = useCallback((page: number, size: Measured): void => {
    setSizes((current) => {
      // UNCHANGED SIZE, UNCHANGED MAP. Returning a new map for an equal value
      // sets state on every draw, which re-renders, which redraws.
      const known = current.get(page);
      if (known?.width === size.width && known.height === size.height) return current;
      return new Map(current).set(page, size);
    });
    onPageBoxRef.current?.(page, size.crop);
  }, []);

  /** The page occupying the most of the viewport, as the current one. */
  useEffect(() => {
    // TOPMOST OF THE VISIBLE SET, not the most-covered one. Most-covered needs a
    // measurement per page per scroll and answers differently for a page taller
    // than the viewport, where nothing is ever "most" covered. The topmost
    // visible page is what a reader means by "the page I am on" and it is
    // already known here.
    const [first] = [...visible].sort((a, b) => a - b);
    if (first !== undefined) onCurrentPage(first);
  }, [onCurrentPage, visible]);

  /**
   * A TOOL WHOSE GESTURE IS SELECTING TEXT (`UiTool.fromSelection`, the highlighter): no drawing surface is mounted
   * for it, so the text layer takes the drag and the browser selects the words, and the release marks them.
   */
  const fromSelection = drawing?.tool.fromSelection;
  const selectsText = fromSelection !== undefined;
  const markSelection = useCallback((): void => {
    if (fromSelection === undefined || drawing === undefined) return;
    const selection = readTextSelection();
    if (selection === undefined) return;
    const command = fromSelection(selection);
    if (command === undefined) return;
    // NOT AWAITED: whether the version moved decides nothing here — the selection is spent either way — and the
    // command reports its own refusal.
    void drawing.onCommand(command);
    // THE SELECTION IS SPENT once it is a mark: left in place it would still offer the selected-text menu for words
    // that are already marked, and the next drag would start from it.
    globalThis.document.getSelection()?.removeAllRanges();
  }, [drawing, fromSelection]);

  return (
    <div
      // THE PANE: the scroller, and beside it what must NOT scroll with the pages. The rulers take their own grid tracks
      // and the loupe is placed against this box; inside the scroller both were laid out in its scrolled content.
      className={rulers ? 'm-page-pane m-page-pane--rulers' : 'm-page-pane'}
      ref={pane}
      // UNTIL THE FIRST FRAME the pages are laid out, observed and drawn out of sight (`app.css`), and the opening state
      // stands in their place; the attribute is what the stylesheet and the rendered cases read.
      data-first-frame={firstFrame ? 'shown' : 'pending'}
    >
      {firstFrame ? null : <OpeningState />}
      {loupe && lens !== undefined ? (
        <div
          className="m-loupe-at"
          style={{ insetInlineStart: `${String(lens.screen.x)}px`, insetBlockStart: `${String(lens.screen.y)}px` }}
        >
          <Loupe view={view} page={lens.page} zoom={shown} rotation={rotations.get(lens.page)} at={lens.at} />
        </div>
      ) : null}
      {rulers || grid !== undefined ? (
        <PageSpans
          scroller={scroller}
          slotFor={slotFor}
          visible={visible}
          viewport={viewport}
          sizes={sizes}
          rulers={rulers}
          grid={grid !== undefined}
          unit={unit}
          zoom={shown}
        />
      ) : null}
    <div
      // A NAMED, FOCUSABLE REGION: the document scrolls here, and a scroller with nothing focusable inside — a page of
      // plain text, a scan — could not be scrolled from the keyboard at all (WCAG 2.1.1; axe's
      // `scrollable-region-focusable`, found by the menu bar's rendered case on 2026-09-26). Focused, the arrows and
      // Page Up/Down scroll it, which is the browser's own behaviour for a focused scroller.
      role="region"
      tabIndex={0}
      className={[
        'm-page-list',
        layout === 'facing' ? 'm-page-list--facing' : '',
        // ONE PAGE TO A SCREEN, centred, at Fit page in a continuous layout (`app.css`); facing pages fit a spread, and
        // single page already shows one.
        fitOnePage ? 'm-page-list--fit-page' : '',
        grid === undefined ? '' : 'm-page-list-grid',
        panning ? 'm-page-list--panning' : '',
        selectsText ? 'm-page-list--selects-text' : '',
        grab === undefined ? '' : 'is-grabbing',
      ]
        .filter((name) => name !== '')
        .join(' ')}
      // THE HAND TOOL'S DRAG. Pointer capture keeps the drag alive when the pointer leaves the pane,
      // and the scroll is set from where the press started, never summed from deltas.
      onPointerDown={
        panning
          ? (event) => {
              const element = scroller.current;
              if (event.button !== 0 || element === null) return;
              element.setPointerCapture(event.pointerId);
              setGrab({ x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop });
            }
          : undefined
      }
      onPointerUp={
        panning
          ? () => {
              setGrab(undefined);
            }
          : selectsText
            ? markSelection
            : undefined
      }
      onPointerCancel={
        panning
          ? () => {
              setGrab(undefined);
            }
          : undefined
      }
      // THE SPACING IS A CUSTOM PROPERTY, not an inline background. The grid is
      // a repeating gradient in `app.css`, so its colour is a token there and
      // this passes only the number that has to be computed — which is the
      // token rule's own line: a value that is genuinely dynamic.
      style={
        grid === undefined && !fitOnePage
          ? undefined
          : ({
              ...(grid === undefined ? {} : { '--m-grid': `${String(grid)}px` }),
              // THE ORIGIN (`--m-grid-x`, `--m-grid-y`) IS `PageSpans`', the one the ruler uses, so a grid line is a
              // mark the reader can find on the ruler; it is set on this element there, because it moves with every
              // scroll and this component must not render with it.
              //
              // FIT PAGE'S ROOM: the scroller's own measured height, each page's share of it.
              ...(fitOnePage && viewport !== undefined ? { '--m-fit-room': `${String(viewport.height)}px` } : {}),
            } as React.CSSProperties)
      }
      // ALWAYS NAMED, since it is a focusable region (2026-09-26): *Document pages* alone, and in the split view each
      // pane's own name — two scrollable regions under one name are two a screen-reader user cannot tell apart, and
      // telling them apart is the whole of what the split view is for. *Corrected:* this was named only when there were
      // two, which was right while the scroller could not take the focus.
      aria-label={
        label === undefined
          ? i18n._(PAGE_LIST_LABEL)
          : labelValues === undefined
            ? i18n._(label)
            : i18n._(label, labelValues)
      }
      ref={scroller}
      onWheel={onWheel}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      // CAPTURE, so a press on a page's own controls — an annotation, the text layer — still
      // makes this the pane the reader is in; a bubbling handler would miss any that stop it.
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      {Array.from({ length: pageCount }, (_, page) => {
        const slot = (
        <PageSlot
          key={page}
          page={page}
          ref={slotRef(page)}
          view={view}
          // THE ELEMENT FOLLOWS THE MARGIN and the draw follows the answer, and they are two props because
          // they part company on every command: a new version empties the rotation answers until the model
          // is asked again, and when one prop did both, the canvases on screen unmounted for those frames
          // and came back empty. Now the canvas keeps the previous drawing until a draw can start.
          mounted={visible.has(page)}
          // `has`, not a truthy `get`: a page answered with `undefined` is
          // answered, and a page answered with `0` is upright. Both draw.
          //
          // AND NOT BEFORE THE ZOOM IS RESOLVED: a fit with no page box falls back to 1, and a page drawn at that is
          // the first-open jump — drawn at 100%, then stretched, then drawn again.
          draw={visible.has(page) && rotations.has(page) && (resolved !== undefined || startBoxRefused)}
          rotation={rotations.get(page)}
          size={sizes.get(page) ?? lastKnownBefore(sizes, page) ?? startEstimate}
          zoom={shown}
          renderZoom={renderZoom}
          onMeasured={measured}
          onFailed={failed}
          // THE SLOT'S OWN MEASUREMENT, not the inherited estimate: an overlay
          // placed over a page using a neighbour's box would put every
          // rectangle in the wrong frame. `lastKnownBefore` above is a size
          // estimate for layout, which is a different tolerance from a
          // coordinate system.
          drawing={sizes.has(page) ? drawing : undefined}
          // GATED ON THE SLOT'S OWN MEASUREMENT for `drawing`'s reason: an outline
          // placed with a neighbour's box would sit over the wrong words.
          editing={sizes.has(page) ? editing : undefined}
          // THE SLOT'S OWN MEASUREMENT GATES THIS TOO, and for `drawing`'s
          // reason: a text layer placed with a neighbour's box would put every
          // line in the wrong frame, which reads as a selection that drifts
          // rather than as a missing measurement.
          text={sizes.has(page) ? pageText.get(page)?.lines : undefined}
          // NOT GATED ON THE MEASUREMENT, unlike the layer beside it. The note
          // carries no geometry — it is a sentence about the page, not a thing
          // placed on it — and gating it on `sizes` would hide it for exactly
          // as long as the page has not been drawn, which is when a reader is
          // most likely to be wondering.
          kind={pageText.get(page)?.kind}
          // THE SLOT'S OWN MEASUREMENT GATES THIS, for the text layer's reason: a preview placed
          // with a neighbour's box would cover the wrong region of the page.
          annotations={sizes.has(page) ? pageAnnotations.get(page) : undefined}
          search={search}
          // ONE MAP FOR THE LIST, the slot taking its own page's marks: an absent page is no marks, never a lookup the
          // slot has to know to skip.
          differences={differences}
          secondRasteriser={secondRasteriser}
          tiled={renderZoom * quality > tileAbove}
          quality={quality}
          badge={pageBadges}
          scroller={scroller}
          hidden={layout === 'single' && page !== onShow}
        />
        );
        // THE KEY ON THE OUTERMOST ELEMENT, `Thumbnails`' reason.
        return pageMenu === undefined ? slot : <Fragment key={page}>{pageMenu(page, slot)}</Fragment>;
      })}
    </div>
    </div>
  );
}

/**
 * WHAT THE PAGE AREA SHOWS UNTIL ITS FIRST PAGE IS DRAWN (§10.5's loading state): one sentence and a turning mark,
 * centred, never an empty slot. A status, so a screen reader hears that the document is opening; the mark is still
 * where motion is reduced. Exported because the page area shows it while the parser opens too, before there is a list.
 */
export function OpeningState(): ReactElement {
  const { i18n } = useLingui();
  return (
    <div className="m-page-opening" role="status">
      <Icon name="LoaderCircle" size="control" />
      <span>{i18n._(PAGE_OPENING)}</span>
    </div>
  );
}

/** The empty visible set, one identity, for a read that must not ask yet. */
const NOTHING_VISIBLE: ReadonlySet<number> = new Set();

/**
 * The nearest measured page before `page`, as the estimate for an unvisited one.
 *
 * Before, rather than nearest in either direction: a document is read forwards,
 * so the page above the one being estimated is the one most likely to share its
 * size, and it is the one already drawn.
 *
 * **AND AFTER, WHEN NOTHING BEFORE IS MEASURED.** A scroller mounting mid-document
 * — every edit since ADR-0084, and every tab brought back — draws its starting
 * page first, so the pages above it had no estimate and sat at the slot's minimum.
 * They grew as they drew, pushing the revealed page down: measured live
 * 2026-09-18, a reader on page 3 of 4 landed on page 2 after an insert. The page
 * below is the only size known then, and a wrong estimate is still a better one
 * than none.
 */
/**
 * Where the pages on screen lie inside the scroller, in CSS pixels, for the rulers and the grid — measured on every
 * scroll, and the rulers drawn from it.
 *
 * **Read from the slots' own boxes**, not computed from the page size and
 * a guessed margin: the slot is centred by CSS and the margin is a token, so
 * arithmetic here would be a second opinion about a layout the stylesheet
 * owns — and it would be wrong the day the margin changes.
 *
 * EVERY PAGE NEAR THE VIEWPORT, not the first page alone. Measured from page 1 only, the vertical ruler counted on
 * past page 1's foot, so every later page read a continuation of page 1's numbers (the owner's review of 0.1.6.0).
 * The pages are the ones `visible` already names, so this asks the slots the observer is watching and no others.
 *
 * The grid's origin is the CURRENT page's corner, which is also what the horizontal ruler measures from, with the page
 * beside it in a facing row. The numbers go NEGATIVE once a page is scrolled past, which is correct: a ruler whose
 * origin clamped to zero would put its zero mark wherever the viewport happened to start.
 *
 * ## ITS OWN COMPONENT, so a scroll renders this and nothing else
 *
 * The spans move with every scroll event, and while they were `PageList`'s state each event rendered the whole list:
 * every slot, and around each one its context-menu area, which evaluates the command registry when it renders.
 * Measured 2026-10-01 on the 210 MB scan: that render cost 1.48 s of an 8.1 s scroll, and 830 ms of garbage
 * collection beside it. Held here, a scroll renders the rulers; the list renders when a page enters or leaves
 * `visible`, which is what it draws.
 *
 * The grid's origin is the same reading (a grid line is a mark the reader can find on the ruler), so it is written
 * here as the scroller's two custom properties rather than through `PageList`'s style, which would render it again.
 */
function PageSpans({
  scroller,
  slotFor,
  visible,
  viewport,
  sizes,
  rulers,
  grid,
  unit,
  zoom,
}: {
  readonly scroller: React.RefObject<HTMLDivElement | null>;
  readonly slotFor: (page: number) => HTMLElement | undefined;
  readonly visible: ReadonlySet<number>;
  /** What moves the pages' corners besides a scroll, with `zoom`: read by nothing here, and a dependency of the measure. */
  readonly viewport: unknown;
  readonly sizes: unknown;
  readonly rulers: boolean;
  readonly grid: boolean;
  readonly unit: RulerUnit;
  readonly zoom: number;
}): ReactElement | null {
  const [spans, setSpans] = useState<{
    readonly across: readonly RulerSpan[];
    readonly down: readonly RulerSpan[];
    readonly size: { readonly width: number; readonly height: number };
  }>({ across: [], down: [], size: { width: 0, height: 0 } });

  // ON SCROLL, and whenever the zoom, the viewport or the page sizes move the pages' corners: a ruler that updated
  // only on scroll drifts on zoom, silently, and looks right until measured. The first reading is a frame callback
  // like every other, so the effect itself sets nothing.
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return undefined;
    const measure = (): void => {
      const outer = box.getBoundingClientRect();
      const pages = (visible.size > 0 ? [...visible] : [FIRST_PAGE.kernel])
        .sort((a, b) => a - b)
        .flatMap((page) => {
          const slot = slotFor(page);
          if (slot === undefined) return [];
          const inner = slot.getBoundingClientRect();
          // A HIDDEN SLOT (single page layout) has no box, and a span of zero would put a page's zero on another's.
          if (inner.height === 0) return [];
          return [
            {
              left: inner.left - outer.left,
              right: inner.right - outer.left,
              top: inner.top - outer.top,
              bottom: inner.bottom - outer.top,
            },
          ];
        });
      // THE TOPMOST PAGE ON SCREEN. `visible` reaches a viewport beyond the screen either way (`MARGIN`), so its first
      // page can lie wholly above it; the boxes read here say which pages the scrollport actually shows.
      const current = pages.find((page) => page.bottom > 0 && page.top < outer.height) ?? pages[0];
      if (current === undefined) return;
      if (grid) {
        box.style.setProperty('--m-grid-x', `${String(current.left)}px`);
        box.style.setProperty('--m-grid-y', `${String(current.top)}px`);
      }
      if (!rulers) return;
      setSpans({
        across: pages
          .filter((page) => page.top < current.bottom && page.bottom > current.top)
          .map((page) => ({ start: page.left, end: page.right })),
        down: pages.map((page) => ({ start: page.top, end: page.bottom })),
        size: { width: outer.width, height: outer.height },
      });
    };
    const first = requestAnimationFrame(measure);
    box.addEventListener('scroll', measure, { passive: true });
    return (): void => {
      cancelAnimationFrame(first);
      box.removeEventListener('scroll', measure);
    };
  }, [grid, rulers, scroller, slotFor, visible, zoom, viewport, sizes]);

  // THE GRID'S ORIGIN LEAVES WITH THE GRID: a property left on the scroller would anchor a grid nobody shows.
  useEffect(() => {
    const box = scroller.current;
    if (grid || box === null) return undefined;
    box.style.removeProperty('--m-grid-x');
    box.style.removeProperty('--m-grid-y');
    return undefined;
  }, [grid, scroller]);

  if (!rulers || spans.size.height === 0) return null;
  return <Rulers unit={unit} zoom={zoom} size={spans.size} across={spans.across} down={spans.down} />;
}

function lastKnownBefore(
  sizes: ReadonlyMap<number, Measured>,
  page: number,
): Measured | undefined {
  for (let index = page - 1; index >= 0; index -= 1) {
    const known = sizes.get(index);
    if (known !== undefined) return known;
  }
  for (const [index, known] of [...sizes].sort(([a], [b]) => a - b)) {
    if (index > page) return known;
  }
  return undefined;
}

/**
 * One page's slot: an element that always exists, and a canvas that does not.
 *
 * The canvas is unmounted when the page leaves the margin, which is what
 * releases the bitmap — clearing a canvas by setting `width = 0` keeps the
 * element and its backing store alive, and this is the one place that matters.
 */
function PageSlot({
  page,
  ref,
  view,
  mounted,
  draw,
  rotation,
  size,
  zoom,
  renderZoom,
  onMeasured,
  onFailed,
  drawing,
  editing,
  text,
  kind,
  annotations,
  search,
  differences,
  secondRasteriser,
  tiled,
  quality,
  badge,
  scroller,
  hidden,
}: {
  readonly page: number;
  readonly ref: (element: HTMLElement | null) => void;
  readonly view: DocumentView | undefined;
  /** Whether the page is inside the margin, which is what keeps its canvas (and its bitmap) alive. */
  readonly mounted: boolean;
  /** Whether it may rasterise now: mounted, and its rotation answered for this version. */
  readonly draw: boolean;
  readonly rotation: number | undefined;
  readonly size: Measured | undefined;
  readonly zoom: number;
  readonly renderZoom: number;
  readonly onMeasured: (page: number, measured: Measured) => void;
  /** Told that this page would not draw, with `onMeasured`'s need to be stable. */
  readonly onFailed: (page: number) => void;
  readonly drawing: PageListProps['drawing'];
  readonly editing: TextEditing | undefined;
  readonly text: readonly TextLayerLine[] | undefined;
  /** What the page is made of, or `undefined` before its text has arrived. */
  readonly kind: PageTextAnswer['kind'] | undefined;
  /** This page's existing annotations, or `undefined` before they are known or the slot is measured. */
  readonly annotations: readonly PageAnnotation[] | undefined;
  readonly search: SearchHighlight | undefined;
  /**
   * A comparison's marks on each page (Side by Side, ADR-0131), or `undefined` where this list shows no comparison.
   * Required for `search`'s reason: a mark crossing three components and dropped at one leaves every case green.
   */
  readonly differences: ReadonlyMap<number, readonly DifferenceMark[]> | undefined;
  /**
   * §6.1's second engine, or `undefined` where the setting is off.
   *
   * **Must be stable across renders**, like `onMeasured` beside it: the draw
   * effect depends on it, and an inline arrow would redraw every page on every
   * render of the list.
   */
  readonly secondRasteriser: SecondRasteriser | undefined;
  /** Whether this page is drawn in tiles (E1): the settled zoom is above the reader's threshold. */
  readonly tiled: boolean;
  /** The page-sharpness factor on the drawing scale (`rendering.quality`). */
  readonly quality: number;
  /** Whether the page's number is drawn at its foot. */
  readonly badge: boolean;
  /** The scroller the slot sits in, whose box decides which tiles are wanted. */
  readonly scroller: React.RefObject<HTMLElement | null>;
  /** Out of the layout: single page shows only the page on show, and a hidden slot is never visible, so never drawn. */
  readonly hidden: boolean;
}): ReactElement {
  const { i18n } = useLingui();
  const canvas = useRef<HTMLCanvasElement>(null);
  // THE SLOT'S OWN ELEMENT, beside the visible-pages ref it hands on: tiles measure it against the scroller, and the
  // paper colour is read from whichever canvas lies under a point in it. `ref` is minted once per page, so this is
  // stable.
  const own = useRef<HTMLDivElement | null>(null);
  const slotRef = useCallback(
    (element: HTMLDivElement | null): void => {
      own.current = element;
      ref(element);
    },
    [ref],
  );
  const paperAt = useCallback((x: number, y: number): string | undefined => paperIn(own.current, x, y), []);
  // THE VIEW THE PIXELS ON SCREEN CAME FROM, set when a draw has presented: the drawing overlay holds a
  // released shape until this moves past the view it was released over (`AnnotationOverlay.drawnWith`).
  const [drawnWith, setDrawnWith] = useState<DocumentView | undefined>(undefined);

  /**
   * What the page occupies on screen, in CSS pixels, at the CURRENT zoom.
   *
   * The bitmap may have been drawn at another one — that is the whole of the
   * first tier — so the ratio between them is what the browser stretches by.
   * `undefined` until a page has been drawn once, where the slot's minimum size
   * stands in.
   */
  const shown =
    size === undefined
      ? undefined
      : {
          width: (size.width / size.drawnAt) * zoom,
          height: (size.height / size.drawnAt) * zoom,
        };

  useEffect(() => {
    // THE CANVAS EXISTS WITHOUT A VIEW and stays blank, which is what lets the
    // surface have a shape while the parse is still running. Drawing is what
    // waits, not the element.
    if (!draw || view === undefined) return;
    // SUPERSEDED, NOT MERELY IGNORED: aborting cancels the PDF.js task holding this canvas, which
    // a flag did not — and the next draw on the same canvas was then refused (`renderPage`).
    const superseded = new AbortController();
    // A NEW DRAW OWNS THE MARKER. A failure belongs to the draw that threw, and one can throw for a
    // reason the next draw does not have: a page scrolled into view while a command's new view is
    // still opening is asked of the previous one, whose range main refuses as stale
    // (`useDocumentView`), and the new view's draw then succeeds. Left set, the marker outlived the
    // page it described. The thumbnail strip already cleared it here.
    if (canvas.current !== null) {
      delete canvas.current.dataset['failed'];
      delete canvas.current.dataset['failedReason'];
    }

    const drawPage = async (): Promise<void> => {
      // `devicePixelRatio × zoom`, which is E1's first rule: one bitmap pixel per
      // device pixel. Supersampling and letting CSS shrink the result is what
      // blurs text, and E1 allows it only as the explicit `renderQuality` setting,
      // which is the one factor here — 1 unless a reader chose otherwise.
      const scale = devicePixels() * renderZoom * quality;
      if (tiled) {
        // A PAGE DRAWN IN TILES IS MEASURED, NOT DRAWN, here: no one canvas holds it, so its size, box and rotation
        // come from PDF.js' viewport alone and each tile draws its own piece.
        const measured = await pageGeometry(view.document, pdfjsPageOf(page), scale, rotation);
        if (superseded.signal.aborted) return;
        onMeasured(page, { ...measured, drawnAt: scale });
        // MEASURED, not drawn: each tile presents itself, so this is the nearest moment this slot knows of.
        setDrawnWith(view);
        return;
      }
      const target = canvas.current;
      if (target === null) return;
      const drawn = await renderPage(
        view.document,
        pdfjsPageOf(page),
        target,
        scale,
        // `undefined` where the model has not answered yet, which hands PDF.js
        // the page's own `/Rotate`. A flat zero would silently flatten every
        // document that arrives already turned.
        rotation,
        superseded.signal,
        secondRasteriser,
      );
      if (superseded.signal.aborted) return;
      onMeasured(page, {
        width: drawn.width,
        height: drawn.height,
        drawnAt: scale,
        crop: drawn.crop,
        rotation: drawn.rotation,
      });
      setDrawnWith(view);
    };

    void drawPage().catch((error: unknown) => {
      // A SUPERSEDED DRAW IS NOT A FAILED PAGE: a newer draw of this page is running. Before the
      // draw could be cancelled, the refusal PDF.js gave the newer one landed here as a failure.
      if (error instanceof RenderCancelledError || superseded.signal.aborted) return;
      // A PAGE THAT WILL NOT DRAW SAYS SO, on the element itself.
      //
      // This was a bare swallow, and the swallow is the reassuring answer: a
      // blank slot is what a page still rendering looks like, so a page that
      // threw was indistinguishable from one that had not finished — for ever,
      // and to every observer including `canvasHarness.ts`, which waits sixty
      // seconds and then reports a bound it cannot interpret.
      //
      // One page, not a broken document, so the marker is on the canvas rather
      // than on the surface — but it is *a* marker, which is the difference
      // between a state and a silence.
      if (canvas.current !== null) {
        canvas.current.dataset['failed'] = 'true';
        // AND WHY, for whoever reads the marker from outside — `canvasHarness.ts` reports it, where a bare marker told
        // a CI run only that a draw had thrown.
        canvas.current.dataset['failedReason'] = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      }
      onFailed(page);
    });

    return (): void => {
      superseded.abort();
    };
  }, [draw, onFailed, onMeasured, page, quality, renderZoom, rotation, secondRasteriser, tiled, view]);

  // HELD DECODED WHILE MOUNTED (`pageResidency.ts`), so a zoom's redraw of a page in the margin does not decode its
  // images again; released when it leaves the margin, and PDF.js then closes them unless the strip is drawing it.
  useEffect(() => {
    if (!mounted || view === undefined) return undefined;
    return holdPage(view.document, pdfjsPageOf(page));
  }, [mounted, page, view]);

  // THE CANVAS'S PIXELS GO WITH IT. A canvas taken out of the page keeps its backing store until it is collected, and
  // with an accelerated 2D canvas that store is GPU memory; sized to nothing, it is released now. Captured when the
  // canvas mounts, because by the time this cleanup runs the ref has already let go of it.
  useLayoutEffect(() => {
    const element = canvas.current;
    return (): void => {
      if (element === null) return;
      element.width = 0;
      element.height = 0;
    };
  }, [mounted, tiled]);

  return (
    <div
      className="m-page-slot"
      hidden={hidden}
      ref={slotRef}
      // ITS HEIGHT ALSO AS A PROPERTY, which Fit page's margins centre it by (`.m-page-list--fit-page`): a value that is
      // genuinely dynamic, the token rule's own line.
      style={
        shown === undefined
          ? undefined
          : ({ width: shown.width, height: shown.height, '--m-slot-h': `${String(shown.height)}px` } as React.CSSProperties)
      }
    >
      {mounted && tiled ? (
        size === undefined || view === undefined ? null : (
          <PageTiles
            draw={draw}
            page={page}
            // THE PAGE'S DEVICE SIZE AT THE SCALE TILES DRAW AT, from the measured size and the scale it was measured
            // at — the same ratio `shown` places the slot by, so the tiles and the slot cannot disagree about the page.
            pageSize={{
              width: Math.ceil((size.width / size.drawnAt) * devicePixels() * renderZoom * quality),
              height: Math.ceil((size.height / size.drawnAt) * devicePixels() * renderZoom * quality),
            }}
            rotation={rotation}
            scale={devicePixels() * renderZoom * quality}
            scroller={scroller}
            slot={own}
            view={view}
            zoom={zoom}
          />
        )
      ) : mounted ? (
        <canvas
          className="m-page"
          data-page-canvas={String(page)}
          ref={canvas}
          // THE FIRST TIER. The backing store is whatever the last rasterisation
          // produced; these are what the browser paints it into. While the two
          // agree the page is 1:1 device pixels, and while a zoom is settling
          // they do not — which is the stale bitmap E1 permits transiently, and
          // `renderZoom` is what makes it transient.
          style={shown === undefined ? undefined : { width: shown.width, height: shown.height }}
        />
      ) : null}
      {/* UNDER the annotation overlay and over the canvas. The overlay is
          mounted only while a tool is active, so while somebody is drawing the
          drawing surface takes the pointer and while nobody is, this does —
          which keeps *where does a press go* a question with one answer. */}
      {/* WHY THERE IS NOTHING TO SELECT. A page of words a reader cannot
          select, cannot search and cannot spell-check looks like a broken
          application, and until this row landed nothing in the product said
          otherwise — the substrate simply returned no lines. It is a `<p>` in
          the page's own flow rather than an overlay, so it is in the reading
          order a screen reader takes and carries no geometry to get wrong. */}
      {/* THE PAGE'S NUMBER AT ITS FOOT, as the status bar counts it. Hidden from assistive technology: the page's
          place is what the status bar announces, and a second reading of it on every page would be noise. */}
      {badge ? (
        <span aria-hidden="true" className="m-page-badge" data-page-badge={String(page)}>
          {pdfjsPageOf(page)}
        </span>
      ) : null}
      {kind === 'image-only' ? (
        <p className="m-page-note" data-page-note={String(page)}>
          {i18n._(PAGE_IMAGE_ONLY)}
        </p>
      ) : null}
      {text === undefined || size === undefined ? null : (
        <TextLayer
          geometry={{ crop: size.crop, rotation: size.rotation, zoom }}
          lines={text}
          page={page}
          search={search}
        />
      )}
      {/* A COMPARISON'S MARKS (ADR-0131), over the text and under the annotations, gated on the slot's own measurement
          for the text layer's reason: a box placed with a neighbour's geometry would mark the wrong region. */}
      {differences === undefined || size === undefined ? null : (
        <DifferenceLayer
          geometry={{ crop: size.crop, rotation: size.rotation, zoom }}
          marks={differences.get(page) ?? NO_MARKS}
          page={page}
        />
      )}
      {/* OVER THE TEXT LAYER AND UNDER THE SELECTION: a preview of what a burn-in removes covers
          the page's content, and a selection box around that mark must still show on top of it.
          Mounted whether or not a tool is active — a mark is on the page either way. */}
      {annotations === undefined || size === undefined ? null : (
        <AnnotationLayer
          annotations={annotations}
          geometry={{ crop: size.crop, rotation: size.rotation, zoom }}
          page={page}
        />
      )}
      {/* OVER THE TEXT AND ITS MARKS, as the drawing overlay is: while Edit text is
          on, a press on an outlined block is the mode's, and nothing else holds
          the pointer — the two modes share one slot and never mount together. */}
      {editing === undefined || size === undefined ? null : (
        <TextEditPage
          paperAt={paperAt}
          editing={editing}
          geometry={{ crop: size.crop, rotation: size.rotation, zoom }}
          page={page}
        />
      )}
      {drawing === undefined || size === undefined ? null : (
        <SelectionLayer
          geometry={{ crop: size.crop, rotation: size.rotation, zoom }}
          page={page}
          selection={drawing.selection}
        />
      )}
      {/* NO DRAWING SURFACE for a tool whose gesture is a text selection: the text layer under it takes the drag. */}
      {drawing === undefined || size === undefined || drawing.tool.fromSelection !== undefined ? null : (
        <AnnotationOverlay
          geometry={{
            // THE BOX AND THE ROTATION THE BITMAP WAS DRAWN WITH, and the
            // CURRENT zoom. That pairing is deliberate: the overlay is laid out
            // over what the browser is painting, which during a settling zoom
            // is a stale bitmap stretched to the new scale. Taking `drawnAt`
            // here instead would place rectangles in the frame of the last
            // rasterisation rather than the one on screen.
            crop: size.crop,
            rotation: size.rotation,
            zoom,
          }}
          label={i18n._(ANNOTATION_SURFACE_LABEL, { page: pdfjsPageOf(page) })}
          onCommand={drawing.onCommand}
          drawnWith={drawnWith}
          page={page}
          tool={drawing.tool}
        />
      )}
    </div>
  );
}

/**
 * The paper's colour at a point in a slot, in CSS pixels from the slot's corner — read from whichever drawn canvas lies
 * under it: the whole page's, or the tile holding that point. ONE reader for both, so the text editor's background
 * cannot depend on how the page happens to be drawn.
 *
 * THE BACKING STORE IS NOT THE CSS BOX: a bitmap is drawn at the device's pixel ratio and at the last settled zoom, so
 * a CSS point is scaled into it before it is read.
 */
function paperIn(slot: HTMLElement | null, x: number, y: number): string | undefined {
  if (slot === null) return undefined;
  const corner = slot.getBoundingClientRect();
  for (const drawn of slot.querySelectorAll<HTMLCanvasElement>('canvas.m-page, canvas.m-page-tile')) {
    const box = drawn.getBoundingClientRect();
    const left = box.left - corner.left;
    const top = box.top - corner.top;
    if (box.width === 0 || x < left || y < top || x >= left + box.width || y >= top + box.height) continue;
    const ratio = drawn.width / box.width;
    const pixel = drawn
      .getContext('2d', { willReadFrequently: true })
      ?.getImageData(Math.max(0, Math.round((x - left) * ratio)), Math.max(0, Math.round((y - top) * ratio)), 1, 1).data;
    if (pixel === undefined) return undefined;
    return `rgb(${String(pixel[0] ?? 255)}, ${String(pixel[1] ?? 255)}, ${String(pixel[2] ?? 255)})`;
  }
  return undefined;
}

/**
 * A page drawn in tiles (E1): the cells the scroller shows and a margin, each its own canvas placed over the slot.
 *
 * ## What is visible is asked of the SCROLLER, on its own events
 *
 * The slot's rectangle against the scroller's, in CSS pixels, converted to the page's device pixels at the drawing
 * scale — `scale / zoom` per CSS pixel, since the slot is SHOWN at `zoom` and DRAWN at `scale`. Measured on a scroll or
 * a resize, once a frame, and set only when the tiles change, so a scroll inside a cell draws nothing.
 */
function PageTiles({
  view,
  draw,
  page,
  rotation,
  scale,
  zoom,
  pageSize,
  scroller,
  slot,
}: {
  readonly view: DocumentView;
  /** The slot's: whether a tile may rasterise now. A tile on screen keeps its last drawing until it may. */
  readonly draw: boolean;
  readonly page: number;
  readonly rotation: number | undefined;
  readonly scale: number;
  readonly zoom: number;
  /** The page's size in device pixels at `scale`. */
  readonly pageSize: { readonly width: number; readonly height: number };
  readonly scroller: React.RefObject<HTMLElement | null>;
  readonly slot: React.RefObject<HTMLElement | null>;
}): ReactElement {
  const [tiles, setTiles] = useState<readonly Tile[]>([]);
  const { width, height } = pageSize;

  useEffect(() => {
    const box = scroller.current;
    const own = slot.current;
    if (box === null || own === null) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const shown = box.getBoundingClientRect();
      const at = own.getBoundingClientRect();
      const perCss = scale / zoom;
      const next = tilesCovering(
        { width, height },
        {
          x: (shown.left - at.left) * perCss,
          y: (shown.top - at.top) * perCss,
          width: shown.width * perCss,
          height: shown.height * perCss,
        },
      );
      setTiles((current) => (sameTiles(current, next) ? current : next));
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    box.addEventListener('scroll', schedule, { passive: true });
    const resized = new ResizeObserver(schedule);
    resized.observe(box);
    return (): void => {
      box.removeEventListener('scroll', schedule);
      resized.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [height, scale, scroller, slot, width, zoom]);

  return (
    <div className="m-page-tiles" data-page-tiles={String(page)}>
      {tiles.map((tile) => (
        <PageTile key={tile.key} draw={draw} page={page} rotation={rotation} scale={scale} tile={tile} view={view} zoom={zoom} />
      ))}
    </div>
  );
}

/** Whether two tile lists are the same cells over the same pixels — a scroll inside a cell changes neither. */
function sameTiles(a: readonly Tile[], b: readonly Tile[]): boolean {
  return (
    a.length === b.length &&
    a.every((tile, at) => {
      const other = b[at];
      return (
        other?.key === tile.key &&
        other.x === tile.x &&
        other.y === tile.y &&
        other.width === tile.width &&
        other.height === tile.height
      );
    })
  );
}

/**
 * One tile. It keeps the rectangle and scale it was LAST drawn at and places itself from those, so while a new scale is
 * settling the old bitmap is stretched into its place — E1's two tiers, per tile — rather than drawn in the wrong one.
 * Hidden until its first draw, so a cell never shows an empty box where the page is.
 */
function PageTile({
  view,
  draw,
  page,
  rotation,
  tile,
  scale,
  zoom,
}: {
  readonly view: DocumentView;
  readonly draw: boolean;
  readonly page: number;
  readonly rotation: number | undefined;
  readonly tile: Tile;
  readonly scale: number;
  readonly zoom: number;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly scale: number }>();
  const { x, y, width, height } = tile;

  useEffect(() => {
    const target = canvas.current;
    if (target === null || !draw) return;
    const superseded = new AbortController();
    // A NEW DRAW OWNS THE MARKER: a failure belongs to the draw that threw, and the slot's, above, says why.
    delete target.dataset['failed'];
    const region = { x, y, width, height };
    void renderRegion(view.document, pdfjsPageOf(page), target, scale, rotation, region, superseded.signal)
      .then(() => {
        if (!superseded.signal.aborted) setDrawn({ ...region, scale });
      })
      .catch((error: unknown) => {
        if (error instanceof RenderCancelledError || superseded.signal.aborted) return;
        // A TILE THAT WILL NOT DRAW SAYS SO, on the element, as a whole page does.
        target.dataset['failed'] = 'true';
      });
    return (): void => {
      superseded.abort();
    };
  }, [draw, height, page, rotation, scale, view, width, x, y]);

  const per = drawn === undefined ? 0 : zoom / drawn.scale;
  return (
    <canvas
      className="m-page-tile"
      data-tile={tile.key}
      ref={canvas}
      style={
        drawn === undefined
          ? { visibility: 'hidden' }
          : { left: drawn.x * per, top: drawn.y * per, width: drawn.width * per, height: drawn.height * per }
      }
    />
  );
}
