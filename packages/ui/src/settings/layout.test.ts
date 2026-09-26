import { describe, expect, it } from 'vitest';

import { SECTION_IDS } from '../registries/placement.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from './all.js';
import { LAYOUT_MODE_SETTING, RIBBON_SECTION_SETTING } from './layout.js';

/**
 * The layout settings' own invariants — the ones a derived Settings dialog and the rail both read.
 */
describe('the layout settings', () => {
  it('the ribbon-section enum IS the rail’s section list, in the rail’s order', () => {
    // The enum is built from SECTION_IDS; this keeps a later hand-written enum from drifting off the rail unnoticed.
    expect(RIBBON_SECTION_SETTING.schema.options).toStrictEqual([...SECTION_IDS]);
  });

  it('the layout mode is §10.3’s three modes, Ribbon by default', () => {
    expect(LAYOUT_MODE_SETTING.schema.options).toStrictEqual(['ribbon', 'studio', 'focus']);
    expect(LAYOUT_MODE_SETTING.fallback).toBe('ribbon');
  });

  it('both are registered, and the registry accepts their titles and fallbacks', () => {
    // SettingsRegistry refuses an enum whose titles do not match its members and a fallback its schema refuses, at
    // construction — so constructing it over the shipped list is the check.
    const registry = new SettingsRegistry(ALL_SETTINGS);
    expect(registry.read(LAYOUT_MODE_SETTING.id, undefined)).toBe('ribbon');
    expect(registry.read(RIBBON_SECTION_SETTING.id, undefined)).toBe('home');
    expect(registry.read(RIBBON_SECTION_SETTING.id, 'organize')).toBe('organize');
    expect(registry.read(RIBBON_SECTION_SETTING.id, 'not-a-section')).toBe('home');
  });
});
