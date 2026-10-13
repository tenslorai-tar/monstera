import { describe, expect, it } from 'vitest';

import { ENGINE_TEXT_OBJECTS_MAX } from './pdfiumChannels.js';
import { boundedToAnswer } from './pdfiumHandlers.js';

/**
 * The one place a page's runs or objects are cut to what an answer carries (the owner's L6), and the flag the editor says
 * so from. The walk at the bound is the control: a rule that flagged at the bound, or one that cut there and said
 * nothing past it, each fails one of the two cases.
 */
describe('boundedToAnswer', () => {
  it('cuts a walk one past the bound to the bound, and SAYS it cut', () => {
    const walked = Array.from({ length: ENGINE_TEXT_OBJECTS_MAX + 1 }, (_, at) => at);
    const { kept, truncated } = boundedToAnswer(walked);
    expect(kept).toHaveLength(ENGINE_TEXT_OBJECTS_MAX);
    // THE FIRST ONES ARE KEPT, in the walk's order, so what is outlined is the top of the page's own order.
    expect(kept[0]).toBe(0);
    expect(kept.at(-1)).toBe(ENGINE_TEXT_OBJECTS_MAX - 1);
    expect(truncated).toBe(true);
  });

  it('CONTROL: a walk exactly at the bound is whole, and says nothing', () => {
    const walked = Array.from({ length: ENGINE_TEXT_OBJECTS_MAX }, (_, at) => at);
    expect(boundedToAnswer(walked)).toStrictEqual({ kept: walked, truncated: false });
  });
});
