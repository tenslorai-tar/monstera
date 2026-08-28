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
