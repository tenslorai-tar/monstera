import { describe, expect, it } from 'vitest';

import { TEXT_EDIT_CHARACTERS_LABEL } from '../messages/en.js';
import { problemParticulars } from './problemMessages.js';

/**
 * What a surface shows beside a problem's sentence (ADR-0169). Read by the dialog and the editor alike, so a row with
 * nothing in it reaches both.
 */
describe('problemParticulars', () => {
  it('names the characters a font cannot show, one at a time', () => {
    expect(problemParticulars({ code: 'text-not-writable', detail: { characters: '中文' } })).toStrictEqual({
      label: TEXT_EDIT_CHARACTERS_LABEL,
      value: '中 文',
    });
  });

  /**
   * RRRRRRR-16: `main` forwards only characters the person typed, so a refusal can name none. A label over an empty
   * value reads as a list that failed to load; the sentence stands alone. CONTROL: the case above, the same code with a
   * character, shows its row.
   */
  it('shows no row when the refusal names no character', () => {
    expect(problemParticulars({ code: 'text-not-writable', detail: { characters: '' } })).toBeUndefined();
  });
});
