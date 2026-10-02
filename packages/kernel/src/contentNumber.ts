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
