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

/**
 * A document's `/Contents` decides how deep the reader decodes.
 *
 * `fromDer` decodes a BIT STRING's content as ASN.1 by default, and up to
 * node-forge 1.4.0 it did so for every BIT STRING nested inside another, past
 * its own `maxDepth`, keeping a copy of each level's content (CVE-2026-119191,
 * fixed in 1.4.1). `pkcs7Asn1` reads the signing document's bytes in the
 * contained host, so a crafted signature was a crafted input to that loop.
 * Measured 2026-10-30 with `pkcs7Asn1`'s options on 4,000 nested BIT STRINGs, a
 * 19,890-byte `/Contents`: 7.1 s and 1,256 MiB of heap on 1.4.0, 1 ms and
 * 7 MiB on 1.4.2.
 *
 * The case asserts the decode that was not made — how many levels came back
 * decoded — rather than a time, which a fast runner would pass on 1.4.0.
 */
describe('pkcs7Asn1 — nested BIT STRINGs in /Contents are decoded one level, not all of them', () => {
  const LEVELS = 300;

  /** `SEQUENCE { BIT STRING { BIT STRING { … SEQUENCE {} } } }`, `LEVELS` deep. */
  function nested(): Uint8Array {
    const length = (n: number): number[] => (n < 0x80 ? [n] : [0x82, n >> 8, n & 0xff]);
    let inner = [0x30, 0x00];
    for (let level = 0; level < LEVELS; level += 1) {
      const body = [0x00, ...inner];
      inner = [0x03, ...length(body.length), ...body];
    }
    return Uint8Array.from([0x30, ...length(inner.length), ...inner]);
  }

  /** How many BIT STRINGs, one inside the next, came back with their content decoded. */
  function decodedBitStrings(node: forge.asn1.Asn1): number {
    let count = 0;
    let at: forge.asn1.Asn1 | undefined = Array.isArray(node.value) ? node.value[0] : undefined;
    while (at?.type === forge.asn1.Type.BITSTRING && Array.isArray(at.value)) {
      count += 1;
      at = at.value[0];
    }
    return count;
  }

  it('reads the element whole and decodes only the outermost BIT STRING', () => {
    const contents = nested();
    const read = pkcs7Asn1(contents);

    const der = forge.asn1.toDer(read).getBytes();
    expect(der.length).toBe(contents.length);
    // At least one level decoded, so the walk can see a decoded BIT STRING and a
    // zero below is not a blind count; at most one, which 1.4.0 fails at 300.
    expect(decodedBitStrings(read)).toBe(1);
  });
});
