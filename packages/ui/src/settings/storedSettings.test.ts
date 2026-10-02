import { STORED_SETTINGS } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { ALL_SETTINGS } from './all.js';
import { UPDATE_CHECK_SETTING } from './updates.js';

/**
 * The settings `main` reads are the registry's own — one definition, never two that agree.
 *
 * `main` cannot import this package, so it reads a setting through the contract's definition (`storedSettings.ts`), and
 * the registry's entry SPREADS that definition. Row 265's audit found twelve readers in `main` each re-deriving a schema
 * or a default the registry held; they all agreed, which is why nothing had noticed. What holds them together now is
 * that they are the same objects, and this is where that is asserted.
 */
describe('the settings main reads', () => {
  it('each is registered, with the contract definition’s own schema and default', () => {
    // VACUITY GUARD: twelve were found, and a list that went empty would make every line below vacuous. ELEVEN since
    // the recent-files length stopped being a setting (2026-10-01: the list is always four, `MAX_RECENT_ENTRIES`).
    expect(STORED_SETTINGS.length).toBe(11);
    // THE UPDATE CHECK'S SWITCH IS REGISTERED ONLY WHILE THE CHECK HAS AN ADDRESS (ADR-0110, dormant), so it is not in
    // `ALL_SETTINGS` today; its definition is taken from where it is declared, and held the same way.
    const declared = [...ALL_SETTINGS, UPDATE_CHECK_SETTING];
    for (const stored of STORED_SETTINGS) {
      const registered = declared.find((setting) => setting.id === stored.id);
      expect(registered, stored.id).toBeDefined();
      // THE SAME SCHEMA OBJECT, not an equal one: an entry that wrote its own `z.boolean()` beside the spread would be
      // a second definition again, agreeing today.
      expect(registered?.schema, stored.id).toBe(stored.schema);
      expect(registered?.fallback, stored.id).toStrictEqual(stored.fallback);
    }
  });

  it('CONTROL: an entry that declared its own schema is told apart from one that took the contract’s', () => {
    // Without this, `toBe` on two schemas could pass for any two — the case above would then hold for an entry that
    // re-declared its schema, which is the defect it exists to catch.
    const stored = STORED_SETTINGS[0];
    if (stored === undefined) throw new Error('no stored settings');
    const redeclared = { ...stored, schema: stored.schema.optional() };
    expect(redeclared.schema).not.toBe(stored.schema);
  });
});
