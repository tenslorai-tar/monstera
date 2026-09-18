/**
 * Takes a region's raster again, smaller, until the service that will read it accepts its bytes.
 *
 * ## Why after rasterising, and not before
 *
 * A network service limits an image twice — its pixels and its bytes — and only the
 * first is known before the host has drawn anything. A PNG's size follows its content:
 * a photographed page compresses badly, so a raster inside the pixel limit can be over
 * the byte limit (measured 2026-09-18: a Claude 400 on 10,979,320 encoded bytes, for a
 * scan the pixel rule accepted). So the raster is taken, weighed, and taken again.
 *
 * ## At the floor it is sent as it is
 *
 * The recogniser is the authority on its own service and refuses what it knows will be
 * refused, by name — and a service whose real limit is larger than the one declared
 * (Azure's paid tier) may take it. Refusing here as well would be a second opinion.
 */

/** A service's verdict on a PNG's size: accepted, or how much smaller to draw it. */
export type ByteVerdict = { readonly ok: true } | { readonly ok: false; readonly shrinkBy: number };

/**
 * How many times a raster is taken again.
 *
 * Each retake shrinks by the square root of the overshoot with a 5% margin, which one
 * retake settles for a raster whose size tracks its pixel count; three bounds the host
 * work for one that does not.
 */
export const MAX_RASTER_RETAKES = 3;

/**
 * @param scale the scale the engine chose from the pixel limit
 * @param floor the smallest scale the snapshot takes
 * @param accepts the engine's byte rule
 * @param rasterAt draws the region at a scale
 * @returns the raster to send and the scale it was drawn at
 */
export async function rasterWithinLimit<R extends { readonly png: Uint8Array }>(
  scale: number,
  floor: number,
  accepts: (pngBytes: number) => ByteVerdict,
  rasterAt: (scale: number) => Promise<R>,
): Promise<{ readonly raster: R; readonly scale: number }> {
  let current = scale;
  let raster = await rasterAt(current);
  for (let attempt = 0; attempt < MAX_RASTER_RETAKES; attempt += 1) {
    const verdict = accepts(raster.png.byteLength);
    if (verdict.ok) break;
    const smaller = Math.max(floor, Math.floor(current * verdict.shrinkBy * 100) / 100);
    if (smaller >= current) break;
    current = smaller;
    raster = await rasterAt(current);
  }
  return { raster, scale: current };
}
