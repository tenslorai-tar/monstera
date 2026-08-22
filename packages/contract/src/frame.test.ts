import { describe, expect, it } from 'vitest';

import { FRAME_LENGTH_CEILING, FrameDecoder, encodeFrame } from './frame.js';

/**
 * Declared locally rather than by widening this package's `types`, which is the
 * precedent `boundary.test.ts` set for `structuredClone`. `packages/contract`
 * has no Node types on purpose and one measurement here needs one reading off
 * the runtime; naming it here leaves the package's reach alone.
 */
declare const process: { memoryUsage(): { readonly arrayBuffers: number } };

const MAX = 1024;

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

/** A header for `declared` bytes, with no body behind it. */
function header(declared: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, declared, false);
  return out;
}

/** The frames one push produced, or a thrown assertion naming the violation. */
function framesFrom(
  decoder: FrameDecoder,
  chunk: Uint8Array,
): readonly Uint8Array[] {
  const pushed = decoder.push(chunk);
  if (!pushed.ok) throw new Error(`unexpected violation: ${pushed.error.detail}`);
  return pushed.value;
}

describe('encodeFrame', () => {
  it('prefixes the payload with its big-endian length', () => {
    expect(Array.from(encodeFrame(bytes(0xaa, 0xbb, 0xcc), MAX))).toEqual([
      0, 0, 0, 3, 0xaa, 0xbb, 0xcc,
    ]);
  });

  it('refuses a payload above the maximum rather than splitting it', () => {
    expect(() => encodeFrame(new Uint8Array(MAX + 1), MAX)).toThrow(/exceeds the maximum/u);
  });

  it('refuses an empty payload, which the decoder would refuse anyway', () => {
    expect(() => encodeFrame(new Uint8Array(0), MAX)).toThrow(/empty frame/iu);
  });
});

describe('the maximum is required and must fit the header', () => {
  // A maximum the four-byte prefix cannot express would be silently truncated
  // into a different limit — the number in force would not be the number set.
  it.each([0, -1, 1.5, FRAME_LENGTH_CEILING + 1, Number.NaN])('rejects %p', (value) => {
    expect(() => new FrameDecoder(value)).toThrow(/frame maximum/u);
    expect(() => encodeFrame(bytes(1), value)).toThrow(/frame maximum/u);
  });

  it('accepts the ceiling itself, so the bound is inclusive and not off by one', () => {
    expect(() => new FrameDecoder(FRAME_LENGTH_CEILING)).not.toThrow();
  });
});

describe('FrameDecoder reassembly', () => {
  it('returns a whole frame delivered in one chunk', () => {
    const decoder = new FrameDecoder(MAX);
    const frames = framesFrom(decoder, encodeFrame(bytes(1, 2, 3), MAX));
    expect(frames.map((frame) => Array.from(frame))).toEqual([[1, 2, 3]]);
  });

  /**
   * The resolution case for reassembly, and the one a naive decoder passes
   * everything else while failing.
   *
   * A byte at a time crosses every boundary that exists: inside the header,
   * between header and body, and inside the body. It also pins *when* the frame
   * appears — a decoder that emitted early would produce it before the last
   * byte, and one that never emitted would produce nothing at all, and those
   * are different failures with the same "no frame yet" reading at every step
   * but one.
   */
  it('reassembles a frame delivered one byte at a time, on the last byte and not before', () => {
    const decoder = new FrameDecoder(MAX);
    const wire = encodeFrame(bytes(9, 8, 7, 6), MAX);

    const counts = Array.from(wire).map((byte) => framesFrom(decoder, bytes(byte)).length);

    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('returns several frames from one chunk', () => {
    const decoder = new FrameDecoder(MAX);
    const wire = new Uint8Array([
      ...encodeFrame(bytes(1), MAX),
      ...encodeFrame(bytes(2, 2), MAX),
      ...encodeFrame(bytes(3, 3, 3), MAX),
    ]);
    expect(framesFrom(decoder, wire).map((frame) => Array.from(frame))).toEqual([
      [1],
      [2, 2],
      [3, 3, 3],
    ]);
  });

  it('keeps a partial trailing frame and completes it on the next chunk', () => {
    const decoder = new FrameDecoder(MAX);
    const first = encodeFrame(bytes(1, 1), MAX);
    const second = encodeFrame(bytes(5, 5, 5), MAX);
    const split = 3;

    const head = new Uint8Array([...first, ...second.subarray(0, split)]);
    expect(framesFrom(decoder, head).map((frame) => Array.from(frame))).toEqual([[1, 1]]);
    expect(
      framesFrom(decoder, second.subarray(split)).map((frame) => Array.from(frame)),
    ).toEqual([[5, 5, 5]]);
  });

  it('tolerates an empty chunk without treating it as a frame boundary', () => {
    const decoder = new FrameDecoder(MAX);
    const wire = encodeFrame(bytes(4, 4), MAX);
    expect(framesFrom(decoder, wire.subarray(0, 5))).toEqual([]);
    expect(framesFrom(decoder, new Uint8Array(0))).toEqual([]);
    expect(framesFrom(decoder, wire.subarray(5)).map((frame) => Array.from(frame))).toEqual([
      [4, 4],
    ]);
  });
});

describe('FrameDecoder violations', () => {
  /**
   * The fixture is the header ALONE, and that is the whole case.
   *
   * A decoder that accumulated first and checked the maximum afterwards would
   * answer `ok([])` here and look identical to a correct one that is simply
   * waiting — so a fixture carrying the body too would separate nothing. Only
   * refusing on four bytes proves the check reads the declared length.
   */
  it('refuses an over-sized frame on its header, before any body arrives', () => {
    const decoder = new FrameDecoder(MAX);
    const pushed = decoder.push(header(MAX + 1));
    expect(pushed.ok).toBe(false);
    if (pushed.ok) return;
    expect(pushed.error.code).toBe('frame-too-large');
  });

  it('refuses a frame declaring zero bytes', () => {
    const decoder = new FrameDecoder(MAX);
    const pushed = decoder.push(header(0));
    expect(pushed.ok).toBe(false);
    if (pushed.ok) return;
    expect(pushed.error.code).toBe('empty-frame');
  });

  /**
   * The fixture after the violation is a PERFECTLY VALID frame, because that is
   * the only input that separates poisoning from per-frame rejection. A decoder
   * that flagged the bad frame and carried on would hand this one upward, which
   * is the peer choosing where our parse resumes.
   */
  it('stays poisoned, and refuses a valid frame that follows a violation', () => {
    const decoder = new FrameDecoder(MAX);
    expect(decoder.push(header(MAX + 1)).ok).toBe(false);

    const after = decoder.push(encodeFrame(bytes(1, 2, 3), MAX));
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error.code).toBe('frame-too-large');
    expect(decoder.violation?.code).toBe('frame-too-large');
  });

  it('reports no violation while it is reading, so the flag means something', () => {
    const decoder = new FrameDecoder(MAX);
    framesFrom(decoder, encodeFrame(bytes(1), MAX));
    expect(decoder.violation).toBeNull();
  });
});

/**
 * The property this whole class exists for, and the one a functional assertion
 * cannot see: **nothing is sized by the declared length.**
 *
 * The mechanism is that the call is never written, which no output
 * distinguishes from a call that happens to be guarded. So it is measured
 * instead — and the measurement carries its own resolution test, because
 * "allocated almost nothing" and "the instrument cannot see allocations" are
 * the same reading (audit item 4a).
 */
describe('a declared length allocates nothing', () => {
  const HUGE = 128 * 1024 * 1024;
  const NOISE = 8 * 1024 * 1024;

  it('holds no memory for a header claiming 128 MiB with no body behind it', () => {
    const decoder = new FrameDecoder(HUGE * 2);

    const before = process.memoryUsage().arrayBuffers;
    const pushed = decoder.push(header(HUGE));
    const afterHeader = process.memoryUsage().arrayBuffers;

    expect(pushed.ok).toBe(true);
    expect(afterHeader - before).toBeLessThan(NOISE);

    // THE RESOLUTION TEST, in the same units and the same run: a real 128 MiB
    // allocation must move this reading. Without it the assertion above passes
    // on a runtime that reports zero for everything.
    const real = new Uint8Array(HUGE);
    const afterReal = process.memoryUsage().arrayBuffers;
    expect(afterReal - afterHeader).toBeGreaterThan(HUGE - NOISE);
    expect(real.byteLength).toBe(HUGE);
  });
});
