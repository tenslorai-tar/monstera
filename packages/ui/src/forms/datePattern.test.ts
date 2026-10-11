import { fieldFormatSchema } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { localDatePattern } from './datePattern.js';

describe('localDatePattern', () => {
  it('writes the locale’s own order and separator', () => {
    expect(localDatePattern('en-US')).toBe('mm/dd/yyyy');
    expect(localDatePattern('en-GB')).toBe('dd/mm/yyyy');
    expect(localDatePattern('de-DE')).toBe('dd.mm.yyyy');
  });

  it('a locale whose separators the format cannot carry still gets a pattern the contract accepts', () => {
    for (const locale of ['zh-CN', 'ja-JP', 'hu-HU', 'ar-EG', 'he-IL', 'ko-KR', 'nl-NL', 'fa-IR']) {
      const pattern = localDatePattern(locale);
      expect(fieldFormatSchema.safeParse({ kind: 'date', pattern }).success, `${locale}: ${pattern}`).toBe(true);
    }
  });

  it('CONTROL: two locales that order differently answer differently, so the reading is the locale’s', () => {
    expect(localDatePattern('en-US')).not.toBe(localDatePattern('en-GB'));
  });

  it('a locale Intl refuses falls back rather than refusing the field', () => {
    expect(localDatePattern('not a locale!')).toBe('mm/dd/yyyy');
  });
});
