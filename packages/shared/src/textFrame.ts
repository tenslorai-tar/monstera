/**
 * The frame a run of text is set in ([ADR-0273](../../../docs/DECISIONS/0273-text-set-at-an-angle-is-edited-in-its-own-frame.md)):
 * the turn, slant or flip its matrix gives its letters, as the linear part of that matrix at unit length along the line.
 * `[a, b, c, d]` in PDF's row-vector order, so a point `(x, y)` of the frame is `(a x + c y, b x + d y)` on the page.
 *
 * ## The one definition, for every side that asks
 *
 * The read groups a run's text in its frame, the editor draws a block through it and the writer lays the block out in it.
 * Three sides asking *is this text upright, and if not how is it set* is three opinions waiting to disagree (B3a): one
 * tolerance here, one there, and a run the read offers is one the writer refuses. So the question is answered here and
 * the three take the answer.
 *
 * ## Upright is no frame
 *
 * Text whose matrix keeps the page's axes (no turn, slant or flip, whatever its scale) has no frame, and every side treats
 * it exactly as it did before frames existed. The test is relative to the matrix's own scale, so a float read back from a
 * file decides it and not its size.
 */
export type TextFrame = readonly [number, number, number, number];

/** Below this, a frame's off-diagonal is float noise: at a page's width, a thousandth of a point. */
const UPRIGHT_TOLERANCE = 1e-6;

/**
 * The frame of a matrix's linear part, or `null` where it is upright, or where it draws its text at no size (no inverse):
 * such text has no space to set a word in, and is the writer's `singular` stop, not a frame.
 */
export function textFrameOf(a: number, b: number, c: number, d: number): TextFrame | null {
  const length = Math.hypot(a, b);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const frame: TextFrame = [a / length, b / length, c / length, d / length];
  if (Math.abs(frame[0] * frame[3] - frame[1] * frame[2]) < 1e-9) return null;
  const scale = Math.max(Math.abs(frame[0]), Math.abs(frame[3]));
  const upright = frame[0] > 0 && frame[3] > 0 && Math.abs(frame[1]) <= scale * UPRIGHT_TOLERANCE && Math.abs(frame[2]) <= scale * UPRIGHT_TOLERANCE;
  return upright ? null : frame;
}

/** Whether two frames are one, to the noise a matrix read back from a file carries. */
export function sameTextFrame(left: TextFrame | null, right: TextFrame | null): boolean {
  if (left === null || right === null) return left === right;
  return left.every((value, at) => Math.abs(value - (right[at] ?? 0)) <= 1e-4);
}

/** A point of the frame on the page. */
export function fromTextFrame(frame: TextFrame, x: number, y: number): { readonly x: number; readonly y: number } {
  const [a, b, c, d] = frame;
  return { x: a * x + c * y, y: b * x + d * y };
}

/** A point of the page in the frame: the inverse of {@link fromTextFrame}. A frame has an inverse by construction. */
export function intoTextFrame(frame: TextFrame, x: number, y: number): { readonly x: number; readonly y: number } {
  const [a, b, c, d] = frame;
  const det = a * d - b * c;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}
