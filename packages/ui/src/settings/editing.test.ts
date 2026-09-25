import { describe, expect, it } from 'vitest';

import { AUTHOR_NAME_SETTING, authorFor } from './editing.js';

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
