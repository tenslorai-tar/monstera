import { describe, expect, it } from 'vitest';

import { FrameDecoder, encodeFrame } from './frame.js';
import { ENGINE_HOST_FRAME_MAX_BYTES, LARGEST_INTENT_PAYLOAD_BYTES } from './hostProtocol.js';

/**
 * Declared locally rather than by widening this package's `types`, which is the
 * precedent `boundary.test.ts` set. `packages/contract` has no Node and no DOM
 * types on purpose — it is the wire contract, and nothing in it should be able
 * to reach a process. Only these tests need to weigh an envelope in bytes.
 */
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

/**
 * The maximum is derived from a payload, so the derivation is what gets tested
 * — not the number.
 *
 * Asserting `ENGINE_HOST_FRAME_MAX_BYTES === 262144` would be the constant
 * restating itself, which is the check that passes for every value anyone ever
 * writes there. What has to hold is that the **worst legitimate intent still
 * fits**, and that a document image still does not.
 */

/** Twenty thousand five-digit page indices, as the wire would carry them. */
function wholeDocumentSelection(): Uint8Array {
  const pages = Array.from({ length: 20_000 }, (_, index) => index + 10_000);
  return new TextEncoder().encode(
    JSON.stringify({ docId: 'd1', command: { kind: 'deletePages', pages } }),
  );
}

describe('the engine-host frame maximum', () => {
  /**
   * The positive control for the derivation. If someone lowers the constant to
   * a tidier number, this reddens and the message says which payload stopped
   * fitting — rather than the change passing because no test knew what the
   * number was for.
   */
  it('carries a whole-document page selection, which is the payload it is derived from', () => {
    const payload = wholeDocumentSelection();

    // EXACT, and in the direction that matters: the stated worst case must not
    // be an UNDER-estimate, or the maximum derived from it is too small by
    // however much the estimate was wrong. A `toBeGreaterThan(x * 0.8)` band
    // stood here and it accepted a figure that had never been measured — it
    // could report that the constant was not wildly wrong, which is not a thing
    // worth knowing about a number another number is derived from.
    expect(payload.byteLength).toBe(LARGEST_INTENT_PAYLOAD_BYTES);
    expect(() => encodeFrame(payload, ENGINE_HOST_FRAME_MAX_BYTES)).not.toThrow();
  });

  /**
   * The other direction, and the one the ADR exists to hold: a document image
   * must not fit. The fixture is the smallest thing anyone would call a
   * document — a megabyte — because a fixture the size of a real PDF would also
   * be refused by a maximum that was far too generous.
   */
  it('refuses a payload the size of the smallest thing anyone would call a document', () => {
    expect(() => encodeFrame(new Uint8Array(1024 * 1024), ENGINE_HOST_FRAME_MAX_BYTES)).toThrow(
      /exceeds the maximum/u,
    );
  });

  it('leaves real headroom above the derived payload without leaving an order of magnitude', () => {
    const ratio = ENGINE_HOST_FRAME_MAX_BYTES / LARGEST_INTENT_PAYLOAD_BYTES;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(4);
  });

  /**
   * The bound the source comment names, asserted so it is a number rather than
   * a claim. A selection large enough to be refused should be met by splitting
   * the intent across frames — not by raising the maximum, which would spend
   * the property ADR-0023 §7 exists to protect on the one payload shape with a
   * cheaper fix.
   */
  it('refuses a selection roughly 2.2x past the stated extreme, at a page count that is known', () => {
    const perPage = LARGEST_INTENT_PAYLOAD_BYTES / 20_000;
    const bindsAt = Math.round(ENGINE_HOST_FRAME_MAX_BYTES / perPage);

    expect(bindsAt).toBeGreaterThan(40_000);
    expect(bindsAt).toBeLessThan(48_000);

    const pages = Array.from({ length: bindsAt + 5_000 }, (_, index) => index + 10_000);
    const oversized = new TextEncoder().encode(
      JSON.stringify({ docId: 'd1', command: { kind: 'deletePages', pages } }),
    );
    expect(() => encodeFrame(oversized, ENGINE_HOST_FRAME_MAX_BYTES)).toThrow(
      /exceeds the maximum/u,
    );
  });

  /**
   * PP-4's shape, one layer down: the codec must not acquire a default. A
   * maximum that can be omitted is a maximum nobody chose, and this is the one
   * number standing between "intent crosses" and "whatever fits crosses".
   */
  it('is required by the codec — an omitted maximum is refused, not defaulted', () => {
    const omitted = undefined as unknown as number;
    expect(() => new FrameDecoder(omitted)).toThrow(/frame maximum/u);
    expect(() => encodeFrame(new Uint8Array(1), omitted)).toThrow(/frame maximum/u);
  });

  it('round-trips a real intent payload through the decoder at this maximum', () => {
    const payload = wholeDocumentSelection();
    const decoder = new FrameDecoder(ENGINE_HOST_FRAME_MAX_BYTES);
    const pushed = decoder.push(encodeFrame(payload, ENGINE_HOST_FRAME_MAX_BYTES));

    expect(pushed.ok).toBe(true);
    if (!pushed.ok) return;
    expect(pushed.value).toHaveLength(1);
    expect(pushed.value[0]?.byteLength).toBe(payload.byteLength);
  });
});
