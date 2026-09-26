import { UPDATE_CHECK_SETTING_ID } from '@monstera/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALL_SETTINGS } from './all.js';
import { UPDATES_SETTINGS } from './updates.js';

/**
 * The update check's switch is registered exactly while the check has an address (ADR-0110): a switch for a check
 * that cannot run would read ON while nothing is ever asked.
 */
describe('Settings › Updates › Check for new versions', () => {
  afterEach(() => {
    vi.doUnmock('@monstera/contract');
    vi.resetModules();
  });

  it('is absent while the manifest address is dormant — this build', () => {
    expect(UPDATES_SETTINGS).toStrictEqual([]);
    expect(ALL_SETTINGS.map((setting) => setting.id)).not.toContain(UPDATE_CHECK_SETTING_ID);
  });

  it('CONTROL: a live address registers it, from the same value main reads, in the composed set', async () => {
    // WITHOUT THIS a module that never registered the row passes the case above, which is the defect's own output.
    vi.resetModules();
    vi.doMock('@monstera/contract', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@monstera/contract')>()),
      UPDATE_MANIFEST: { state: 'live', url: 'https://monsterapdf.com/updates/v1/store.json' },
    }));
    const live = await import('./all.js');
    const row = live.ALL_SETTINGS.find((setting) => setting.id === UPDATE_CHECK_SETTING_ID);
    expect(row?.fallback).toBe(true);
    expect(row?.category).toBe('updates');
  });
});
