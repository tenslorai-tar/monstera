import { describe, expect, it } from 'vitest';

import { PanelPresence, sidesThatGiveWay } from './panelPresence.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import {
  CONTEXT_PANEL_MIN_WIDTH,
  CONTEXT_PANEL_OPEN_SETTING,
  DOCUMENT_PANEL_MIN_WIDTH,
  DOCUMENT_PANEL_OPEN_SETTING,
  EDGE_HANDLE_WIDTH,
  PAGE_AREA_MIN_WIDTH,
} from './settings/layout.js';
import { SettingsStore } from './settingsStore.js';

/** The widths the rule turns on, from the constants rather than restated: both in the row, and the left alone. */
const BOTH = PAGE_AREA_MIN_WIDTH + DOCUMENT_PANEL_MIN_WIDTH + CONTEXT_PANEL_MIN_WIDTH;
const LEFT = PAGE_AREA_MIN_WIDTH + DOCUMENT_PANEL_MIN_WIDTH + EDGE_HANDLE_WIDTH;
const BOTH_OPEN = { start: true, end: true } as const;

function presence(): { readonly settings: SettingsStore; readonly presence: PanelPresence } {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  return { settings, presence: new PanelPresence(settings) };
}

describe('sidesThatGiveWay (ADR-0146 Decision 2)', () => {
  it('keeps both sides while the row holds the floor beside both minimums, to the pixel', () => {
    expect(sidesThatGiveWay(BOTH, BOTH_OPEN)).toStrictEqual({ start: false, end: false });
    expect(sidesThatGiveWay(BOTH - 1, BOTH_OPEN)).toStrictEqual({ start: false, end: true });
  });

  it('gives the RIGHT side way first, then the left, and counts a side that gave way as its handle', () => {
    expect(sidesThatGiveWay(LEFT, BOTH_OPEN)).toStrictEqual({ start: false, end: true });
    expect(sidesThatGiveWay(LEFT - 1, BOTH_OPEN)).toStrictEqual({ start: true, end: true });
  });

  it('CONTROL: a rule that counted a shut side at its minimum would push the right side out of a row that holds it', () => {
    // The left is shut, so it costs its handle: the floor, a handle and the right's minimum fit exactly.
    const row = PAGE_AREA_MIN_WIDTH + EDGE_HANDLE_WIDTH + CONTEXT_PANEL_MIN_WIDTH;
    expect(row).toBeLessThan(BOTH);
    expect(sidesThatGiveWay(row, { start: false, end: true })).toStrictEqual({ start: false, end: false });
  });

  it('never says a SHUT side gave way, and keeps everything before the row has been measured', () => {
    expect(sidesThatGiveWay(100, { start: false, end: false })).toStrictEqual({ start: false, end: false });
    expect(sidesThatGiveWay(undefined, BOTH_OPEN)).toStrictEqual({ start: false, end: false });
  });
});

describe('PanelPresence (ADR-0146 Decisions 3 and 4)', () => {
  it('draws a side that gave way as its handle WITHOUT writing its setting, and in the row again when there is room', () => {
    const { settings, presence: panels } = presence();
    panels.measure(LEFT);
    expect(panels.form('start')).toBe('row');
    expect(panels.form('end')).toBe('handle');
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
    panels.measure(BOTH);
    expect(panels.form('end')).toBe('row');
  });

  it('SHOWS a side that gave way as its sheet, and HIDES the sheet before it touches the setting', () => {
    const { settings, presence: panels } = presence();
    panels.measure(LEFT);
    panels.show('end');
    expect(panels.form('end')).toBe('sheet');
    expect(panels.shown('end')).toBe(true);

    panels.hide('end');
    expect(panels.form('end')).toBe('handle');
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);

    // IN THE ROW, hide is the chevron it always was: it shuts the setting.
    panels.hide('start');
    expect(settings.get(DOCUMENT_PANEL_OPEN_SETTING.id)).toBe(false);
  });

  it('opens a sheet for a side that SHOWING makes give way — decided after the write, not before', () => {
    // The left is in the row and the right is shut, which the row holds; opening the right is what makes it not fit.
    const { settings, presence: panels } = presence();
    settings.set(CONTEXT_PANEL_OPEN_SETTING.id, false);
    panels.measure(LEFT);
    expect(panels.form('end')).toBe('handle');

    panels.show('end');
    // CONTROL: read BEFORE the write, the right side had room, so no sheet would open and nothing would show.
    expect(panels.form('end')).toBe('sheet');
    expect(panels.form('start')).toBe('row');
  });

  it('keeps ONE sheet: showing the other side replaces it', () => {
    const { presence: panels } = presence();
    panels.measure(LEFT - 1);
    panels.show('end');
    panels.show('start');
    expect(panels.form('start')).toBe('sheet');
    expect(panels.form('end')).toBe('handle');
  });

  it('forgets a sheet once its side has room, so a later narrowing does not bring it back unasked', () => {
    const { presence: panels } = presence();
    panels.measure(LEFT);
    panels.show('end');
    panels.measure(BOTH);
    expect(panels.form('end')).toBe('row');
    panels.measure(LEFT);
    expect(panels.form('end')).toBe('handle');
  });

  it('tells its readers when the row, the sheet or an open setting moves, and stops when they leave', () => {
    const { presence: panels } = presence();
    let heard = 0;
    const off = panels.subscribe(() => {
      heard += 1;
    });
    panels.measure(LEFT);
    expect(heard).toBe(1);
    // A SHOW WHOSE SETTING WAS ALREADY ON is two: the store tells of every write, and then the sheet. A sheet that went
    // unheard is a panel that never draws, with the setting's notice standing in for it — which is why this counts.
    panels.show('end');
    expect(heard).toBe(3);
    panels.hide('start');
    expect(heard).toBe(4);
    off();
    panels.measure(BOTH);
    expect(heard).toBe(4);
  });
});
