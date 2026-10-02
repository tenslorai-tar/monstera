import { describe, expect, it } from 'vitest';

import { SettingsRegistry } from '../registries/settings.js';
import { ORGANIZE_GRID_SIZE_SETTING } from './appearance.js';

describe('Organize’s page view (appearance.organize-grid-size)', () => {
  const registry = new SettingsRegistry([ORGANIZE_GRID_SIZE_SETTING]);
  const read = (stored: unknown): unknown => registry.read(ORGANIZE_GRID_SIZE_SETTING.id, stored);

  it('offers Thumbnail and Full page, Thumbnail by default', () => {
    expect(ORGANIZE_GRID_SIZE_SETTING.schema.options).toStrictEqual(['thumbnail', 'full-page']);
    expect(read(undefined)).toBe('thumbnail');
    expect(read('full-page')).toBe('full-page');
  });

  it('reads v5-09’s stored Medium and Large as Thumbnail, the card view each was', () => {
    expect(read('medium')).toBe('thumbnail');
    expect(read('large')).toBe('thumbnail');
  });

  it('CONTROL: a value no build ever stored is refused, not migrated', () => {
    // WHAT THE MIGRATION DOES NOT DO is the half that separates it from a catch-all: the registry's fallback answers
    // here, and `accept` says the value was not one of this setting's.
    expect(registry.accept(ORGANIZE_GRID_SIZE_SETTING.id, 'huge')).toBeUndefined();
    expect(registry.accept(ORGANIZE_GRID_SIZE_SETTING.id, 'large')).toStrictEqual({ value: 'thumbnail' });
  });
});
