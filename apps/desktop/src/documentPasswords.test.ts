import { inspect } from 'node:util';

import { HELD_PASSWORD_REDACTION, HeldPassword, asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DocumentPasswords } from './documentPasswords.js';

/** Made up for this file; no document carries it. */
const PASSWORD = 'sample-only-7Q';
const DOC = asDocId('00000000-0000-4000-8000-000000000171');

/**
 * Every way this code turns a value into text or a copy, applied to `value`. A way that REFUSES the value (a structured
 * clone of something holding a function) writes nothing, and is recorded as the refusal rather than ending the case.
 */
function writtenEveryWay(value: unknown): readonly string[] {
  const ways: readonly (() => string)[] = [
    () => JSON.stringify({ value }),
    () => JSON.stringify(structuredClone({ value })),
    () => inspect({ value }, { depth: 5, showHidden: true }),
    () => String(value),
    () => JSON.stringify({ ...(value as object) }),
  ];
  return ways.map((way) => {
    try {
      return way();
    } catch (refused) {
      return `<refused: ${refused instanceof Error ? refused.name : 'a throw'}>`;
    }
  });
}

describe('HeldPassword (ADR-0171 Decision 2)', () => {
  it('no serialisation of a held password writes any of it', () => {
    for (const written of writtenEveryWay(new HeldPassword(PASSWORD))) expect(written).not.toContain(PASSWORD);
  });

  it('CONTROL: the same text in a plain object is written by every one of them but string coercion', () => {
    // THE SAME INSTRUMENTS SEE IT, so the case above is a property of the holder and not of a blind serialiser.
    // `String` of a plain object is "[object Object]", which is why one way is excused; the holder's own `String` is
    // pinned to the redaction by the case below.
    const plain = { text: PASSWORD };
    const seen = writtenEveryWay(plain).filter((written) => written.includes(PASSWORD));
    expect(seen.length).toBe(writtenEveryWay(plain).length - 1);
  });

  it('says what it is in place of the text, so a log line shows that one was there', () => {
    const held = new HeldPassword(PASSWORD);
    expect(JSON.stringify(held)).toBe(JSON.stringify(HELD_PASSWORD_REDACTION));
    expect(String(held)).toBe(HELD_PASSWORD_REDACTION);
    // THROUGH THE REGISTERED SYMBOL, which is what lets the module name Node's hook without importing Node.
    expect(inspect(held)).toBe(HELD_PASSWORD_REDACTION);
  });

  it('reveals the text exactly, a character outside the basic plane included, and refuses once wiped', () => {
    const text = 'naïve-密码-\u{1F511}';
    const held = new HeldPassword(text);
    expect(held.reveal()).toBe(text);
    // CONTROL for the wipe: before it the units are the password's.
    expect(held.isWiped()).toBe(false);
    held.wipe();
    expect(held.isWiped()).toBe(true);
    expect(() => held.reveal()).toThrow(/wiped/u);
  });
});

describe('DocumentPasswords (ADR-0171 Decisions 1 and 2)', () => {
  it('holds the password a document opens with, and forgetting it wipes the bytes', () => {
    const passwords = new DocumentPasswords();
    passwords.hold(DOC, PASSWORD);
    const held = passwords.opensWith(DOC);
    // CONTROL: before the close the bytes are the password's, so a wipe that did nothing would fail below.
    expect(held?.isWiped()).toBe(false);
    expect(held?.reveal()).toBe(PASSWORD);

    passwords.forget(DOC);
    expect(held?.isWiped()).toBe(true);
    expect(passwords.opensWith(DOC)).toBeUndefined();
  });

  it('a password held again KEEPS the first as a key until close, since a copy may still need it (Decision 8)', () => {
    const passwords = new DocumentPasswords();
    passwords.hold(DOC, PASSWORD);
    const first = passwords.opensWith(DOC);
    passwords.hold(DOC, 'another-one');
    expect(first?.isWiped()).toBe(false);
    expect(passwords.opensWith(DOC)?.reveal()).toBe('another-one');
    expect(passwords.opening(DOC).keys.map((key) => key.reveal())).toStrictEqual(['another-one', PASSWORD]);
    passwords.forget(DOC);
    expect(first?.isWiped()).toBe(true);
  });

  it('the holder itself writes no password either', () => {
    const passwords = new DocumentPasswords();
    passwords.hold(DOC, PASSWORD);
    for (const written of writtenEveryWay(passwords)) expect(written).not.toContain(PASSWORD);
  });
});

/**
 * The holder follows a protect, its undo and its redo
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8):
 * the key the document opens with now, every key a copy may need, and how the document stands.
 */
describe('DocumentPasswords follows the protection (ADR-0171 Decision 8)', () => {
  const FIRST = { kind: 'first protect' };
  const SECOND = { kind: 'second protect' };

  /** What an open of a copy is handed, revealed for the assertion. */
  function opening(passwords: DocumentPasswords): { readonly keys: readonly string[]; readonly standing: string } {
    const { keys, standing } = passwords.opening(DOC);
    return { keys: keys.map((key) => key.reveal()), standing };
  }

  it('a plain document stands unprotected from its first open, and a later answer does not rewrite that', () => {
    const passwords = new DocumentPasswords();
    passwords.opened(DOC, true);
    passwords.opened(DOC, false);
    expect(opening(passwords)).toStrictEqual({ keys: [], standing: 'unprotected' });
  });

  it('CONTROL: an encrypted document, an owner-only password included, stands as copied', () => {
    const passwords = new DocumentPasswords();
    passwords.opened(DOC, false);
    expect(opening(passwords)).toStrictEqual({ keys: [], standing: 'as-copied' });
  });

  it('a protect gives the document its user password, and its undo and redo move back and forth', () => {
    const passwords = new DocumentPasswords();
    passwords.opened(DOC, true);
    passwords.protect(DOC, FIRST, { encryption: 'aes-256', userPassword: 'first-key' });
    expect(passwords.opensWith(DOC)?.reveal()).toBe('first-key');
    expect(opening(passwords)).toStrictEqual({ keys: ['first-key'], standing: 'as-copied' });

    passwords.protect(DOC, SECOND, { encryption: 'aes-256', userPassword: 'second-key' });
    expect(opening(passwords)).toStrictEqual({ keys: ['second-key', 'first-key'], standing: 'as-copied' });

    // UNDO THE SECOND: back to the first key, and the second is still offered, for the copies it encrypted.
    passwords.step(DOC, SECOND, 'before');
    expect(opening(passwords)).toStrictEqual({ keys: ['first-key', 'second-key'], standing: 'as-copied' });
    // UNDO THE FIRST: unprotected, no key current, and both still offered.
    passwords.step(DOC, FIRST, 'before');
    expect(passwords.opensWith(DOC)).toBeUndefined();
    expect(opening(passwords)).toStrictEqual({ keys: ['second-key', 'first-key'], standing: 'unprotected' });
    // REDO THE FIRST.
    passwords.step(DOC, FIRST, 'after');
    expect(passwords.opensWith(DOC)?.reveal()).toBe('first-key');
  });

  it('a protect with an owner password only opens with none, and one removing the protection stands unprotected', () => {
    const passwords = new DocumentPasswords();
    passwords.hold(DOC, 'its-own');
    passwords.protect(DOC, FIRST, { encryption: 'aes-256' });
    expect(opening(passwords)).toStrictEqual({ keys: ['its-own'], standing: 'as-copied' });
    expect(passwords.opensWith(DOC)).toBeUndefined();
    passwords.protect(DOC, SECOND, { encryption: 'none' });
    expect(opening(passwords).standing).toBe('unprotected');
    // UNDOING THE REMOVAL puts the owner-only protect back, which stands as copied.
    passwords.step(DOC, SECOND, 'before');
    expect(opening(passwords).standing).toBe('as-copied');
  });

  it('CONTROL: a step the holder never saw moves nothing', () => {
    const passwords = new DocumentPasswords();
    passwords.protect(DOC, FIRST, { encryption: 'aes-256', userPassword: 'first-key' });
    passwords.step(DOC, { kind: 'a stranger' }, 'before');
    expect(passwords.opensWith(DOC)?.reveal()).toBe('first-key');
  });

  it('close wipes every key a protect added, not only the current one', () => {
    const passwords = new DocumentPasswords();
    passwords.protect(DOC, FIRST, { encryption: 'aes-256', userPassword: 'first-key' });
    passwords.protect(DOC, SECOND, { encryption: 'aes-256', userPassword: 'second-key' });
    const keys = passwords.opening(DOC).keys;
    passwords.forget(DOC);
    expect(keys.map((key) => key.isWiped())).toStrictEqual([true, true]);
    expect(opening(passwords)).toStrictEqual({ keys: [], standing: 'as-copied' });
  });
});
