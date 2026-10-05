import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DocumentKeys } from './documentKeys.js';
import { DocumentStores } from './documentStores.js';

/**
 * The renderer's keys for each open document: held per document, newest first, never twice, and wiped when the
 * document's store closes ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)
 * Decision 7).
 */
const ONE = asDocId('one');
const TWO = asDocId('two');

describe('DocumentKeys', () => {
  it('holds a document’s keys newest first, once each, and for that document only', () => {
    const keys = new DocumentKeys();
    keys.hold(ONE, 'first');
    keys.hold(ONE, 'second');
    keys.hold(ONE, 'first');
    keys.hold(TWO, 'other');
    expect(keys.keysOf(ONE).map((key) => key.reveal())).toStrictEqual(['second', 'first']);
    expect(keys.keysOf(TWO).map((key) => key.reveal())).toStrictEqual(['other']);
  });

  it('writes no character of a key through any serialisation', () => {
    const keys = new DocumentKeys();
    keys.hold(ONE, 'a-key-nothing-may-write');
    const held = keys.keysOf(ONE);
    expect(`${JSON.stringify(held)}${String(held[0])}`).not.toContain('a-key-nothing-may-write');
  });
});

describe('DocumentStores — a closed document’s keys', () => {
  it('are WIPED and dropped by the close that drops its store', () => {
    const stores = new DocumentStores();
    stores.open(ONE, asDocVersion(1));
    stores.keys.hold(ONE, 'typed-for-one');
    const held = stores.keys.keysOf(ONE);

    stores.close(ONE);

    // WIPED, not only dropped: a reference anything kept reads as nothing.
    expect(held.map((key) => key.isWiped())).toStrictEqual([true]);
    expect(stores.keys.keysOf(ONE)).toStrictEqual([]);
  });

  it('CONTROL: an open document’s keys are held and readable, and another’s close leaves them', () => {
    const stores = new DocumentStores();
    stores.open(ONE, asDocVersion(1));
    stores.open(TWO, asDocVersion(1));
    stores.keys.hold(ONE, 'typed-for-one');

    stores.close(TWO);

    const held = stores.keys.keysOf(ONE);
    expect(held.map((key) => key.isWiped())).toStrictEqual([false]);
    expect(held.map((key) => key.reveal())).toStrictEqual(['typed-for-one']);
  });
});
