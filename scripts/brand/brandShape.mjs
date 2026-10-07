// @ts-check
/**
 * The shape every brand output assumes of its master, as one function its two callers take:
 * `generateAssets.mjs`, which refuses a master of the wrong shape, and its proof.
 *
 * Every output pads with transparency, and every mark sits on whatever ground its surface has —
 * the title bar in three themes, the start screen, Explorer. A master with no alpha channel, or an
 * opaque corner, would draw a square behind the mark on every one of them. Measured 2026-09-19: the
 * owner's three masters were 2048 × 2048 RGBA with four transparent corners each; measured
 * 2026-10-04, so is the one master that replaced them (`brandMaster.mjs`).
 */

import sharp from 'sharp';

/**
 * The most alpha a corner may carry and still count as transparent: 8 of 255, about 3%.
 *
 * Read from the owner's own file, not chosen: the 4096 × 4096 logo of 2026-10-07 has corner alphas of 3 to 5 and 91,606 of
 * its 16.8 million pixels at an alpha between 1 and 23 (a haze left by the tool that exported it), which no eye separates
 * from transparent on any ground this application draws on. The rule's purpose is that no square is drawn behind the mark,
 * and a square at 3% is not one; above this the corner is the mark's own ground and the master is refused as before.
 */
export const CORNER_HAZE = 8;

/**
 * Why a master is not the shape the outputs assume, or `null`.
 *
 * @param {Buffer} master
 * @returns {Promise<string | null>}
 */
export async function shapeProblem(master) {
  const meta = await sharp(master).metadata();
  if (meta.hasAlpha !== true) return 'it has no alpha channel';
  const { data, info } = await sharp(master).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (/** @type {number} */ x, /** @type {number} */ y) =>
    data[(y * info.width + x) * info.channels + info.channels - 1] ?? 255;
  const corners = [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1],
  ];
  const opaque = corners.filter(([x, y]) => alphaAt(x ?? 0, y ?? 0) > CORNER_HAZE).length;
  return opaque === 0 ? null : `${String(opaque)} of its corners are not transparent`;
}
