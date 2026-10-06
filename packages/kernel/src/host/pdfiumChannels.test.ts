import { ENGINE_ANSWER_FILE_MAX_BYTES } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { ENGINE_TEXT_OBJECTS_MAX, PAGE_TEXT_OBJECTS_MAX, SMALLEST_RUN_BYTES, pdfiumChannels } from './pdfiumChannels.js';

/**
 * The text read's bound is DERIVED (ADR-0130 Decision 3): the most runs an answer within the 8 MiB answer ceiling
 * could carry at the smallest a run serialises to. The literal is held to that division here, so a schema field added
 * or a ceiling moved cannot leave the bound a guess again.
 */
describe('engine/text-runs’ bound', () => {
  /** The smallest run the schema accepts: no text, every number 0, every flag `true` — a character shorter than `false`. */
  const smallest = {
    index: 0,
    last: 0,
    text: '',
    bottom: 0,
    top: 0,
    left: 0,
    right: 0,
    style: {
      size: 0,
      colour: { r: 0, g: 0, b: 0 },
      font: '',
      serif: true,
      mono: true,
      italic: true,
      bold: true,
      upright: true,
    },
  };

  it('SMALLEST_RUN_BYTES is the smallest run the schema accepts, serialised', () => {
    const answer = { runs: [smallest], truncated: false, unaddressable: 0 };
    // ACCEPTED, or the figure would be the size of something the wire refuses.
    expect(pdfiumChannels['engine/text-runs'].result.safeParse(answer).success).toBe(true);
    expect(JSON.stringify(smallest).length).toBe(SMALLEST_RUN_BYTES);
  });

  it('ENGINE_TEXT_OBJECTS_MAX is the answer ceiling over a run and its separator, rounded down to a hundred', () => {
    const derived = Math.floor(ENGINE_ANSWER_FILE_MAX_BYTES / (SMALLEST_RUN_BYTES + 1) / 100) * 100;
    expect(ENGINE_TEXT_OBJECTS_MAX).toBe(derived);
  });

  it('CONTROL: a run that ends before it starts is refused, so `last` says which objects a run is', () => {
    const backwards = { runs: [{ ...smallest, index: 5, last: 4 }], truncated: false, unaddressable: 0 };
    expect(pdfiumChannels['engine/text-runs'].result.safeParse(backwards).success).toBe(false);
  });
});

describe('engine/page-runs’ answer', () => {
  const run = { index: 3, members: [3, 5], text: 'ab', left: 0, right: 1, bottom: 0, top: 1 };
  const answer = (runs: readonly unknown[]) => pdfiumChannels['engine/page-runs'].result.safeParse({ textObjects: [3, 4, 5], runs });

  it('PAGE_TEXT_OBJECTS_MAX is the answer ceiling over the smallest index and its comma', () => {
    expect(PAGE_TEXT_OBJECTS_MAX).toBe(ENGINE_ANSWER_FILE_MAX_BYTES / 2);
  });

  it('accepts a run named by its first object, and refuses one named by any other (the control)', () => {
    expect(answer([run]).success).toBe(true);
    expect(answer([{ ...run, index: 5 }]).success).toBe(false);
    expect(answer([{ ...run, members: [] }]).success).toBe(false);
  });
});
