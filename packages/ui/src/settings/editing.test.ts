import { describe, expect, it } from 'vitest';

import { SettingsRegistry } from '../registries/settings.js';
import { AUTHOR_NAME_SETTING, OCR_LANGUAGE_SETTING, authorFor } from './editing.js';

/**
 * *Your name for comments* (ADR-0103 Decision 2): empty by default, and empty means the Windows user
 * name `main` answers. `authorFor` is the one place the two are combined, so these cases are that
 * rule's whole specification.
 */
describe('the name a new mark carries', () => {
  it('is empty by default, which stands for the Windows user name', () => {
    expect(AUTHOR_NAME_SETTING.fallback).toBe('');
    expect(authorFor(AUTHOR_NAME_SETTING.fallback, 'priya.raman')).toBe('priya.raman');
  });

  it('is the typed name whenever one is typed — the setting wins', () => {
    expect(authorFor('Priya Raman', 'priya.raman')).toBe('Priya Raman');
  });

  it('treats a name of only spaces as no name, so a stray space does not sign comments blank', () => {
    expect(authorFor('   ', 'priya.raman')).toBe('priya.raman');
  });

  it('CONTROL: with no user name known either, the mark names nobody rather than something invented', () => {
    expect(authorFor('', '')).toBe('');
  });
});

/**
 * *Recognition languages* became a set on 2026-09-28 under the id an older build stored ONE language at. Read through
 * the registry, which is what the store does, so the migration is exercised on the path a stored value takes.
 */
describe('the recognition languages a person chose before they became a set', () => {
  const registry = new SettingsRegistry([OCR_LANGUAGE_SETTING]);

  it('a single stored language is read as a set of that one — the choice kept, not replaced by the fallback', () => {
    // GERMAN, not the fallback's English: a registry that refused the old value would answer `['eng']`, and a case
    // stored as `'eng'` could not tell the migration from the fallback.
    expect(registry.read(OCR_LANGUAGE_SETTING.id, 'deu')).toStrictEqual(['deu']);
  });

  it('CONTROL: a stored set is read as it is, and a value no build wrote falls back', () => {
    expect(registry.read(OCR_LANGUAGE_SETTING.id, ['fra', 'eng'])).toStrictEqual(['fra', 'eng']);
    expect(registry.read(OCR_LANGUAGE_SETTING.id, 'klingon')).toStrictEqual(['eng']);
    expect(registry.read(OCR_LANGUAGE_SETTING.id, ['eng', 'eng'])).toStrictEqual(['eng']);
  });
});
