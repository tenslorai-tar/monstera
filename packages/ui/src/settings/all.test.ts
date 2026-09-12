import { SECRET_SETTING_IDS } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { ALL_SETTINGS } from './all.js';

/**
 * The registered set against the contract's list of secret ids.
 *
 * ## Both directions, because each failure is invisible from the other side
 *
 * A setting marked `secret: true` that the contract does not list would pass
 * `settings.save`'s refusal and reach the plaintext document. An id the
 * contract lists that no setting marks would be refused on `settings.save` and
 * never offered to `settings.saveSecret` by anything that reads the flag. Sorted
 * equality catches both; iterating either list alone would make it the universe
 * and miss the other's extra member.
 */
describe('the registered settings', () => {
  it('mark as secret EXACTLY the ids the contract keeps off settings.save', () => {
    const marked = ALL_SETTINGS.filter((setting) => setting.secret === true)
      .map((setting) => setting.id)
      .sort();

    // A VACUITY GUARD: two empty lists are equal, and a registry that stopped
    // marking anything secret would agree with a contract that listed nothing.
    expect(marked.length).toBeGreaterThan(0);
    expect(marked).toStrictEqual([...SECRET_SETTING_IDS].sort());
  });
});
