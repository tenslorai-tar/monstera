/**
 * Which existing field a wanted name collides with, or `undefined`.
 *
 * ## The ONE answer to *can a field be called this*, taken by the writer and by the surface that asks first (B3a)
 *
 * It answers *is there a field with exactly this name* and one thing more, and that is what makes it a rule rather than
 * a lookup. A dot makes a **parent** in the field tree: measured 2026-09-08, creating `owner` beside an existing
 * `owner.first` is refused by pdf-lib, and so is the reverse. So two names collide when either is a path prefix of the
 * other, not only when they are equal.
 *
 * The writer refused with this rule and the surface did not know it existed: the refusal crossed the engine host's
 * boundary as `internal` (an apply's reason does not), and a person who typed a name a field already had was told only
 * that something went wrong inside the application. The surface now asks this before it sends anything.
 */
export function fieldNameClash(existing: readonly string[], wanted: string): string | undefined {
  return existing.find((name) => name === wanted || name.startsWith(`${wanted}.`) || wanted.startsWith(`${name}.`));
}
