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
 * It runs in the compose host, beside the decoder it guards, never in `main`.
 */

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
