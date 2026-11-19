/**
 * Which step of the rewriter's ladder meets a size a person typed
 * ([ADR-0298](../../../docs/DECISIONS/0298-a-smaller-copy-may-be-asked-for-by-size.md) Decision 2 and 3).
 *
 * The steps are tried from the lightest, and the first whose copy is no larger than `bytes` is the answer: pictures stay
 * as sharp as the size allows. Where none fits, the answer is the step whose copy came out smallest, with `fits: false`,
 * so the person is offered the smallest the file can go rather than refused. Linear, not halving: a copy's size falls
 * with each step nearly always and not by rule, since the rewriter keeps a picture's new stream only where it is
 * smaller.
 *
 * `sizeAt` makes the copy at a step and answers its size, or something other than a number that ends the search, such as
 * a document the engine could not read; that answer is passed back as it is.
 */
export async function stepThatFits<Stop>(
  steps: number,
  bytes: number,
  sizeAt: (step: number) => Promise<number | Stop>,
): Promise<{ readonly step: number; readonly size: number; readonly fits: boolean } | Stop> {
  if (!(steps > 0)) throw new RangeError(`a ladder of ${String(steps)} steps has none to try`);
  let smallest: { step: number; size: number } | undefined;
  for (let step = 0; step < steps; step += 1) {
    const size = await sizeAt(step);
    if (typeof size !== 'number') return size;
    if (size <= bytes) return { step, size, fits: true };
    if (smallest === undefined || size < smallest.size) smallest = { step, size };
  }
  // A LADDER OF ONE OR MORE STEPS SET `smallest` on its first, so this is never undefined here.
  const floor = smallest ?? { step: steps - 1, size: Number.POSITIVE_INFINITY };
  return { ...floor, fits: false };
}
