import forge from 'node-forge';
import { describe, expect, it } from 'vitest';

import { pkcs7Asn1 } from './signatureRead.js';

/**
 * Reading a signature out of its fixed-size `/Contents` hole.
 *
 * ## Why a CONSTRUCTED element, and not a signed document
 *
 * The defect is a signature whose DER encoding ends in a zero byte, which a
 * freshly minted key produces about once in 256 runs — so a signed fixture
 * reaches it by luck, and that is how it was found: one full-suite run failed,
 * and the same file passed alone. A five-byte `SEQUENCE { INTEGER 0 }` ends in
 * zero every time, which turns a one-in-256 failure into a case.
 */
describe('pkcs7Asn1 — /Contents read to the element’s own length', () => {
  /** `SEQUENCE { INTEGER 0 }`: five bytes, the last of them zero. */
  const element = Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00);

  /** The element inside a hole zero-padded past it, as `/Contents` holds a signature. */
  function hole(): Uint8Array {
    const padded = new Uint8Array(32);
    padded.set(element);
    return padded;
  }

  it('reads an element whose FINAL byte is zero out of a zero-padded hole, exactly', () => {
    const der = forge.asn1.toDer(pkcs7Asn1(hole())).getBytes();
    expect(Array.from(der, (character) => character.charCodeAt(0))).toStrictEqual([...element]);
  });

  it('CONTROL: stripping trailing zeros first — the shape this replaced — cannot read it', () => {
    // THE REPLACED ALGORITHM, inline, so the case reproduces the logged failure
    // rather than asserting that some input fails: it strips the element's own
    // last byte along with the padding.
    const padded = hole();
    let end = padded.length;
    while (end > 0 && padded[end - 1] === 0) end -= 1;
    const stripped = String.fromCharCode(...padded.subarray(0, end));

    expect(() => forge.asn1.fromDer(stripped)).toThrow(/Too few bytes/);
  });
});
