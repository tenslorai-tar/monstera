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
 * hundred-thousandth of a point but that times the mark's width: measured 2026-11-12, a word stamp whose 190-unit
 * appearance is fitted to a 200-point `/Rect` (scale 1.0526315…) drew its far border edge up to 16 of 255 apart from its
 * layer at four places, and identically at six.
 */
export function matrixNumber(value: number): string {
  return value.toFixed(6);
}
