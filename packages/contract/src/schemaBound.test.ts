import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ANSWER_TOO_LARGE, channel, fileAnswered, fileRequested } from './channel.js';
import { WORST_BYTES_PER_CHAR, hostRouteViolations, maxEncodedBytes, unboundedMembers } from './schemaBound.js';

describe('the most bytes a schema admits', () => {
  /** Each figure checked against a value built at the bound, so the walk is compared with an encoder, not with itself. */
  it('matches what an encoder writes for a value at the bound', () => {
    const schema = z.object({ name: z.string().max(10), counts: z.array(z.number().int()).max(3), flag: z.boolean() });
    const atBound = { name: 'x'.repeat(10), counts: [-9007199254740991, -9007199254740991, -9007199254740991], flag: false };
    // ASCII throughout, so the string's length is its byte length.
    expect(maxEncodedBytes(schema, 1)).toBe(JSON.stringify(atBound).length);
  });

  /** A string's worst is every character escaped — what a hostile host may send, and what a bound has to hold at. */
  it('costs a string six bytes a character at worst', () => {
    const escaped = JSON.stringify(String.fromCodePoint(0).repeat(10));
    expect(maxEncodedBytes(z.string().max(10), WORST_BYTES_PER_CHAR)).toBe(escaped.length);
  });

  /** An undeclared bound is the alarming answer, never the reassuring one. */
  it('answers Infinity for anything nothing bounds', () => {
    expect(maxEncodedBytes(z.string(), 1)).toBe(Infinity);
    expect(maxEncodedBytes(z.array(z.boolean()), 1)).toBe(Infinity);
    expect(maxEncodedBytes(z.record(z.string().max(1), z.boolean()), 1)).toBe(Infinity);
    expect(maxEncodedBytes(z.unknown(), 1)).toBe(Infinity);
    expect(maxEncodedBytes(z.object({ inner: z.object({ deep: z.string() }) }), 1)).toBe(Infinity);
    expect(maxEncodedBytes(z.object({ open: z.boolean() }).loose(), 1)).toBe(Infinity);
  });

  it('bounds an integer by the longer of its bounds written out', () => {
    expect(maxEncodedBytes(z.number().int().min(-5).max(1000), 1)).toBe(4);
    expect(maxEncodedBytes(z.number().int().min(-50_000).max(1000), 1)).toBe(6);
  });

  /**
   * A TUPLE WITH NO REST IS ITS OWN BOUND, read off the closure JSON Schema spells (`items: false`). zod 4.6.7 writes
   * that form and 4.4.3 did not, and a walk keyed on the older spelling answered Infinity for every page range.
   */
  it('bounds a tuple with no rest by its members, as an encoder writes it at the bound', () => {
    const pair = z.tuple([z.number().int().min(0).max(99), z.boolean()]);
    expect(maxEncodedBytes(pair, 1)).toBe(JSON.stringify([99, false]).length);
    expect(unboundedMembers(pair, 'pair')).toStrictEqual([]);
  });

  /**
   * A LIST OF TYPES IS EACH OF THEM. zod 4.6.7 writes a bare nullable primitive as `"type": ["number","null"]`, and a
   * reader that took `type` as one word read it as no type: Infinity here, and nothing to report in the sweep.
   */
  it('bounds a node that lists its types by the worst of them', () => {
    expect(maxEncodedBytes(z.boolean().nullable(), 1)).toBe(JSON.stringify(false).length);
    expect(maxEncodedBytes(z.number().nullable(), 1)).toBe(JSON.stringify(-1.7976931348623157e308).length);
  });

  it('CONTROL: and reports an unbounded string whose type is listed beside null', () => {
    expect(maxEncodedBytes(z.string().nullable(), 1)).toBe(Infinity);
    expect(unboundedMembers(z.string().nullable(), 'note')).toStrictEqual(['string note']);
  });

  it('CONTROL: and reads a tuple WITH a rest as unbounded, like any array', () => {
    const open = z.tuple([z.boolean()]).rest(z.boolean());
    expect(maxEncodedBytes(open, 1)).toBe(Infinity);
    expect(unboundedMembers(open, 'open')).toStrictEqual(['array  open']);
  });
});

describe('the route rule a host channel map must satisfy (ADR-0125)', () => {
  const FRAME = 262_144;
  const CEILING = 8 * 1024 * 1024;
  const small = z.object({ n: z.number().int() }).strict();

  /**
   * AT WORST, NOT PLAIN: a result of 100,000 characters fits a frame written plainly and does not written escaped, so
   * a rule reading the plain figure passes this and the next case alike.
   */
  it('reports a frame-answered channel whose result fits plainly and not at worst', () => {
    const channels = { 'x/big': channel('big', small, z.object({ text: z.string().max(100_000) })) };
    expect(maxEncodedBytes(channels['x/big'].result, 1)).toBeLessThan(FRAME);
    expect(hostRouteViolations(channels, FRAME, CEILING)).toMatchObject([{ channel: 'x/big', direction: 'answer' }]);
  });

  it('CONTROL: and does not report one that fits at worst', () => {
    const channels = { 'x/small': channel('small', small, z.object({ text: z.string().max(1_000) })) };
    expect(hostRouteViolations(channels, FRAME, CEILING)).toStrictEqual([]);
  });

  it('accepts the same result declared file-answered', () => {
    const channels = { 'x/big': fileAnswered('big', small, z.object({ text: z.string() })) };
    expect(hostRouteViolations(channels, FRAME, CEILING)).toStrictEqual([]);
  });

  /** `fileAnswered` adds the failure by construction; a declaration spelt by hand is what this clause is for. */
  it('reports a file-answered channel that does not declare the failure its route introduces', () => {
    const byHand = { ...channel('big', small, z.object({ text: z.string() })), answer: 'file' as const };
    expect(byHand.failures).not.toContain(ANSWER_TOO_LARGE);
    expect(hostRouteViolations({ 'x/big': byHand }, FRAME, CEILING)).toMatchObject([
      { channel: 'x/big', direction: 'answer', reason: expect.stringMatching(/does not declare/u) as unknown },
    ]);
  });

  it('reports frame-requested params past the frame, and accepts them file-requested under the ceiling', () => {
    const params = z.object({ session: z.string().max(8), prior: z.array(z.number()).max(100_000) }).strict();
    expect(hostRouteViolations({ 'x/undo': channel('undo', params, small) }, FRAME, CEILING)).toMatchObject([
      { channel: 'x/undo', direction: 'request' },
    ]);
    expect(hostRouteViolations({ 'x/undo': fileRequested('undo', params, small) }, FRAME, CEILING)).toStrictEqual([]);
  });

  /** ADR-0138: the file has a ceiling too, and params nothing bounds pass no route. */
  it('reports file-requested params past the file ceiling', () => {
    const params = z.object({ session: z.string().max(8), prior: z.array(z.number()) }).strict();
    expect(hostRouteViolations({ 'x/undo': fileRequested('undo', params, small) }, FRAME, CEILING)).toMatchObject([
      { channel: 'x/undo', direction: 'request', reason: expect.stringMatching(/file ceiling/u) as unknown },
    ]);
  });

  /**
   * THE WIRE'S SIDE: an object that is not strict parses with extra keys, so its params are unbounded on the wire even
   * when every declared field is bounded. The output side reads it as closed, and passed every command for that reason.
   */
  it('reads params on the side the wire is parsed against: an open object is unbounded, a strict one is not', () => {
    const open = z.object({ session: z.string().max(8) });
    expect(hostRouteViolations({ 'x/open': channel('open', open, small) }, FRAME, CEILING)).toMatchObject([
      { channel: 'x/open', direction: 'request' },
    ]);
    expect(hostRouteViolations({ 'x/closed': channel('closed', open.strict(), small) }, FRAME, CEILING)).toStrictEqual([]);
  });
});
