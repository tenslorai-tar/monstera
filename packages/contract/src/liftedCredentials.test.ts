import { describe, expect, it } from 'vitest';

import {
  LIFTED_CREDENTIALS_MAX,
  PROTECTION_TERMS_MAX,
  liftCredentials,
  restoreCredentials,
} from './liftedCredentials.js';

/**
 * The one rule for what a file the host transport writes may hold (ADR-0171's correction of 2026-10-05). The transport
 * cases (`credentialTransport.test.ts`, `client.test.ts`) prove the files; these prove the rule's edges.
 */
describe('liftCredentials and restoreCredentials', () => {
  it('lifts every string under a credential-named key, at any depth, and restores the value exactly', () => {
    const value = {
      session: 's1',
      password: 'a',
      inverse: { kind: 'setDocumentProtection', prior: { standing: 'protected', passwordTerms: 'b' } },
      sources: [{ ownerPassword: 'c', page: 2 }],
      passphrase: null,
    };
    const { filed, credentials } = liftCredentials(value);
    expect(filed).toStrictEqual({
      session: 's1',
      inverse: { kind: 'setDocumentProtection', prior: { standing: 'protected' } },
      sources: [{ page: 2 }],
      passphrase: null,
    });
    expect(credentials).toStrictEqual([
      { path: ['password'], value: 'a' },
      { path: ['inverse', 'prior', 'passwordTerms'], value: 'b' },
      { path: ['sources', 0, 'ownerPassword'], value: 'c' },
    ]);
    expect(restoreCredentials(JSON.parse(JSON.stringify(filed)), credentials)).toStrictEqual(value);
  });

  it('leaves a value with no credential as it was, and lifts nothing', () => {
    const value = { session: 's1', inverse: { kind: 'rotatePages', prior: [1, 2] } };
    expect(liftCredentials(value)).toStrictEqual({ filed: value, credentials: [] });
  });

  it('refuses a credential-named key that holds anything but a string or null', () => {
    expect(() => liftCredentials({ passwords: ['a'] })).toThrow(/cannot be lifted/u);
    expect(() => liftCredentials({ secret: { value: 'a' } })).toThrow(/cannot be lifted/u);
  });

  it('refuses more values than a frame carries, and one longer than the longest a channel may', () => {
    const many = Object.fromEntries(Array.from({ length: LIFTED_CREDENTIALS_MAX + 1 }, (_, at) => [`password${String(at)}`, 'x']));
    expect(() => liftCredentials(many)).toThrow(/above the frame/u);
    expect(liftCredentials({ password: 'x'.repeat(PROTECTION_TERMS_MAX) }).credentials).toHaveLength(1);
    expect(() => liftCredentials({ password: 'x'.repeat(PROTECTION_TERMS_MAX + 1) })).toThrow();
  });

  it('copies a key named __proto__ as a key, never as the copy’s prototype', () => {
    const value: unknown = JSON.parse('{"__proto__": {"password": "a"}, "session": "s1"}');
    const { filed, credentials } = liftCredentials(value);
    expect(Object.getPrototypeOf(filed)).toBe(Object.prototype);
    expect(Object.hasOwn(filed as object, '__proto__')).toBe(true);
    expect(credentials).toStrictEqual([{ path: ['__proto__', 'password'], value: 'a' }]);
  });

  /**
   * A HOST IS HOSTILE (invariant 25), and on the answer's side its frame names the paths. So restoring refuses any path
   * that does not end at a credential-named key the file does not hold, and walks own properties only.
   */
  it('refuses a path that ends anywhere but an absent credential-named key, or walks through a prototype', () => {
    expect(() => restoreCredentials({ value: {} }, [{ path: ['value', 'kind'], value: 'x' }])).toThrow(/not a credential/u);
    expect(() => restoreCredentials({ password: 'p' }, [{ path: ['password'], value: 'x' }])).toThrow(/already holds/u);
    expect(() => restoreCredentials({}, [{ path: ['value', 'password'], value: 'x' }])).toThrow(/does not hold/u);
    expect(() => restoreCredentials({}, [{ path: ['__proto__', 'password'], value: 'x' }])).toThrow(/does not hold/u);
    expect(Object.hasOwn(Object.prototype, 'password')).toBe(false);
  });
});
