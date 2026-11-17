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

  it('is registered, on by default, in this build, whose address is live (the owner’s decision of 2026-11-17)', () => {
    expect(UPDATES_SETTINGS.map((setting) => setting.id)).toStrictEqual([UPDATE_CHECK_SETTING_ID]);
    const row = ALL_SETTINGS.find((setting) => setting.id === UPDATE_CHECK_SETTING_ID);
    expect(row?.fallback).toBe(true);
    expect(row?.category).toBe('updates');
  });

  it('CONTROL: a dormant address registers none, from the same value main reads', async () => {
    // WITHOUT THIS a module that registered the row whatever the address passes the case above.
    vi.resetModules();
    vi.doMock('@monstera/contract', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@monstera/contract')>()),
      UPDATE_MANIFEST: { state: 'dormant' },
    }));
    const dormant = await import('./all.js');
    expect(dormant.ALL_SETTINGS.map((setting) => setting.id)).not.toContain(UPDATE_CHECK_SETTING_ID);
  });
});
