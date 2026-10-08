/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Where the IHDR chunk's type, width and height sit: after the signature (8), and the chunk's length field (4). */
const IHDR_TYPE_AT = 12;
const IHDR_WIDTH_AT = 16;
const IHDR_HEIGHT_AT = 20;
const IHDR_END = 24;

/**
 * The size a PNG DECLARES in its first chunk, read without decoding anything, or `undefined` when the bytes do not begin
 * with a PNG signature and a header chunk (CR-SEC-21).
 *
 * `main` decodes the print raster the engine host produced, and the host is hostile by invariant 25's premise: a header
 * that declares a size the decoder will allocate for is a request to allocate it. Reading the declared size first is what
 * lets the caller refuse before the decoder is asked, which the decoder cannot do for itself.
 */
export function declaredPngSize(png: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  if (png.length < IHDR_END) return undefined;
  if (!PNG_SIGNATURE.every((byte, index) => png[index] === byte)) return undefined;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // 'IHDR' as four code points, read in the order the chunk stores them.
  if (view.getUint32(IHDR_TYPE_AT) !== 0x49484452) return undefined;
  return { width: view.getUint32(IHDR_WIDTH_AT), height: view.getUint32(IHDR_HEIGHT_AT) };
}

/**
 * The declared size of `png`, or a thrown refusal where it is not a PNG or declares more than `maxPixels`. The product of
 * two 32-bit numbers is exact in a double up to 2^53, so the comparison needs no big integers.
 */
export function pngSizeWithin(png: Uint8Array, maxPixels: number): { readonly width: number; readonly height: number } {
  const size = declaredPngSize(png);
  if (size === undefined) throw new Error('the print raster is not a PNG with a readable header, so it was not decoded');
  if (size.width === 0 || size.height === 0 || size.width * size.height > maxPixels) {
    throw new Error(
      `the print raster declares ${String(size.width)} by ${String(size.height)} pixels, more than the ` +
        `${String(maxPixels)} a print asks for, so it was not decoded`,
    );
  }
  return size;
}
