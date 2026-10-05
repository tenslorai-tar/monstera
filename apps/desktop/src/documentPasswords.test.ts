import { inspect } from 'node:util';

import { asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DocumentPasswords, HELD_PASSWORD_REDACTION, HeldPassword } from './documentPasswords.js';

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
    expect(inspect(held)).toBe(HELD_PASSWORD_REDACTION);
  });

  it('reveals the text for an engine open, and refuses once wiped', () => {
    const held = new HeldPassword(PASSWORD);
    expect(held.reveal()).toBe(PASSWORD);
    held.wipe();
    expect(() => held.reveal()).toThrow(/wiped/u);
  });
});

describe('DocumentPasswords (ADR-0171 Decisions 1 and 2)', () => {
  it('holds the password a document opens with, and forgetting it wipes the bytes', () => {
    const passwords = new DocumentPasswords();
    passwords.hold(DOC, PASSWORD);
    const held = passwords.heldFor(DOC);
    // CONTROL: before the close the bytes are the password's, so a wipe that did nothing would fail below.
    expect(held?.isWiped()).toBe(false);
    expect(passwords.openingPassword(DOC)).toBe(PASSWORD);

    passwords.forget(DOC);
    expect(held?.isWiped()).toBe(true);
    expect(passwords.openingPassword(DOC)).toBeUndefined();
  });

  it('a password held again wipes the one it replaces', () => {
    const passwords = new DocumentPasswords();
    passwords.hold(DOC, PASSWORD);
    const first = passwords.heldFor(DOC);
    passwords.hold(DOC, 'another-one');
    expect(first?.isWiped()).toBe(true);
    expect(passwords.openingPassword(DOC)).toBe('another-one');
  });

  it('the holder itself writes no password either', () => {
    const passwords = new DocumentPasswords();
    passwords.hold(DOC, PASSWORD);
    for (const written of writtenEveryWay(passwords)) expect(written).not.toContain(PASSWORD);
  });
});
