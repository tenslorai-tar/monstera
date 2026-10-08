import { describe, expect, it } from 'vitest';

import { MAX_SETTINGS_BYTES, channels, serialisedLengthWithin } from './channels.js';

const schema = channels['settings.save'].params;

describe('settings.save is bounded as a whole (CR-SEC-07)', () => {
  it('refuses a document past the bound, whichever way it is large: one long value, many keys, or deep nesting', () => {
    const oneLongValue = { values: { theme: 'x'.repeat(MAX_SETTINGS_BYTES) } };
    const manyKeys = { values: Object.fromEntries(Array.from({ length: 100_000 }, (_, index) => [`setting-${String(index)}`, 'a value'])) };
    let deep: unknown = 'leaf';
    for (let level = 0; level < 200_000; level += 1) deep = [deep];
    const nested = { values: { theme: deep } };

    for (const oversized of [oneLongValue, manyKeys]) {
      expect(schema.safeParse(oversized).success).toBe(false);
    }
    // A DEEPLY NESTED VALUE is refused rather than thrown at: serialising it may overflow the stack, and that is an
    // answer of "not within any bound" and not an exception out of the schema.
    expect(() => schema.safeParse(nested)).not.toThrow();
    expect(schema.safeParse(nested).success).toBe(false);
  });

  it('counts bytes, not characters: multi-byte text that is under the bound in characters and over it in bytes is refused', () => {
    // Each character below is three bytes in UTF-8 and one UTF-16 unit.
    const characters = Math.floor(MAX_SETTINGS_BYTES / 2);
    expect(serialisedLengthWithin({ text: '€'.repeat(characters) }, MAX_SETTINGS_BYTES)).toBe(false);
  });

  it('CONTROL: an ordinary settings document, and one just under the bound, are accepted', () => {
    expect(schema.safeParse({ values: { theme: 'dark', zoom: 1.25, tools: { pen: { colour: '#000000' } } } }).success).toBe(true);
    expect(schema.safeParse({ values: {} }).success).toBe(true);
    expect(serialisedLengthWithin({ text: 'x'.repeat(MAX_SETTINGS_BYTES - 20) }, MAX_SETTINGS_BYTES)).toBe(true);
  });
});
