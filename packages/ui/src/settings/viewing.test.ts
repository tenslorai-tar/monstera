// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { DARK_PAGE_SETTING, GRID_SETTING, RULERS_SETTING, applyDarkPage } from './viewing.js';

describe('applyDarkPage', () => {
  it('puts the mode in force and takes it out again', () => {
    const root = document.createElement('div');

    applyDarkPage(root, true);
    expect(root.dataset['darkPage']).toBe('true');

    // REMOVED, not written false. `[data-dark-page='true']` is the selector, so
    // a `false` would not match it either — but an attribute that is present
    // and means nothing is a state a later selector could start matching by
    // accident, and there is no reason to leave one behind.
    applyDarkPage(root, false);
    expect(root.hasAttribute('data-dark-page')).toBe(false);
  });
});

describe('the viewing settings', () => {
  it('are off by default, except the rulers the owner’s design draws on every document screen', () => {
    // A reading aid that arrived switched on is a decision made for every reader on a fresh install —
    // which is why only the owner makes one. Their v5 design (2026-09-24) draws the rulers on every
    // document screen, so they arrive on; the grid and the dark page do not appear there.
    expect(RULERS_SETTING.fallback).toBe(true);
    expect(GRID_SETTING.fallback).toBe(false);
    expect(DARK_PAGE_SETTING.fallback).toBe(false);
  });

  it('every fallback is a value its own schema accepts', () => {
    // The registry throws at construction otherwise, which is where the accent
    // setting's first version was caught. Asserting it here names the setting
    // rather than failing at composition with a stack.
    for (const setting of [RULERS_SETTING, GRID_SETTING, DARK_PAGE_SETTING]) {
      expect(setting.schema.safeParse(setting.fallback).success).toBe(true);
    }
  });

  it('DARK PAGE IS NOT AN APPEARANCE SETTING, which is the distinction it exists for', () => {
    // A theme repaints the shell; this repaints the document. Filing it under
    // `appearance` would put "I want dark chrome" and "I want the document
    // inverted" in one drawer, and the common case is the first without the
    // second. The category is the only thing that records that here.
    expect(DARK_PAGE_SETTING.category).toBe('viewing');
    expect(DARK_PAGE_SETTING.id.startsWith('viewing.')).toBe(true);
  });
});
