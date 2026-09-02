// @vitest-environment happy-dom
import { contrast, channels } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ACCENT_SETTING, applyAccent } from './accent.js';

/**
 * The accent, and the floor it has to clear.
 *
 * ## The surfaces are SET on the element, not read from the stylesheet
 *
 * `applyAccent` reads `--bg` and `--surface` off the computed style, which in a
 * real shell come from `tokens.css`. happy-dom loads no stylesheet, so each
 * case writes the ground it wants to test against — which is better than
 * loading the token file anyway: a case can then state a ground that makes a
 * given accent unusable, and say why.
 */

function ground(bg: string, surface = bg): HTMLElement {
  const root = document.createElement('div');
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--surface', surface);
  document.body.append(root);
  return root;
}

/** The contrast between two CSS colours, for a case that checks a ratio. */
function ratio(left: string, right: string): number {
  const a = channels(left);
  const b = channels(right);
  if (a === null || b === null) throw new Error(`could not parse ${left} or ${right}`);
  return contrast(a, b);
}

describe('applyAccent', () => {
  it('APPLIES a colour that already clears the floor, unchanged', () => {
    const root = ground('#ffffff');
    expect(applyAccent(root, '#0b6b3a')).toBeUndefined();
    expect(root.style.getPropertyValue('--accent')).toBe('#0b6b3a');
  });

  it('ADJUSTS a colour that does not clear, rather than accepting it', () => {
    // A pale yellow on white is about 1.2:1 — unusable as a control boundary.
    // The founding record says auto-adjust or reject, so this must come back
    // as a DIFFERENT colour that clears, not as the one that was asked for.
    const root = ground('#ffffff');
    expect(applyAccent(root, '#ffe680')).toBeUndefined();

    const applied = root.style.getPropertyValue('--accent');
    expect(applied).not.toBe('#ffe680');
    // THE RATIO IS ASSERTED, not merely that something changed: a function that
    // darkened by a fixed amount would also produce a different colour, and
    // would be wrong for every input that needed more.
    expect(ratio(applied, '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('clears BOTH grounds, not just the first', () => {
    // The two surfaces an accent sits on can be far apart, and a colour that
    // clears against one may fail the other. A check that stopped at the first
    // would pass this case with a colour that is invisible on the second.
    const root = ground('#ffffff', '#111111');
    expect(applyAccent(root, '#808080')).toBeUndefined();

    const applied = root.style.getPropertyValue('--accent');
    expect(ratio(applied, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(ratio(applied, '#111111')).toBeGreaterThanOrEqual(3);
  });

  it('either REFUSES or applies a colour that clears — never neither', () => {
    // THE PROPERTY, over grounds chosen to be awkward. It is written this way
    // because two earlier versions of this case were wrong about what the
    // function should do, and both times the assertion was the guess rather
    // than the code:
    //
    // 1. "these grounds admit nothing" — false. At a 3:1 floor against two
    //    surfaces, black or white clears almost any pair, so `onColor`'s
    //    unsatisfiable branch is not reachable from here with two grounds.
    // 2. "so it always applies" — also false, and this is the finding.
    //    `#777777` against white and black resolves to a colour that clears in
    //    full precision and lands at **2.9897:1** once rounded to eight bits
    //    per channel, which is what a CSS custom property holds.
    //
    // What is actually true is the invariant below, and it is the one worth
    // guarding: whatever comes back, the shell is never wearing a colour that
    // fails the floor.
    for (const pair of [
      ['#ffffff', '#000000'],
      ['#767676', '#808080'],
      ['#949494', '#111111'],
      ['#ffffff', '#f4f5f7'],
    ] as const) {
      const root = ground(pair[0], pair[1]);
      const refusal = applyAccent(root, '#777777');
      const applied = root.style.getPropertyValue('--accent');

      if (refusal === undefined) {
        expect(ratio(applied, pair[0])).toBeGreaterThanOrEqual(3);
        expect(ratio(applied, pair[1])).toBeGreaterThanOrEqual(3);
      } else {
        expect(applied).toBe('');
      }
    }
  });

  it('CLEARS AFTER ROUNDING, which the continuous solve alone does not guarantee', () => {
    // The measured instance, pinned. `#777777` against white and black is the
    // colour whose full-precision answer clears 3:1 and whose eight-bit form
    // lands at 2.9897:1 — so a function that trusted `onColor` alone would put
    // a failing colour on the shell, having just checked it.
    //
    // ASSERTED ON THE APPLIED VALUE, parsed back from the property, because
    // that is the thing a browser will actually paint. Asserting on what the
    // solver returned is exactly the mistake this case exists for.
    const root = ground('#ffffff', '#000000');
    expect(applyAccent(root, '#777777')).toBeUndefined();

    const applied = root.style.getPropertyValue('--accent');
    expect(ratio(applied, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(ratio(applied, '#000000')).toBeGreaterThanOrEqual(3);
  });

  it('refuses when the grounds cannot be read at all', () => {
    // An element with no tokens is what a broken stylesheet looks like. Applying
    // an unchecked accent there would be the reassuring answer for a failed
    // read — the accent goes on, nothing says it was never verified.
    const root = document.createElement('div');
    document.body.append(root);

    expect(applyAccent(root, '#0b6b3a')).toBeTypeOf('string');
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });

  it('`theme` REMOVES the override rather than writing the themes colour', () => {
    // Writing the theme's own value would freeze it: a later theme change would
    // leave the accent behind, which is the difference between "I chose
    // nothing" and "I chose this theme's green".
    const root = ground('#ffffff');
    applyAccent(root, '#0b6b3a');
    expect(root.style.getPropertyValue('--accent')).not.toBe('');

    expect(applyAccent(root, 'theme')).toBeUndefined();
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.style.getPropertyValue('--on-accent')).toBe('');
  });

  it('solves the ON-accent colour against the accent, not against the page', () => {
    // The label sits on the button. Solved against the page's background it
    // would be a colour that reads over the page and not over the control —
    // which is the mistake that makes a green button with green text.
    const root = ground('#ffffff');
    applyAccent(root, '#0b6b3a');

    const accent = root.style.getPropertyValue('--accent');
    const label = root.style.getPropertyValue('--on-accent');
    expect(ratio(label, accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the accent setting', () => {
  it('accepts `theme` and a six-digit hex, and refuses anything else', () => {
    // The fallback must be a value the schema admits — the registry throws at
    // construction otherwise, which is how the first version of this setting
    // was caught.
    expect(ACCENT_SETTING.schema.safeParse(ACCENT_SETTING.fallback).success).toBe(true);
    expect(ACCENT_SETTING.schema.safeParse('#0b6b3a').success).toBe(true);
    expect(ACCENT_SETTING.schema.safeParse('#abc').success).toBe(false);
    expect(ACCENT_SETTING.schema.safeParse('green').success).toBe(false);
  });
});
