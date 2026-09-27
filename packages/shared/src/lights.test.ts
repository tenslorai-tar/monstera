import { describe, expect, it } from 'vitest';

import { channelsWithAlpha, luminance } from './colour.js';
import { NO_TURN, TURNED_STRENGTH, turnFor, turnLight } from './lights.js';

const GREEN_GLOW = 'rgba(34, 197, 94, 0.3)';
const THEME_ACCENT = [47, 185, 106] as const;

function parts(value: string | null): readonly [readonly [number, number, number], number] {
  const parsed = value === null ? null : channelsWithAlpha(value);
  if (parsed === null) throw new Error(`${String(value)} parses`);
  return parsed;
}

describe('turnLight (ADR-0114)', () => {
  it('NO TURN is the identity, in the design’s own channels and alpha', () => {
    expect(parts(turnLight(GREEN_GLOW, NO_TURN))).toStrictEqual([[34, 197, 94], 0.3]);
    expect(parts(turnLight('#060b09', NO_TURN))).toStrictEqual([[6, 11, 9], 1]);
  });

  it('a turn moves the colour and draws it at the turned strength — never stronger than the design', () => {
    const [rgb, alpha] = parts(turnLight(GREEN_GLOW, { degrees: 120, scale: 1 }));
    expect(alpha).toBe(Math.round(0.3 * TURNED_STRENGTH * 1000) / 1000);
    expect(alpha).toBeLessThan(0.3);
    expect(rgb).not.toStrictEqual([34, 197, 94]);
  });

  it('keeps the design’s LIGHTNESS, which is what makes the family sweepable: luminance stays near the design’s', () => {
    // OKLCH lightness is not WCAG luminance, so this is a closeness, not an equality — and it is the property the
    // contrast sweep leans on: a turn cannot make a dim light bright.
    const design = luminance(parts(GREEN_GLOW)[0]);
    for (const degrees of [60, 120, 180, 240, 300]) {
      const turned = luminance(parts(turnLight(GREEN_GLOW, { degrees, scale: 1 }))[0]);
      expect(Math.abs(turned - design)).toBeLessThan(0.25);
    }
  });

  it('every turn lands INSIDE sRGB, by giving up chroma rather than clipping a channel', () => {
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const [rgb] = parts(turnLight('rgba(250, 204, 21, 0.07)', { degrees, scale: 1 }));
      for (const channel of rgb) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('a scale of zero is a NEUTRAL light — a grey accent’s ground is grey, not green', () => {
    const [[red, green, blue]] = parts(turnLight(GREEN_GLOW, { degrees: 0, scale: 0 }));
    expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThanOrEqual(1);
  });

  it('refuses what it cannot parse rather than guessing a colour', () => {
    expect(turnLight('var(--x)', NO_TURN)).toBeNull();
  });
});

describe('turnFor', () => {
  it('the theme’s own accent is no turn at all', () => {
    expect(turnFor(THEME_ACCENT, THEME_ACCENT)).toStrictEqual(NO_TURN);
  });

  it('a grey accent scales the chroma to about nothing; a vivid one never above the design’s', () => {
    expect(turnFor([128, 128, 128], THEME_ACCENT).scale).toBeLessThan(0.01);
    expect(turnFor([0, 255, 0], THEME_ACCENT).scale).toBe(1);
  });
});
