import { describe, expect, it } from 'vitest';

import { sentAsShown } from './blockAsShown.js';

/** A page's runs by index, as a writer reads them: the step-9 shape, one run per line, the first ending in a space. */
const PAGE = new Map([
  [4, 'Names '],
  [7, 'Hours'],
  [9, 'Joe'],
]);
const shown = (run: number): string | undefined => PAGE.get(run);

describe('sentAsShown (ADR-0260)', () => {
  it('is true for a block sent exactly the words its runs show, a soft wrap read as a space', () => {
    expect(sentAsShown([{ lines: [[4], [7]], soft: [true, false], text: 'Names Hours' }], shown)).toBe(true);
  });

  it('is false for words that differ by one character, so a change none of which was written is refused', () => {
    // THE SPACE THE FIRST LINE ENDS IN, dropped: the smallest difference the writer was measured to write (ADR-0260).
    expect(sentAsShown([{ lines: [[4], [7]], soft: [true, false], text: 'NamesHours' }], shown)).toBe(false);
    expect(sentAsShown([{ lines: [[9]], soft: [false], text: 'Joe (walked)' }], shown)).toBe(false);
  });

  it('reads a hard line end as a paragraph, not as the space a soft wrap is', () => {
    // CONTROL for the join: the same runs ending in a hard line are a new paragraph, so the soft-wrap words are not them.
    expect(sentAsShown([{ lines: [[4], [7]], soft: [false, false], text: 'Names Hours' }], shown)).toBe(false);
  });

  it('is false when any one block of several differs', () => {
    expect(
      sentAsShown(
        [
          { lines: [[9]], soft: [false], text: 'Joe' },
          { lines: [[7]], soft: [false], text: 'Minutes' },
        ],
        shown,
      ),
    ).toBe(false);
  });

  it('is false for a run the page cannot name, which the writer could not compare', () => {
    expect(sentAsShown([{ lines: [[99]], soft: [false], text: '' }], shown)).toBe(false);
  });
});
