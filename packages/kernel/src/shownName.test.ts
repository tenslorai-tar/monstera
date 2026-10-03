import { describe, expect, it } from 'vitest';

import { shownName } from './shownName.js';

describe('shownName', () => {
  it('leaves a name that fits exactly as it is', () => {
    const exactly = 'x'.repeat(256);
    expect(shownName(exactly, 256)).toBe(exactly);
  });

  it('shortens a longer one to the bound, ending in an ellipsis that says there is more', () => {
    const shown = shownName('Layer '.repeat(60), 256);
    expect(shown).toHaveLength(256);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown.startsWith('Layer Layer')).toBe(true);
  });

  it('never splits a surrogate pair, which would leave a character nothing can draw', () => {
    // 254 units, then a pair at units 255 and 256: a cut at 255 would end on the pair's first half.
    const name = `${'a'.repeat(254)}😀tail`;
    const shown = shownName(name, 256);
    expect(shown).toBe(`${'a'.repeat(254)}…`);
    // CONTROL: the pair whole where it fits, so the case above is about the cut and not about the character.
    expect(shownName(`${'a'.repeat(253)}😀tail`, 256)).toBe(`${'a'.repeat(253)}😀…`);
  });
});
