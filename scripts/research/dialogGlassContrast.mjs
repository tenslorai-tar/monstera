// @ts-check
/**
 * How opaque must a dialog's glass be for its text to stay readable over ANYTHING behind it?
 *
 * The owner asked for every dialog to be glass — the panel colour over a blur of the window — and not so
 * see-through that its text is hard to read. The token contrast check cannot answer this: it evaluates a
 * text role on a surface, and a translucent surface's colour depends on what is behind it, which the token
 * file does not know. So this composites the worst cases explicitly, through the same maths the check
 * uses (`packages/shared`' `channels` and `contrast`):
 *
 *   what can be behind a dialog  →  the dialog's backdrop (`--canvas` at 0.6)  →  the glass (`--surface` at α)
 *
 * and asks each text role's contrast on the result. The worst case is a flat field of the extreme colour:
 * a blur averages what is behind, so it can only move the result TOWARDS the middle, never past the flat
 * extreme. The extremes are pure white (a page) and pure black (ink, the redaction mark), in both themes.
 *
 * Usage: node scripts/research/dialogGlassContrast.mjs   (needs `packages/shared` built)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';

const { channels, contrast } = await import(`file://${join(repoRoot(), 'packages/shared/dist/colour.js')}`);

/**
 * Reads one theme block's colour tokens from the shipped token file.
 *
 * @param {string} selector
 * @returns {Record<string, string>}
 */
function theme(selector) {
  const css = readFileSync(join(repoRoot(), 'packages/ui/src/tokens.css'), 'utf8');
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const block = css.slice(start, css.indexOf('}', start));
  /** @type {Record<string, string>} */
  const tokens = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gu)) tokens[match[1] ?? ''] = (match[2] ?? '').trim();
  return tokens;
}

/** @param {number[]} top @param {number} alpha @param {number[]} under */
const over = (top, alpha, under) => top.map((value, index) => value * alpha + (under[index] ?? 0) * (1 - alpha));

const BACKDROP_ALPHA = 0.6;
const CANDIDATES = [0.8, 0.85, 0.9, 0.94];
const BEHIND = { white: [255, 255, 255], black: [0, 0, 0] };

// CONTROL: at full opacity the glass IS the surface, so each result must equal the token pair's own ratio.
for (const [name, selector] of /** @type {const} */ ([
  ['dark', "[data-theme='dark']"],
  ['light', "[data-theme='light']"],
])) {
  const t = theme(selector);
  const surface = channels(t['surface']);
  const canvas = channels(t['canvas']);
  if (surface === null || canvas === null) throw new Error(`${name}: surface or canvas did not parse`);
  const solid = contrast(channels(t['faint']), surface);
  const viaGlass = contrast(channels(t['faint']), over(surface, 1, over(canvas, BACKDROP_ALPHA, BEHIND.white)));
  if (Math.abs(solid - viaGlass) > 1e-9) throw new Error(`${name}: the control failed — α=1 is not the surface`);
  process.stdout.write(`${name}: control ok (faint on solid surface ${solid.toFixed(2)}:1)\n`);

  for (const alpha of CANDIDATES) {
    const row = [];
    for (const [behindName, behind] of Object.entries(BEHIND)) {
      const glass = over(surface, alpha, over(canvas, BACKDROP_ALPHA, behind));
      const worst = Math.min(...['text', 'muted', 'faint'].map((role) => contrast(channels(t[role]), glass)));
      row.push(`over ${behindName}: faintest text ${worst.toFixed(2)}:1`);
    }
    process.stdout.write(`  ${name} α=${String(alpha)}  ${row.join('   ')}\n`);
  }
}
