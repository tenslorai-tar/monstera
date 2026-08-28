import type { DocId, DocVersion } from '@monstera/shared';
import { type StoreApi, createStore } from 'zustand/vanilla';

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
}

export type DocumentStore = StoreApi<DocumentState & DocumentActions>;

/**
 * Creates the store for one document.
 *
 * `docId` is captured rather than passed per call, which is what stops a write
 * naming a document other than this store's own.
 */
export function createDocumentStore(docId: DocId, version: DocVersion): DocumentStore {
  return createStore<DocumentState & DocumentActions>()((set, get) => ({
    docId,
    version,
    observed: (next) => {
      if (next <= get().version) return false;
      set({ version: next });
      return true;
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
