import { describe, expect, it } from 'vitest';

import { type Rgb, channels, contrast, luminance, onColor } from './colour.js';

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** `--surface2` in the dark theme, which is what `--border-control` was solved against. */
const DARK_SURFACE: Rgb = [0x24, 0x28, 0x2c];

describe('contrast', () => {
  it('reports the two ratios WCAG fixes by definition', () => {
    // 21:1 and 1:1 are not measurements — they are what the formula produces at
    // its extremes, so a change to `luminance` that broke the curve while
    // keeping its shape would still land here.
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('is symmetric, so which argument is the foreground cannot change the answer', () => {
    expect(contrast(DARK_SURFACE, WHITE)).toBeCloseTo(contrast(WHITE, DARK_SURFACE), 10);
  });
});

describe('channels', () => {
  it('reads three- and six-digit hex identically', () => {
    expect(channels('#fff')).toEqual([255, 255, 255]);
    expect(channels('#ffffff')).toEqual([255, 255, 255]);
  });

  it('answers null for a value it cannot read, rather than a black default', () => {
    // The load-bearing case in this describe. A parse failure that returned
    // [0,0,0] would report a plausible ratio for a colour nobody can see, which
    // is the blind-instrument shape: the failure state and a real answer are
    // the same output.
    expect(channels('var(--surface)')).toBeNull();
    expect(channels('')).toBeNull();
  });

  it('COMPOSITES alpha over the surface rather than ignoring it', () => {
    // Half-opacity white over black is mid-grey. Ignoring alpha would answer
    // pure white and report a ratio for a colour that never renders.
    expect(channels('rgba(255, 255, 255, 0.5)', BLACK)).toEqual([127.5, 127.5, 127.5]);
  });

  it('leaves an alpha value alone when there is nothing to composite over', () => {
    expect(channels('rgba(255, 255, 255, 0.5)', null)).toEqual([255, 255, 255]);
  });
});

describe('onColor', () => {
  it('returns the wanted colour UNCHANGED when it already clears', () => {
    const solved = onColor(WHITE, [BLACK], 4.5);
    expect(solved.ok).toBe(true);
    expect(solved.ok && solved.value).toEqual(WHITE);
  });

  it('solves a colour that does not clear, and the result actually clears', () => {
    // Mid-grey on white fails 4.5:1. The assertion is not that the answer is
    // some particular colour — it is that the POST-CONDITION holds, which is
    // the only thing a caller relies on.
    const wanted: Rgb = [0x80, 0x80, 0x80];
    const solved = onColor(wanted, [WHITE], 4.5);
    expect(solved.ok).toBe(true);
    if (solved.ok) expect(contrast(solved.value, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('clears against EVERY background, not merely one of them', () => {
    // The conjunction is the whole point: a control boundary sits on several
    // chrome surfaces and must be legible on all of them. Solving against one
    // alone yields a colour that fails on another, and nobody sees it until
    // they switch theme.
    //
    // THE FIXTURE IS CHOSEN SO THE BUG CANNOT PASS IT, which took two attempts.
    // The first used mid-grey against white, black and a dark surface at 3:1 —
    // and mid-grey clears all three ALREADY, so `every` and `some` returned the
    // same answer and the case survived its own mutation. Near-black clears
    // white at 3:1 (16.3:1) and fails black (1.3:1), so a `some` implementation
    // returns it unchanged and this case reddens.
    const wanted: Rgb = [0x20, 0x20, 0x20];
    const backgrounds: readonly Rgb[] = [WHITE, BLACK];
    expect(contrast(wanted, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(wanted, BLACK)).toBeLessThan(3);

    const solved = onColor(wanted, backgrounds, 3);
    if (!solved.ok) throw new Error(`expected a solution, got: ${solved.error}`);
    for (const background of backgrounds) {
      expect(contrast(solved.value, background)).toBeGreaterThanOrEqual(3);
    }
  });

  it('REFUSES when no colour on the axis can clear, rather than returning its best attempt', () => {
    // 21:1 is reachable only between pure black and pure white, so a mid-grey
    // background admits nothing. Returning the closest attempt would hand back
    // a colour that fails the ratio the caller asked for — which is the entire
    // defect this function exists to prevent.
    const solved = onColor([0x80, 0x80, 0x80], [[0x80, 0x80, 0x80]], 21);
    expect(solved.ok).toBe(false);
    expect(!solved.ok && solved.error).toContain('21:1');
  });

  it('CONTROL: the same call at a reachable ratio succeeds, so the refusal is the ratio', () => {
    // Without this the case above passes for a build where onColor refuses
    // everything, and refusal-versus-impossibility is exactly the pair the
    // negative-probe rule says to separate.
    const solved = onColor([0x80, 0x80, 0x80], [[0x80, 0x80, 0x80]], 3);
    expect(solved.ok).toBe(true);
  });

  it('refuses an empty background set rather than treating it as satisfied', () => {
    // `every` on an empty array is true, so the naive implementation returns
    // the wanted colour and reports success for a caller that never said what
    // the surface was. Vacuous truth answering a design question.
    const solved = onColor(WHITE, [], 4.5);
    expect(solved.ok).toBe(false);
    expect(!solved.ok && solved.error).toContain('no backgrounds');
  });

  it('prefers the NEARER direction, so a light surface drives the answer darker', () => {
    // Near-white wanted on white: black is far, white is unreachable. The
    // answer must move down, and asserting the direction is what separates
    // "solved" from "returned something that happens to clear".
    const wanted: Rgb = [0xf0, 0xf0, 0xf0];
    const solved = onColor(wanted, [WHITE], 4.5);
    if (!solved.ok) throw new Error(`expected a solution, got: ${solved.error}`);
    expect(luminance(solved.value)).toBeLessThan(luminance(wanted));
  });
});
