import { UNWRITABLE_CHARACTERS_MAX, UNWRITABLE_CHARACTERS_MAX_UNITS } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { unwritableCharacters } from './textEditRefusals.js';

/**
 * Which characters a `text-not-writable` refusal names (ADR-0169 Decision 4).
 *
 * The rule is *what was written and is absent from what was read back*, so every case below is built from a read
 * that differs from the write in a known way, and the expected answer is one only that rule produces: a function that
 * named every character of a differing pair, or none, fails each of them.
 */
describe('the characters a refusal names', () => {
  it('names the characters of the write that the read-back lost, each once, in the order typed', () => {
    // `é` read back as `Ø` twice and `中` dropped: `à`, read back as itself, is carried and is not named.
    expect(unwritableCharacters([{ written: 'déjà vu, été 中', read: 'dØjà vu, ØtØ ' }])).toBe('é中');
  });

  it('names nothing for a pair that agrees — the control for the case above', () => {
    expect(unwritableCharacters([{ written: 'déjà vu', read: 'déjà vu' }])).toBe('');
  });

  it('never names whitespace, which a text page collapses whatever the font', () => {
    expect(unwritableCharacters([{ written: 'a  b\tc', read: 'abc' }])).toBe('');
  });

  it('names an accent typed as a combining mark WITH its letter', () => {
    const decomposed = `e${String.fromCodePoint(0x301)}`;
    expect(unwritableCharacters([{ written: `caf${decomposed}`, read: 'caf' }])).toBe(decomposed);
  });

  it('names across every pair, without repeating one already named', () => {
    expect(
      unwritableCharacters([
        { written: 'Ωmega', read: 'mega' },
        { written: 'Ωhm 中', read: 'hm ' },
      ]),
    ).toBe('Ω中');
  });

  it('stops at the wire’s bound, keeping the first typed', () => {
    const many = Array.from({ length: UNWRITABLE_CHARACTERS_MAX + 8 }, (_, at) => String.fromCodePoint(0x4e00 + at));
    const named = unwritableCharacters([{ written: many.join(''), read: '' }]);
    expect(named).toBe(many.slice(0, UNWRITABLE_CHARACTERS_MAX).join(''));
    expect(named.length).toBeLessThanOrEqual(UNWRITABLE_CHARACTERS_MAX_UNITS);
  });
});
