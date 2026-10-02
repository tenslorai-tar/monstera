// @ts-check
/**
 * The surface variants the research instruments measure a candidate by removing: CSS adopted into the running page
 * through the CSSOM (the renderer's CSP refuses an injected `<style>`, §9.27), or a Chromium switch on the launch.
 * Never shipped; only ever injected by an instrument.
 *
 * ONE table for every instrument that takes `--variant`: `frameTimes.mjs` reads what a candidate costs in frames and
 * `appMemory.mjs` what it costs in memory, and a variant spelt twice would let the two measure different things under
 * one name (B3a).
 */

/** The CSS each variant adds. An empty string is a variant carried by a switch or a script instead. */
export const VARIANTS = {
  none: '',
  'no-blur': '*, *::before, *::after { backdrop-filter: none !important; }',
  'no-gradients': '*, *::before, *::after { background-image: none !important; }',
  'no-thumbnails': '.m-document-panel__body { display: none !important; }',
  // THE SCROLLER COMPOSITED, two ways: a hint, and an opaque background (which changes the look and is a probe only).
  'composited-scroll': '.m-page-list { will-change: scroll-position; }',
  'opaque-scroller': '.m-page-list { background-color: #0b120e !important; }',
  'scroller-layer': '.m-page-list { will-change: transform; }',
  // `no-gradients` TAKES THE GRAIN TOO (an SVG noise image, blended `overlay` over the window), so the three are also
  // measured apart: the grain alone, the surface's ambient lights alone, and the page area's own light alone.
  'no-grain': '.m-document-surface::before { display: none !important; }',
  'no-ambient': '.m-document-surface { background-image: none !important; }',
  'no-canvas-light': '.m-canvas-area { background-image: none !important; }',
  // BOTH LIGHTS AT ONCE, the grain kept: what the lit ground costs apart from its noise.
  'no-lights': '.m-document-surface, .m-canvas-area { background-image: none !important; }',
  'scroller-layer-no-grain': '.m-page-list { will-change: transform; } .m-document-surface::before { display: none !important; }',
  // THE GRAIN KEPT, on its own layer: drawn once, blended by the compositor, never re-rastered under a repaint.
  'grain-layer': '.m-document-surface::before { will-change: transform; }',
  // THE GRAIN KEPT AND ITS LAYER UNDONE: the shipped grain as it was before its window-sized layer (93f34880).
  'grain-unlayered': '.m-document-surface::before { will-change: auto !important; }',
  'scroller-layer-grain-layer': '.m-page-list { will-change: transform; } .m-document-surface::before { will-change: transform; }',
  // THE GRADIENTS' REMAINING COST once the page list has its own layer: the owner's trade, measured after the fix.
  'scroller-layer-no-gradients':
    '.m-page-list { will-change: transform; } *, *::before, *::after { background-image: none !important; }',
  // EACH PAGE'S LAYOUT ISOLATED: a slot that moved without changing size need not lay its text layer out again.
  'contain-slots': '.m-page-slot { contain: layout; }',
  // A Chromium switch rather than CSS: every scroller composited, LCD text given up wherever one scrolls.
  'prefer-compositing': '',
  // A Chromium switch rather than CSS: 2D canvases in the RENDERER's memory, not the GPU process's — PDF.js' pages and
  // thumbnails are 2D canvases, so what moves between the two processes is what those canvases hold there.
  'cpu-canvas': '',
  // A script rather than CSS: see `frameTimes.mjs`' NO_GLOBAL_CURSOR.
  'no-global-cursor': '',
};

/** @typedef {keyof typeof VARIANTS} Variant */

/**
 * The CSS a named variant adds, refusing a name the table does not hold.
 *
 * @param {string} name
 * @returns {string}
 */
export function variantCss(name) {
  const css = /** @type {Record<string, string>} */ (VARIANTS)[name];
  if (css === undefined) throw new Error(`--variant is one of ${Object.keys(VARIANTS).join(', ')}.`);
  return css;
}

/**
 * The Chromium switches a named variant adds to the launch.
 *
 * @param {string} name
 * @returns {string[]}
 */
export function variantSwitches(name) {
  if (name === 'prefer-compositing') return ['--enable-prefer-compositing-to-lcd-text'];
  if (name === 'cpu-canvas') return ['--disable-accelerated-2d-canvas'];
  return [];
}
