import { describe, expect, it } from 'vitest';

import { type Rgb, channels, contrast, luminance, onColor, onColorRounded } from './colour.js';

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

describe('onColorRounded', () => {
  /** Whether every channel is a value a CSS colour or a canvas can carry. */
  function isEightBit([r, g, b]: Rgb): boolean {
    return [r, g, b].every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    );
  }

  it('CLEARS THE FLOOR AFTER ROUNDING, which onColor alone does not guarantee', () => {
    // THE MEASURED INSTANCE, and the reason this function exists. `onColor`
    // answers 23.59 per channel here at 4.5137:1; rounding that to nearest
    // gives 24, which is 4.4957:1 — under the ratio it was just solved for.
    //
    // Asserted on the RETURNED value rather than on the solver's, because the
    // returned one is what a caller writes. Checking the solver's answer is
    // precisely the mistake this case exists for.
    const grey: Rgb = [0x80, 0x80, 0x80];
    const solved = onColor(grey, [grey], 4.5);
    if (!solved.ok) throw new Error('the continuous solve should succeed here');
    // NEAREST, spelt out — the rounding this function replaced. Built as a
    // tuple rather than cast from `map`, so the shape is the type rather than
    // an assertion about it.
    const nearest: Rgb = [
      Math.round(solved.value[0]),
      Math.round(solved.value[1]),
      Math.round(solved.value[2]),
    ];
    expect(contrast(nearest, grey)).toBeLessThan(4.5);

    const rounded = onColorRounded(grey, [grey], 4.5);
    if (!rounded.ok) throw new Error(`expected a rounded solution, got: ${rounded.error}`);
    expect(isEightBit(rounded.value)).toBe(true);
    expect(contrast(rounded.value, grey)).toBeGreaterThanOrEqual(4.5);
  });

  it('clears EVERY background, not just the first', () => {
    // A colour clearing one ground and failing the other is the defect a
    // single-ground check cannot see, and rounding is where it would appear:
    // the direction is chosen once for all channels.
    const grounds: Rgb[] = [WHITE, DARK_SURFACE];
    const rounded = onColorRounded([0x80, 0x80, 0x80], grounds, 3);
    if (!rounded.ok) throw new Error(`expected a rounded solution, got: ${rounded.error}`);
    for (const ground of grounds) {
      expect(contrast(rounded.value, ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it('passes onColor’s own refusal through rather than inventing one', () => {
    // 21:1 is reachable only between pure black and pure white, so a mid-grey
    // ground admits nothing. The caller must meet the solver's words, not a
    // second explanation — two wordings for one refusal is two opinions about
    // why a design cannot be satisfied.
    const refused = onColorRounded([0x80, 0x80, 0x80], [[0x80, 0x80, 0x80]], 21);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain('black–white axis');
  });

  it('returns an EIGHT-BIT colour for an answer that needed no adjustment', () => {
    // `onColor` returns `wanted` unchanged when it already clears, and `wanted`
    // is normally integral — so this is the branch where the direction is
    // "unmoved" and rounding to nearest is correct. Without a case it is a
    // branch nothing reaches, since every other case moves.
    const rounded = onColorRounded(BLACK, [WHITE], 4.5);
    if (!rounded.ok) throw new Error(`expected a rounded solution, got: ${rounded.error}`);
    expect(rounded.value).toStrictEqual(BLACK);
  });

  it('CONTROL: it does not simply return what it was given', () => {
    // Without this, "clears the floor" is satisfied by a function that answers
    // `wanted` whenever `wanted` happens to clear — and every case above uses a
    // colour that does not, so none of them would notice.
    const wanted: Rgb = [0xf0, 0xf0, 0xf0];
    const rounded = onColorRounded(wanted, [WHITE], 4.5);
    if (!rounded.ok) throw new Error(`expected a rounded solution, got: ${rounded.error}`);
    expect(rounded.value).not.toStrictEqual(wanted);
    expect(luminance(rounded.value)).toBeLessThan(luminance(wanted));
  });
});
