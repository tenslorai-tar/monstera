/**
 * How a number is written into a PDF content stream.
 *
 * ## One owner, because the rule is one rule and the precision is not
 *
 * **A content stream has no exponential notation.** PDF 32000-1 §7.3.3 defines
 * a real as digits with an optional decimal point, so `1e-7` — which is what
 * `String(0.0000001)` produces — is not a number a reader can parse. The
 * failure it causes is the quiet kind: a stream that fails to tokenise renders
 * as a blank page rather than as an error, so nothing between the write and the
 * user's screen says anything went wrong.
 *
 * That rule was written once inside `pageBackground.ts` and was about to be
 * written a second time inside `pageResize.ts`, which is B3a's shape exactly —
 * *a rule that lives in call sites is a rule the next caller re-derives*, and a
 * partial second copy is the dangerous form because it agrees most of the time.
 *
 * **The digit count is a caller's decision and is deliberately a parameter**,
 * because the two callers want different answers and one shared constant would
 * have to be wrong for one of them: a colour component or a rectangle edge is
 * finer than a device pixel at three decimals, and a scale factor at three
 * decimals is 0.1% — 0.6pt across a 600pt page, which is visible. Sharing the
 * guarantee and parametrising the precision is what keeps this from becoming a
 * second opinion about either.
 */

/**
 * `value` as content-stream text, in fixed notation.
 *
 * @param value the number to write
 * @param decimals how many places to keep — the caller's precision, stated at
 *   the call site with its reason
 */
export function contentNumber(value: number, decimals: number): string {
  // `toFixed` is the whole mechanism and it is exhaustive for this: it is
  // specified to produce fixed notation for every finite input, including the
  // magnitudes where `String` switches to exponential.
  return value.toFixed(decimals);
}

/**
 * Decimals for a **coordinate or a colour** — a position on the page, an edge,
 * a component.
 *
 * A PDF user space unit is 1/72 inch, so a thousandth of one is 0.00035 mm.
 * Nothing this application renders can show it.
 */
export const COORDINATE_DECIMALS = 3;

/**
 * Decimals for a **scale factor**, which multiplies a coordinate rather than
 * being one.
 *
 * The error a scale carries is proportional to the page, so the acceptable
 * absolute error decides the digits rather than the other way round: five
 * decimals across the format's largest page — 14,400 units, PDF 32000-1's own
 * limit — is 0.14 units, under a fifth of a point. Three would be 14 units.
 */
export const SCALE_DECIMALS = 5;
