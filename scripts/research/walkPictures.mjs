// @ts-check
/**
 * WHICH WINDOW A WALK STEP'S PICTURE IS OF, and the one rule that decides whether it is evidence of the step's effect.
 *
 * A step's screenshot is what a person reading the report checks a pass against, so a picture of a window the effect did
 * not happen in is evidence that would pass a broken button. Until 2026-11-17 every step photographed the walk's own
 * window after its work, and the update rows' effects happen in separate copies of the application that the step starts
 * and closes inside its work: rows 288 and 289 of the full walk of 2026-11-17T13-16-52 passed with two identical pictures
 * of the walk's ordinary window, with no *Update available* button and no security notice in either.
 *
 * So the harness (`liveWalk.mjs`) notes every window a step opens, in the walk's own application or in a copy it starts,
 * hands the step `photograph(window)`, and says of each picture which window it is of; this module says whether the
 * pictures taken can stand for the effect.
 */

/**
 * `walk`: the walk's own window. `opened`: a window the step opened. `elsewhere`: neither, such as a window an earlier
 * step left open.
 * @typedef {{ file: string, of: 'walk' | 'opened' | 'elsewhere' }} StepPicture
 */

/**
 * Why a step's pictures are not evidence of its effect, or nothing. A step that opened a window other than the walk's own
 * (a new window of the walk's application, or a copy of the application it started) had its effect there, so its row's
 * picture, the FIRST taken, must be of a window it opened; a step that opened none is pictured in the walk's own window.
 *
 * @param {number} opened how many windows other than the walk's own the step opened
 * @param {readonly StepPicture[]} pictures in the order taken
 * @returns {string | undefined}
 */
export function pictureRefusal(opened, pictures) {
  const [first] = pictures;
  const wanted = opened > 0 ? 'opened' : 'walk';
  if (first === undefined) return opened > 0 ? `the step opened ${String(opened)} window(s) other than the walk's own and photographed none of them` : undefined;
  if (first.of === wanted) return undefined;
  if (first.of === 'elsewhere') return `the step's picture (${first.file}) is of a window that is neither the walk's own nor one the step opened`;
  return opened > 0
    ? `the step's effect happened in a window other than the walk's own, and its picture (${first.file}) is of the walk's own window`
    : `the step opened no window, and its picture (${first.file}) is not of the walk's own`;
}
