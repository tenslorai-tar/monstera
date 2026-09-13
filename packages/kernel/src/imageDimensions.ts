/**
 * An image's size in pixels, read from its header before anything decodes it.
 *
 * ## Why an import needs this at all
 *
 * pdf-lib's `embedPng` decodes every pixel before it will say how large a PNG is, and
 * what that costs follows the pixel count, not the file: measured 2026-09-13 with a
 * scratch probe, a 450 KB PNG of 12,000 × 12,000 flat colour peaked at 1,583 MiB
 * inside one process. So a bound on bytes bounds nothing, and a bound on pixels has
 * to be read from the one place that states them before the decode — the header.
 *
 * ## Strict, and a header it cannot read is not a PNG
 *
 * PNG (RFC 2083 §3.1–3.2, ISO/IEC 15948) puts the size in the first chunk, which must
 * be `IHDR` and exactly thirteen bytes long. This reads the eight-byte signature, that
 * chunk's length and type, and the two big-endian 32-bit dimensions — and nothing
 * else. Anything that does not match answers `null`, and the caller refuses the file
 * by name rather than handing a decoder bytes whose size it could not state.
 *
 * It runs beside every decoder it guards: in the compose host for an import, and in
 * `main` for Insert image, whose pdf-lib writer decodes there. Until 2026-09-13 the
 * second route had no pixel check at all, so a 450 KB PNG could reach `embedPng` in
 * `main` past its whole memory budget — threat model §2's decode bomb.
 */

import { MAX_IMPORT_IMAGE_PIXELS } from '@monstera/contract';

/** A PNG file's first eight bytes. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** `IHDR` in ASCII, the type every PNG's first chunk must have. */
const IHDR = [0x49, 0x48, 0x44, 0x52] as const;

/** An image's width and height, in pixels. */
export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The size a PNG's header states, or `null` for bytes that do not begin with a
 * readable PNG header.
 *
 * A width or height of zero is `null` too: RFC 2083 forbids both, and a zero would
 * make any pixel bound pass.
 */
export function pngPixelSize(bytes: Uint8Array): PixelSize | null {
  // Signature 8, chunk length 4, chunk type 4, width 4, height 4.
  if (bytes.length < 24) return null;
  for (let at = 0; at < PNG_SIGNATURE.length; at += 1) {
    if (bytes[at] !== PNG_SIGNATURE[at]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  for (let at = 0; at < IHDR.length; at += 1) {
    if (bytes[12 + at] !== IHDR[at]) return null;
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** A PNG refused before any decoder ran, and which rule refused it. */
export class PngPixelsRefused extends Error {
  override readonly name = 'PngPixelsRefused';
  readonly reason: 'no-header' | 'too-many-pixels';
  /** The size the header stated, or `null` when it stated none. */
  readonly size: PixelSize | null;

  constructor(reason: 'no-header' | 'too-many-pixels', size: PixelSize | null) {
    super(
      size === null
        ? 'the PNG has no readable header, so its size cannot be stated before a decode'
        : `the PNG is ${String(size.width)} × ${String(size.height)}, past ${String(MAX_IMPORT_IMAGE_PIXELS)} pixels`,
    );
    this.reason = reason;
    this.size = size;
  }
}

/**
 * THE ONE PER-IMAGE PIXEL RULE, for every route that hands a PNG to a decoder.
 *
 * The image import and Insert image both call this, so there is one answer to *may
 * this PNG be decoded* (B3a). The import adds its own bound on a set's total, which is
 * a different question.
 *
 * @throws PngPixelsRefused `no-header` for bytes with no readable PNG header, and
 *   `too-many-pixels` past `MAX_IMPORT_IMAGE_PIXELS`
 */
export function checkPngPixels(bytes: Uint8Array): PixelSize {
  const size = pngPixelSize(bytes);
  if (size === null) throw new PngPixelsRefused('no-header', null);
  if (size.width * size.height > MAX_IMPORT_IMAGE_PIXELS) {
    throw new PngPixelsRefused('too-many-pixels', size);
  }
  return size;
}
