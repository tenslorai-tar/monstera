import forge from 'node-forge';
import { describe, expect, it } from 'vitest';

import { contextTagged, isContextTag } from './asn1Context.js';

/**
 * The context tags against the format, never against forge's enum: the signing code writes and reads `[n]` through
 * `asn1Context.ts`, so a case reading through it as well would agree with any mistake in it. X.690 writes a constructed
 * context-specific tag `n` as the identifier octet `0xA0 | n`.
 */
describe('a context-specific tag', () => {
  it('is written as X.690’s identifier octet for [0], [1] and [2]', () => {
    const identifiers = ([0, 1, 2] as const).map((tag) => forge.asn1.toDer(contextTagged(tag, [])).bytes().charCodeAt(0));
    expect(identifiers).toStrictEqual([0xa0, 0xa1, 0xa2]);
  });

  it('is recognised by its tag, and not by the universal type of the same number', () => {
    const one = forge.asn1.fromDer(forge.util.createBuffer(String.fromCharCode(0xa1, 0x00)));
    const boolean = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.BOOLEAN, false, String.fromCharCode(0xff));
    expect([isContextTag(one, 1), isContextTag(one, 0), isContextTag(boolean, 1)]).toStrictEqual([true, false, false]);
  });
});
