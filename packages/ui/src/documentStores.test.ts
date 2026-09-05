import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DocumentStores, createDocumentStore } from './documentStores.js';

const ONE = asDocId('11111111-1111-4111-8111-111111111111');
const TWO = asDocId('22222222-2222-4222-8222-222222222222');

describe('createDocumentStore', () => {
  it('carries its own docId, which no write can change', () => {
    const store = createDocumentStore(ONE, asDocVersion(1));
    store.getState().observed(asDocVersion(2));
    expect(store.getState().docId).toBe(ONE);
  });

  it('takes a newer version and reports that it did', () => {
    const store = createDocumentStore(ONE, asDocVersion(1));
    expect(store.getState().observed(asDocVersion(2))).toBe(true);
    expect(store.getState().version).toBe(2);
  });

  it('IGNORES an older version, because IPC replies are not ordered', () => {
    // A slow answer for version 4 arriving after a fast one for version 5 would
    // move the renderer backwards. Same document, wrong order — a different
    // failure from the cross-document race the per-document shape removes, so
    // it needs its own mechanism.
    const store = createDocumentStore(ONE, asDocVersion(5));
    expect(store.getState().observed(asDocVersion(4))).toBe(false);
    expect(store.getState().version).toBe(5);
  });

  it('ignores the SAME version too, so a duplicate reply is not an update', () => {
    const store = createDocumentStore(ONE, asDocVersion(5));
    expect(store.getState().observed(asDocVersion(5))).toBe(false);
  });
});

describe('DocumentStores', () => {
  it('gives two documents two stores, and a write to one leaves the other alone', () => {
    // THE RACE CLASS, asserted rather than assumed away. §6's claim is that an
    // async result cannot land in the wrong document's state; this is what that
    // means when written down.
    const stores = new DocumentStores();
    const one = stores.open(ONE, asDocVersion(1));
    const two = stores.open(TWO, asDocVersion(1));

    one.getState().observed(asDocVersion(9));

    expect(one.getState().version).toBe(9);
    expect(two.getState().version).toBe(1);
    expect(one).not.toBe(two);
  });

  it('MISSES after close rather than creating, which is what lets L10 be checked', () => {
    // A get-or-create registry answers every lookup with a store, so a reply
    // arriving after close resurrects state for a document that is gone and
    // reports success. Missing is the answer a caller can act on.
    const stores = new DocumentStores();
    stores.open(ONE, asDocVersion(1));
    expect(stores.get(ONE)).toBeDefined();

    expect(stores.close(ONE)).toBe(true);
    expect(stores.get(ONE)).toBeUndefined();
    expect(stores.size).toBe(0);
  });

  it('distinguishes closing an open document from closing one that never was', () => {
    const stores = new DocumentStores();
    stores.open(ONE, asDocVersion(1));
    expect(stores.close(ONE)).toBe(true);
    expect(stores.close(ONE)).toBe(false);
  });

  it('REFUSES a second open, rather than discarding the first store silently', () => {
    const stores = new DocumentStores();
    stores.open(ONE, asDocVersion(1));
    expect(() => stores.open(ONE, asDocVersion(1))).toThrow(/already has a store/u);
  });

  it('CONTROL: the same open succeeds after a close, so the refusal is the collision', () => {
    // Without this the case above passes for a build where `open` throws
    // always, and refusal-versus-impossibility is the pair the negative-probe
    // rule says to separate.
    const stores = new DocumentStores();
    stores.open(ONE, asDocVersion(1));
    stores.close(ONE);
    expect(() => stores.open(ONE, asDocVersion(1))).not.toThrow();
  });

  it('drops the store itself on close, so a held reference cannot be the live one', () => {
    // The dropped store keeps working — it is an ordinary object and nothing
    // can reach into a caller's variable. What matters is that the REGISTRY no
    // longer hands it out, so a component resolving its store by DocId after a
    // close gets nothing rather than a store whose writes go nowhere anybody
    // reads.
    const stores = new DocumentStores();
    const held = stores.open(ONE, asDocVersion(1));
    stores.close(ONE);

    held.getState().observed(asDocVersion(2));
    expect(held.getState().version).toBe(2);
    expect(stores.get(ONE)).toBeUndefined();
  });
});

describe('the navigation history', () => {
  function fresh() {
    return createDocumentStore(ONE, asDocVersion(1), 0);
  }

  it('SCROLLING does not push, which is the whole distinction', () => {
    // THE SEPARATING CASE. A history that recorded scrolling would make
    // Alt+Left step back one page at a time through everything the reader read,
    // which is useless exactly where it is wanted. A case that only checked
    // `page` would pass for that implementation.
    const store = fresh();
    store.getState().viewing(1);
    store.getState().viewing(2);
    store.getState().viewing(3);

    expect(store.getState().page).toBe(3);
    expect(store.getState().history).toStrictEqual([0]);
    expect(store.getState().back()).toBeUndefined();
  });

  it('a jump pushes, and back returns to where the reader jumped FROM', () => {
    const store = fresh();
    store.getState().viewing(4);
    store.getState().jumpTo(40);

    expect(store.getState().page).toBe(40);
    // Back goes to the previous ANCHOR, not to page 4 — the reader scrolled
    // there and scrolling is not a location the history holds.
    expect(store.getState().back()).toBe(0);
    expect(store.getState().page).toBe(0);
    expect(store.getState().forward()).toBe(40);
  });

  it('a jump TRUNCATES the forward branch', () => {
    // Without this, forward means "some page you once visited" rather than "the
    // branch you were on", and a reader who goes back and then somewhere else
    // can still walk forward into a history that no longer exists.
    const store = fresh();
    store.getState().jumpTo(10);
    store.getState().jumpTo(20);
    store.getState().back();
    store.getState().jumpTo(99);

    expect(store.getState().history).toStrictEqual([0, 10, 99]);
    expect(store.getState().forward()).toBeUndefined();
  });

  it('ignores a jump to the page already shown', () => {
    const store = fresh();
    store.getState().jumpTo(7);
    store.getState().jumpTo(7);

    expect(store.getState().history).toStrictEqual([0, 7]);
  });

  it('answers undefined at both ends rather than clamping', () => {
    // A caller scrolls only when there is somewhere to go, so the boundary has
    // to be an ABSENT page rather than the current one — returning the page you
    // are on would make every press at the start scroll to where you already
    // are, which reads as a control that half-works.
    const store = fresh();
    expect(store.getState().back()).toBeUndefined();
    expect(store.getState().forward()).toBeUndefined();
  });

  it('drops the OLDEST entry past the limit and moves the index with it', () => {
    // The index is the part that breaks silently: dropping from the front
    // without adjusting it renumbers every entry, and `back` then returns a
    // page the reader never came from.
    const store = fresh();
    for (let page = 1; page <= 60; page += 1) store.getState().jumpTo(page);

    const state = store.getState();
    expect(state.history).toHaveLength(50);
    expect(state.historyAt).toBe(49);
    expect(state.history[state.historyAt]).toBe(60);
    // And the entry before the current one is still the page before it, which
    // is what a mis-adjusted index would get wrong.
    expect(store.getState().back()).toBe(59);
  });

  /**
   * The remap contract's first assertion outside the arithmetic's own file.
   *
   * `pageOrder.test.ts` proves `remapPageIndex` answers correctly. These prove
   * the INVARIANT — that a back-stack still points at the pages it pointed at
   * after the document is reordered — which is the half `docs/FEATURES.md` has
   * recorded as unproven since the arithmetic landed.
   */
  it('the back-stack FOLLOWS its pages across a move', () => {
    const store = fresh();
    store.getState().jumpTo(1);
    store.getState().jumpTo(4);

    // Page 0 moves to the end of a five-page document: `0 1 2 3 4` becomes
    // `1 2 3 4 0`, so the reader's 1 and 4 become 0 and 3.
    store.getState().movedPages(5, { from: 0, to: 4 });

    const state = store.getState();
    expect(state.history).toStrictEqual([4, 0, 3]);
    // AND THE CURSOR STILL POINTS AT THE SAME JUMP, which a remap that
    // rebuilt the array without tracking `historyAt` would get wrong while
    // leaving the entries correct.
    expect(state.historyAt).toBe(2);
    expect(state.page).toBe(3);
    expect(store.getState().back()).toBe(0);
  });

  it('CONTROL: without the move the same stack is unchanged', () => {
    // Without this, the case above passes for a `movedPages` that rewrites the
    // history to anything at all — including the identity, which for some
    // fixtures is the correct answer and for this one is not.
    const store = fresh();
    store.getState().jumpTo(1);
    store.getState().jumpTo(4);

    expect(store.getState().history).toStrictEqual([0, 1, 4]);
  });

  it('an entry the move deletes is DROPPED, and the cursor moves with it', () => {
    // `remapPageIndex` answers `null` for a page outside the document, which is
    // how an entry stops resolving. Clamping instead would put a page the
    // reader never visited into their own history.
    const store = fresh();
    store.getState().jumpTo(1);
    store.getState().jumpTo(2);

    // A three-page document: page 7 is outside it, so the entries that map to
    // nothing go. `0 1 2` is the identity, so only the out-of-range entry is
    // affected — asserted through a move that keeps the rest still.
    store.getState().movedPages(2, { from: 0, to: 1 });

    const state = store.getState();
    // Pages 0 and 1 survive as 1 and 0; page 2 is outside a two-page document.
    expect(state.history).toStrictEqual([1, 0]);
    expect(state.historyAt).toBe(1);
  });
});
