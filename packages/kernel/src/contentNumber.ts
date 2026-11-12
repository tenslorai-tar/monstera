/**
 * A number as a content stream defines one.
 *
 * `String(1e-7)` is `"1e-7"`, which is not a number in a content stream — the
 * background row paid for this and its symptom there was a blank page. Fixed
 * notation, and the same reason applies everywhere a stream is written: a
 * rectangle a hundredth of a point across is representable in a payload.
 *
 * In a module of its own, importing nothing, because the engine-agnostic
 * signature drawing writes streams too and must not reach MuPDF's module to
 * borrow this.
 */
export function contentNumber(value: number): string {
  return value.toFixed(4);
}

/**
 * A `cm` operand that SCALES, to six places. A scale multiplies across the whole mark, so its rounding is not one
 * ten-thousandth of a point but that times the mark's width. Measured 2026-11-12 (`engraveOnSave.test.ts`): a resize
 * keeps a signature's or picture's `/BBox` and moves its `/Rect`, so a 200 by 80 appearance fitted to a 247.37 by 116.13
 * box drew a typed signature's edges up to 18 of 255 apart from its layer at four places, and a picture on a page turned
 * 90 up to 235; at six places neither differs.
 */
export function matrixNumber(value: number): string {
  return value.toFixed(6);
}
