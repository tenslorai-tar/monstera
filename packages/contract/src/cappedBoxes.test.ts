import { describe, expect, it } from 'vitest';

import { MAX_BOXED_CHARACTERS, cappedBoxes } from './schemas.js';

/**
 * The one cap on the characters an answer names as drawn in the box (SSSSSSS-22): every host's answer takes it, so a
 * list is never cut two ways. Its `more` term — characters a writer counted past its own names — had no case with a
 * value, since the in-process engine answers 0.
 */
describe('cappedBoxes', () => {
  it('names the first characters and COUNTS the rest, adding them to what the writer already counted', () => {
    const boxed = Array.from({ length: MAX_BOXED_CHARACTERS + 10 }, (_, at) => String.fromCodePoint(0x4e00 + at));
    const capped = cappedBoxes({ boxed, more: 5 });
    expect(capped.boxed).toStrictEqual(boxed.slice(0, MAX_BOXED_CHARACTERS));
    expect(capped.more).toBe(15);
  });

  it('CONTROL: under the cap, every character is named and the counted rest passes through unchanged', () => {
    expect(cappedBoxes({ boxed: ['中'], more: 3 })).toStrictEqual({ boxed: ['中'], more: 3 });
  });
});
