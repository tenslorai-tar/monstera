import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { SettingsRegistry, type SettingDefinition } from './registries/settings.js';
import { SettingsStore } from './settingsStore.js';

function setting(over: Partial<SettingDefinition> = {}): SettingDefinition {
  return {
    id: 'appearance.theme',
    title: messageKey('setting.theme.label'),
    schema: z.enum(['light', 'dark', 'system']),
    fallback: 'system',
    category: 'appearance',
    ...over,
  };
}

const registry = new SettingsRegistry([
  setting(),
  setting({ id: 'ai.key', schema: z.string(), fallback: '', secret: true, category: 'privacy' }),
]);

describe('SettingsStore', () => {
  it('answers the fallback for a setting nobody has set', () => {
    expect(new SettingsStore(registry).get('appearance.theme')).toBe('system');
  });

  it('refuses a value the schema does not accept, rather than storing it for `get` to cope with', () => {
    // Validating on write means a reader never has to carry the question, and
    // the dialog's own display of a value cannot depend on which path it took.
    const store = new SettingsStore(registry);
    expect(() => {
      store.set('appearance.theme', 'chartreuse');
    }).toThrow(/refused a value/u);
    expect(store.get('appearance.theme')).toBe('system');
  });

  it('CONTROL: an accepted value is stored and read back', () => {
    // Without this, "refuses a bad value" is satisfied by a store that refuses
    // every value — and no setting in the application would ever change.
    const store = new SettingsStore(registry);
    store.set('appearance.theme', 'dark');
    expect(store.get('appearance.theme')).toBe('dark');
  });

  it('drops a stored id the registry no longer knows, rather than carrying it forward', () => {
    // A setting an older build wrote and this one removed. Kept, it would make
    // `all()` answer with keys no schema governs and would re-export a removed
    // setting for ever.
    const store = new SettingsStore(registry);
    store.hydrate({ 'appearance.theme': 'dark', 'gone.setting': 'x' });

    expect(store.all()).toStrictEqual({ 'appearance.theme': 'dark' });
  });

  it('runs a hydrated value through the registry rather than trusting the disk', () => {
    // The assertion is that an INVALID stored value becomes the fallback while
    // a valid one survives. A store that trusted the disk passes neither, and a
    // store that ignored the disk passes only the first.
    const store = new SettingsStore(registry);
    store.hydrate({ 'appearance.theme': 'chartreuse' });
    expect(store.get('appearance.theme')).toBe('system');

    store.hydrate({ 'appearance.theme': 'dark' });
    expect(store.get('appearance.theme')).toBe('dark');
  });

  it('keeps secrets in `all` and excludes them from `exportable`', () => {
    // The two operations are different and conflating them gives you one of two
    // failures: a key leaked into a shared file, or a key forgotten every
    // launch. Which one depends on which caller reached for the store first,
    // so both halves are asserted here.
    const store = new SettingsStore(registry);
    store.set('appearance.theme', 'dark');
    store.set('ai.key', 'sk-not-a-real-key');

    expect(store.all()).toStrictEqual({
      'appearance.theme': 'dark',
      'ai.key': 'sk-not-a-real-key',
    });
    expect(store.exportable()).toStrictEqual({ 'appearance.theme': 'dark' });
  });

  it('notifies with the id that changed, and with `*` after a hydrate', () => {
    // A hydrate is not a list of ids: it may change any number at once, and a
    // component re-reading per id would render once per setting.
    const store = new SettingsStore(registry);
    const seen: string[] = [];
    const stop = store.subscribe((id) => seen.push(id));

    store.set('appearance.theme', 'dark');
    store.hydrate({ 'ai.key': 'x' });
    stop();
    store.set('appearance.theme', 'light');

    expect(seen).toStrictEqual(['appearance.theme', '*']);
  });

  it('refuses a write to an unregistered id rather than dropping it silently', () => {
    const store = new SettingsStore(registry);
    expect(() => {
      store.set('nobody.knows', 1);
    }).toThrow(/"nobody\.knows"/u);
  });
});
