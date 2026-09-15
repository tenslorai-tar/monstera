// @ts-check
/**
 * Colour notation for the proofs that read a running window, in ONE place.
 *
 * Moved here from `rendererPolicy.proof.mjs` when `canvasPixels.proof.mjs` became its second caller: the title
 * bar's overlay is painted from a `#rrggbb` the renderer sent, and the bar reports `rgb()`. Two proofs each
 * holding a conversion would be two opinions about one notation (B3a).
 */

/**
 * `rgb(r, g, b)` as lower-case `#rrggbb`, or the input when it is not one.
 *
 * The two sides of a comparison are reported in different notations by different subsystems —
 * `getBackgroundColor()` answers hex, `getComputedStyle` answers `rgb()` — and a comparison that normalised
 * neither would report a difference that is only a spelling. Anything unparseable is returned unchanged so it
 * cannot silently become a match.
 *
 * @param {string} value
 * @returns {string}
 */
export function rgbToHex(value) {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)$/u.exec(value.trim());
  if (match === null) return value.toLowerCase();
  return `#${[1, 2, 3]
    .map((index) => Number(match[index]).toString(16).padStart(2, '0'))
    .join('')}`;
}
