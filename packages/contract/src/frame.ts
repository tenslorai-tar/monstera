import { type Result, err, ok } from '@monstera/shared';

/**
 * Length-prefixed framing for the engine-host pipe (ADR-0023 §4).
 *
 * ## Why this lives in `contract` and not beside the host
 *
 * ADR-0022 made the host's pipe a trust boundary and ruled that it registers
 * into this package's discipline rather than acquiring one of its own: *"a
 * second validated-boundary discipline beside it is the defect"* (B3a). The
 * framing is **beneath** that discipline, not beside it — the schemas above it
 * are the same `channel()` declarations everything else uses, and this is the
 * byte layer they travel on. Both ends need the identical rule, and both ends
 * already depend on this package, so there is exactly one definition of what a
 * frame is.
 *
 * That also fixes the vocabulary: this package compiles with `"types": []` and
 * is imported by the renderer, so there is no `Buffer` here. `Uint8Array` and
 * `DataView` throughout.
 *
 * ## The hostile-input surface, and it is the first one
 *
 * The host is hostile by invariant 25's own premise, so this decoder is the
 * first code a compromised engine reaches — before any schema, before any
 * handler. Four properties, each chosen so the bug is unrepresentable rather
 * than guarded against:
 *
 * 1. **No allocation is ever sized by the declared length.** Not "the maximum
 *    is checked first" — the sizing call is simply never written. Received
 *    bytes are accumulated as they arrive and completed frames are sliced out
 *    of them, so the only memory this holds is memory the peer actually sent.
 *    A length field that sizes a buffer is the classic way this goes wrong, and
 *    a check in front of it is a check someone later moves.
 * 2. **A declared length above the maximum is terminal.** ADR-0023: *a frame
 *    that exceeds it kills the host rather than truncating.* Truncating would
 *    hand the schema layer a valid-looking message assembled from a violation.
 * 3. **A violation poisons the decoder.** Once the stream has lied about its
 *    own shape, every byte after it is unframed — resynchronising means
 *    guessing where the next header starts, which is the peer choosing our
 *    parse offsets.
 * 4. **An empty frame is refused.** Zero bytes cannot carry a message, so
 *    accepting one would hand an empty payload upward where it reads like a
 *    parse that found nothing. An empty result is a broken input, not a clean
 *    one.
 *
 * ## The maximum is a required argument, undefaulted
 *
 * The same reasoning ADR-0023 §2 gives for the job's memory limit: a default is
 * how a number nobody chose becomes the number in force. It is also a question
 * this layer must not answer — whether a whole document image ever crosses this
 * pipe, or only intent, decides whether the ceiling is kilobytes or hundreds of
 * megabytes, and that belongs to whoever builds the byte path. Leaving it
 * required keeps the codec correct under either answer and puts the number at
 * the one call site that has grounds to pick it.
 */

/** Bytes of length prefix. Fixed width, so a header is never ambiguous. */
export const FRAME_HEADER_BYTES = 4;

/** The largest length a {@link FRAME_HEADER_BYTES}-byte prefix can express. */
export const FRAME_LENGTH_CEILING = 0xff_ff_ff_ff;

/**
 * Why a stream stopped being a stream of frames. Always terminal.
 *
 * There is no `poisoned` code, and its absence is deliberate: a decoder that
 * has already refused keeps returning the **original** violation rather than a
 * second one describing its own state. The first one is the diagnosis; a later
 * "this decoder is poisoned" would be the consequence wearing the shape of a
 * cause, and it is what a reader would see in the log.
 */
export interface FrameViolation {
  readonly code: 'frame-too-large' | 'empty-frame';
  /** Diagnostic text. Lengths and limits only — never payload content. */
  readonly detail: string;
}

/**
 * Prefixes `payload` with its length.
 *
 * Throws rather than returning a failure: an oversized outbound frame is our
 * own code exceeding a limit we set, which is a defect and not an outcome.
 */
export function encodeFrame(payload: Uint8Array, maxFrameBytes: number): Uint8Array {
  assertUsableMaximum(maxFrameBytes);
  if (payload.byteLength === 0) {
    throw new RangeError('An empty frame carries no message and is refused by the decoder.');
  }
  if (payload.byteLength > maxFrameBytes) {
    throw new RangeError(
      `Frame of ${String(payload.byteLength)} bytes exceeds the maximum of ` +
        `${String(maxFrameBytes)}. Splitting it here would hand the peer a message ` +
        'we declared unsendable.',
    );
  }

  const framed = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false);
  framed.set(payload, FRAME_HEADER_BYTES);
  return framed;
}

/**
 * Reassembles frames from a byte stream that arrives in arbitrary chunks.
 *
 * One instance per connection. It is a state machine and its states are
 * *reading* and *poisoned*; there is no recovery from the second, by design.
 */
export class FrameDecoder {
  readonly #max: number;

  /**
   * Received bytes not yet consumed, kept as the chunks they arrived in.
   *
   * A single growing buffer would copy every pending byte on every chunk, which
   * turns a large frame delivered in pipe-sized pieces into quadratic work.
   * Copying happens once per frame instead, when one is complete.
   */
  #pending: Uint8Array[] = [];

  #pendingBytes = 0;

  #poison: FrameViolation | null = null;

  constructor(maxFrameBytes: number) {
    assertUsableMaximum(maxFrameBytes);
    this.#max = maxFrameBytes;
  }

  /** The violation that stopped this decoder, or `null` while it is reading. */
  get violation(): FrameViolation | null {
    return this.#poison;
  }

  /**
   * Consumes a chunk and returns every frame it completed — possibly none,
   * possibly several.
   *
   * A failure here is the peer breaking the protocol, which is an expected
   * outcome on a hostile boundary and so a `Result`. The caller's answer is to
   * kill the host; there is nothing else a violated frame stream supports.
   */
  push(chunk: Uint8Array): Result<readonly Uint8Array[], FrameViolation> {
    if (this.#poison !== null) return err(this.#poison);

    if (chunk.byteLength > 0) {
      this.#pending.push(chunk);
      this.#pendingBytes += chunk.byteLength;
    }

    const frames: Uint8Array[] = [];

    for (;;) {
      if (this.#pendingBytes < FRAME_HEADER_BYTES) break;

      const header = this.#peek(FRAME_HEADER_BYTES);
      const declared = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(
        0,
        false,
      );

      // Both checks happen against the DECLARED length, before a single byte of
      // the body is required to have arrived and without anything being sized
      // by it. A peer that claims four gigabytes is refused on the header.
      if (declared === 0) {
        return err(this.#poisonWith({
          code: 'empty-frame',
          detail: 'A frame declared zero bytes. Zero bytes cannot carry a message.',
        }));
      }
      if (declared > this.#max) {
        return err(this.#poisonWith({
          code: 'frame-too-large',
          detail:
            `A frame declared ${String(declared)} bytes against a maximum of ` +
            `${String(this.#max)}.`,
        }));
      }

      if (this.#pendingBytes < FRAME_HEADER_BYTES + declared) break;

      this.#drop(FRAME_HEADER_BYTES);
      frames.push(this.#take(declared));
    }

    return ok(frames);
  }

  /** Copies the first `count` pending bytes without consuming them. */
  #peek(count: number): Uint8Array {
    const out = new Uint8Array(count);
    let written = 0;
    for (const chunk of this.#pending) {
      if (written >= count) break;
      const slice = chunk.subarray(0, Math.min(chunk.byteLength, count - written));
      out.set(slice, written);
      written += slice.byteLength;
    }
    return out;
  }

  /** Consumes and returns the first `count` pending bytes. */
  #take(count: number): Uint8Array {
    const out = this.#peek(count);
    this.#drop(count);
    return out;
  }

  /** Consumes the first `count` pending bytes and discards them. */
  #drop(count: number): void {
    let remaining = count;
    while (remaining > 0) {
      const head = this.#pending[0];
      // Unreachable while callers check `#pendingBytes` first, and a throw
      // rather than a `break`: silently dropping fewer bytes than asked would
      // desynchronise the stream, which is the one failure this class exists to
      // make impossible.
      if (head === undefined) {
        throw new Error(
          `Frame decoder asked to drop ${String(count)} bytes with ${String(remaining)} still ` +
            'owed and nothing pending.',
        );
      }
      if (head.byteLength > remaining) {
        this.#pending[0] = head.subarray(remaining);
        this.#pendingBytes -= remaining;
        return;
      }
      this.#pending.shift();
      this.#pendingBytes -= head.byteLength;
      remaining -= head.byteLength;
    }
  }

  /**
   * Records the violation and drops everything pending.
   *
   * Dropping matters as much as the flag: bytes held after a violation are
   * bytes a killed host's stream is still costing us.
   */
  #poisonWith(violation: FrameViolation): FrameViolation {
    this.#poison = violation;
    this.#pending = [];
    this.#pendingBytes = 0;
    return violation;
  }
}

/**
 * A maximum outside what the header can express is a configuration defect, and
 * defects throw. Checked in both the encoder and the decoder rather than in one
 * of them, because they are constructed independently at each end.
 */
function assertUsableMaximum(maxFrameBytes: number): void {
  if (
    !Number.isInteger(maxFrameBytes) ||
    maxFrameBytes < 1 ||
    maxFrameBytes > FRAME_LENGTH_CEILING
  ) {
    throw new RangeError(
      `A frame maximum must be an integer in 1..${String(FRAME_LENGTH_CEILING)}; got ` +
        `${String(maxFrameBytes)}. A maximum the ${String(FRAME_HEADER_BYTES)}-byte header ` +
        'cannot express would be silently truncated into a different limit.',
    );
  }
}
