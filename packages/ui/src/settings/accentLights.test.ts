import { ACCENT_LIGHTS, NO_TURN, channels, channelsWithAlpha, turnFor, turnLight } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

// THE FILE'S TEXT through the bundler, as the renderer's own build would read it: this package may not import Node.
import TOKENS from '../tokens.css?raw';
import { ACCENT_PRESETS } from './accentPresets.js';

/**
 * The owner's 27 September list, item 6, against the REAL token file: *"The default accent gives exactly today's look
 * … A case per sample accent proves the glow moved, with a control that the default green is unchanged."*
 *
 * Read from `tokens.css` rather than restated, so a light added to the file or to `ACCENT_LIGHTS` is covered here the
 * day it is added. That the floors hold under every turn is `check:tokencontrast`'s sweep, not this file's.
 */

/** One theme block's declarations, by the attribute that selects it. */
function block(theme: 'dark' | 'light'): ReadonlyMap<string, string> {
  const found = new RegExp(`\\[data-theme='${theme}'\\][^{]*\\{([^}]*)\\}`, 'u').exec(TOKENS);
  if (found === null) throw new Error(`tokens.css has a ${theme} block`);
  const values = new Map<string, string>();
  for (const declaration of (found[1] ?? '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/gu)) {
    values.set(declaration[1] ?? '', (declaration[2] ?? '').trim());
  }
  return values;
}

/** Two CSS colours are the same colour, channel for channel and in alpha. */
function same(left: string, right: string): boolean {
  const a = channelsWithAlpha(left);
  const b = channelsWithAlpha(right);
  return a !== null && b !== null && a[1] === b[1] && a[0].every((value, index) => value === b[0][index]);
}

describe.each(['dark', 'light'] as const)('the %s theme’s lights', (theme) => {
  const values = block(theme);
  const accent = channels(values.get('accent') ?? '');

  it('declares every light the accent turns, so none is turned from nothing', () => {
    // THE LIST'S CONTROL: an empty list would satisfy every case below.
    expect(ACCENT_LIGHTS.length).toBeGreaterThan(20);
    expect(ACCENT_LIGHTS.filter((name) => !values.has(name))).toStrictEqual([]);
  });

  it('the theme’s own accent draws EVERY light exactly as the design does, to the byte', () => {
    if (accent === null) throw new Error('the theme declares its accent');
    const turn = turnFor(accent, accent);
    expect(turn).toStrictEqual(NO_TURN);
    const changed = ACCENT_LIGHTS.filter((name) => {
      const design = values.get(name) ?? '';
      const turned = turnLight(design, turn);
      return turned === null || !same(turned, design);
    });
    expect(changed).toStrictEqual([]);
  });

  // THE SAMPLES WHOSE HUE IS ANOTHER COLOUR'S: the green preset sits a few degrees from the theme's own accent, and a
  // turn that small can round to the same bytes on a faint tint, which would be a true answer to a different question.
  const others = ACCENT_PRESETS.filter((preset) => {
    const chosen = channels(preset.value);
    return accent !== null && chosen !== null && Math.abs(turnFor(chosen, accent).degrees) > 30;
  });

  it('has at least three sample accents of another hue to try', () => {
    expect(others.length).toBeGreaterThanOrEqual(3);
  });

  it.each(others.map((preset) => preset.value))('the sample accent %s MOVES the glow and every tint', (value) => {
    const chosen = channels(value);
    if (accent === null || chosen === null) throw new Error('both accents parse');
    const turn = turnFor(chosen, accent);
    const still = ['glow-green', 'tint-start', 'tint-canvas', 'glow-teal'].filter((name) => {
      const design = values.get(name) ?? '';
      const turned = turnLight(design, turn);
      return turned === null || same(turned, design);
    });
    expect(still).toStrictEqual([]);
  });

  it('CONTROL: the default green, chosen by its value, is unchanged — the move above is the accent’s, not the rule’s', () => {
    if (accent === null) throw new Error('the theme declares its accent');
    const design = values.get('glow-green') ?? '';
    const turned = turnLight(design, turnFor(accent, accent));
    expect(turned !== null && same(turned, design)).toBe(true);
  });
});
