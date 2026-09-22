import { channels } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ACCENT_MIN_RATIO, ACCENT_PRESETS, accentUsable } from './accentPresets.js';

/** The light theme's surfaces, as `tokens.css` declares them. */
const LIGHT = ['#ffffff', '#f7f8f9', '#f4f5f7'].map((hex) => {
  const rgb = channels(hex);
  if (rgb === null) throw new Error(`the fixture colour ${hex} did not parse`);
  return rgb;
});

/** The dark theme's. */
const DARK = ['#24282b', '#2a2f33', '#191c1e'].map((hex) => {
  const rgb = channels(hex);
  if (rgb === null) throw new Error(`the fixture colour ${hex} did not parse`);
  return rgb;
});

describe('which accent may be offered', () => {
  it('REFUSES a colour that cannot be told from this theme’s surfaces', () => {
    // A strong blue on the dark theme's own surfaces measures under 3:1 — the swatch the owner's
    // design draws refused, arriving in the theme where it is genuinely unusable.
    expect(accentUsable('#2563eb', DARK)).toBe(false);
    // CONTROL: the same colour on the light theme's surfaces clears it, so the answer is the
    // theme's and not the colour's alone.
    expect(accentUsable('#2563eb', LIGHT)).toBe(true);
  });

  it('accepts the theme’s own without asking, and refuses a value that is not a colour', () => {
    expect(accentUsable('theme', LIGHT)).toBe(true);
    expect(accentUsable('not a colour', LIGHT)).toBe(false);
    // NO SURFACES IS NOT A PASS: a check with nothing to check against refuses.
    expect(accentUsable('#16a34a', [])).toBe(false);
  });

  it('every preset is usable in at least one theme, so none is offered nowhere', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(accentUsable(preset.value, LIGHT) || accentUsable(preset.value, DARK), preset.value).toBe(true);
    }
  });

  it('holds an accent to the FILL ratio, which is the one it can fail', () => {
    // A check about the text on the accent could never refuse: `onColor` solves a foreground for any
    // fill, since no colour fails against both white and black. 1.4.11's 3:1 is the rule that bites.
    expect(ACCENT_MIN_RATIO).toBe(3);
  });
});
