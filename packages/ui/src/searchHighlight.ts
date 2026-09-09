import type { TextMatchOptions } from '@monstera/shared';

/**
 * Painting a search's matches onto the text layer's own glyphs.
 *
 * ## Why the CSS Custom Highlight API and not elements
 *
 * The obvious way to highlight a match is to wrap it in a `<mark>`. That is the
 * wrong shape here for a reason specific to this layer: the text layer is
 * **transparent text placed over a raster**, and its whole contract is that the
 * browser owns selection, caret, double-click-to-word, copy and the
 * accessibility tree. Splitting a line's single text node into three to wrap a
 * match changes what a selection copies, moves the caret's offsets, and
 * introduces elements the accessibility tree then has to be told to ignore.
 *
 * The Custom Highlight API paints over ranges without touching the tree. The
 * nodes are unchanged, so everything the platform was doing keeps working, and
 * a match that spans a wrap is one `Range` across two line elements rather than
 * two elements pretending to be one match.
 *
 * ## The registry is a DOCUMENT-level singleton, so this module is its writer
 *
 * `CSS.highlights` is per window, keyed by name. Several text layers are
 * mounted at once — continuous scroll keeps a few pages alive — and each knows
 * only its own ranges. If each wrote the registry directly, the last one to
 * render would erase the others; if each used its own name, the stylesheet
 * would need a rule per page.
 *
 * So the layers contribute and this module composes: {@link HighlightPainter}
 * holds one entry per page and rewrites both named highlights whenever one
 * changes. One writer, many contributors (B3).
 *
 * ## Absence is a real state, not an error
 *
 * The API is not everywhere, and it does not exist at all in the test
 * environment. A missing registry means the matches are still found, still
 * listed and still navigable — only unpainted. So {@link platformSink} answers
 * `null` rather than throwing, and every caller treats that as *nothing to do*.
 */

/** The two names this build registers, and the stylesheet's `::highlight()`. */
export const HIGHLIGHT_ALL = 'monstera-find';
export const HIGHLIGHT_ACTIVE = 'monstera-find-active';

/**
 * What a painter writes to, so the platform registry is one implementation.
 *
 * Injected rather than reached for, because the alternative is a module whose
 * only behaviour is a side effect on a global that the test environment does
 * not have — which would leave the composition untested and the feature
 * detection standing in for coverage.
 */
export interface HighlightSink {
  readonly show: (name: string, ranges: readonly Range[]) => void;
  readonly hide: (name: string) => void;
}

/** Which occurrence a reader is currently on. */
export interface ActiveMatch {
  readonly page: number;
  readonly line: number;
  readonly offset: number;
}

/**
 * What a text layer needs in order to know what to paint.
 *
 * **The query is the one that was SEARCHED, not the one in the box.** A reader
 * who runs a search and then keeps typing has a find field holding a query
 * nothing has answered yet; painting that one would highlight matches beside a
 * result list counting different ones. The find bar therefore captures this
 * into the same state variant that holds the answer, so the two cannot
 * disagree (B5).
 */
export interface SearchHighlight {
  readonly query: string;
  readonly options: TextMatchOptions;
  readonly active?: ActiveMatch | undefined;
}

/** One page's contribution. */
interface PageRanges {
  readonly all: readonly Range[];
  readonly active: readonly Range[];
}

/** Composes every mounted page's ranges into the two named highlights. */
export interface HighlightPainter {
  /** Replaces one page's contribution, or removes it when `ranges` is null. */
  readonly setPage: (page: number, ranges: PageRanges | null) => void;
  /** Removes everything. For a document closing, not for a page scrolling away. */
  readonly clear: () => void;
}

export function createHighlightPainter(sink: HighlightSink): HighlightPainter {
  const pages = new Map<number, PageRanges>();

  const repaint = (): void => {
    const all: Range[] = [];
    const active: Range[] = [];
    // BY PAGE NUMBER, so the ranges arrive in document order however the pages
    // happened to mount. Nothing downstream reads the order today; a registry
    // whose contents depend on scroll history is the kind of thing that makes a
    // later difference impossible to explain.
    for (const page of [...pages.keys()].sort((a, b) => a - b)) {
      const entry = pages.get(page);
      if (entry === undefined) continue;
      all.push(...entry.all);
      active.push(...entry.active);
    }
    // HIDDEN RATHER THAN SHOWN EMPTY. An empty `Highlight` is legal and paints
    // nothing, so the two are indistinguishable on screen — and a registry
    // holding an entry for a search that ended is a thing the next reader has
    // to work out is inert.
    if (all.length === 0) sink.hide(HIGHLIGHT_ALL);
    else sink.show(HIGHLIGHT_ALL, all);
    if (active.length === 0) sink.hide(HIGHLIGHT_ACTIVE);
    else sink.show(HIGHLIGHT_ACTIVE, active);
  };

  return {
    setPage: (page, ranges) => {
      if (ranges === null) pages.delete(page);
      else pages.set(page, ranges);
      repaint();
    },
    clear: () => {
      pages.clear();
      repaint();
    },
  };
}

/**
 * The window's own registry, or `null` where the API is absent.
 *
 * Read through `Reflect.get` rather than named directly: `CSS` and `Highlight`
 * are declared by the DOM lib, so naming them compiles everywhere and throws at
 * runtime in an environment that has neither — which is every unit test in this
 * package. The feature detection has to be a value check, not a type one.
 */
export function platformSink(): HighlightSink | null {
  const css = Reflect.get(globalThis, 'CSS') as { highlights?: HighlightRegistry } | undefined;
  const highlights = css?.highlights;
  const construct = Reflect.get(globalThis, 'Highlight') as
    | (new (...ranges: readonly Range[]) => Highlight)
    | undefined;
  if (highlights === undefined || typeof construct !== 'function') return null;
  return {
    show: (name, ranges) => {
      highlights.set(name, new construct(...ranges));
    },
    hide: (name) => {
      highlights.delete(name);
    },
  };
}

/**
 * The one painter the mounted text layers share, or `null`.
 *
 * Module state, and that is what the thing being written is: a per-window
 * registry outlives every component that contributes to it, so a painter
 * rebuilt on render would erase the pages that did not re-render with it.
 * Resolved once, lazily, because reading `globalThis` at module scope runs
 * before a test can arrange one.
 */
let shared: HighlightPainter | null | undefined;

export function sharedPainter(): HighlightPainter | null {
  if (shared === undefined) {
    const sink = platformSink();
    shared = sink === null ? null : createHighlightPainter(sink);
  }
  return shared;
}

/**
 * Drops the resolved painter, so a test can arrange a different environment.
 *
 * **A shipped export with only test callers, and the rule that permits it**
 * (finding CCCCCC-5). `editFidelity.proof.mjs` refuses the same move in words —
 * *an unused render API added to a shipped module for a proof's convenience is
 * an abstraction with one caller* — and both decisions were taken in one range,
 * with nothing to point at.
 *
 * The line between them is **who owns the state**. A capability an instrument
 * wants is the instrument's to bind; it can rasterise a page itself, and adding
 * a `render` to the adapter would put an abstraction in shipped code for a
 * caller outside it. Memoised module state is the opposite: this module owns
 * it, nothing else can reach it, and *the platform has no Custom Highlight API*
 * is a branch that would otherwise be unreachable on any runner where it does.
 *
 * So: **expose a reset only for state this module itself memoises, never a
 * capability a caller could bind for itself.** Three callers here, all tests,
 * and that is the whole surface.
 */
export function resetSharedPainter(): void {
  shared = undefined;
}
