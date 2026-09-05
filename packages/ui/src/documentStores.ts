import {
  type DocId,
  type DocVersion,
  type PriorPageOrder,
  remapPageIndex,
} from '@monstera/shared';
import { type StoreApi, createStore } from 'zustand/vanilla';

import { DEFAULT_ZOOM, type ZoomMode } from './zoom.js';

/**
 * One store per open document, created on open and dropped on close
 * (ARCHITECTURE §6).
 *
 * ## What this makes unrepresentable, and why it is a SHAPE rather than a guard
 *
 * §6: *"an async result landing in the wrong document's state, and the next save
 * writing one document's content into another's file"*. Both are impossible
 * here because there is no shared place for them to land — a store holds one
 * document's state and cannot be reached with another's id. Nothing has to
 * remember a generation token, because nothing is generational.
 *
 * The alternative this replaces is a singleton store keyed by `DocId`, where
 * every write carries the key and every read has to be right about it. That
 * design is correct exactly as often as its callers are, and its failure is
 * silent: the wrong document's state updates and nothing throws.
 *
 * ## `zustand/vanilla`, not the React hook (ADR-0005)
 *
 * `createStore` produces a store with no React binding, passed to components
 * through context. Two reasons, and the second is the load-bearing one: this
 * file becomes testable in Node with no DOM, and — because a store is a value
 * rather than a module-level hook — *one per document* is expressible at all.
 * `create()` from `zustand` returns a hook bound to a single store instance,
 * which is the singleton this section forbids.
 *
 * ## App-shell state is NOT here
 *
 * §6: *"App-shell state (theme, active tab, panels, settings cache) is a
 * separate small store. Never let a singleton store accumulate document
 * state."* The separation is enforced by {@link DocumentState} being a closed
 * interface: shell state has nowhere to go in it without an edit that a reader
 * of this file would see.
 */

/**
 * What the renderer knows about one open document.
 *
 * **Deliberately minimal, and it is not a placeholder.** Invariant 2 says the
 * renderer holds an opaque `DocId` and a `DocVersion` and never a path or
 * mutable bytes, so this is the whole of what a document's state can be until a
 * feature adds a view concern. Inventing zoom, page or selection now would be
 * state nothing reads — the display-only sin, in a store.
 */
export interface DocumentState {
  /** The document this store belongs to. Fixed at creation and never written. */
  readonly docId: DocId;
  /**
   * The newest version this renderer has observed.
   *
   * Monotonic by construction — see {@link DocumentActions.observed}, which
   * ignores an older one rather than trusting arrival order.
   */
  readonly version: DocVersion;
  /**
   * The page the reader is looking at, zero-based.
   *
   * **The first view concern to live here**, and this file's own header said
   * what would justify it: *"inventing zoom, page or selection now would be
   * state nothing reads"*. Page navigation reads it, so it stops being an
   * invention.
   */
  readonly page: number;
  /**
   * Where the reader has JUMPED, in order, with {@link historyAt} pointing at
   * the current entry.
   *
   * ## Jumps, not scrolls, and that distinction is the feature
   *
   * Scrolling through a document does not push. If it did, Alt+Left after
   * reading ten pages would step back one page at a time and the control would
   * be useless — what a reader wants is *return me to where I jumped from*.
   * So `viewing` moves {@link page} and leaves this alone; `jumpTo` pushes.
   *
   * ## In the DOCUMENT'S store, which is the whole reason this is not App state
   *
   * A back-stack that outlived its document would offer to return a reader to
   * page 40 of a file they closed. Held here, it cannot: §6 drops the store on
   * close, so the lifetime is the shape rather than a cleanup somebody
   * remembers.
   */
  readonly history: readonly number[];
  /** The index into {@link history} the reader is currently at. */
  readonly historyAt: number;
  /**
   * How this document is magnified.
   *
   * ## HERE BECAUSE OF TABS, and that is this file's own rule being met again
   *
   * The header says a view concern belongs in this store once something reads
   * it, and zoom lived in `App` while there was one document — where it was
   * indistinguishable from *the application's zoom*. With two documents open,
   * a reader who fits one to the width and reads the other at 200% and finds
   * both changed by switching tabs has met a singleton wearing a per-document
   * name. Which document a magnification belongs to is only a question once
   * there are two, and this is the answer.
   *
   * A **mode**, not a number, for the reason `App` gives: nothing here can
   * resolve a fit, because nothing here knows how wide the scroller is.
   */
  readonly zoom: ZoomMode;
  /**
   * How many pages the document has, once its parser has answered.
   *
   * `undefined` until then, which is a real state: the navigation commands
   * clamp against it and a count of zero would let them clamp to nothing.
   *
   * Per document for zoom's reason and one sharper: a stale count is a
   * *wrong* statement rather than an inconvenient one. Switching from a
   * ten-page document to a two-page one with a shared count leaves the status
   * bar reading "Page 1 of 10" over a document that has two.
   */
  readonly pageCount: number | undefined;
}

export interface DocumentActions {
  /**
   * Records a version the renderer has seen, if it is newer.
   *
   * **Older versions are dropped rather than applied**, because IPC replies are
   * not ordered: a slow answer for version 4 can arrive after a fast one for
   * version 5, and applying it would move the renderer backwards. That is a
   * different failure from the cross-document race this store's shape removes —
   * same document, wrong order — so it needs a mechanism of its own, and
   * monotonicity is the cheapest one that cannot be got wrong by a caller.
   *
   * @returns whether the version was taken, so a caller can tell *applied* from
   * *ignored*. A void return would make a dropped update and an applied one the
   * same observation.
   */
  readonly observed: (version: DocVersion) => boolean;

  /**
   * Records the page the reader has scrolled to.
   *
   * Moves {@link DocumentState.page} and **does not touch the history**. See
   * {@link DocumentState.history} for why that is the feature rather than an
   * omission.
   */
  readonly viewing: (page: number) => void;

  /**
   * Records a deliberate jump, pushing it onto the history.
   *
   * **Truncates anything ahead**, which is what makes forward mean *the branch
   * you were on* rather than *some page you once visited*. Jumping to the page
   * you are already at is ignored: a control pressed twice should not fill the
   * stack with one page.
   */
  readonly jumpTo: (page: number) => void;

  /**
   * Steps back through the history.
   *
   * @returns the page to go to, or `undefined` at the start. **A page and not a
   * boolean**, because the caller has to scroll somewhere and re-reading the
   * store for it would be a second read of a value this call already knows.
   */
  readonly back: () => number | undefined;

  /** Steps forward. See {@link back}. */
  readonly forward: () => number | undefined;

  /**
   * Follows the back-stack across a page move — **the remap contract's first
   * caller outside a test.**
   *
   * ## Why the history needs this and nothing else in the renderer does
   *
   * Every other consumer of a page index re-queries after a version bump:
   * destinations and the outline are read fresh, so they resolve against the
   * document as it now is. The back-stack cannot. It is a record of where the
   * reader HAS BEEN, held in the renderer, and a move renumbers the pages it
   * points at — so `Alt+Left` after a reorder returns the reader to a page they
   * were never on, silently and looking correct.
   *
   * ## It asks the same array the tree rewrite was built from
   *
   * `remapPageIndex` is the kernel's own permutation, moved to
   * `@monstera/shared` so this side can reach it. Deriving the mapping here
   * instead would be a second opinion about what a move means, agreeing with
   * the engine until one of them was fixed (B3a).
   *
   * ## An entry that no longer resolves is DROPPED, not clamped
   *
   * `remapPageIndex` answers `null` for a page the document no longer has, and
   * the honest response is to forget it: clamping would put a page the reader
   * never visited into their history, which is worse than a shorter stack.
   * `historyAt` moves with the entries before it so the cursor still points at
   * the same jump.
   */
  readonly movedPages: (count: number, move: PriorPageOrder) => void;

  /** Records the magnification the reader chose for THIS document. */
  readonly zoomed: (mode: ZoomMode) => void;

  /**
   * Records how many pages the parser found.
   *
   * Idempotent by value: the scroller reports on every mount, and a set that
   * always wrote would wake every subscriber for an unchanged number.
   */
  readonly counted: (pages: number) => void;
}

/**
 * How many jumps the history keeps.
 *
 * A bound rather than none, because a session is unbounded and an array that
 * only grows is a leak with a slow fuse. Fifty is far past what a reader
 * retraces by hand and small enough that the cost never matters.
 *
 * **The OLDEST goes**, and the index moves with it — dropping from the front
 * without adjusting `historyAt` would silently renumber every entry and send
 * `back` to the wrong page.
 */
const HISTORY_LIMIT = 50;

export type DocumentStore = StoreApi<DocumentState & DocumentActions>;

/**
 * Creates the store for one document.
 *
 * `docId` is captured rather than passed per call, which is what stops a write
 * naming a document other than this store's own.
 */
export function createDocumentStore(
  docId: DocId,
  version: DocVersion,
  page = 0,
): DocumentStore {
  return createStore<DocumentState & DocumentActions>()((set, get) => ({
    docId,
    version,
    page,
    // SEEDED WITH THE OPENING PAGE, so `back` has somewhere to return to after
    // the reader's first jump. An empty history would make the first Alt+Left
    // do nothing, which reads as a broken control rather than as a boundary.
    history: [page],
    historyAt: 0,
    zoom: DEFAULT_ZOOM,
    // NOT ZERO. A document whose parser has not answered has an unknown page
    // count, and zero is a number the navigation commands would clamp against.
    pageCount: undefined,
    observed: (next) => {
      if (next <= get().version) return false;
      set({ version: next });
      return true;
    },
    viewing: (next) => {
      if (next === get().page) return;
      set({ page: next });
    },
    jumpTo: (next) => {
      const state = get();
      if (next === state.page) return;
      const kept = [...state.history.slice(0, state.historyAt + 1), next];
      const dropped = Math.max(0, kept.length - HISTORY_LIMIT);
      set({
        page: next,
        history: kept.slice(dropped),
        historyAt: kept.length - 1 - dropped,
      });
    },
    back: () => {
      const state = get();
      if (state.historyAt <= 0) return undefined;
      const at = state.historyAt - 1;
      const target = state.history[at];
      if (target === undefined) return undefined;
      set({ historyAt: at, page: target });
      return target;
    },
    forward: () => {
      const state = get();
      const at = state.historyAt + 1;
      const target = state.history[at];
      if (target === undefined) return undefined;
      set({ historyAt: at, page: target });
      return target;
    },
    movedPages: (count, move) => {
      const state = get();
      // REMAPPED THEN FILTERED, in that order, so the cursor is computed
      // against the entries that survive rather than against the old indices.
      const remapped = state.history.map((page) => remapPageIndex(count, move, page));
      const kept: number[] = [];
      let at = 0;
      for (const [index, page] of remapped.entries()) {
        if (page === null) continue;
        if (index <= state.historyAt) at = kept.length;
        kept.push(page);
      }
      if (kept.length === 0) {
        // EVERY ENTRY GONE is a real state — a one-page history whose page was
        // moved out of range cannot happen, but a caller may hand any move.
        // Seeding with the current page keeps the invariant `initial` states:
        // an empty history makes the first Alt+Left do nothing for a reason
        // the reader cannot see.
        const here = remapPageIndex(count, move, state.page) ?? state.page;
        set({ page: here, history: [here], historyAt: 0 });
        return;
      }
      set({
        page: remapPageIndex(count, move, state.page) ?? state.page,
        history: kept,
        historyAt: at,
      });
    },
    zoomed: (mode) => {
      set({ zoom: mode });
    },
    counted: (pages) => {
      if (pages === get().pageCount) return;
      set({ pageCount: pages });
    },
  }));
}

/**
 * The open documents' stores, and the only thing that creates or drops one.
 *
 * ## `get` MISSES rather than creates, and that is invariant L10's half here
 *
 * *Async results check their document is still open before committing.* A
 * get-or-create registry would answer every lookup with a store, so a reply
 * arriving after close would resurrect state for a document that is gone and
 * report success. Missing is the answer that lets a caller take L10's check —
 * and it is the same rule `engineSessions.ts` states on the other side of the
 * process boundary: *get-or-miss, never get-or-create*.
 */
export class DocumentStores {
  readonly #stores = new Map<DocId, DocumentStore>();

  /**
   * Mints the store for a newly opened document.
   *
   * Refuses a `DocId` that already has one. A second `open` for the same
   * document means either two opens with no close between them or a `DocId`
   * reused, and both are defects the caller has to hear about — replacing the
   * store silently would drop the state the first one holds.
   */
  open(docId: DocId, version: DocVersion): DocumentStore {
    if (this.#stores.has(docId)) {
      throw new Error(
        `${docId} already has a store. A second open with no close between them would discard ` +
          `the first store's state, so this is reported rather than resolved.`,
      );
    }
    const store = createDocumentStore(docId, version);
    this.#stores.set(docId, store);
    return store;
  }

  /** The store for an open document, or `undefined` when it is closed. */
  get(docId: DocId): DocumentStore | undefined {
    return this.#stores.get(docId);
  }

  /**
   * Drops a document's store.
   *
   * @returns whether there was one, so closing twice is distinguishable from
   * closing something that was never open.
   */
  close(docId: DocId): boolean {
    return this.#stores.delete(docId);
  }

  /** How many documents are open. For diagnostics and for controls that assert a drop. */
  get size(): number {
    return this.#stores.size;
  }
}
